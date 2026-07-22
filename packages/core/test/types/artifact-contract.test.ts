/**
 * Contract-level assertions on what a scan actually emits. These guard the
 * fields a consumer is promised but that no other test looks at: the
 * classification `signals` (previously computed and then dropped on the floor),
 * the structured `failures` list, and the artifact version they belong to.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ARTIFACT_VERSION } from '../../src/types/artifact.js';
import { scanProject } from '../../src/pipeline/scan-project.js';
import type { ScanResult } from '../../src/types/artifact.js';

const FIXTURE = path.resolve(import.meta.dirname, '../fixtures/simple-react');
const WS = path.join(os.tmpdir(), 'ce-contract-ws');

let result: ScanResult;

async function getResult(): Promise<ScanResult> {
  result ??= await scanProject({ rootPath: FIXTURE }, { workspaceRoot: WS });
  return result;
}

afterAll(async () => {
  await fs.rm(WS, { recursive: true, force: true });
});

describe('artifact contract', () => {
  it('is at the version that introduced signals/failures/stubbedModules', () => {
    expect(ARTIFACT_VERSION).toBe(2);
  });

  it('carries the classification signals on every summary', async () => {
    const r = await getResult();
    expect(r.components.length).toBeGreaterThan(0);
    for (const c of r.components) {
      expect(c.signals, `${c.descriptor.name} has no signals`).toBeDefined();
      expect(typeof c.signals.jsxDepth).toBe('number');
      expect(Array.isArray(c.signals.hookNames)).toBe(true);
    }
  });

  it('exposes signals that explain the classification, not just restate it', async () => {
    const r = await getResult();
    // UserPanel is the fixture's context-consuming container; its score is
    // non-zero *because* of signals a consumer can now see for itself.
    const userPanel = r.components.find((c) => c.descriptor.name === 'UserPanel');
    expect(userPanel).toBeDefined();
    expect(userPanel!.classification.contextDependencyScore).toBeGreaterThan(0);
    expect(userPanel!.signals.contextConsumers.length).toBeGreaterThan(0);

    const button = r.components.find((c) => c.descriptor.name === 'Button');
    expect(button!.signals.contextConsumers).toEqual([]);
    expect(button!.signals.propCount).toBeGreaterThan(0);
  });

  it('reports failures as a structured list alongside the prose warnings', async () => {
    const r = await getResult();
    expect(Array.isArray(r.failures)).toBe(true);
    for (const f of r.failures) {
      expect(typeof f.componentId).toBe('string');
      expect(typeof f.name).toBe('string');
      expect(typeof f.filePath).toBe('string');
      expect(typeof f.message).toBe('string');
    }
  });

  it('gives scan-level heuristic findings a field of their own', async () => {
    const r = await getResult();
    // Present on EVERY scan, empty on a healthy one — a consumer must be able to
    // read the field unconditionally rather than sniffing prose out of `warnings`.
    expect(Array.isArray(r.heuristicWarnings)).toBe(true);
    for (const h of r.heuristicWarnings) {
      expect(typeof h.signal).toBe('string');
      expect(typeof h.dependency).toBe('string');
      expect(typeof h.scanned).toBe('number');
      expect(typeof h.message).toBe('string');
    }
  });

  it('keeps `warnings` to the prose restatement of `failures` and nothing else', async () => {
    const r = await getResult();
    // Once anything else rides on this list, every consumer that caps it (the
    // MCP relay caps at 20) drops whichever finding happens to sort last.
    expect([...r.warnings].sort()).toEqual(
      r.failures.map((f) => `Failed to analyze ${f.name}: ${f.message}`).sort(),
    );
  });
});
