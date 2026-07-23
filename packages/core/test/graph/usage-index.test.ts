/**
 * Unit tests for the reverse import graph (usedByCount / usedByFiles).
 *
 * The attribution crux, exercised against the `usage-graph` fixture where ONE
 * shared Button is imported four different ways:
 *   - directly by name from two files (Toolbar, Panel),
 *   - through a barrel re-export from one file (Sidebar → ui/index.ts → Button),
 *   - and by a DEFAULT import from one file (Modal).
 * All four must credit the SAME componentId; the barrel file must not be
 * double-credited; the component's own file must be excluded; and a component
 * imported only from a `.stories` file must read 0 (stories are outside the
 * program, so the count cannot see them — the documented caveat, not a bug).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadProject } from '../../src/project/load-project.js';
import { reactAdapter } from '../../src/adapters/react/react-adapter.js';
import { buildUsageIndex } from '../../src/graph/usage-index.js';
import type { ComponentDescriptor } from '../../src/types/component.js';
import type { LoadedProject } from '../../src/types/project.js';
import type { ReactProgramHandle } from '../../src/adapters/react/ts-program.js';
import type { Project } from 'ts-morph';

const FIXTURE = path.resolve(import.meta.dirname, '../fixtures/usage-graph');
const WS = path.join(os.tmpdir(), 'ce-usage-index-ws');

let descriptors: ComponentDescriptor[];
let tsProject: Project;
let loaded: LoadedProject;

beforeAll(async () => {
  loaded = await loadProject({ rootPath: FIXTURE }, { workspaceRoot: WS });
  const program = reactAdapter.createProgram(loaded);
  descriptors = reactAdapter.discoverComponents(program);
  tsProject = (program.handle as ReactProgramHandle).tsProject;
});

afterAll(async () => {
  await fs.rm(WS, { recursive: true, force: true });
});

function idOf(name: string): string {
  const d = descriptors.find((c) => c.name === name);
  if (!d) throw new Error(`fixture component ${name} not discovered`);
  return d.id;
}

describe('buildUsageIndex — attribution', () => {
  it('credits a shared component imported by name, via a barrel, and by default — exactly once per file', () => {
    const index = buildUsageIndex(tsProject, descriptors, loaded);
    const button = index.get(idOf('Button'));

    expect(button).toBeDefined();
    // 2 direct-named + 1 through-barrel + 1 default = 4 distinct importing files.
    expect(button?.usedByCount).toBe(4);

    const files = (button?.usedByFiles ?? []).map((f) => path.basename(f)).sort();
    expect(files).toEqual(['Modal.tsx', 'Panel.tsx', 'Sidebar.tsx', 'Toolbar.tsx']);
  });

  it('never credits the barrel file itself, nor the component`s own file', () => {
    const index = buildUsageIndex(tsProject, descriptors, loaded);
    const files = index.get(idOf('Button'))?.usedByFiles ?? [];
    expect(files.some((f) => f.endsWith('/ui/index.ts'))).toBe(false);
    expect(files.some((f) => f.endsWith('/Button/Button.tsx'))).toBe(false);
  });

  it('reads 0 for a component imported only from a .stories file (stories are outside the program)', () => {
    const index = buildUsageIndex(tsProject, descriptors, loaded);
    const widget = index.get(idOf('Widget'));
    // Either an explicit zero row or simply absent — both mean "no in-program importer".
    expect(widget?.usedByCount ?? 0).toBe(0);
  });

  it('counts distinct importing files, not import statements', () => {
    const index = buildUsageIndex(tsProject, descriptors, loaded);
    const button = index.get(idOf('Button'));
    expect(button?.usedByFiles.length).toBe(button?.usedByCount);
    // No duplicate file paths.
    expect(new Set(button?.usedByFiles).size).toBe(button?.usedByFiles.length);
  });
});
