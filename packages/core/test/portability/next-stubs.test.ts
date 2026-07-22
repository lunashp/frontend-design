import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EngineSession } from '../../src/pipeline/session.js';

const WS = path.join(os.tmpdir(), 'ce-next-ws');
const dirs: string[] = [];

async function write(root: string, rel: string, content: string): Promise<void> {
  const file = path.join(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

async function project(
  componentSource: string,
  deps: Record<string, string> = { react: '^19.0.0', next: '16.2.6' },
): Promise<string> {
  const root = path.join(os.tmpdir(), `ce-next-${dirs.length}`);
  dirs.push(root);
  await fs.rm(root, { recursive: true, force: true });
  await write(root, 'package.json', JSON.stringify({ name: 'n', dependencies: deps }));
  await write(root, 'tsconfig.json', JSON.stringify({ include: ['src/**/*.tsx'] }));
  await write(root, 'src/Thing.tsx', componentSource);
  return root;
}

async function bundleOf(root: string) {
  const session = await EngineSession.create({ rootPath: root }, { workspaceRoot: WS });
  const scan = await session.scan();
  const thing = scan.components.find((c) => c.descriptor.name === 'Thing');
  expect(thing).toBeDefined();
  return session.buildArtifact(thing!.descriptor.id);
}

afterEach(async () => {
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
  dirs.length = 0;
  await fs.rm(WS, { recursive: true, force: true });
});

describe('next stubs', () => {
  it('swaps client Next.js imports for stubs so the component can render', async () => {
    const root = await project(
      `import Link from 'next/link';\n` +
        `import { useRouter } from 'next/navigation';\n` +
        `export const Thing = () => { const r = useRouter(); return <Link href="/x" onClick={() => r.push('/y')}>go</Link>; };\n`,
    );
    const a = await bundleOf(root);

    // `next` can never install in the sandbox; stubbing must remove it entirely.
    expect(a.bundle.externalDeps).not.toHaveProperty('next');
    expect(a.sandpack.renderability).not.toBe('code-only');

    const paths = Object.keys(a.bundle.files);
    expect(paths).toContain('/src/__next-stubs__/next-link.tsx');
    expect(paths).toContain('/src/__next-stubs__/next-navigation.tsx');

    const entry = a.bundle.files[a.bundle.entryPath] as string;
    expect(entry).toMatch(/from '[^']*__next-stubs__\/next-link'/);
    expect(entry).toMatch(/from '[^']*__next-stubs__\/next-navigation'/);
    expect(entry).not.toMatch(/from 'next\//);
  });

  it('discloses every substitution and what it costs, instead of swapping silently', async () => {
    const root = await project(
      `import Link from 'next/link';\n` +
        `import { useRouter } from 'next/navigation';\n` +
        `export const Thing = () => { const r = useRouter(); return <Link href="/x" onClick={() => r.push('/y')}>go</Link>; };\n`,
    );
    const a = await bundleOf(root);

    const stubbed = [...a.bundle.stubbedModules];
    expect(stubbed.map((s) => s.specifier)).toEqual(['next/link', 'next/navigation']);
    expect(stubbed.map((s) => s.replacedWith)).toEqual([
      '/src/__next-stubs__/next-link.tsx',
      '/src/__next-stubs__/next-navigation.tsx',
    ]);
    // Every stub file it names must actually be in the bundle.
    for (const s of stubbed) expect(a.bundle.files[s.replacedWith]).toBeDefined();

    // The loss has to be concrete: a prefetch-less <a> and a dead router.
    expect(stubbed[0]?.lost).toMatch(/plain <a>/);
    expect(stubbed[1]?.lost).toMatch(/no-ops/);

    // And it has to reach the user, not just sit in the artifact.
    const notes = a.sandpack.notes.join(' ');
    expect(notes).toMatch(/next\/link → local stub/);
    expect(notes).toMatch(/next\/navigation → local stub/);
  });

  it('reports no substitutions for a component that needed none', async () => {
    const root = await project(`export const Thing = () => <div>plain</div>;\n`, {
      react: '^19.0.0',
    });
    const a = await bundleOf(root);
    expect(a.bundle.stubbedModules).toEqual([]);
  });

  it('stays code-only for server-only Next.js modules rather than faking them', async () => {
    const root = await project(
      `import { headers } from 'next/headers';\n` +
        `export const Thing = () => <div>{String(headers())}</div>;\n`,
    );
    const a = await bundleOf(root);

    // A server component has no design to preview; pretending otherwise would lie.
    expect(a.bundle.externalDeps).toHaveProperty('next');
    expect(a.sandpack.renderability).toBe('code-only');
    expect(a.sandpack.notes.join(' ')).toMatch(/server-only Next\.js modules/);
  });

  it('stubs @sentry/nextjs (it hard-requires next) so its importers render', async () => {
    const root = await project(
      `import * as Sentry from '@sentry/nextjs';\n` +
        `export const Thing = () => { Sentry.captureException(new Error('x')); return <div>ok</div>; };\n`,
      { react: '^19.0.0', '@sentry/nextjs': '^10.48.0' },
    );
    const a = await bundleOf(root);

    // The real package can't load in the sandbox; the stub replaces it entirely.
    expect(a.bundle.externalDeps).not.toHaveProperty('@sentry/nextjs');
    expect(a.sandpack.renderability).not.toBe('code-only');
    expect(Object.keys(a.bundle.files)).toContain('/src/__next-stubs__/sentry-nextjs.tsx');
    const entry = a.bundle.files[a.bundle.entryPath] as string;
    void entry;
    const thingFile = Object.entries(a.bundle.files).find(([p]) => p.endsWith('/Thing.tsx'))?.[1] as string;
    expect(thingFile).toMatch(/from '[^']*__next-stubs__\/sentry-nextjs'/);
    expect(thingFile).not.toMatch(/from '@sentry\/nextjs'/);
  });
});
