/**
 * Local HTTP + WebSocket server wrapping @ce/core. Reads target projects
 * read-only (via the engine) and streams scan progress over WS. Deliberately
 * thin: it maps requests to engine calls and serializes the results.
 */

import http from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { createLogger, type ProgressEvent } from '@ce/core';
import { sendJson, sendError, handlePreflight, readJsonBody } from './http-util.js';
import { SessionStore } from './session-store.js';

export interface HostOptions {
  readonly port: number;
  readonly defaultProject?: string;
  readonly workspaceRoot?: string;
}

export interface Host {
  readonly server: http.Server;
  listen(): Promise<number>;
  close(): Promise<void>;
}

export function createHost(options: HostOptions): Host {
  const store = new SessionStore(options.workspaceRoot);
  const clients = new Set<WebSocket>();

  const broadcast = (event: ProgressEvent): void => {
    const msg = JSON.stringify({ type: 'progress', ...event });
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) ws.send(msg);
    }
  };

  const server = http.createServer((req, res) => {
    void handleRequest(req, res).catch((err: unknown) => {
      sendError(res, 500, err instanceof Error ? err.message : 'Internal error');
    });
  });

  async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = `${req.method} ${url.pathname}`;

    if (req.method === 'OPTIONS') return handlePreflight(res);

    if (route === 'GET /api/health') {
      return sendJson(res, 200, { ok: true, defaultProject: options.defaultProject ?? null });
    }

    if (route === 'POST /api/scan') {
      const body = await readJsonBody<{ path?: string }>(req);
      const projectPath = body.path ?? options.defaultProject;
      if (!projectPath) return sendError(res, 400, 'Missing "path"', 'MISSING_PATH');
      const logger = createLogger({ onProgress: broadcast });
      try {
        const result = await store.scan(projectPath, logger);
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

    sendError(res, 404, `No route: ${route}`, 'NOT_FOUND');
  }

  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  return {
    server,
    listen() {
      return new Promise<number>((resolve) => {
        server.listen(options.port, () => resolve(options.port));
      });
    },
    close() {
      return new Promise<void>((resolve) => {
        for (const ws of clients) ws.close();
        wss.close(() => server.close(() => resolve()));
      });
    },
  };
}
