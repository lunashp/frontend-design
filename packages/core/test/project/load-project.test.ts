import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadProject } from '../../src/project/load-project.js';
import { ProjectLoadError } from '../../src/util/errors.js';

const FIXTURE = path.resolve(import.meta.dirname, '../fixtures/simple-react');
const WS = path.join(os.tmpdir(), 'ce-load-ws');
const tmpDirs: string[] = [];

async function tmpProject(files: Record<string, string>): Promise<string> {
  const dir = path.join(os.tmpdir(), `ce-load-${files['__id'] ?? Object.keys(files).length}-${tmpDirs.length}`);
  tmpDirs.push(dir);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    if (name === '__id') continue;
    await fs.writeFile(path.join(dir, name), content);
  }
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.map((d) => fs.rm(d, { recursive: true, force: true })));
  tmpDirs.length = 0;
  await fs.rm(WS, { recursive: true, force: true });
});

describe('loadProject', () => {
  it('loads a real React project with tsconfig aliases and src dir', async () => {
    const p = await loadProject({ rootPath: FIXTURE }, { workspaceRoot: WS });
    expect(p.framework).toBe('react');
    expect(p.tsconfigPath).toBeTruthy();
    expect(p.pathAliases.paths['@/*']).toBeDefined();
    expect(p.srcDirs.some((d) => d.endsWith('/src'))).toBe(true);
  });

  it('throws for a nonexistent path', async () => {
    await expect(loadProject({ rootPath: '/no/such/project' })).rejects.toBeInstanceOf(
      ProjectLoadError,
    );
  });

  it('detects Vue and falls back to root when no src dir or tsconfig exists', async () => {
    const dir = await tmpProject({
      'package.json': JSON.stringify({ name: 'v', dependencies: { vue: '^3.0.0' } }),
    });
    const p = await loadProject({ rootPath: dir }, { workspaceRoot: WS });
    expect(p.framework).toBe('vue');
    expect(p.tsconfigPath).toBeNull();
    expect(p.srcDirs).toEqual([path.resolve(dir)]);
    expect(p.pathAliases).toEqual({ baseUrl: null, paths: {} });
  });

  it('reports unknown framework when there is no package.json', async () => {
    const dir = await tmpProject({ 'index.ts': 'export {};' });
    const p = await loadProject({ rootPath: dir }, { workspaceRoot: WS });
    expect(p.framework).toBe('unknown');
    expect(p.pkg.name).toBeNull();
  });

  it('throws ProjectLoadError on invalid package.json', async () => {
    const dir = await tmpProject({ 'package.json': '{ not valid json' });
    await expect(loadProject({ rootPath: dir }, { workspaceRoot: WS })).rejects.toBeInstanceOf(
      ProjectLoadError,
    );
  });

  it('detects React via the next dependency', async () => {
    const dir = await tmpProject({
      'package.json': JSON.stringify({ name: 'n', dependencies: { next: '^15.0.0' } }),
    });
    const p = await loadProject({ rootPath: dir }, { workspaceRoot: WS });
    expect(p.framework).toBe('react');
  });
});
