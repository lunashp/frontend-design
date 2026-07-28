/**
 * Per-project session persistence: the kit basket and in-progress customizations,
 * saved so a reload doesn't throw away work.
 *
 * WHY: only the URL state (filters, selection, tab) survived a reload. A curated
 * basket and minutes of live re-theming lived purely in React state and vanished
 * on refresh — the most expensive data to lose, because it comes AFTER a scan
 * that itself costs minutes. Named presets already prove the localStorage
 * pattern (`lib/presets.ts`); this extends it to the two states that hurt most.
 *
 * SCOPED PER PROJECT. Component ids are per-project hashes of file+export, so a
 * basket or a customization map means nothing under a different scan target. The
 * key is the project root; switching projects loads that project's own snapshot.
 *
 * Pure by construction — persistence goes through an injected `SessionStorage`,
 * never `window` — so the whole round trip is unit-testable without a DOM, and
 * everything read back is untrusted (corrupt JSON, an older shape, a hand-edited
 * value): every decode degrades to an empty snapshot and NEVER throws.
 */

import type { CustomizationState } from './customize.js';

export interface SessionSnapshot {
  /** Component ids in the kit basket, in insertion order. */
  readonly basket: readonly string[];
  /** Per-component customization state, keyed by component id. */
  readonly customizations: Readonly<Record<string, CustomizationState>>;
}

export const EMPTY_SNAPSHOT: SessionSnapshot = { basket: [], customizations: {} };

/**
 * The slice of the Web Storage API this store needs. Injected (not reached for on
 * `window`) so the module stays pure and a test can hand in an in-memory fake or
 * a throwing stub.
 */
export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Versioned namespace, so a future shape change can bump `v1` without clashing. */
export const SESSION_KEY_PREFIX = 'ce:session:v1';

/** The storage key for one project root. */
export function sessionStorageKey(projectRoot: string): string {
  return `${SESSION_KEY_PREFIX}:${projectRoot}`;
}

// ── Defensive coercion (everything from storage is untrusted) ─────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Keep only string→string entries; drop anything else. */
function coerceStringRecord(v: unknown): Record<string, string> {
  if (!isRecord(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === 'string') out[k] = val;
  }
  return out;
}

/** Keep every own entry as-is — prop values are intentionally `unknown`. */
function coerceRecord(v: unknown): Record<string, unknown> {
  return isRecord(v) ? { ...v } : {};
}

/**
 * Rebuild a clean `CustomizationState` from untrusted JSON, defaulting missing
 * maps to empty. Returns null only when the value is not an object at all, so a
 * junk entry is dropped rather than poisoning the map.
 */
function coerceState(v: unknown): CustomizationState | null {
  if (!isRecord(v)) return null;
  return {
    tokenOverrides: coerceStringRecord(v.tokenOverrides),
    propValues: coerceRecord(v.propValues),
    designOverrides: coerceStringRecord(v.designOverrides),
  };
}

/** Keep only the string entries of the basket array. */
function coerceBasket(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((id): id is string => typeof id === 'string');
}

/** Keep only the id→valid-state entries of the customization map. */
function coerceCustomizations(v: unknown): Record<string, CustomizationState> {
  if (!isRecord(v)) return {};
  const out: Record<string, CustomizationState> = {};
  for (const [id, raw] of Object.entries(v)) {
    const state = coerceState(raw);
    if (state) out[id] = state;
  }
  return out;
}

/**
 * A raw JSON string → a valid snapshot. `null` (nothing stored), malformed JSON,
 * a non-object payload, and individually broken entries all degrade to a valid
 * (possibly empty) snapshot. Exposed so callers that already hold the string can
 * decode without a storage object; never throws.
 */
export function decodeSnapshot(raw: string | null): SessionSnapshot {
  if (raw === null) return EMPTY_SNAPSHOT;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_SNAPSHOT;
  }
  if (!isRecord(parsed)) return EMPTY_SNAPSHOT;
  return {
    basket: coerceBasket(parsed.basket),
    customizations: coerceCustomizations(parsed.customizations),
  };
}

/**
 * Read the snapshot stored under `key`. Absent storage, a throwing `getItem`
 * (privacy mode), and every malformed shape degrade to `EMPTY_SNAPSHOT` — this
 * never throws.
 */
export function loadSession(storage: SessionStorageLike | null, key: string): SessionSnapshot {
  if (!storage) return EMPTY_SNAPSHOT;
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return EMPTY_SNAPSHOT;
  }
  return decodeSnapshot(raw);
}

/**
 * Persist `snapshot` under `key`. Returns whether the write landed: a null or
 * rejecting storage (quota, privacy mode) yields `false` so the caller can
 * degrade to in-memory-only rather than crash — it never throws.
 */
export function saveSession(
  storage: SessionStorageLike | null,
  key: string,
  snapshot: SessionSnapshot,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

/**
 * Drop basket ids the current scan does not contain. A saved basket can name a
 * component that has since been deleted or renamed; carrying a stale id into a
 * kit build would 404 the whole request. Order is preserved. Pure.
 */
export function pruneBasket(
  basket: readonly string[],
  presentIds: ReadonlySet<string>,
): string[] {
  return basket.filter((id) => presentIds.has(id));
}
