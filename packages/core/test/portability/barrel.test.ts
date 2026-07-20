import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EngineSession } from '../../src/pipeline/session.js';

const WS = path.join(os.tmpdir(), 'ce-barrel-ws');
const dirs: string[] = [];

async function write(root: string, rel: string, content: string): Promise<void> {
  const file = path.join(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

/**
 * Mirrors the shape that made 91% of a real project's components unrenderable:
 * an icon barrel re-exporting far more modules than the bundle budget allows.
 * A component wants one icon; following the barrel drags in all of them.
 */
async function barrelProject(iconCount: number): Promise<string> {
  const root = path.join(os.tmpdir(), `ce-barrel-${dirs.length}`);
  dirs.push(root);
  await fs.rm(root, { recursive: true, force: true });

  await write(root, 'package.json', JSON.stringify({ name: 'b', dependencies: { react: '^19.0.0' } }));
  await write(root, 'tsconfig.json', JSON.stringify({ include: ['src/**/*.tsx', 'src/**/*.ts'] }));

  const names = Array.from({ length: iconCount }, (_, i) => `Icon${i}`);
  for (const n of names) {
    await write(root, `src/icons/${n}.tsx`, `export const ${n} = () => <svg data-n="${n}" />;\n`);
  }
  await write(root, 'src/icons/index.ts', names.map((n) => `export * from './${n}';`).join('\n') + '\n');

  await write(
    root,
    'src/Thing.tsx',
    `import { Icon3 } from './icons';\nexport const Thing = () => <div><Icon3 /></div>;\n`,
  );
  return root;
}

afterEach(async () => {
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
  dirs.length = 0;
  await fs.rm(WS, { recursive: true, force: true });
});

describe('barrel imports', () => {
  it('pulls in only the file declaring the imported symbol, not the whole barrel', async () => {
    // Far more icons than MAX_LOCAL_FILES, so a barrel-following walk must bust it.
    const root = await barrelProject(120);
    const session = await EngineSession.create({ rootPath: root }, { workspaceRoot: WS });
    const scan = await session.scan();
    const thing = scan.components.find((c) => c.descriptor.name === 'Thing');
    expect(thing).toBeDefined();

    const artifact = session.buildArtifact(thing!.descriptor.id);
    const paths = Object.keys(artifact.bundle.files);

    expect(paths.some((p) => p.endsWith('/Icon3.tsx'))).toBe(true);
    expect(paths.some((p) => p.endsWith('/Icon7.tsx'))).toBe(false);
    expect(paths.some((p) => p.endsWith('/icons/index.ts'))).toBe(false);

    // Small bundle → complete → actually renderable, which is the whole point.
    expect(artifact.bundle.incomplete).toBe(false);
    expect(artifact.sandpack.renderability).not.toBe('code-only');

    const entry = artifact.bundle.files[artifact.bundle.entryPath] as string;
    expect(entry).toMatch(/from '\.\/icons\/Icon3'/);
  });
});
