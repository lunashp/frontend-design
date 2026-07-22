/**
 * End-to-end proof that a collapsed heuristic reaches the caller. The pure rule
 * is covered in test/classify/heuristic-health.test.ts; what this pins is that
 * `scan()` actually runs it and puts the result somewhere a human reads —
 * without that, the check is as silent as the heuristic it is watching.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { scanProject } from '../../src/pipeline/scan-project.js';

const ROOT = path.join(os.tmpdir(), `ce-heuristic-${process.pid}`);
const WS = path.join(ROOT, '.ws');

/** A project of `count` trivial atoms — none of which reads a store. */
async function makeProject(dir: string, deps: Record<string, string>, count: number): Promise<void> {
  const src = path.join(dir, 'src');
  await fs.mkdir(src, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'heuristic-fixture',
      version: '1.0.0',
      private: true,
      type: 'module',
      dependencies: { react: '^19.2.0', 'react-dom': '^19.2.0', ...deps },
    }),
  );
  await fs.writeFile(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { jsx: 'react-jsx', baseUrl: '.' }, include: ['src'] }),
  );
  for (let i = 0; i < count; i += 1) {
    await fs.writeFile(
      path.join(src, `Atom${i}.tsx`),
      `export function Atom${i}() {\n  return <span>atom ${i}</span>;\n}\n`,
    );
  }
}

afterAll(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

describe('scan surfaces a heuristic that never fired', () => {
  it('reports a declared store library detected in zero of many components', async () => {
    const dir = path.join(ROOT, 'with-zustand');
    await makeProject(dir, { zustand: '^4.5.0' }, 45);

    const r = await scanProject({ rootPath: dir }, { workspaceRoot: WS });

    expect(r.components).toHaveLength(45);
    const [warning, ...rest] = r.heuristicWarnings;
    expect(warning, `findings were: ${JSON.stringify(r.heuristicWarnings)}`).toBeDefined();
    expect(rest).toEqual([]);
    expect(warning).toMatchObject({ signal: 'usesStore', dependency: 'zustand', scanned: 45 });
    expect(warning.message).toMatch(/0 of 45/);
  });

  it('keeps the finding OUT of the prose warnings, which only restate failures', async () => {
    // The defect this field exists to fix: appended to `warnings` the finding
    // sorted LAST, so every consumer that caps that list (the MCP relay caps at
    // 20) dropped the scan-level finding first. Leaving a prose copy behind
    // would keep that trap armed for anyone who reads `warnings` instead.
    const dir = path.join(ROOT, 'with-zustand-prose');
    await makeProject(dir, { zustand: '^4.5.0' }, 45);

    const r = await scanProject({ rootPath: dir }, { workspaceRoot: WS });

    expect(r.heuristicWarnings).toHaveLength(1);
    expect(r.warnings.filter((w) => w.includes('zustand'))).toEqual([]);
    // Nothing failed to analyze in this fixture, so the prose log is empty.
    expect(r.warnings).toEqual([]);
  });

  it('stays silent on the same project without the corroborating dependency', async () => {
    const dir = path.join(ROOT, 'no-store-dep');
    await makeProject(dir, {}, 45);

    const r = await scanProject({ rootPath: dir }, { workspaceRoot: WS });

    expect(r.components).toHaveLength(45);
    expect(r.heuristicWarnings).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});
