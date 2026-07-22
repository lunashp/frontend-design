import { describe, it, expect, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { scanProject } from '../../src/pipeline/scan-project.js';
import { EngineSession } from '../../src/pipeline/session.js';
import { AdapterRegistry } from '../../src/adapters/registry.js';
import { reactAdapter } from '../../src/adapters/react/react-adapter.js';
import type { FrameworkAdapter } from '../../src/types/adapter.js';
import type { ScanResult } from '../../src/types/artifact.js';

const FIXTURE = path.resolve(import.meta.dirname, '../fixtures/simple-react');
const WS = path.join(os.tmpdir(), 'ce-scan-ws');

let result: ScanResult;

async function getResult(): Promise<ScanResult> {
  result ??= await scanProject({ rootPath: FIXTURE }, { workspaceRoot: WS });
  return result;
}

afterAll(async () => {
  await fs.rm(WS, { recursive: true, force: true });
});

describe('scanProject (simple-react fixture)', () => {
  it('discovers exactly the UI components (not hooks, contexts, or types)', async () => {
    const r = await getResult();
    const names = r.components.map((c) => c.descriptor.name).sort();
    expect(names).toEqual([
      'Badge',
      'Button',
      'Card',
      'Chip',
      'StyledTag',
      'StyledTagLink',
      'ThemedNote',
      'UserPanel',
    ]);
    expect(r.framework).toBe('react');
    expect(r.warnings).toEqual([]);
    expect(r.failures).toEqual([]);
  });

  it('discovers styled-components, which contain no JSX of their own', async () => {
    const r = await getResult();
    const tag = r.components.find((c) => c.descriptor.name === 'StyledTag');
    expect(tag).toBeDefined();
    expect(tag!.descriptor.filePath).toMatch(/StyledTag\.tsx$/);
    // `styled(Component)` is a different tag shape and must be caught too.
    expect(r.components.some((c) => c.descriptor.name === 'StyledTagLink')).toBe(true);
  });

  it('names an anonymous default export after its folder', async () => {
    const r = await getResult();
    const note = r.components.find((c) => c.descriptor.name === 'ThemedNote');
    expect(note).toBeDefined();
    expect(note!.descriptor.exportName).toBe('default');
    expect(note!.descriptor.isDefaultExport).toBe(true);
  });

  it('extracts Button props including enum options and defaults', async () => {
    const r = await getResult();
    const button = r.components.find((c) => c.descriptor.name === 'Button');
    expect(button).toBeDefined();
    const props = new Map(button!.propModel.props.map((p) => [p.name, p]));

    const variant = props.get('variant');
    expect(variant?.kind).toBe('enum');
    expect(variant?.options).toEqual(expect.arrayContaining(['primary', 'secondary']));

    expect(props.get('size')?.kind).toBe('enum');
    expect(props.get('disabled')?.kind).toBe('boolean');
    expect(props.get('children')?.required).toBe(true);
    // Inherited DOM props must be filtered out.
    expect(props.has('className')).toBe(false);
  });

  it('classifies presentational atoms vs context-consuming containers', async () => {
    const r = await getResult();
    const button = r.components.find((c) => c.descriptor.name === 'Button')!;
    expect(button.classification.atomicLevel).toBe('atom');
    expect(button.classification.kind).toBe('presentational');
    expect(button.classification.contextDependencyScore).toBe(0);

    const userPanel = r.components.find((c) => c.descriptor.name === 'UserPanel')!;
    expect(userPanel.classification.kind).toBe('container');
    expect(userPanel.classification.contextDependencyScore).toBeGreaterThan(0);
  });

  it('does not demote a component that reads only the theme', async () => {
    const r = await getResult();
    // ThemedNote calls `useTheme()` and nothing else. That used to make it a
    // container with a 1.5 score (and so a `stubbed` preview) — a styling
    // concern masquerading as a data dependency.
    const note = r.components.find((c) => c.descriptor.name === 'ThemedNote')!;
    expect(note.signals.contextConsumers).toEqual(['useTheme']);
    expect(note.classification.kind).toBe('presentational');
    expect(note.classification.contextDependencyScore).toBe(0);

    // UserPanel reads the theme too, but its score comes from the session.
    const userPanel = r.components.find((c) => c.descriptor.name === 'UserPanel')!;
    expect(userPanel.signals.contextConsumers).toEqual(['useTheme', 'useSession']);
    expect(userPanel.classification.contextDependencyScore).toBe(1.5);
  });

  it('attaches the signals a classification was derived from to every summary', async () => {
    const r = await getResult();
    const button = r.components.find((c) => c.descriptor.name === 'Button')!;
    expect(button.signals.contextConsumers).toEqual([]);
    expect(button.signals.propCount).toBeGreaterThan(0);
    expect(button.signals.childComponentCount).toBe(0);

    const card = r.components.find((c) => c.descriptor.name === 'Card')!;
    expect(card.signals.childComponentCount).toBeGreaterThan(0);
    expect(card.signals.jsxDepth).toBeGreaterThan(1);
  });

  it('catalogues a named+default export of one declaration only once', async () => {
    const r = await getResult();
    const badges = r.components.filter((c) => c.descriptor.name === 'Badge');
    expect(badges).toHaveLength(1);
    // The named export is kept: it ports as an explicit `import { Badge }`.
    expect(badges[0]!.descriptor.exportName).toBe('Badge');
    expect(badges[0]!.descriptor.isDefaultExport).toBe(false);
  });

  it('detects the color-typed prop on Badge as a color control', async () => {
    const r = await getResult();
    const badge = r.components.find((c) => c.descriptor.name === 'Badge')!;
    const color = badge.propModel.props.find((p) => p.name === 'color');
    expect(color?.kind).toBe('color');
  });

  it('yields to the event loop while classifying', async () => {
    const session = await EngineSession.create({ rootPath: FIXTURE }, { workspaceRoot: WS });

    // Count event-loop turns that happen *while* the scan runs. A fully
    // synchronous classify loop lets it turn zero times — which is why the host
    // could not answer /api/health, and why queued WS progress frames only
    // flushed once the scan was already over.
    let scanning = true;
    let turns = 0;
    const tick = (): void => {
      if (!scanning) return;
      turns += 1;
      setImmediate(tick);
    };
    setImmediate(tick);

    await session.scan();
    scanning = false;

    expect(turns).toBeGreaterThan(1);
  });
});

describe('scanProject — analysis failures', () => {
  /** The React adapter, but prop extraction blows up for one component. */
  const failingAdapter: FrameworkAdapter = {
    ...reactAdapter,
    extractProps(descriptor, program) {
      if (descriptor.name === 'Badge') throw new Error('checker exploded');
      return reactAdapter.extractProps(descriptor, program);
    },
  };

  it('names a failed component in failures[] as well as in warnings', async () => {
    const session = await EngineSession.create(
      { rootPath: FIXTURE },
      { workspaceRoot: WS, registry: new AdapterRegistry().register(failingAdapter) },
    );
    const r = await session.scan();

    expect(r.failures).toHaveLength(1);
    const [failure] = r.failures;
    expect(failure!.name).toBe('Badge');
    expect(failure!.filePath).toMatch(/Badge\.tsx$/);
    expect(failure!.message).toBe('checker exploded');
    expect(failure!.componentId).toEqual(expect.any(String));

    // The prose warning is kept: it is what a human reads in the log.
    expect(r.warnings).toEqual(['Failed to analyze Badge: checker exploded']);
    // And the component is absent rather than listed with fabricated metadata.
    expect(r.components.some((c) => c.descriptor.name === 'Badge')).toBe(false);
  });
});
