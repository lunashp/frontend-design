/**
 * The GET /api/thumbnail contract, exercised end-to-end WITHOUT a browser.
 *
 * The render seam (`renderThumbnail`) is injected with a fake that returns
 * canned bytes, so this proves the route's own behaviour — session resolution,
 * the code-only/renderability gate, the on-disk cache, the ETag/304
 * revalidation and the response shaping — with zero Chromium. The real
 * browser render is proven separately in e2e/thumbnail-render.spec.ts, which is
 * deliberately kept out of `pnpm test`.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHost, DEFAULT_HOST, type Host } from '../src/server.js';
import type { ThumbnailRenderer } from '../src/thumbnail-renderer.js';

const REACT_FIXTURE = path.resolve(import.meta.dirname, '../../core/test/fixtures/simple-react');
const WEB_ROOT = path.join(os.tmpdir(), 'ce-thumb-webroot');

/** A valid 1x1 PNG — enough for the route to treat as a real image body. */
const FAKE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);

const opened: Host[] = [];
const tempDirs: string[] = [];

interface RendererProbe {
  renderer: ThumbnailRenderer;
  calls: () => number;
}

/** A fake renderer that counts invocations and returns whatever `result` says. */
function probe(result: Buffer | null): RendererProbe {
  let calls = 0;
  return {
    renderer: async () => {
      calls += 1;
      return result;
    },
    calls: () => calls,
  };
}

/**
 * Each host gets its own workspace so one test's on-disk thumbnail cache cannot
 * satisfy another's request for the same component — the disk cache is keyed by
 * pixels, so a shared workspace would leak a rendered PNG across tests.
 */
async function start(renderThumbnail: ThumbnailRenderer) {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-thumb-ws-'));
  tempDirs.push(workspaceRoot);
  const host = createHost({
    port: 0,
    webRoot: WEB_ROOT,
    workspaceRoot,
    defaultProject: REACT_FIXTURE,
    renderThumbnail,
  });
  opened.push(host);
  const port = await host.listen();
  return { base: `http://${DEFAULT_HOST}:${port}` };
}

/** First scanned component the engine reports as renderable (never code-only). */
async function firstRenderableId(base: string): Promise<string> {
  const scan = await fetch(`${base}/api/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: REACT_FIXTURE }),
  });
  const { components } = (await scan.json()) as {
    components: Array<{ descriptor: { id: string } }>;
  };
  for (const c of components) {
    const res = await fetch(`${base}/api/artifact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: REACT_FIXTURE, id: c.descriptor.id }),
    });
    const artifact = (await res.json()) as { sandpack: { renderability: string } };
    if (artifact.sandpack.renderability !== 'code-only') return c.descriptor.id;
  }
  throw new Error('fixture has no renderable component');
}

beforeAll(async () => {
  await fs.mkdir(WEB_ROOT, { recursive: true });
});

afterAll(async () => {
  await fs.rm(WEB_ROOT, { recursive: true, force: true });
  await Promise.all(tempDirs.map((d) => fs.rm(d, { recursive: true, force: true })));
});

afterEach(async () => {
  while (opened.length) await opened.pop()?.close();
});

describe('GET /api/thumbnail validation', () => {
  it('400s when no path and no default project', async () => {
    const host = createHost({ port: 0, webRoot: WEB_ROOT, renderThumbnail: probe(FAKE_PNG).renderer });
    opened.push(host);
    const port = await host.listen();
    const res = await fetch(`http://${DEFAULT_HOST}:${port}/api/thumbnail?id=x`);
    expect(res.status).toBe(400);
  });

  it('400s when id is missing', async () => {
    const { base } = await start(probe(FAKE_PNG).renderer);
    const res = await fetch(`${base}/api/thumbnail?path=${encodeURIComponent(REACT_FIXTURE)}`);
    expect(res.status).toBe(400);
  });

  it('404s an unknown component id, never a 500', async () => {
    const { base } = await start(probe(FAKE_PNG).renderer);
    const res = await fetch(`${base}/api/thumbnail?id=${encodeURIComponent('no/such.tsx#Nope')}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/thumbnail rendering', () => {
  it('renders a PNG for a renderable component', async () => {
    const p = probe(FAKE_PNG);
    const { base } = await start(p.renderer);
    const id = await firstRenderableId(base);

    const res = await fetch(`${base}/api/thumbnail?id=${encodeURIComponent(id)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('etag')).toBeTruthy();
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(FAKE_PNG)).toBe(true);
    expect(p.calls()).toBe(1);
  });

  it('serves the second request from the disk cache — the renderer runs once', async () => {
    const p = probe(FAKE_PNG);
    const { base } = await start(p.renderer);
    const id = await firstRenderableId(base);

    await fetch(`${base}/api/thumbnail?id=${encodeURIComponent(id)}`);
    const again = await fetch(`${base}/api/thumbnail?id=${encodeURIComponent(id)}`);
    expect(again.status).toBe(200);
    expect(Buffer.from(await again.arrayBuffer()).equals(FAKE_PNG)).toBe(true);
    // The pixels came off disk the second time; Chromium was never asked twice.
    expect(p.calls()).toBe(1);
  });

  it('revalidates with a 304 when the caller already has the current ETag', async () => {
    const { base } = await start(probe(FAKE_PNG).renderer);
    const id = await firstRenderableId(base);

    const first = await fetch(`${base}/api/thumbnail?id=${encodeURIComponent(id)}`);
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();

    const revalidate = await fetch(`${base}/api/thumbnail?id=${encodeURIComponent(id)}`, {
      headers: { 'If-None-Match': etag as string },
    });
    expect(revalidate.status).toBe(304);
  });

  it('answers 204 (not 500) when the renderer reports the browser is unavailable', async () => {
    const p = probe(null);
    const { base } = await start(p.renderer);
    const id = await firstRenderableId(base);

    const res = await fetch(`${base}/api/thumbnail?id=${encodeURIComponent(id)}`);
    expect(res.status).toBe(204);
    expect(res.headers.get('x-thumbnail-reason')).toBe('unavailable');
    expect(p.calls()).toBe(1);
  });

  it('degrades to 204, never 500, when the project cannot be scanned', async () => {
    const p = probe(FAKE_PNG);
    const host = createHost({ port: 0, webRoot: WEB_ROOT, renderThumbnail: p.renderer });
    opened.push(host);
    const port = await host.listen();
    const res = await fetch(
      `http://${DEFAULT_HOST}:${port}/api/thumbnail?path=/no/such/project&id=x`,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('x-thumbnail-reason')).toBe('error');
    // A scan failure must never reach the browser.
    expect(p.calls()).toBe(0);
  });
});
