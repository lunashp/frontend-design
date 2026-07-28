/**
 * The MCP server's handle on the engine's bounded EngineSession cache.
 *
 * Identical in behaviour to @ce/host's SessionStore because it *is* the same
 * class: both are thin subclasses of @ce/core's SessionStore, which owns the
 * LRU eviction, idle expiry, `force` semantics and explicit release of a
 * displaced session. This file only keeps the `new SessionCache(workspaceRoot)`
 * call shape the MCP entry points use.
 */

import { EngineError, type Logger, type PortableKit } from '@ce/core';
import {
  SessionStore as CoreSessionStore,
  type SessionStoreOptions,
} from '@ce/core/pipeline/session-store.js';

export type { ScanOptions, SessionStoreOptions } from '@ce/core/pipeline/session-store.js';

export class SessionCache extends CoreSessionStore {
  constructor(workspaceRoot?: string, options: Omit<SessionStoreOptions, 'workspaceRoot'> = {}) {
    super({ ...options, workspaceRoot });
  }

  /**
   * Build a PortableKit for a SET of components — the multi-component sibling of
   * the core store's getArtifact. buildKit needs an already-scanned session, and
   * the core SessionStore exposes no getKit; this package owns only packages/mcp,
   * so compose it here from the store's public surface: scan() primes and caches
   * the session (a no-op on a cache hit), get() hands that same session back
   * most-recently-used. The missing-session branch cannot happen right after a
   * successful scan, but a thrown EngineError beats a non-null assertion that
   * would mask a real regression in the store's admit/evict logic.
   */
  async getKit(projectPath: string, ids: readonly string[], logger: Logger): Promise<PortableKit> {
    await this.scan(projectPath, logger);
    const session = this.get(projectPath);
    if (!session) {
      throw new EngineError(`No cached session for ${projectPath} after scan`, 'NO_SESSION');
    }
    return session.buildKit(ids);
  }
}
