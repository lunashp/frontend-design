/**
 * React glue over the pure preset store (`lib/presets.ts`).
 *
 * The store stays a plain data module; this hook holds the list in state, keeps
 * it aligned with the (project, component) key, and writes every change through
 * to `localStorage`. The browser access is isolated here — the store never
 * touches `window`, so it remains testable without a DOM.
 */

import { useCallback, useEffect, useState } from 'react';
import type { CustomizationState } from '../../lib/customize.js';
import {
  addPreset,
  createPreset,
  deletePreset,
  loadPresets,
  presetStorageKey,
  renamePreset,
  savePresets,
  type PresetList,
  type PresetStorage,
} from '../../lib/presets.js';

/**
 * `window.localStorage`, or null when it is unreachable (privacy mode can throw
 * on the very property access). Returning null lets the pure store degrade to
 * "no persistence" without a try/catch at every call site.
 */
function getLocalStorage(): PresetStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** A collision-resistant id, falling back when `crypto.randomUUID` is absent. */
function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface PresetsController {
  readonly presets: PresetList;
  /** True when the last write reached storage; false warns it will not persist. */
  readonly persisted: boolean;
  /** Save the given snapshot under `name` (upsert by name). */
  readonly save: (name: string, state: CustomizationState) => void;
  readonly rename: (id: string, name: string) => void;
  readonly remove: (id: string) => void;
}

export function usePresets(projectRoot: string, componentId: string): PresetsController {
  const key = presetStorageKey(projectRoot, componentId);
  const [presets, setPresets] = useState<PresetList>(() => loadPresets(getLocalStorage(), key));
  const [persisted, setPersisted] = useState(true);

  // Re-read when the component (or project) changes: the pane is keyed by
  // component id, so this reloads the right list on every selection.
  useEffect(() => {
    setPresets(loadPresets(getLocalStorage(), key));
    setPersisted(true);
  }, [key]);

  const commit = useCallback(
    (next: PresetList) => {
      setPresets(next);
      setPersisted(savePresets(getLocalStorage(), key, next));
    },
    [key],
  );

  const save = useCallback(
    (name: string, state: CustomizationState) =>
      commit(addPreset(presets, createPreset(name, state, Date.now(), newId()))),
    [commit, presets],
  );
  const rename = useCallback(
    (id: string, name: string) => commit(renamePreset(presets, id, name)),
    [commit, presets],
  );
  const remove = useCallback((id: string) => commit(deletePreset(presets, id)), [commit, presets]);

  return { presets, persisted, save, rename, remove };
}
