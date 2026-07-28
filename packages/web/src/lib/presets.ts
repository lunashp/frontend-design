/**
 * Named customization presets, persisted so re-theming survives a reload.
 *
 * The in-memory customization map (see `customize.ts`) lives in React state and
 * evaporates on refresh — minutes of theming lost to one reload. A preset is a
 * NAMED snapshot of a component's `CustomizationState` that the user saves to
 * `localStorage` and re-applies later. This module is the pure store: every
 * function is a plain data transform, and persistence goes through an injected
 * `PresetStorage`, so the whole thing is testable without a DOM.
 *
 * Everything read back from storage is untrusted (corrupt JSON, an older shape,
 * a hand-edited value), so `loadPresets` validates defensively and NEVER throws
 * — a broken store degrades to "no presets", it does not crash the pane.
 */

import type { CustomizationState } from './customize.js';

export interface Preset {
  /** Stable per-preset id — the handle for rename/delete/apply. */
  readonly id: string;
  /** User-facing label. Trimmed; may repeat only via rename. */
  readonly name: string;
  /** The snapshot this preset restores. */
  readonly state: CustomizationState;
  /** Creation timestamp (ms), for stable display ordering if needed. */
  readonly createdAt: number;
}

export type PresetList = readonly Preset[];

/**
 * The slice of the Web Storage API this store needs. Injecting it (rather than
 * reaching for `window.localStorage`) is what keeps the module pure and lets a
 * test hand in an in-memory fake or a throwing stub.
 */
export interface PresetStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Versioned namespace, so a future shape change can bump `v1` without clashing. */
export const PRESET_KEY_PREFIX = 'ce:presets:v1';

/**
 * Presets are keyed by project AND component. The snapshot is inherently
 * component-scoped — `tokenOverrides` are keyed by per-component token-id hashes
 * and `propValues` by that component's prop names — so a preset saved on one
 * component maps onto tokens and props another component does not have. Per
 * (project, component) is therefore the only honest scope.
 */
export function presetStorageKey(projectRoot: string, componentId: string): string {
  return `${PRESET_KEY_PREFIX}:${projectRoot}::${componentId}`;
}

/** Compare two names for upsert/dedup: trimmed, case-insensitive. */
function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/** Build a preset from a name, snapshot, clock and id. Name is trimmed here so
 *  every entry the store holds is already clean. */
export function createPreset(
  name: string,
  state: CustomizationState,
  createdAt: number,
  id: string,
): Preset {
  return { id, name: name.trim(), state, createdAt };
}

/**
 * Save `preset` into the list. If one with the same (normalized) name already
 * exists it is replaced in place — saving "Brand" twice updates it rather than
 * stacking a duplicate the user cannot tell apart. Otherwise it is appended.
 */
export function addPreset(list: PresetList, preset: Preset): PresetList {
  const key = normalizeName(preset.name);
  const at = list.findIndex((p) => normalizeName(p.name) === key);
  if (at === -1) return [...list, preset];
  return list.map((p, i) => (i === at ? preset : p));
}

/** Rename the preset with `id` (trimmed). Unknown id is a no-op. Immutable. */
export function renamePreset(list: PresetList, id: string, name: string): PresetList {
  return list.map((p) => (p.id === id ? { ...p, name: name.trim() } : p));
}

/** Remove the preset with `id`. Unknown id leaves the list unchanged. Immutable. */
export function deletePreset(list: PresetList, id: string): PresetList {
  return list.filter((p) => p.id !== id);
}

/** The preset with `id`, or undefined — the target for apply/switch. */
export function findPreset(list: PresetList, id: string): Preset | undefined {
  return list.find((p) => p.id === id);
}

// ── Persistence (defensive at both ends) ──────────────────────────────────────

/** True when `v` is a plain object we can index — not an array, not null. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Keep only the string→string entries; anything else is dropped, never thrown. */
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
 * maps to empty. Returns null only when the value is not an object at all.
 */
function coerceState(v: unknown): CustomizationState | null {
  if (!isRecord(v)) return null;
  return {
    tokenOverrides: coerceStringRecord(v.tokenOverrides),
    propValues: coerceRecord(v.propValues),
    designOverrides: coerceStringRecord(v.designOverrides),
  };
}

/** Validate one stored entry into a `Preset`, or null to drop it. */
function coercePreset(v: unknown): Preset | null {
  if (!isRecord(v)) return null;
  const { id, name, createdAt, state } = v;
  if (typeof id !== 'string' || id === '') return null;
  if (typeof name !== 'string') return null;
  const cleanState = coerceState(state);
  if (cleanState === null) return null;
  return {
    id,
    name,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
    state: cleanState,
  };
}

/**
 * Read the presets stored under `key`. Absent storage, missing value, malformed
 * JSON, a non-array payload, and individually broken entries all degrade to a
 * valid (possibly empty) list — this function never throws.
 */
export function loadPresets(storage: PresetStorage | null, key: string): PresetList {
  if (!storage) return [];
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return []; // access itself can throw in some privacy modes
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: Preset[] = [];
  for (const entry of parsed) {
    const preset = coercePreset(entry);
    if (preset) out.push(preset);
  }
  return out;
}

/**
 * Persist `list` under `key`. Returns whether the write landed: a null storage
 * or a rejecting one (quota, privacy mode) yields `false` so the caller can warn
 * that the preset will not survive a reload — it never throws.
 */
export function savePresets(storage: PresetStorage | null, key: string, list: PresetList): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}
