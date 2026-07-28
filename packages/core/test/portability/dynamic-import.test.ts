import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EngineSession } from '../../src/pipeline/session.js';

const WS = path.join(os.tmpdir(), 'ce-dyn-ws');
const dirs: string[] = [];

async function write(root: string, rel: string, content: string): Promise<void> {
  const file = path.join(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

async function project(): Promise<string> {
  const root = path.join(os.tmpdir(), `ce-dyn-${dirs.length}`);
  dirs.push(root);
  await fs.rm(root, { recursive: true, force: true });
  await write(root, 'package.json', JSON.stringify({ name: 'd', dependencies: { react: '^19.0.0' } }));
  await write(root, 'tsconfig.json', JSON.stringify({ include: ['src/**/*.tsx', 'src/**/*.ts'] }));
  await write(root, 'src/data/sample.mock.ts', `export const SAMPLE = { title: 'hi' };\n`);
  // Dynamic import inside a handler — a static graph walk misses it entirely.
  await write(
    root,
    'src/Widget.tsx',
    `export const Widget = () => {\n` +
      `  const load = async () => { const { SAMPLE } = await import('./data/sample.mock'); return SAMPLE; };\n` +
      `  return <button onClick={load}>go</button>;\n` +
      `};\n`,
  );
  return root;
}

afterEach(async () => {
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
  dirs.length = 0;
  await fs.rm(WS, { recursive: true, force: true });
});

describe('dynamic import()', () => {
  it('bundles the target of a dynamic import and rewrites its specifier', async () => {
    const root = await project();
    const session = await EngineSession.create({ rootPath: root }, { workspaceRoot: WS });
    const scan = await session.scan();
    const widget = scan.components.find((c) => c.descriptor.name === 'Widget');
    const bundle = session.buildArtifact(widget!.descriptor.id).bundle;

    // The mock file must be IN the bundle, else esbuild can't resolve import().
    const paths = Object.keys(bundle.files);
    expect(paths.some((p) => p.endsWith('/data/sample.mock.ts'))).toBe(true);

    // And the specifier must be rewritten to the bundle-relative path.
    const widgetFile = Object.entries(bundle.files).find(([p]) => p.endsWith('/Widget.tsx'))?.[1] as string;
    expect(widgetFile).toMatch(/import\(['"][^'"]*data\/sample\.mock['"]\)/);
    expect(bundle.incomplete).toBe(false);
  });
});
