/** Thin client for the @ce/host HTTP + WS API. */

import type {
  ApiError,
  ComponentArtifact,
  ProgressEvent,
  ProjectPreflight,
  ScanResult,
} from './types.js';

export interface Health {
  ok: boolean;
  defaultProject: string | null;
}

async function parseOrThrow<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T | ApiError;
  if (!res.ok || (data as ApiError).error) {
    const err = (data as ApiError).error;
    throw new Error(err?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export async function getHealth(): Promise<Health> {
  return parseOrThrow<Health>(await fetch('/api/health'));
}

/**
 * The pre-scan profile for a project (framework, srcDirs, aliases, node_modules,
 * workspace members). Cheap on the host — no full scan — so the web can fetch it
 * around the auto-scan and show the user what they are committing to.
 */
export async function getPreflight(path?: string): Promise<ProjectPreflight> {
  const query = path ? `?path=${encodeURIComponent(path)}` : '';
  return parseOrThrow<ProjectPreflight>(await fetch(`/api/preflight${query}`));
}

export interface ScanOptions {
  /** Re-run the engine even if the host has a cached result for this project. */
  force?: boolean;
}

export async function scanProject(path?: string, options: ScanOptions = {}): Promise<ScanResult> {
  const res = await fetch('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(path ? { path } : {}), ...(options.force ? { force: true } : {}) }),
  });
  return parseOrThrow<ScanResult>(res);
}

export async function getArtifact(path: string, id: string): Promise<ComponentArtifact> {
  const res = await fetch('/api/artifact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, id }),
  });
  return parseOrThrow<ComponentArtifact>(res);
}

/** Subscribe to scan progress over WS. Returns an unsubscribe fn. */
export function connectProgress(onEvent: (e: ProgressEvent) => void): () => void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.addEventListener('message', (msg) => {
    try {
      const data = JSON.parse(msg.data as string) as { type?: string } & ProgressEvent;
      if (data.type === 'progress') onEvent(data);
    } catch {
      /* ignore malformed frames */
    }
  });
  return () => ws.close();
}
