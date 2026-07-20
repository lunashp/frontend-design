/**
 * Caches EngineSessions by resolved project path so P2+ (opening a component to
 * build its artifact) reuses the ts-morph program built during the scan, and so
 * a page reload does not pay for a fresh scan — minutes on a large target.
 * Re-scanning is an explicit act (`force`), not a side effect of loading the UI.
 */

import * as path from 'node:path';
import { EngineSession, type ComponentArtifact, type Logger, type ScanResult } from '@ce/core';

interface Entry {
  readonly session: EngineSession;
  readonly result: ScanResult;
}

export interface ScanOptions {
  /** Re-run the engine even if a result is cached — the gallery's "Re-scan". */
  readonly force?: boolean;
}

export class SessionStore {
  private readonly entries = new Map<string, Entry>();
  /** Runs in progress, so concurrent requests for one project share a single scan. */
  private readonly pending = new Map<string, Promise<Entry>>();

  constructor(private readonly workspaceRoot?: string) {}

  async scan(projectPath: string, logger: Logger, options: ScanOptions = {}): Promise<ScanResult> {
    const key = path.resolve(projectPath);
    if (!options.force) {
      const cached = this.entries.get(key);
      if (cached) return cached.result;
    }
    return (await this.run(key, logger)).result;
  }

  private run(key: string, logger: Logger): Promise<Entry> {
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;

    const started = (async () => {
      const session = await EngineSession.create(
        { rootPath: key },
        { workspaceRoot: this.workspaceRoot, logger },
      );
      // Cache only after scan() succeeds, so a failed scan never leaves a poisoned
      // (un-scanned) session that would make every later /api/artifact fail.
      const result = await session.scan();
      const entry: Entry = { session, result };
      this.entries.set(key, entry);
      return entry;
    })().finally(() => {
      this.pending.delete(key);
    });

    this.pending.set(key, started);
    return started;
  }

  private async ensureEntry(key: string, logger: Logger): Promise<Entry> {
    return this.entries.get(key) ?? (await this.run(key, logger));
  }

  /** Build a single component's full artifact (P2 render + portable bundle). */
  async getArtifact(projectPath: string, id: string, logger: Logger): Promise<ComponentArtifact> {
    const entry = await this.ensureEntry(path.resolve(projectPath), logger);
    return entry.session.buildArtifact(id);
  }

  get(projectPath: string): EngineSession | undefined {
    return this.entries.get(path.resolve(projectPath))?.session;
  }
}
