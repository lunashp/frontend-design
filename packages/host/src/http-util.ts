/** Tiny HTTP helpers so the host stays dependency-light (no Express). */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isInside } from '@ce/core';

/**
 * This process reads arbitrary local source and hands it back over HTTP, so
 * `Access-Control-Allow-Origin: *` would let any page on the internet read the
 * user's disk through their browser. Only loopback origins are echoed back —
 * the Vite dev server (5173), the host's own origin, and nothing else. A remote
 * page gets no ACAO header at all, so the browser blocks it.
 */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTNAMES.has(url.hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Stage the CORS headers for one request. Called once per request before any
 * `writeHead`, which merges what `setHeader` already staged.
 */
export function applyCors(req: IncomingMessage, res: ServerResponse): void {
  // The response varies by Origin even when it is rejected, so caches must not
  // reuse an allowed response for a different origin.
  res.setHeader('Vary', 'Origin');
  const origin = req.headers.origin;
  if (!isAllowedOrigin(origin)) return;
  res.setHeader('Access-Control-Allow-Origin', origin as string);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

export function sendError(res: ServerResponse, status: number, message: string, code?: string): void {
  sendJson(res, status, { error: { message, code: code ?? 'ERROR' } });
}

export function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

/**
 * Send a PNG with a content-addressed ETag so a re-request for the same pixels
 * revalidates cheaply (a 304 body-less reply) while a re-scan that changes the
 * ETag fetches fresh. `no-cache` forces that revalidation rather than letting a
 * browser serve a stale render across a re-scan at the same URL.
 */
export function sendPng(res: ServerResponse, png: Buffer, etag: string): void {
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': String(png.byteLength),
    ETag: etag,
    'Cache-Control': 'no-cache',
  });
  res.end(png);
}

export function handlePreflight(res: ServerResponse): void {
  res.writeHead(204);
  res.end();
}

export async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {} as T;
  return JSON.parse(raw) as T;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

export function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Serve one file out of the built gallery (`packages/web/dist`).
 *
 * Returns `false` when the request is not a static hit, so the caller can fall
 * through to its own 404. Unknown paths without a file extension resolve to
 * `index.html` — the SPA needs deep links to boot the app rather than 404.
 */
export async function serveStatic(
  root: string,
  urlPath: string,
  res: ServerResponse,
): Promise<boolean> {
  const decoded = decodeURIComponent(urlPath);
  const candidate = path.join(root, decoded === '/' ? 'index.html' : decoded);
  // `path.join` already collapses `..`, but a crafted path can still escape via
  // a symlink or an absolute-looking segment; refuse anything outside the root.
  if (!isInside(root, candidate)) return false;

  const target = (await isFile(candidate))
    ? candidate
    : path.extname(candidate) === ''
      ? path.join(root, 'index.html')
      : null;
  if (!target || !(await isFile(target))) return false;

  const body = await fs.readFile(target);
  res.writeHead(200, {
    'Content-Type': contentTypeFor(target),
    'Content-Length': String(body.byteLength),
  });
  res.end(body);
  return true;
}

async function isFile(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isFile();
  } catch {
    return false;
  }
}
