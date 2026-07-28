import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EngineSession } from '../../src/pipeline/session.js';

const WS = path.join(os.tmpdir(), 'ce-peer-ws');
const dirs: string[] = [];

async function write(root: string, rel: string, content: string): Promise<void> {
  const file = path.join(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

async function pkg(root: string, name: string, json: Record<string, unknown>): Promise<void> {
  await write(root, path.join('node_modules', name, 'package.json'), JSON.stringify(json));
}

/**
 * Mirrors the real shape that broke every preview: a component imports only
 * `ui-kit`, but `ui-kit` pulls `style-engine` in at runtime via a peer dep. The
 * peer is marked optional (exactly what @mui/material does for @emotion/styled)
 * yet is installed, so the target really uses it.
 */
async function targetProject(): Promise<string> {
  const root = path.join(os.tmpdir(), `ce-peer-${dirs.length}`);
  dirs.push(root);
  await fs.rm(root, { recursive: true, force: true });

  await write(
    root,
    'package.json',
    JSON.stringify({
      name: 'peer-target',
      dependencies: { react: '^19.0.0', 'ui-kit': '^7.3.6', 'style-engine': '^11.14.0' },
    }),
  );
  await write(root, 'tsconfig.json', JSON.stringify({ include: ['src/**/*.tsx'] }));
  await write(root, 'src/Thing.tsx', `import { Widget } from 'ui-kit';\nexport const Thing = () => <Widget />;\n`);

  await pkg(root, 'ui-kit', {
    name: 'ui-kit',
    version: '7.3.6',
    peerDependencies: { 'style-engine': '^11.3.0', react: '^19.0.0', 'pigment-css': '^7.3.7' },
    peerDependenciesMeta: { 'style-engine': { optional: true }, 'pigment-css': { optional: true } },
  });
  // Installed → the target uses it. `pigment-css` is deliberately NOT installed.
  await pkg(root, 'style-engine', { name: 'style-engine', version: '11.14.0' });

  return root;
}

/**
 * `next-intl` requires `next` at runtime, but `next` cannot run in the sandbox.
 * Its own imports are stubbed elsewhere; the peer walker must not drag the real
 * `next` package back in, which would re-block the component as code-only.
 */
async function nextPeerProject(): Promise<string> {
  const root = path.join(os.tmpdir(), `ce-peer-${dirs.length}`);
  dirs.push(root);
  await fs.rm(root, { recursive: true, force: true });

  await write(
    root,
    'package.json',
    JSON.stringify({
      name: 'nx-peer',
      dependencies: { react: '^19.0.0', 'intl-kit': '^4.6.1', next: '16.2.6' },
    }),
  );
  await write(root, 'tsconfig.json', JSON.stringify({ include: ['src/**/*.tsx'] }));
  await write(root, 'src/Thing.tsx', `import { t } from 'intl-kit';\nexport const Thing = () => <div>{t('x')}</div>;\n`);

  await pkg(root, 'intl-kit', {
    name: 'intl-kit',
    version: '4.6.1',
    peerDependencies: { next: '>=14', react: '^19.0.0' },
  });
  await pkg(root, 'next', { name: 'next', version: '16.2.6' });
  return root;
}

afterEach(async () => {
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
  dirs.length = 0;
  await fs.rm(WS, { recursive: true, force: true });
});

describe('portable bundle external deps', () => {
  it('includes installed peer deps of the packages a component imports', async () => {
    const root = await targetProject();
    const session = await EngineSession.create({ rootPath: root }, { workspaceRoot: WS });
    const scan = await session.scan();
    const thing = scan.components.find((c) => c.descriptor.name === 'Thing');
    expect(thing).toBeDefined();

    const deps = session.buildArtifact(thing!.descriptor.id).bundle.externalDeps;

    expect(deps['ui-kit']).toBe('^7.3.6');
    // The whole point: never imported by the component, required at runtime.
    expect(deps['style-engine']).toBe('^11.14.0');
    // An optional peer the target did not install must not be added — it would
    // only make the sandbox install fail.
    expect(deps).not.toHaveProperty('pigment-css');
    // The sandbox template already provides react.
    expect(deps).not.toHaveProperty('react');
  });

  it('does not pull in a peer that cannot run in the sandbox (next)', async () => {
    const root = await nextPeerProject();
    const session = await EngineSession.create({ rootPath: root }, { workspaceRoot: WS });
    const scan = await session.scan();
    const thing = scan.components.find((c) => c.descriptor.name === 'Thing');
    const artifact = session.buildArtifact(thing!.descriptor.id);

    expect(artifact.bundle.externalDeps).toHaveProperty('intl-kit');
    // `next` is unsandboxable; adding it as a peer would re-block the component.
    expect(artifact.bundle.externalDeps).not.toHaveProperty('next');
    expect(artifact.sandpack.renderability).not.toBe('code-only');
  });
});
