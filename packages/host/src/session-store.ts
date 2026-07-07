/**
 * Caches EngineSessions by resolved project path so P2+ (opening a component to
 * build its artifact) reuses the ts-morph program built during the scan.
 */

import * as path from 'node:path';
import { EngineSession, type ComponentArtifact, type Logger, type ScanResult } from '@ce/core';

export class SessionStore {
  private readonly sessions = new Map<string, EngineSession>();

  constructor(private readonly workspaceRoot?: string) {}

  async scan(projectPath: string, logger: Logger): Promise<ScanResult> {
    const key = path.resolve(projectPath);
    const session = await EngineSession.create(
      { rootPath: key },
      { workspaceRoot: this.workspaceRoot, logger },
    );
    // Cache only after scan() succeeds, so a failed scan never leaves a poisoned
    // (un-scanned) session that would make every later /api/artifact fail.
    const result = session.scan();
    this.sessions.set(key, session);
    return result;
  }

  private async ensureSession(projectPath: string, logger: Logger): Promise<EngineSession> {
    const key = path.resolve(projectPath);
    const cached = this.sessions.get(key);
    if (cached) return cached;
    const session = await EngineSession.create(
      { rootPath: key },
      { workspaceRoot: this.workspaceRoot, logger },
    );
    session.scan();
    this.sessions.set(key, session);
    return session;
  }

  /** Build a single component's full artifact (P2 render + portable bundle). */
  async getArtifact(projectPath: string, id: string, logger: Logger): Promise<ComponentArtifact> {
    const session = await this.ensureSession(projectPath, logger);
    return session.buildArtifact(id);
  }

  get(projectPath: string): EngineSession | undefined {
    return this.sessions.get(path.resolve(projectPath));
  }
}
