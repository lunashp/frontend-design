/**
 * The GET /api/a11y contract, exercised end-to-end WITHOUT a browser.
 *
 * The audit seam (`auditA11y`) is injected with a fake that returns canned axe
 * violations (or null), so this proves the route's own behaviour — session
 * resolution, the code-only/renderability gate, the on-disk JSON cache, the
 * ETag/304 revalidation, the summarizer wiring and the graceful-degradation
 * response shaping — with zero Chromium. The real axe run is proven separately in
 * e2e/a11y-audit.spec.ts, which is deliberately kept out of `pnpm test`.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHost, DEFAULT_HOST, type Host } from '../src/server.js';
import type { A11yAuditor } from '../src/a11y-audit.js';
import type { AxeViolationRaw } from '../src/a11y.js';

const REACT_FIXTURE = path.resolve(import.meta.dirname, '../../core/test/fixtures/simple-react');
const WEB_ROOT = path.join(os.tmpdir(), 'ce-a11y-webroot');

/** A canned axe violation the fake auditor hands back. */
const FAKE_VIOLATIONS: AxeViolationRaw[] = [
  {
    id: 'image-alt',
    impact: 'critical',
    help: 'Images must have alternate text',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/image-alt',
    nodeCount: 1,
    targets: ['img'],
  },
  {
    id: 'color-contrast',
    impact: 'serious',
    help: 'Elements must meet minimum contrast ratio thresholds',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/color-contrast',
    nodeCount: 2,
    targets: ['p', 'span'],
  },
];

const opened: Host[] = [];
const tempDirs: string[] = [];

interface AuditorProbe {
  auditor: A11yAuditor;
  calls: () => number;
}

/** A fake auditor that counts invocations and returns whatever `result` says. */
function probe(result: readonly AxeViolationRaw[] | null): AuditorProbe {
  let calls = 0;
  return {
    auditor: async () => {
      calls += 1;
      return result;
    },
    calls: () => calls,
  };
}

/** Each host gets its own workspace so one test's on-disk audit cannot satisfy another's. */
async function start(auditA11y: A11yAuditor) {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-a11y-ws-'));
  tempDirs.push(workspaceRoot);
  const host = createHost({
    port: 0,
    webRoot: WEB_ROOT,
    workspaceRoot,
    defaultProject: REACT_FIXTURE,
    auditA11y,
  });
  opened.push(host);
  const port = await host.listen();
  return { base: 'http://' + DEFAULT_HOST + ':' + port };
}

/** First scanned component the engine reports as renderable (never code-only). */
async function firstRenderableId(base: string): Promise<string> {
  const scan = await fetch(base + '/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: REACT_FIXTURE }),
  });
  const { components } = (await scan.json()) as {
    components: Array<{ descriptor: { id: string } }>;
  };
  for (const c of components) {
    const res = await fetch(base + '/api/artifact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: REACT_FIXTURE, id: c.descriptor.id }),
    });
    const artifact = (await res.json()) as { sandpack: { renderability: string } };
    if (artifact.sandpack.renderability !== 'code-only') return c.descriptor.id;
  }
  throw new Error('fixture has no renderable component');
}

interface ReportBody {
  available: boolean;
  reason?: string;
  summary?: { critical: number; serious: number; moderate: number; minor: number };
  findings?: Array<{ ruleId: string; impact: string; nodeCount: number }>;
  total?: number;
  disclosure?: string;
  stubbedContext?: boolean;
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

describe('GET /api/a11y validation', () => {
  it('400s when no path and no default project', async () => {
    const host = createHost({ port: 0, webRoot: WEB_ROOT, auditA11y: probe(FAKE_VIOLATIONS).auditor });
    opened.push(host);
    const port = await host.listen();
    const res = await fetch('http://' + DEFAULT_HOST + ':' + port + '/api/a11y?id=x');
    expect(res.status).toBe(400);
  });

  it('400s when id is missing', async () => {
    const { base } = await start(probe(FAKE_VIOLATIONS).auditor);
    const res = await fetch(base + '/api/a11y?path=' + encodeURIComponent(REACT_FIXTURE));
    expect(res.status).toBe(400);
  });

  it('404s an unknown component id, never a 500', async () => {
    const { base } = await start(probe(FAKE_VIOLATIONS).auditor);
    const res = await fetch(base + '/api/a11y?id=' + encodeURIComponent('no/such.tsx#Nope'));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/a11y auditing', () => {
  it('returns a structured, impact-ranked report for a renderable component', async () => {
    const p = probe(FAKE_VIOLATIONS);
    const { base } = await start(p.auditor);
    const id = await firstRenderableId(base);

    const res = await fetch(base + '/api/a11y?id=' + encodeURIComponent(id));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('etag')).toBeTruthy();
    const body = (await res.json()) as ReportBody;
    expect(body.available).toBe(true);
    expect(body.summary).toEqual({ critical: 1, serious: 1, moderate: 0, minor: 0 });
    expect(body.total).toBe(2);
    // Critical leads the ranked list; the disclosure rides on the payload.
    expect(body.findings?.[0]?.ruleId).toBe('image-alt');
    expect(body.findings?.[0]?.impact).toBe('critical');
    expect(String(body.disclosure).toLowerCase()).toContain('advisory');
    expect(p.calls()).toBe(1);
  });

  it('carries a clean pass honestly — available with zero findings', async () => {
    const p = probe([]);
    const { base } = await start(p.auditor);
    const id = await firstRenderableId(base);

    const body = (await (await fetch(base + '/api/a11y?id=' + encodeURIComponent(id))).json()) as ReportBody;
    expect(body.available).toBe(true);
    expect(body.total).toBe(0);
    expect(body.findings).toEqual([]);
    expect(body.summary).toEqual({ critical: 0, serious: 0, moderate: 0, minor: 0 });
  });

  it('serves the second request from the disk cache — the auditor runs once', async () => {
    const p = probe(FAKE_VIOLATIONS);
    const { base } = await start(p.auditor);
    const id = await firstRenderableId(base);

    await fetch(base + '/api/a11y?id=' + encodeURIComponent(id));
    const again = await fetch(base + '/api/a11y?id=' + encodeURIComponent(id));
    expect(again.status).toBe(200);
    const body = (await again.json()) as ReportBody;
    expect(body.available).toBe(true);
    // The report came off disk the second time; axe was never asked twice.
    expect(p.calls()).toBe(1);
  });

  it('revalidates with a 304 when the caller already has the current ETag', async () => {
    const { base } = await start(probe(FAKE_VIOLATIONS).auditor);
    const id = await firstRenderableId(base);

    const first = await fetch(base + '/api/a11y?id=' + encodeURIComponent(id));
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();

    const revalidate = await fetch(base + '/api/a11y?id=' + encodeURIComponent(id), {
      headers: { 'If-None-Match': etag as string },
    });
    expect(revalidate.status).toBe(304);
  });

  it('answers a definitive unavailable (200, not 500) when the browser is absent', async () => {
    const p = probe(null);
    const { base } = await start(p.auditor);
    const id = await firstRenderableId(base);

    const res = await fetch(base + '/api/a11y?id=' + encodeURIComponent(id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReportBody;
    expect(body.available).toBe(false);
    expect(body.reason).toBe('unavailable');
    expect(body.disclosure).toBeTruthy();
    expect(p.calls()).toBe(1);
  });

  it('never caches an unavailable outcome — a transient browser failure must not stick', async () => {
    const p = probe(null);
    const { base } = await start(p.auditor);
    const id = await firstRenderableId(base);

    await fetch(base + '/api/a11y?id=' + encodeURIComponent(id));
    await fetch(base + '/api/a11y?id=' + encodeURIComponent(id));
    // Both requests reached the auditor: an unavailable result is never persisted.
    expect(p.calls()).toBe(2);
  });

  it('degrades to unavailable (200), never 500, when the project cannot be scanned', async () => {
    const p = probe(FAKE_VIOLATIONS);
    const host = createHost({ port: 0, webRoot: WEB_ROOT, auditA11y: p.auditor });
    opened.push(host);
    const port = await host.listen();
    const res = await fetch('http://' + DEFAULT_HOST + ':' + port + '/api/a11y?path=/no/such/project&id=x');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReportBody;
    expect(body.available).toBe(false);
    expect(body.reason).toBe('unavailable');
    // A scan failure must never reach the auditor.
    expect(p.calls()).toBe(0);
  });
});
