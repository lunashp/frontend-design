import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EngineSession } from '../../src/pipeline/session.js';

const WS = path.join(os.tmpdir(), 'ce-ctxprov-ws');
const dirs: string[] = [];

async function write(root: string, rel: string, content: string): Promise<void> {
  const file = path.join(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

async function project(): Promise<string> {
  const root = path.join(os.tmpdir(), `ce-ctxprov-${dirs.length}`);
  dirs.push(root);
  await fs.rm(root, { recursive: true, force: true });
  await write(root, 'package.json', JSON.stringify({ name: 'p', dependencies: { react: '^19.0.0' } }));
  await write(root, 'tsconfig.json', JSON.stringify({ include: ['src/**/*.tsx', 'src/**/*.ts'] }));
  // Self-contained context: provider + throwing hook, all in one module.
  await write(
    root,
    'src/PanelContext.tsx',
    `import { createContext, useContext, useState } from 'react';\n` +
      `const Ctx = createContext<{ open: boolean } | null>(null);\n` +
      `export const PanelProvider = ({ children }: { children: React.ReactNode }) => {\n` +
      `  const [open] = useState(false);\n` +
      `  return <Ctx.Provider value={{ open }}>{children}</Ctx.Provider>;\n` +
      `};\n` +
      `export const usePanel = () => { const c = useContext(Ctx); if (!c) throw new Error('usePanel must be used within a PanelProvider'); return c; };\n`,
  );
  // A component that consumes the context (would throw without the provider).
  await write(
    root,
    'src/Launcher.tsx',
    `import { usePanel } from './PanelContext';\n` +
      `export const Launcher = () => { const { open } = usePanel(); return <button>{open ? 'on' : 'off'}</button>; };\n`,
  );
  // A plain component that does NOT consume the context.
  await write(root, 'src/Plain.tsx', `export const Plain = () => <div>plain</div>;\n`);
  return root;
}

afterEach(async () => {
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
  dirs.length = 0;
  await fs.rm(WS, { recursive: true, force: true });
});

describe('self-contained context providers', () => {
  it('wraps a consuming component in the detected provider', async () => {
    const root = await project();
    const session = await EngineSession.create({ rootPath: root }, { workspaceRoot: WS });
    const scan = await session.scan();
    const launcher = scan.components.find((c) => c.descriptor.name === 'Launcher');
    const artifact = session.buildArtifact(launcher!.descriptor.id);

    expect(artifact.bundle.previewProviders?.some((p) => p.exportName === 'PanelProvider')).toBe(true);
    const entry = artifact.sandpack.files['/index.tsx'] as string;
    expect(entry).toMatch(/import \{ PanelProvider as __P0 \}/);
    expect(entry).toMatch(/<__P0>/);
  });

  it('does NOT wrap a component that does not consume the context', async () => {
    const root = await project();
    const session = await EngineSession.create({ rootPath: root }, { workspaceRoot: WS });
    const scan = await session.scan();
    const plain = scan.components.find((c) => c.descriptor.name === 'Plain');
    const artifact = session.buildArtifact(plain!.descriptor.id);

    expect(artifact.bundle.previewProviders ?? []).toHaveLength(0);
  });
});
