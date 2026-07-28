/**
 * Local HTTP + WebSocket server wrapping @ce/core. Reads target projects
 * read-only (via the engine) and streams scan progress over WS. Deliberately
 * thin: it maps requests to engine calls and serializes the results.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import http from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { createLogger, preflightProject, type ProgressEvent } from '@ce/core';
import {
  applyCors,
  sendJson,
  sendJsonEtag,
  sendError,
  sendHtml,
  sendPng,
  handlePreflight,
  readJsonBody,
  serveStatic,
} from './http-util.js';
import { SessionStore } from './session-store.js';
import { renderPreviewHtml } from './bundle-preview.js';
import { clampThumbnailWidth, shouldRenderThumbnail, thumbnailCacheKey } from './thumbnail.js';
import { readCachedThumbnail, writeCachedThumbnail } from './thumbnail-cache.js';
import { renderThumbnail as defaultThumbnailRenderer, type ThumbnailRenderer } from './thumbnail-renderer.js';
import {
  a11yCacheKey,
  shouldAuditA11y,
  summarizeAxe,
  unavailableDisclosure,
  type A11yUnavailable,
  type A11yUnavailableReason,
} from './a11y.js';
import { readCachedAudit, writeCachedAudit } from './a11y-cache.js';
import { auditA11y as defaultA11yAuditor, type A11yAuditor } from './a11y-audit.js';

/**
 * Loopback only. This process reads arbitrary local source, so binding every
 * interface (Node's default when `host` is omitted) publishes the user's disk
 * to their whole network. Overriding it is a deliberate act — see main.ts.
 */
export const DEFAULT_HOST = '127.0.0.1';

/** Ports tried before giving up, starting at the requested one. */
export const DEFAULT_PORT_ATTEMPTS = 10;

/** The built gallery, relative to this file: packages/host/src → packages/web/dist. */
const DEFAULT_WEB_ROOT = path.resolve(import.meta.dirname, '../../web/dist');

export interface HostOptions {
  readonly port: number;
  readonly defaultProject?: string;
  readonly workspaceRoot?: string;
  /** Interface to bind. Defaults to loopback; widen only on purpose. */
  readonly host?: string;
  /** Consecutive ports to try when the requested one is taken. */
  readonly portAttempts?: number;
  /** Directory holding the built web gallery. Defaults to packages/web/dist. */
  readonly webRoot?: string;
  /**
   * How a component is rendered to a PNG. Defaults to the real headless-Chromium
   * renderer; injected in tests so the /api/thumbnail contract can be exercised
   * end-to-end without launching a browser.
   */
  readonly renderThumbnail?: ThumbnailRenderer;
  /**
   * How a component is audited for accessibility (axe against the rendered
   * preview). Defaults to the real auditor over the shared browser; injected in
   * tests so the /api/a11y contract can be exercised without a browser.
   */
  readonly auditA11y?: A11yAuditor;
}

export interface Host {
  readonly server: http.Server;
  listen(): Promise<number>;
  close(): Promise<void>;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Bind, stepping the port forward while it is taken.
 *
 * Node reports bind failures as an 'error' event, never as a throw — so without
 * a handler here the returned promise never settles and the process hangs
 * forever on an occupied port.
 */
function listenWithFallback(
  server: http.Server,
  port: number,
  host: string,
  attempts: number,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let remaining = Math.max(1, attempts);
    let current = port;

    const cleanup = (): void => {
      server.off('error', onError);
      server.off('listening', onListening);
    };
    const onError = (err: NodeJS.ErrnoException): void => {
      if (err.code === 'EADDRINUSE' && remaining > 1) {
        remaining -= 1;
        current += 1;
        server.listen(current, host);
        return;
      }
      cleanup();
      reject(err);
    };
    const onListening = (): void => {
      cleanup();
      const address = server.address();
      resolve(typeof address === 'object' && address !== null ? address.port : current);
    };

    server.on('error', onError);
    server.on('listening', onListening);
    server.listen(current, host);
  });
}

export function createHost(options: HostOptions): Host {
  const store = new SessionStore(options.workspaceRoot);
  const clients = new Set<WebSocket>();
  const webRoot = options.webRoot ?? DEFAULT_WEB_ROOT;
  const renderThumbnail = options.renderThumbnail ?? defaultThumbnailRenderer;
  const auditA11y = options.auditA11y ?? defaultA11yAuditor;

  const broadcast = (event: ProgressEvent): void => {
    const msg = JSON.stringify({ type: 'progress', ...event });
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) ws.send(msg);
    }
  };

  // Bundled preview HTML, keyed by `${resolvedProject}::${id}`. Cleared on scan
  // so a re-scan yields fresh previews. Bounded (LRU by insertion order) so a
  // gallery-wide sweep can't accumulate hundreds of multi-MB docs and OOM.
  const PREVIEW_CACHE_MAX = 40;
  const previewCache = new Map<string, string>();
  const cachePreview = (key: string, html: string): void => {
    if (previewCache.size >= PREVIEW_CACHE_MAX) {
      const oldest = previewCache.keys().next().value;
      if (oldest !== undefined) previewCache.delete(oldest);
    }
    previewCache.set(key, html);
  };

  const server = http.createServer((req, res) => {
    void handleRequest(req, res).catch((err: unknown) => {
      sendError(res, 500, err instanceof Error ? err.message : 'Internal error');
    });
  });

  async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = `${req.method} ${url.pathname}`;

    applyCors(req, res);
    if (req.method === 'OPTIONS') return handlePreflight(res);

    if (route === 'GET /api/health') {
      return sendJson(res, 200, { ok: true, defaultProject: options.defaultProject ?? null });
    }

    // A "here is what I will scan" profile, without a full scan: framework +
    // confidence, resolved srcDirs, tsconfig aliases, node_modules presence, and
    // (for a monorepo root) the React members. GET so the web can fetch it around
    // the auto-scan and let the user commit to the scan informed. Read-only.
    if (req.method === 'GET' && url.pathname === '/api/preflight') {
      const projectPath = url.searchParams.get('path') ?? options.defaultProject;
      if (!projectPath) return sendError(res, 400, 'Missing "path"', 'MISSING_PATH');
      try {
        return sendJson(res, 200, preflightProject({ rootPath: projectPath }));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Preflight failed';
        const code = (err as { code?: string }).code ?? 'PREFLIGHT_FAILED';
        return sendError(res, 422, message, code);
      }
    }

    if (route === 'POST /api/scan') {
      const body = await readJsonBody<{ path?: string; force?: boolean }>(req);
      const projectPath = body.path ?? options.defaultProject;
      if (!projectPath) return sendError(res, 400, 'Missing "path"', 'MISSING_PATH');
      const logger = createLogger({ onProgress: broadcast });
      previewCache.clear();
      try {
        const result = await store.scan(projectPath, logger, { force: body.force === true });
        return sendJson(res, 200, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Scan failed';
        const code = (err as { code?: string }).code ?? 'SCAN_FAILED';
        return sendError(res, 422, message, code);
      }
    }

    if (route === 'POST /api/artifact') {
      const body = await readJsonBody<{ path?: string; id?: string }>(req);
      const projectPath = body.path ?? options.defaultProject;
      if (!projectPath) return sendError(res, 400, 'Missing "path"', 'MISSING_PATH');
      if (!body.id) return sendError(res, 400, 'Missing "id"', 'MISSING_ID');
      const logger = createLogger({ onProgress: broadcast });
      try {
        const artifact = await store.getArtifact(projectPath, body.id, logger);
        return sendJson(res, 200, artifact);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Artifact build failed';
        const code = (err as { code?: string }).code ?? 'ARTIFACT_FAILED';
        return sendError(res, 422, message, code);
      }
    }

    // The multi-component harvest endpoint: merge a SET of components into one
    // kit (shared token namespace, deduped files, merged deps). POST so the id
    // set travels in the body. Read-only — same engine, same session cache.
    if (route === 'POST /api/kit') {
      const body = await readJsonBody<{ path?: string; ids?: unknown }>(req);
      const projectPath = body.path ?? options.defaultProject;
      if (!projectPath) return sendError(res, 400, 'Missing "path"', 'MISSING_PATH');
      const rawIds = body.ids;
      // Assembling a kit from an empty or non-string set can't be honoured, and a
      // non-array would crash deeper in the graph walk — reject at the boundary.
      if (
        !Array.isArray(rawIds) ||
        rawIds.length === 0 ||
        rawIds.some((id) => typeof id !== 'string')
      ) {
        return sendError(res, 400, '"ids" must be a non-empty string array', 'INVALID_IDS');
      }
      const ids = rawIds as string[];
      const logger = createLogger({ onProgress: broadcast });
      try {
        // Ensure the project is scanned and its session cached, then build the kit
        // off that session. Mirrors getArtifact's scan-then-session-call; the store
        // has no buildKit method, so the route reaches the session via get().
        await store.scan(projectPath, logger);
        const session = store.get(projectPath);
        if (!session) return sendError(res, 422, 'Session unavailable after scan', 'KIT_FAILED');
        return sendJson(res, 200, session.buildKit(ids));
      } catch (err) {
        const code = (err as { code?: string }).code;
        const message = err instanceof Error ? err.message : 'Kit build failed';
        // An unknown id is the caller's mistake, not a server fault: 4xx, not 500.
        if (code === 'COMPONENT_NOT_FOUND') return sendError(res, 404, message, code);
        return sendError(res, 422, message, code ?? 'KIT_FAILED');
      }
    }

    // Self-contained preview: bundle the component locally (no external CDN) and
    // serve an HTML doc the web app iframes. GET so an <iframe src> can load it.
    if (req.method === 'GET' && url.pathname === '/api/preview') {
      const projectPath = url.searchParams.get('path') ?? options.defaultProject;
      const id = url.searchParams.get('id');
      if (!projectPath) return sendError(res, 400, 'Missing "path"', 'MISSING_PATH');
      if (!id) return sendError(res, 400, 'Missing "id"', 'MISSING_ID');

      // Optional prop overrides (Customize prop edits), JSON in the `props` query.
      const propsRaw = url.searchParams.get('props');
      let propOverrides: Record<string, unknown> | undefined;
      if (propsRaw) {
        try {
          const parsed = JSON.parse(propsRaw) as unknown;
          if (parsed && typeof parsed === 'object') propOverrides = parsed as Record<string, unknown>;
        } catch {
          /* ignore malformed props */
        }
      }

      const cacheKey = `${path.resolve(projectPath)}::${id}::${propsRaw ?? ''}`;
      const cached = previewCache.get(cacheKey);
      if (cached) return sendHtml(res, 200, cached);

      const logger = createLogger({ onProgress: broadcast });
      try {
        const artifact = await store.getArtifact(projectPath, id, logger);
        // Code-only components (giant page subtrees, server-only modules) have an
        // incomplete or unbundlable spec — the UI never previews them. Short-circuit
        // instead of feeding a huge/broken bundle to esbuild (which can exhaust it).
        if (artifact.sandpack.renderability === 'code-only') {
          return sendHtml(
            res,
            200,
            `<!doctype html><meta charset="utf-8"><body style="font:13px/1.5 ui-monospace,monospace;color:#7a7f87;padding:16px">` +
              `This component can’t be bundled for an isolated preview (too many files or a server-only runtime). See the Portable tab for its code.</body>`,
          );
        }
        const html = await renderPreviewHtml({
          targetRoot: path.resolve(projectPath),
          spec: artifact.sandpack,
          propOverrides,
        });
        cachePreview(cacheKey, html);
        return sendHtml(res, 200, html);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Preview build failed';
        // Render the error INTO the iframe so the user sees why, not a blank frame.
        return sendHtml(
          res,
          200,
          `<!doctype html><meta charset="utf-8"><body style="font:13px/1.5 ui-monospace,monospace;color:#b4232c;padding:16px">` +
            `<strong>Preview build failed</strong><pre style="white-space:pre-wrap">${escapeHtml(message)}</pre></body>`,
        );
      }
    }

    // Lazy, per-card thumbnail: a PNG of the component rendered in headless
    // Chromium. GET so a gallery card's <img src> can load it. The gallery is
    // virtualized, so only visible cards ever mount an <img> and hit this route.
    //
    // Contract:
    //   200 image/png (+ ETag) — the rendered thumbnail.
    //   304                     — If-None-Match matched; pixels unchanged.
    //   204 (+ X-Thumbnail-Reason: code-only | unavailable | error)
    //                           — no thumbnail; the card falls back to text.
    //   400                     — missing path/id.
    //   404                     — unknown component id.
    // It never 500s or hangs on a render problem: every failure degrades to 204.
    if (req.method === 'GET' && url.pathname === '/api/thumbnail') {
      const projectPath = url.searchParams.get('path') ?? options.defaultProject;
      const id = url.searchParams.get('id');
      if (!projectPath) return sendError(res, 400, 'Missing "path"', 'MISSING_PATH');
      if (!id) return sendError(res, 400, 'Missing "id"', 'MISSING_ID');

      const widthRaw = url.searchParams.get('w');
      const width = clampThumbnailWidth(widthRaw === null ? undefined : Number(widthRaw));

      const noThumbnail = (reason: 'code-only' | 'unavailable' | 'error'): void => {
        // 204 carries no body (an <img> treats it as an error and falls back);
        // the reason header is for a human reading the network panel, not the UI.
        res.writeHead(204, { 'X-Thumbnail-Reason': reason });
        res.end();
      };

      const logger = createLogger({ onProgress: broadcast });
      try {
        const artifact = await store.getArtifact(projectPath, id, logger);
        // A code-only component cannot render in isolation — the engine already
        // decided that, so skip the browser entirely and let the card show text.
        if (!shouldRenderThumbnail(artifact.sandpack.renderability)) return noThumbnail('code-only');

        // The workspace dir (authoritative, from the session that just built the
        // artifact) is where the on-disk PNG cache lives — under the engine's own
        // scratch area, never the target project.
        const workspaceDir = store.get(projectPath)?.loaded.workspaceDir;
        const key = thumbnailCacheKey({ componentId: id, spec: artifact.sandpack, width });
        const etag = `"${key}"`;

        // The ETag is the pixel hash, so an unchanged component revalidates as a
        // body-less 304 (instant scroll-back) and a re-scan that changes the
        // bundle changes the ETag and refetches.
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
          res.end();
          return;
        }

        // Disk hit → serve instantly, no browser work. Survives page reloads and
        // re-scans of unchanged source.
        if (workspaceDir) {
          const cached = await readCachedThumbnail(workspaceDir, key);
          if (cached) return sendPng(res, cached, etag);
        }

        const png = await renderThumbnail({
          targetRoot: path.resolve(projectPath),
          spec: artifact.sandpack,
          width,
        });
        // null = the browser is unavailable, the bundle failed, or the render
        // timed out. All degrade to the same text-only card.
        if (!png) return noThumbnail('unavailable');

        if (workspaceDir) {
          // Persist for later hits; a write failure (full disk) must not fail the
          // response — worst case we render again next time.
          await writeCachedThumbnail(workspaceDir, key, png).catch(() => {});
        }
        return sendPng(res, png, etag);
      } catch (err) {
        // An unknown id is the caller's mistake (404). Anything else is a
        // definitive "no thumbnail", never a 500 that would break the gallery.
        if ((err as { code?: string }).code === 'COMPONENT_NOT_FOUND') {
          return sendError(res, 404, err instanceof Error ? err.message : 'Unknown component', 'COMPONENT_NOT_FOUND');
        }
        return noThumbnail('error');
      }
    }

    // Advisory accessibility audit: axe-core run against the component's rendered
    // preview (the SAME render the thumbnail uses, over the SAME shared browser).
    // GET so the inspector can fetch it lazily when a component is opened.
    //
    // Contract:
    //   200 application/json { available:true, summary, findings, disclosure, … }
    //                         (+ ETag) — the audit; findings are advisory, bounded,
    //                         and disclose stubbed context.
    //   200 application/json { available:false, reason, disclosure }
    //                         — code-only (no isolated render) or unavailable
    //                         (browser absent / render or axe timed out). Definitive,
    //                         never a 500 or a hang.
    //   304                   — If-None-Match matched; audit unchanged.
    //   400                   — missing path/id.
    //   404                   — unknown component id.
    if (req.method === 'GET' && url.pathname === '/api/a11y') {
      const projectPath = url.searchParams.get('path') ?? options.defaultProject;
      const id = url.searchParams.get('id');
      if (!projectPath) return sendError(res, 400, 'Missing "path"', 'MISSING_PATH');
      if (!id) return sendError(res, 400, 'Missing "id"', 'MISSING_ID');

      const unavailable = (reason: A11yUnavailableReason): void => {
        const body: A11yUnavailable = { available: false, reason, disclosure: unavailableDisclosure(reason) };
        // 200, not an error status: "cannot audit" is a definitive, expected
        // answer the inspector renders, exactly like a 204 thumbnail.
        sendJson(res, 200, body);
      };

      const logger = createLogger({ onProgress: broadcast });
      try {
        const artifact = await store.getArtifact(projectPath, id, logger);
        // A code-only component cannot render in isolation — skip the browser
        // entirely and tell the inspector there is nothing to audit.
        if (!shouldAuditA11y(artifact.sandpack.renderability)) return unavailable('code-only');

        const workspaceDir = store.get(projectPath)?.loaded.workspaceDir;
        const key = a11yCacheKey({ componentId: id, spec: artifact.sandpack });
        const etag = '"a11y-' + key + '"';

        // The ETag is the bundle hash, so an unchanged component revalidates as a
        // body-less 304 and a re-scan that changes the bundle refetches.
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
          res.end();
          return;
        }

        // Disk hit → serve instantly, no browser work. Survives reloads and
        // re-scans of unchanged source.
        if (workspaceDir) {
          const cached = await readCachedAudit(workspaceDir, key);
          if (cached) return sendJsonEtag(res, 200, cached, etag);
        }

        const violations = await auditA11y({
          targetRoot: path.resolve(projectPath),
          spec: artifact.sandpack,
        });
        // null = browser unavailable, bundle failed, or the render/axe run timed
        // out. All degrade to the same "unavailable" — never cached (transient).
        if (!violations) return unavailable('unavailable');

        const report = summarizeAxe(violations, { renderability: artifact.sandpack.renderability });
        if (workspaceDir) {
          // Persist for later hits; a write failure (full disk) must not fail the
          // response — worst case we audit again next time.
          await writeCachedAudit(workspaceDir, key, report).catch(() => {});
        }
        return sendJsonEtag(res, 200, report, etag);
      } catch (err) {
        // An unknown id is the caller's mistake (404). Anything else degrades to
        // an "unavailable" audit, never a 500 that would break the inspector.
        if ((err as { code?: string }).code === 'COMPONENT_NOT_FOUND') {
          return sendError(res, 404, err instanceof Error ? err.message : 'Unknown component', 'COMPONENT_NOT_FOUND');
        }
        return unavailable('unavailable');
      }
    }

    // Everything that is not an API call is the built gallery, so starting the
    // host is the single command that runs the product — no second dev server.
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      if (await serveStatic(webRoot, url.pathname, res)) return;
      if (!(await isDirectory(webRoot))) {
        return sendHtml(
          res,
          503,
          `<!doctype html><meta charset="utf-8"><title>Gallery not built</title>` +
            `<body style="font:14px/1.6 ui-sans-serif,system-ui;padding:32px;max-width:52rem">` +
            `<h1 style="font-size:1.25rem">The gallery has not been built</h1>` +
            `<p>The API is up, but there is no built web app to serve at ` +
            `<code>${escapeHtml(webRoot)}</code>.</p>` +
            `<p>Build it once with <code>pnpm --filter @ce/web build</code>, or run the Vite dev ` +
            `server with <code>pnpm dev</code> and open it instead — it proxies /api here.</p></body>`,
        );
      }
    }

    sendError(res, 404, `No route: ${route}`, 'NOT_FOUND');
  }

  const wss = new WebSocketServer({ server, path: '/ws' });
  // ws mirrors every http.Server 'error' onto the WebSocketServer, and an
  // unhandled 'error' on an EventEmitter throws — so without this, the port
  // fallback below would crash the process on the very EADDRINUSE it handles.
  wss.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') return; // owned by listen(), already handled
    console.error(`[ce:host] websocket error: ${err.message}`);
  });
  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  return {
    server,
    listen() {
      return listenWithFallback(
        server,
        options.port,
        options.host ?? DEFAULT_HOST,
        options.portAttempts ?? DEFAULT_PORT_ATTEMPTS,
      );
    },
    close() {
      return new Promise<void>((resolve) => {
        for (const ws of clients) ws.close();
        wss.close(() => server.close(() => resolve()));
      });
    },
  };
}
