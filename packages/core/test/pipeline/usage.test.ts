/**
 * Pipeline-level proof that the usage index reaches the ScanResult summaries: a
 * scan of the `usage-graph` fixture must carry `usage.usedByCount` on every
 * component, computed once per scan and attached to each ComponentSummary.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { scanProject } from '../../src/pipeline/scan-project.js';
import type { ScanResult } from '../../src/types/artifact.js';

const FIXTURE = path.resolve(import.meta.dirname, '../fixtures/usage-graph');
const WS = path.join(os.tmpdir(), 'ce-usage-pipeline-ws');

let result: ScanResult;
async function getResult(): Promise<ScanResult> {
  result ??= await scanProject({ rootPath: FIXTURE }, { workspaceRoot: WS });
  return result;
}

afterAll(async () => {
  await fs.rm(WS, { recursive: true, force: true });
});

describe('scanProject — usage index reaches summaries', () => {
  it('attaches usedByCount to every summary', async () => {
    const r = await getResult();
    for (const c of r.components) {
      expect(c.usage).toBeDefined();
      expect(typeof c.usage?.usedByCount).toBe('number');
    }
  });

  it('reports 4 importers for the shared Button and 0 for the story-only Widget', async () => {
    const r = await getResult();
    const button = r.components.find((c) => c.descriptor.name === 'Button');
    const widget = r.components.find((c) => c.descriptor.name === 'Widget');

    expect(button?.usage?.usedByCount).toBe(4);
    // The known, disclosed caveat: a component used only by a .stories file reads
    // 0 because story files are excluded from the analyzed program.
    expect(widget?.usage?.usedByCount).toBe(0);
  });

  it('excludes the barrel file and the component`s own file from usedByFiles', async () => {
    const r = await getResult();
    const button = r.components.find((c) => c.descriptor.name === 'Button');
    const files = button?.usage?.usedByFiles ?? [];
    expect(files.some((f) => f.endsWith('/ui/index.ts'))).toBe(false);
    expect(files.some((f) => f.endsWith('/Button/Button.tsx'))).toBe(false);
    expect(files.length).toBe(4);
  });
});
