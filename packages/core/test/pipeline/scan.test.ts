import { describe, it, expect, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { scanProject } from '../../src/pipeline/scan-project.js';
import { EngineSession } from '../../src/pipeline/session.js';
import { AdapterRegistry } from '../../src/adapters/registry.js';
import { reactAdapter } from '../../src/adapters/react/react-adapter.js';
import type { FrameworkAdapter } from '../../src/types/adapter.js';
import type { ClassificationSignals, ComponentDescriptor } from '../../src/types/component.js';
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
      'StyledPanel',
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

  it('discovers a styled factory exported directly as the default', async () => {
    const r = await getResult();
    // ts-morph exports this one as the TaggedTemplateExpression itself, with no
    // variable declaration wrapping it — the shape discovery used to fall
    // through on, silently losing every `export default styled.x\`…\`` file.
    const panel = r.components.find((c) => c.descriptor.name === 'StyledPanel');
    expect(panel).toBeDefined();
    expect(panel!.descriptor.exportName).toBe('default');
    expect(panel!.descriptor.filePath).toMatch(/StyledPanel\.tsx$/);
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

/**
 * Grading the detectors themselves is a property of the whole corpus, not of any
 * one component, and `detectDegenerateHeuristics` deliberately stays silent below
 * 40 components — more than any on-disk fixture here has. So the corpus is
 * synthesised by the adapter instead: what is under test is where the finding
 * LANDS on a ScanResult, not the detector, which `classify/heuristic-health` owns.
 */
describe('scanProject — scan-level heuristic findings', () => {
  const STORE_FIXTURE = path.resolve(import.meta.dirname, '../fixtures/store-target');

  const SILENT_SIGNALS: ClassificationSignals = {
    childComponentCount: 0,
    jsxDepth: 1,
    hookNames: [],
    usesRouter: false,
    usesStore: false,
    usesDataFetching: false,
    contextConsumers: [],
    isClientComponent: true,
    propCount: 0,
  };

  function unreachable(method: string): never {
    throw new Error(`${method} is never called by scan()`);
  }

  /** Reports `count` components on which every graded signal reads false. */
  function silentAdapter(count: number): FrameworkAdapter {
    const descriptors: ComponentDescriptor[] = Array.from({ length: count }, (_, i) => ({
      id: `/s/C${i}.tsx#C${i}`,
      name: `C${i}`,
      filePath: `/s/C${i}.tsx`,
      exportName: `C${i}`,
      isDefaultExport: false,
      loc: { file: `/s/C${i}.tsx`, line: 1, column: 1 },
    }));
    return {
      id: 'react',
      detect: () => ({ matches: true, confidence: 1 }),
      createProgram: (project) => ({ framework: 'react', project, handle: null }),
      discoverComponents: () => descriptors,
      extractProps: () => ({ props: [] }),
      extractSignals: () => SILENT_SIGNALS,
      styleStrategies: () => [],
      sandpackTemplate: () => 'react-ts',
      buildEntry: () => unreachable('buildEntry'),
      generateProviderStubs: () => unreachable('generateProviderStubs'),
    };
  }

  it('puts a collapsed detector on its own typed field, never as prose in warnings', async () => {
    const session = await EngineSession.create(
      { rootPath: STORE_FIXTURE },
      { workspaceRoot: WS, registry: new AdapterRegistry().register(silentAdapter(60)) },
    );
    const r = await session.scan();

    expect(r.heuristicWarnings).toHaveLength(1);
    const [h] = r.heuristicWarnings;
    expect(h!.signal).toBe('usesStore');
    expect(h!.dependency).toBe('zustand');
    expect(h!.scanned).toBe(60);
    expect(h!.message).toMatch(/zustand/);

    // The defect this replaces: the finding was appended LAST to the untyped
    // `warnings`, so every consumer that caps that list cut the finding first —
    // on exactly the large targets whose scale makes it diagnostic.
    expect(r.warnings).toEqual([]);
  });

  it('stays empty when every graded detector still fires', async () => {
    const firing = silentAdapter(60);
    const session = await EngineSession.create(
      { rootPath: STORE_FIXTURE },
      {
        workspaceRoot: WS,
        registry: new AdapterRegistry().register({
          ...firing,
          extractSignals: () => ({ ...SILENT_SIGNALS, usesStore: true }),
        }),
      },
    );
    const r = await session.scan();

    expect(r.heuristicWarnings).toEqual([]);
  });
});
