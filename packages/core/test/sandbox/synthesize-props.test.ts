import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EngineSession } from '../../src/pipeline/session.js';

/**
 * A component that reads NESTED data off a required object prop
 * (`row.items.map()`, `row.count.toLocaleString()`) used to throw at render and
 * fall back to "needs app context", because the synthetic prop was `{}`. These
 * prove the type-driven synthesis: the object prop is filled with a value shaped
 * like its real type (arrays → [], numbers → 0, strings → '', nested → recurse),
 * so the component renders instead of throwing.
 */

const WS = path.join(os.tmpdir(), 'ce-synth-ws');
const dirs: string[] = [];

async function write(root: string, rel: string, content: string): Promise<void> {
  const file = path.join(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

async function project(rowTsx: string): Promise<string> {
  const root = path.join(os.tmpdir(), `ce-synth-${dirs.length}`);
  dirs.push(root);
  await fs.rm(root, { recursive: true, force: true });
  await write(root, 'package.json', JSON.stringify({ name: 's', dependencies: { react: '^19.0.0' } }));
  await write(root, 'tsconfig.json', JSON.stringify({ include: ['src/**/*.tsx', 'src/**/*.ts'] }));
  await write(root, 'src/Row.tsx', rowTsx);
  return root;
}

afterEach(async () => {
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
  dirs.length = 0;
  await fs.rm(WS, { recursive: true, force: true });
});

/** The serialized props object baked into the sandbox entry, as source text. */
function entrySource(artifact: ReturnType<EngineSession['buildArtifact']>): string {
  const files = artifact.sandpack.files;
  const entryPath = Object.keys(files).find((p) => /index\.(t|j)sx?$/.test(p)) ?? '';
  return files[entryPath] ?? '';
}

describe('type-driven object-prop synthesis', () => {
  it('fills a required object prop with its real nested shape, and renders', async () => {
    const root = await project(
      `interface RowData {\n` +
        `  title: string;\n` +
        `  count: number;\n` +
        `  tags: string[];\n` +
        `  active: boolean;\n` +
        `}\n` +
        `export function Row({ row }: { row: RowData }) {\n` +
        `  return (\n` +
        `    <div>\n` +
        `      <span>{row.title}</span>\n` +
        `      <span>{row.count.toLocaleString()}</span>\n` +
        `      <ul>{row.tags.map((t) => <li key={t}>{t}</li>)}</ul>\n` +
        `      {row.active ? 'on' : 'off'}\n` +
        `    </div>\n` +
        `  );\n` +
        `}\n`,
    );
    const session = await EngineSession.create({ rootPath: root }, { workspaceRoot: WS });
    const scan = await session.scan();
    const row = scan.components.find((c) => c.descriptor.name === 'Row');
    expect(row).toBeDefined();
    const artifact = session.buildArtifact(row!.descriptor.id);

    const src = entrySource(artifact);
    // The synthesized object carries a value of the right shape for every field —
    // the arrays/numbers/strings that the component dereferences.
    expect(src).toMatch(/"row":\s*{[^}]*"count":\s*0/);
    expect(src).toMatch(/"tags":\s*\[\]/);
    expect(src).toMatch(/"title":\s*""/);
    expect(src).toMatch(/"active":\s*false/);
    // And the bundle is renderable, not code-only.
    expect(artifact.sandpack.renderability).not.toBe('code-only');
  });

  it('recurses into nested objects and stops safely at self-referential types', async () => {
    const root = await project(
      `interface TreeNode {\n` +
        `  label: string;\n` +
        `  meta: { total: number };\n` +
        `  next: TreeNode | null;\n` +
        `}\n` +
        `export function Node({ node }: { node: TreeNode }) {\n` +
        `  return <div>{node.label} {node.meta.total}</div>;\n` +
        `}\n`,
    );
    const session = await EngineSession.create({ rootPath: root }, { workspaceRoot: WS });
    const scan = await session.scan();
    const node = scan.components.find((c) => c.descriptor.name === 'Node');
    const artifact = session.buildArtifact(node!.descriptor.id);
    const src = entrySource(artifact);
    // Nested object resolved (meta.total), and the recursion terminated (no hang).
    expect(src).toMatch(/"meta":\s*{[^}]*"total":\s*0/);
    expect(artifact.sandpack.renderability).not.toBe('code-only');
  });
});
