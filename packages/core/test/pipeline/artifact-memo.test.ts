import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EngineSession } from '../../src/pipeline/session.js';
import { AdapterRegistry } from '../../src/adapters/registry.js';
import { reactAdapter } from '../../src/adapters/react/react-adapter.js';
import type { BuildEntryInput, FrameworkAdapter } from '../../src/types/adapter.js';

/**
 * A built artifact is immutable and a session is per-scan, so building it twice
 * for the same id is pure waste — the web bounces Details<->Preview<->Portable<->
 * Customize and re-opens components, paying a full portability + tokenization
 * rebuild each time. These tests pin the per-id memo: the same instance comes
 * back on repeat calls, and the heavy build runs exactly once per id.
 */

const FIXTURE = path.resolve(import.meta.dirname, '../fixtures/simple-react');
const WS = path.join(os.tmpdir(), 'ce-artifact-memo-ws');

describe('buildArtifact — per-id memo', () => {
  let session: EngineSession;
  // `buildEntry` runs once per genuine artifact build (nothing in scan() touches
  // it), so its call count is the "heavy work actually ran" signal the memo must
  // hold at 1 across repeat lookups. Counted through the adapter seam so the real
  // build behaviour is preserved.
  let buildEntrySpy: ReturnType<typeof vi.fn>;
  const byName = new Map<string, string>();

  beforeAll(async () => {
    buildEntrySpy = vi.fn((input: BuildEntryInput): string => reactAdapter.buildEntry(input));
    const adapter: FrameworkAdapter = { ...reactAdapter, buildEntry: buildEntrySpy };
    session = await EngineSession.create(
      { rootPath: FIXTURE },
      { workspaceRoot: WS, registry: new AdapterRegistry().register(adapter) },
    );
    const scan = await session.scan();
    for (const c of scan.components) byName.set(c.descriptor.name, c.descriptor.id);
  });

  afterAll(async () => {
    await fs.rm(WS, { recursive: true, force: true });
  });

  it('returns the same artifact instance on repeat calls and builds it only once', () => {
    const id = byName.get('Button') as string;
    const before = buildEntrySpy.mock.calls.length;
    const first = session.buildArtifact(id);
    const second = session.buildArtifact(id);
    // Referential identity: the second lookup hands back the memoized instance.
    expect(second).toBe(first);
    // ...and the heavy build ran exactly once despite two lookups.
    expect(buildEntrySpy.mock.calls.length - before).toBe(1);
  });

  it('memoizes per id — distinct ids get distinct instances, each built once', () => {
    const buttonId = byName.get('Button') as string;
    const cardId = byName.get('Card') as string;
    const beforeCard = buildEntrySpy.mock.calls.length;
    const card = session.buildArtifact(cardId);
    // Card had never been built, so exactly one build ran for it.
    expect(buildEntrySpy.mock.calls.length - beforeCard).toBe(1);
    // Distinct components never share a memo slot.
    const button = session.buildArtifact(buttonId);
    expect(card).not.toBe(button);
    // Repeat lookups of either id stay pinned to their own instance.
    expect(session.buildArtifact(cardId)).toBe(card);
    expect(session.buildArtifact(buttonId)).toBe(button);
  });
});
