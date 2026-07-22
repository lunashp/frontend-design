/**
 * Local HTTP + WebSocket server wrapping @ce/core. Reads target projects
 * read-only (via the engine) and streams scan progress over WS. Deliberately
 * thin: it maps requests to engine calls and serializes the results.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import http from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { createLogger, type ProgressEvent } from '@ce/core';
import {
  applyCors,
  sendJson,
  sendError,
  sendHtml,
  handlePreflight,
  readJsonBody,
  serveStatic,
} from './http-util.js';
import { SessionStore } from './session-store.js';
import { renderPreviewHtml } from './bundle-preview.js';

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
