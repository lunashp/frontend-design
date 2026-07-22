/**
 * The host's handle on the engine's bounded EngineSession cache.
 *
 * All of the behaviour — LRU eviction, idle expiry, `force` semantics, explicit
 * release of a displaced session — lives in @ce/core's SessionStore. This file
 * exists only to keep the host's `new SessionStore(workspaceRoot)` call shape,
 * so the transport can no longer drift from the MCP server's copy.
 */

import {
  SessionStore as CoreSessionStore,
  type SessionStoreOptions,
} from '@ce/core/pipeline/session-store.js';

export type { ScanOptions, SessionStoreOptions } from '@ce/core/pipeline/session-store.js';

export class SessionStore extends CoreSessionStore {
  constructor(workspaceRoot?: string, options: Omit<SessionStoreOptions, 'workspaceRoot'> = {}) {
    super({ ...options, workspaceRoot });
  }
}
