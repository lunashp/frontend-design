import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { preflightProject } from '../../src/project/preflight.js';
import { ProjectLoadError } from '../../src/util/errors.js';

const FIXTURE = path.resolve(import.meta.dirname, '../fixtures/simple-react');
const tmpDirs: string[] = [];

async function tmpProject(files: Record<string, string>): Promise<string> {
  const dir = path.join(os.tmpdir(), `ce-preflight-${tmpDirs.length}-${Date.now()}`);
  tmpDirs.push(dir);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.map((d) => fs.rm(d, { recursive: true, force: true })));
  tmpDirs.length = 0;
});

describe('preflightProject', () => {
  it('profiles a real React project without running a full scan', () => {
    const p = preflightProject({ rootPath: FIXTURE });
    expect(p.framework).toBe('react');
    // A declared `react` dependency is the strongest possible signal.
    expect(p.frameworkConfidence).toBeGreaterThanOrEqual(0.9);
    expect(p.frameworkReason.toLowerCase()).toContain('react');
    expect(p.packageName).toBe('simple-react-fixture');
    expect(p.srcDirs.some((d) => d.endsWith(`${path.sep}src`))).toBe(true);
    expect(p.pathAliases.paths['@/*']).toBeDefined();
    // The fixture has no installed dependencies — an honest preflight must say so
    // rather than let the degraded preview surprise the user mid-scan.
    expect(p.nodeModulesPresent).toBe(false);
    expect(p.isWorkspaceRoot).toBe(false);
    expect(p.reactMembers).toEqual([]);
  });

  it('reports node_modules as present when the target is installed', async () => {
    const dir = await tmpProject({
      'package.json': JSON.stringify({ name: 'installed', dependencies: { react: '^19.0.0' } }),
      'node_modules/.keep': '',
      'src/App.tsx': 'export const App = () => null;',
    });
    const p = preflightProject({ rootPath: dir });
    expect(p.nodeModulesPresent).toBe(true);
  });

  it('detects React implied by next, at lower confidence, and names why', async () => {
    const dir = await tmpProject({
      'package.json': JSON.stringify({ name: 'n', dependencies: { next: '^15.0.0' } }),
      'src/page.tsx': 'export default function P() { return null; }',
    });
    const p = preflightProject({ rootPath: dir });
    expect(p.framework).toBe('react');
    // next implies React but is not itself react — the confidence and the reason
    // must both reflect that softer signal, not claim a direct dependency.
    expect(p.frameworkConfidence).toBeLessThan(0.95);
    expect(p.frameworkReason.toLowerCase()).toContain('next');
  });

  it('flags a Vue project as unsupported-for-this-tool with a Vue verdict', async () => {
    const dir = await tmpProject({
      'package.json': JSON.stringify({ name: 'v', dependencies: { vue: '^3.0.0' } }),
    });
    const p = preflightProject({ rootPath: dir });
    expect(p.framework).toBe('vue');
    expect(p.frameworkConfidence).toBeGreaterThan(0);
  });

  it('reports zero confidence and a reason when no framework is declared', async () => {
    const dir = await tmpProject({ 'index.ts': 'export {};' });
    const p = preflightProject({ rootPath: dir });
    expect(p.framework).toBe('unknown');
    expect(p.frameworkConfidence).toBe(0);
    expect(p.frameworkReason.length).toBeGreaterThan(0);
    expect(p.packageName).toBeNull();
  });

  it('lists the React members of a pnpm workspace root whose own package declares no React', async () => {
    const dir = await tmpProject({
      'package.json': JSON.stringify({ name: 'monorepo-root', private: true }),
      'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
      'packages/ui/package.json': JSON.stringify({
        name: '@acme/ui',
        dependencies: { react: '^19.0.0' },
      }),
      'packages/design/package.json': JSON.stringify({
        name: '@acme/design',
        devDependencies: { next: '^15.0.0' },
      }),
      'packages/utils/package.json': JSON.stringify({ name: '@acme/utils' }),
    });
    const p = preflightProject({ rootPath: dir });
    // The root itself is a dead end — no React — so the tool must point at the
    // members that actually contain React rather than scan an empty root.
    expect(p.framework).toBe('unknown');
    expect(p.isWorkspaceRoot).toBe(true);
    const names = p.reactMembers.map((m) => m.name).sort();
    expect(names).toEqual(['@acme/design', '@acme/ui']);
    // Every listed member points at an absolute directory the caller can re-scan.
    for (const m of p.reactMembers) {
      expect(path.isAbsolute(m.dir)).toBe(true);
      expect(m.dir.startsWith(path.resolve(dir))).toBe(true);
    }
    // A member with no React is not offered as a scan target.
    expect(names).not.toContain('@acme/utils');
  });

  it('detects a workspace root declared via package.json workspaces (npm/yarn)', async () => {
    const dir = await tmpProject({
      'package.json': JSON.stringify({
        name: 'yarn-root',
        private: true,
        workspaces: ['apps/*'],
      }),
      'apps/web/package.json': JSON.stringify({
        name: '@acme/web',
        dependencies: { react: '^19.0.0' },
      }),
    });
    const p = preflightProject({ rootPath: dir });
    expect(p.isWorkspaceRoot).toBe(true);
    expect(p.reactMembers.map((m) => m.name)).toEqual(['@acme/web']);
  });

  it('supports the { packages: [...] } form of package.json workspaces', async () => {
    const dir = await tmpProject({
      'package.json': JSON.stringify({
        name: 'ws-obj-root',
        private: true,
        workspaces: { packages: ['libs/*'] },
      }),
      'libs/kit/package.json': JSON.stringify({
        name: '@acme/kit',
        dependencies: { react: '^18.0.0' },
      }),
    });
    const p = preflightProject({ rootPath: dir });
    expect(p.isWorkspaceRoot).toBe(true);
    expect(p.reactMembers.map((m) => m.name)).toEqual(['@acme/kit']);
  });

  it('expands a partial-glob workspace pattern, keeping only matching directories', async () => {
    const dir = await tmpProject({
      'package.json': JSON.stringify({ name: 'partial-root', private: true }),
      'pnpm-workspace.yaml': "packages:\n  - 'packages/app-*'\n",
      'packages/app-web/package.json': JSON.stringify({
        name: '@acme/app-web',
        dependencies: { react: '^19.0.0' },
      }),
      'packages/lib-utils/package.json': JSON.stringify({
        name: '@acme/lib-utils',
        dependencies: { react: '^19.0.0' },
      }),
    });
    const p = preflightProject({ rootPath: dir });
    // `lib-utils` declares React but is not under `app-*`, so it is not a member.
    expect(p.reactMembers.map((m) => m.name)).toEqual(['@acme/app-web']);
  });

  it('skips a member with an unreadable package.json instead of crashing the profile', async () => {
    const dir = await tmpProject({
      'package.json': JSON.stringify({ name: 'broken-member-root', private: true }),
      'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
      'packages/ok/package.json': JSON.stringify({
        name: '@acme/ok',
        dependencies: { react: '^19.0.0' },
      }),
      'packages/broken/package.json': '{ not valid json',
    });
    const p = preflightProject({ rootPath: dir });
    expect(p.isWorkspaceRoot).toBe(true);
    expect(p.reactMembers.map((m) => m.name)).toEqual(['@acme/ok']);
  });

  it('treats a negation-only workspace as a root with no members', async () => {
    const dir = await tmpProject({
      'package.json': JSON.stringify({
        name: 'neg-root',
        private: true,
        workspaces: ['!packages/legacy'],
      }),
      'packages/legacy/package.json': JSON.stringify({
        name: '@acme/legacy',
        dependencies: { react: '^19.0.0' },
      }),
    });
    const p = preflightProject({ rootPath: dir });
    expect(p.isWorkspaceRoot).toBe(true);
    expect(p.reactMembers).toEqual([]);
  });

  it('is not a workspace root when no workspace config exists', async () => {
    const dir = await tmpProject({
      'package.json': JSON.stringify({ name: 'plain', dependencies: { react: '^19.0.0' } }),
      'src/App.tsx': 'export const App = () => null;',
    });
    const p = preflightProject({ rootPath: dir });
    expect(p.isWorkspaceRoot).toBe(false);
    expect(p.reactMembers).toEqual([]);
  });

  it('throws ProjectLoadError for a nonexistent path', () => {
    expect(() => preflightProject({ rootPath: '/no/such/project' })).toThrow(ProjectLoadError);
  });
});
