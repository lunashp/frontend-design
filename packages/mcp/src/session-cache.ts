/**
 * The MCP server's handle on the engine's bounded EngineSession cache.
 *
 * Identical in behaviour to @ce/host's SessionStore because it *is* the same
 * class: both are thin subclasses of @ce/core's SessionStore, which owns the
 * LRU eviction, idle expiry, `force` semantics and explicit release of a
 * displaced session. This file only keeps the `new SessionCache(workspaceRoot)`
 * call shape the MCP entry points use.
 */

import {
  SessionStore as CoreSessionStore,
  type SessionStoreOptions,
} from '@ce/core/pipeline/session-store.js';

export type { ScanOptions, SessionStoreOptions } from '@ce/core/pipeline/session-store.js';

export class SessionCache extends CoreSessionStore {
  constructor(workspaceRoot?: string, options: Omit<SessionStoreOptions, 'workspaceRoot'> = {}) {
    super({ ...options, workspaceRoot });
  }
}
