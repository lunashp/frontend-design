import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { Buffer } from 'node:buffer';
import * as os from 'node:os';
import * as path from 'node:path';
import { EngineSession } from '../../src/pipeline/session.js';

/**
 * A component that imports a binary asset (`import logo from './logo.png'`) used
 * to leave that import dangling — the asset was dropped from the bundle with a
 * warning — which marked the bundle incomplete and forced the component to
 * code-only, on top of showing a broken image anywhere it did render. These prove
 * the asset is now inlined as a self-contained data-URI module and the import
 * resolves, so the bundle is complete and the component can render.
 */

const WS = path.join(os.tmpdir(), 'ce-asset-ws');
const dirs: string[] = [];

// A real 1x1 transparent PNG (67 bytes) — a genuine binary the resolver reads.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function write(root: string, rel: string, content: string | Buffer): Promise<void> {
  const file = path.join(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

async function project(): Promise<string> {
  const root = path.join(os.tmpdir(), `ce-asset-${dirs.length}`);
  dirs.push(root);
  await fs.rm(root, { recursive: true, force: true });
  await write(root, 'package.json', JSON.stringify({ name: 'a', dependencies: { react: '^19.0.0' } }));
  await write(root, 'tsconfig.json', JSON.stringify({ include: ['src/**/*.tsx', 'src/**/*.ts'] }));
  await write(root, 'src/logo.png', PNG_1x1);
  await write(
    root,
    'src/Brand.tsx',
    `import logo from './logo.png';\n` +
      `export const Brand = () => <img src={logo} alt="logo" width={16} height={16} />;\n`,
  );
  return root;
}

afterEach(async () => {
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
  dirs.length = 0;
  await fs.rm(WS, { recursive: true, force: true });
});

describe('asset inlining', () => {
  it('inlines an imported PNG so the bundle is complete and renderable', async () => {
    const root = await project();
    const session = await EngineSession.create({ rootPath: root }, { workspaceRoot: WS });
    const scan = await session.scan();
    const brand = scan.components.find((c) => c.descriptor.name === 'Brand');
    expect(brand).toBeDefined();
    const artifact = session.buildArtifact(brand!.descriptor.id);

    // The image import no longer dangles → bundle complete → not code-only.
    expect(artifact.bundle.incomplete).toBe(false);
    expect(artifact.bundle.danglingImports).toEqual([]);
    expect(artifact.sandpack.renderability).not.toBe('code-only');

    // A `.png.ts` module carrying the base64 data URI is in the bundle, and the
    // original `./logo.png` import is left untouched (esbuild + the dangling
    // check both resolve it by extension).
    const files = artifact.bundle.files;
    const assetModule = Object.entries(files).find(([p]) => p.endsWith('logo.png.ts'));
    expect(assetModule).toBeDefined();
    expect(assetModule?.[1]).toContain(`data:image/png;base64,${PNG_1x1.toString('base64')}`);

    const entry = files[artifact.bundle.entryPath];
    expect(entry).toContain("from './logo.png'");

    // The old P2 "Asset not inlined" warning is gone.
    expect(artifact.bundle.warnings.some((w) => /Asset not inlined/.test(w))).toBe(false);
  });
});
