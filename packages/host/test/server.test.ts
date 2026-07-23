import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHost, DEFAULT_HOST, type Host } from '../src/server.js';

/** A stand-in for packages/web/dist, so these tests never depend on a build. */
const WEB_ROOT = path.join(os.tmpdir(), 'ce-host-webroot');
const MISSING_WEB_ROOT = path.join(os.tmpdir(), 'ce-host-webroot-absent');

const opened: Host[] = [];

/** Start a host on an ephemeral port and register it for teardown. */
async function start(overrides: Partial<Parameters<typeof createHost>[0]> = {}) {
  const host = createHost({ port: 0, webRoot: WEB_ROOT, ...overrides });
  opened.push(host);
  const port = await host.listen();
  return { host, port, base: `http://${DEFAULT_HOST}:${port}` };
}

beforeAll(async () => {
  await fs.rm(WEB_ROOT, { recursive: true, force: true });
  await fs.mkdir(path.join(WEB_ROOT, 'assets'), { recursive: true });
  await fs.writeFile(path.join(WEB_ROOT, 'index.html'), '<!doctype html><title>gallery</title>');
  await fs.writeFile(path.join(WEB_ROOT, 'assets', 'app.js'), 'export const x = 1;\n');
  await fs.rm(MISSING_WEB_ROOT, { recursive: true, force: true });
  // A file the traversal test must never be able to reach through the web root.
  await fs.writeFile(path.join(os.tmpdir(), 'ce-host-secret.txt'), 'top secret');
});

afterAll(async () => {
  await fs.rm(WEB_ROOT, { recursive: true, force: true });
  await fs.rm(path.join(os.tmpdir(), 'ce-host-secret.txt'), { force: true });
});

afterEach(async () => {
  while (opened.length) await opened.pop()?.close();
});

describe('host binding', () => {
  it('binds loopback only, never every interface', async () => {
    const { host } = await start();
    const address = host.server.address();
    expect(typeof address === 'object' && address !== null ? address.address : null).toBe(
      DEFAULT_HOST,
    );
  });

  it('falls back to the next free port and reports the one it bound', async () => {
    const first = await start();
    const second = await start({ port: first.port, portAttempts: 5 });

    expect(second.port).not.toBe(first.port);
    expect(second.port).toBeGreaterThan(first.port);
    expect(second.port).toBeLessThanOrEqual(first.port + 5);

    // The reported port is the one actually serving.
    const res = await fetch(`http://${DEFAULT_HOST}:${second.port}/api/health`);
    expect(res.status).toBe(200);
  });

  it('rejects instead of hanging when no port is available', async () => {
    const first = await start();
    const blocked = createHost({ port: first.port, portAttempts: 1, webRoot: WEB_ROOT });
    opened.push(blocked);

    await expect(blocked.listen()).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });
});

describe('host CORS', () => {
  it('echoes a loopback dev origin', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/health`, {
      headers: { Origin: 'http://localhost:5173' },
    });

    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(res.headers.get('vary')).toBe('Origin');
  });

  it('sends no allow-origin at all to a remote page', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/health`, {
      headers: { Origin: 'https://evil.example.com' },
    });

    // A wildcard here would let any site on the internet read local source
    // through the visitor's browser.
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('vary')).toBe('Origin');
    expect(res.status).toBe(200);
  });

  it('answers preflight for an allowed origin only', async () => {
    const { base } = await start();

    const allowed = await fetch(`${base}/api/scan`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://127.0.0.1:5173' },
    });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5173');
    expect(allowed.headers.get('access-control-allow-methods')).toContain('POST');

    const denied = await fetch(`${base}/api/scan`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example.com' },
    });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });
});

/** The engine's own React fixture, reached read-only over the preflight route. */
const REACT_FIXTURE = path.resolve(import.meta.dirname, '../../core/test/fixtures/simple-react');

describe('host preflight route', () => {
  it('profiles a project without a full scan', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/preflight?path=${encodeURIComponent(REACT_FIXTURE)}`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      framework: string;
      packageName: string | null;
      srcDirs: string[];
      nodeModulesPresent: boolean;
      isWorkspaceRoot: boolean;
    };
    expect(body.framework).toBe('react');
    expect(body.packageName).toBe('simple-react-fixture');
    expect(body.srcDirs.some((d) => d.endsWith('/src'))).toBe(true);
    expect(body.nodeModulesPresent).toBe(false);
    expect(body.isWorkspaceRoot).toBe(false);
  });

  it('lists React members for a workspace root', async () => {
    const root = path.join(os.tmpdir(), `ce-host-ws-${Date.now()}`);
    await fs.rm(root, { recursive: true, force: true });
    await fs.mkdir(path.join(root, 'packages', 'ui'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'ws-root', private: true }),
    );
    await fs.writeFile(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
    await fs.writeFile(
      path.join(root, 'packages', 'ui', 'package.json'),
      JSON.stringify({ name: '@ws/ui', dependencies: { react: '^19.0.0' } }),
    );
    try {
      const { base } = await start();
      const res = await fetch(`${base}/api/preflight?path=${encodeURIComponent(root)}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        isWorkspaceRoot: boolean;
        reactMembers: { name: string | null; dir: string }[];
      };
      expect(body.isWorkspaceRoot).toBe(true);
      expect(body.reactMembers.map((m) => m.name)).toEqual(['@ws/ui']);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('uses the default project when no path is given', async () => {
    const { base } = await start({ defaultProject: REACT_FIXTURE });
    const res = await fetch(`${base}/api/preflight`);
    expect(res.status).toBe(200);
    expect((await res.json()) as { framework: string }).toMatchObject({ framework: 'react' });
  });

  it('400s when no path and no default project', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/preflight`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'MISSING_PATH' } });
  });

  it('422s for a nonexistent project without hanging', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/preflight?path=/no/such/project`);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: { code: 'PROJECT_LOAD_FAILED' } });
  });
});

describe('host kit route', () => {
  /** Scan the fixture over HTTP and map component name → descriptor id. */
  async function scanIds(base: string): Promise<Map<string, string>> {
    const res = await fetch(`${base}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: REACT_FIXTURE }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      components: { descriptor: { id: string; name: string } }[];
    };
    return new Map(body.components.map((c) => [c.descriptor.name, c.descriptor.id]));
  }

  it('builds a portable kit for a set of ids with one shared token sheet', async () => {
    const { base } = await start();
    const byName = await scanIds(base);
    // Card composes Button; UserPanel composes Card — so Button.tsx is reached by
    // both entries and must appear once. A valid two-id kit is the core case.
    const ids = [byName.get('Card'), byName.get('UserPanel')].filter(
      (id): id is string => typeof id === 'string',
    );
    expect(ids).toHaveLength(2);

    const res = await fetch(`${base}/api/kit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: REACT_FIXTURE, ids }),
    });
    expect(res.status).toBe(200);
    const kit = (await res.json()) as {
      files: Record<string, string>;
      tokensCss: string;
      tokensCssPath: string;
      components: { id: string }[];
    };
    // The merged bundle carries exactly one shared :root sheet at a stable path.
    expect(kit.tokensCssPath).toBe('/tokens.css');
    expect(typeof kit.tokensCss).toBe('string');
    expect(kit.files['/tokens.css']).toBe(kit.tokensCss);
    // Button.tsx, shared by both entries, is present once (deduped merge).
    const buttonFiles = Object.keys(kit.files).filter((k) => /\/Button\/Button\.tsx$/.test(k));
    expect(buttonFiles).toHaveLength(1);
    expect(kit.components.map((c) => c.id).sort()).toEqual([...ids].sort());
  });

  it('reuses a project already scanned by a prior request', async () => {
    const { base } = await start();
    const byName = await scanIds(base);
    const ids = [byName.get('Button')].filter((id): id is string => typeof id === 'string');
    const res = await fetch(`${base}/api/kit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: REACT_FIXTURE, ids }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { components: unknown[] }).toMatchObject({
      components: [{ id: ids[0] }],
    });
  });

  it('400s when ids is missing, not an array, empty, or not all strings', async () => {
    const { base } = await start();
    for (const bad of [{}, { ids: 'nope' }, { ids: [] }, { ids: [123] }]) {
      const res = await fetch(`${base}/api/kit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: REACT_FIXTURE, ...bad }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'INVALID_IDS' } });
    }
  });

  it('400s when no path and no default project', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/kit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['x#Y'] }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'MISSING_PATH' } });
  });

  it('maps an unknown component id to a 4xx, not a 500', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/kit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: REACT_FIXTURE, ids: ['no/such/file.tsx#Nope'] }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await res.json()).toMatchObject({ error: { code: 'COMPONENT_NOT_FOUND' } });
  });
});

describe('host static gallery', () => {
  it('serves the built gallery at the root', async () => {
    const { base } = await start();
    const res = await fetch(base);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('<title>gallery</title>');
  });

  it('serves assets with their own content type', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/assets/app.js`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(await res.text()).toContain('export const x');
  });

  it('falls back to index.html for SPA deep links', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/component/Button`);

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>gallery</title>');
  });

  it('refuses to serve files outside the web root', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/..%2Fce-host-secret.txt`);

    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('top secret');
  });

  it('explains how to build when the gallery is missing', async () => {
    const { base } = await start({ webRoot: MISSING_WEB_ROOT });
    const res = await fetch(base);

    expect(res.status).toBe(503);
    const body = await res.text();
    expect(body).toContain('pnpm --filter @ce/web build');
    expect(body).toContain(MISSING_WEB_ROOT);
  });

  it('keeps the API answering even with no gallery build', async () => {
    const { base } = await start({ webRoot: MISSING_WEB_ROOT });
    const res = await fetch(`${base}/api/health`);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('still returns a JSON 404 for an unknown API route', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/nope`);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
