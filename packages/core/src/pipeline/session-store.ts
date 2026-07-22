/**
 * Bounded cache of EngineSessions, keyed by resolved project path. Shared by
 * every transport: @ce/host's `SessionStore` and the MCP server's `SessionCache`
 * are both thin subclasses of this one, so the two can no longer drift.
 *
 * Caching at all is what makes P2+ affordable — opening a component reuses the
 * ts-morph program built during the scan, and a page reload does not pay for a
 * fresh scan. Re-scanning stays an explicit act (`force`), never a side effect
 * of a lookup.
 *
 * Bounding it is what keeps that affordable. An EngineSession owns a whole
 * ts-morph program (hundreds of MB on a large target), so an unbounded map is a
 * leak: scanning a second project, or force re-scanning the first, used to pin
 * the previous program alive for the life of the process. Entries are capped
 * (least-recently-used evicted first), expire once idle, and every session that
 * is evicted, replaced or superseded is explicitly released.
 */

import * as path from 'node:path';
import { EngineSession } from './session.js';
import type { ComponentArtifact, ScanResult } from '../types/artifact.js';
import type { Logger } from '../util/logger.js';

/** Live sessions kept before the least-recently-used one is evicted. */
export const DEFAULT_MAX_SESSIONS = 3;

/** How long an unused session stays cached (30 minutes). */
export const DEFAULT_TTL_MS = 30 * 60 * 1000;

export interface SessionStoreOptions {
  /** Engine scratch dir. The target project itself is never written to. */
  readonly workspaceRoot?: string;
  /** Cap on simultaneously cached sessions. Clamped to at least 1. */
  readonly maxSessions?: number;
  /** Idle milliseconds before an entry is dropped; `0` disables expiry. */
  readonly ttlMs?: number;
  /** Clock seam so tests can age entries without waiting. */
  readonly now?: () => number;
}

export interface ScanOptions {
  /** Re-run the engine even if a result is cached — the gallery's "Re-scan". */
  readonly force?: boolean;
}

interface Entry {
  readonly session: EngineSession;
  readonly result: ScanResult;
  /** Last access, driving both TTL expiry and LRU order. */
  readonly usedAt: number;
}

/**
 * Let go of a session we are no longer caching.
 *
 * EngineSession exposes no dispose/teardown today, so dropping the last
 * reference is the whole of the teardown available: the ts-morph program and
 * docgen parser it holds become garbage once nothing points at them. The
 * optional call is here so that the day the engine grows a `dispose()`,
 * eviction starts using it without a second round of edits.
 */
function releaseSession(session: EngineSession): void {
  const disposable = session as EngineSession & { dispose?: () => void };
  if (typeof disposable.dispose === 'function') disposable.dispose();
}

export class SessionStore {
  private readonly entries = new Map<string, Entry>();
  /** Runs in progress, so concurrent requests for one project share one scan. */
  private readonly pending = new Map<string, Promise<Entry>>();
  private readonly maxSessions: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(private readonly options: SessionStoreOptions = {}) {
    this.maxSessions = Math.max(1, options.maxSessions ?? DEFAULT_MAX_SESSIONS);
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  /** Number of live cached sessions (expired ones are dropped first). */
  get size(): number {
    this.pruneExpired();
    return this.entries.size;
  }

  async scan(projectPath: string, logger: Logger, options: ScanOptions = {}): Promise<ScanResult> {
    const key = path.resolve(projectPath);
    if (!options.force) {
      const cached = this.lookup(key);
      if (cached) return cached.result;
    }
    return (await this.run(key, logger, options.force === true)).result;
  }

  /** Build a single component's full artifact (P2 render + portable bundle). */
  async getArtifact(projectPath: string, id: string, logger: Logger): Promise<ComponentArtifact> {
    const key = path.resolve(projectPath);
    const entry = this.lookup(key) ?? (await this.run(key, logger, false));
    return entry.session.buildArtifact(id);
  }

  get(projectPath: string): EngineSession | undefined {
    return this.lookup(path.resolve(projectPath))?.session;
  }

  /** Drop every cached session (shutdown, tests). Runs in flight are unaffected. */
  clear(): void {
    for (const entry of this.entries.values()) releaseSession(entry.session);
    this.entries.clear();
  }

  /** Fetch an entry and mark it most-recently-used, or miss. */
  private lookup(key: string): Entry | undefined {
    this.pruneExpired();
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    // Re-insert so Map iteration order stays least-recently-used first.
    this.entries.delete(key);
    const touched: Entry = { ...entry, usedAt: this.now() };
    this.entries.set(key, touched);
    return touched;
  }

  private pruneExpired(): void {
    if (this.ttlMs <= 0) return;
    const cutoff = this.now() - this.ttlMs;
    for (const [key, entry] of this.entries) {
      if (entry.usedAt <= cutoff) this.evict(key);
    }
  }

  private evict(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    releaseSession(entry.session);
  }

  /** Insert a freshly scanned entry, releasing whatever it displaces. */
  private admit(key: string, entry: Entry): void {
    // A forced re-scan replaces the previous session for this key; release it
    // rather than letting Map.set silently drop the last reference to a program
    // we could have torn down explicitly.
    this.evict(key);
    this.entries.set(key, entry);
    this.pruneExpired();
    while (this.entries.size > this.maxSessions) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.evict(oldest);
    }
  }

  private run(key: string, logger: Logger, force: boolean): Promise<Entry> {
    // A forced re-scan must NOT attach to the run it is trying to replace:
    // joining it would hand back exactly the stale result the caller asked to
    // redo. Only an unforced call shares an in-flight scan.
    if (!force) {
      const inFlight = this.pending.get(key);
      if (inFlight) return inFlight;
    }

    // Declared up front because the run identifies itself by this promise: a
    // forced re-scan overwrites the pending slot, and whichever run no longer
    // holds it must neither publish its result nor clear the slot.
    let tracked: Promise<Entry> | undefined;

    const started = (async () => {
      const session = await EngineSession.create(
        { rootPath: key },
        { workspaceRoot: this.options.workspaceRoot, logger },
      );
      // Cache only after scan() succeeds, so a failed scan never leaves a poisoned
      // (un-scanned) session that would make every later artifact build fail.
      const result = await session.scan();
      const entry: Entry = { session, result, usedAt: this.now() };
      if (this.pending.get(key) === tracked) this.admit(key, entry);
      else releaseSession(session);
      return entry;
    })();

    tracked = started.finally(() => {
      if (this.pending.get(key) === tracked) this.pending.delete(key);
    });

    this.pending.set(key, tracked);
    return tracked;
  }
}
