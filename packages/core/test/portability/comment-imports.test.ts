import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EngineSession } from '../../src/pipeline/session.js';

const WS = path.join(os.tmpdir(), 'ce-comment-ws');
const dirs: string[] = [];

async function write(root: string, rel: string, content: string): Promise<void> {
  const file = path.join(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

async function project(): Promise<string> {
  const root = path.join(os.tmpdir(), `ce-comment-${dirs.length}`);
  dirs.push(root);
  await fs.rm(root, { recursive: true, force: true });
  await write(root, 'package.json', JSON.stringify({ name: 'c', dependencies: { react: '^19.0.0' } }));
  await write(root, 'tsconfig.json', JSON.stringify({ include: ['src/**/*.tsx', 'src/**/*.ts'] }));
  // A helper whose JSDoc shows example imports of a module that is NOT a real
  // dependency and does not exist. A text scan would flag these as dangling.
  await write(
    root,
    'src/helpers.ts',
    `/**\n * Usage:\n *   import { thing } from '../does-not-exist';\n */\n` +
      `export const help = () => 1;\n`,
  );
  await write(
    root,
    'src/Widget.tsx',
    `import { help } from './helpers';\nexport const Widget = () => <div>{help()}</div>;\n`,
  );
  return root;
}

afterEach(async () => {
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
  dirs.length = 0;
  await fs.rm(WS, { recursive: true, force: true });
});

describe('dangling-import detection ignores comments', () => {
  it('does not mark a bundle incomplete for an import that only appears in a comment', async () => {
    const root = await project();
    const session = await EngineSession.create({ rootPath: root }, { workspaceRoot: WS });
    const scan = await session.scan();
    const widget = scan.components.find((c) => c.descriptor.name === 'Widget');
    const artifact = session.buildArtifact(widget!.descriptor.id);

    // The commented `../does-not-exist` is documentation, not a real import.
    expect(artifact.bundle.incomplete).toBe(false);
    expect(artifact.sandpack.renderability).not.toBe('code-only');
  });
});
