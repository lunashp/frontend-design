import { describe, it, expect } from 'vitest';
import {
  addPreset,
  createPreset,
  deletePreset,
  findPreset,
  loadPresets,
  presetStorageKey,
  renamePreset,
  savePresets,
  type Preset,
  type PresetList,
  type PresetStorage,
} from '../src/lib/presets.js';
import { EMPTY_CUSTOMIZATION, type CustomizationState } from '../src/lib/customize.js';

/** A minimal in-memory Storage stand-in, so the pure store needs no `window`. */
function fakeStorage(initial: Record<string, string> = {}): PresetStorage & {
  store: Record<string, string>;
} {
  const store: Record<string, string> = { ...initial };
  return {
    store,
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = v;
    },
  };
}

const state = (over: Partial<CustomizationState> = {}): CustomizationState => ({
  ...EMPTY_CUSTOMIZATION,
  ...over,
});

const preset = (id: string, name: string, s: CustomizationState = EMPTY_CUSTOMIZATION): Preset =>
  createPreset(name, s, 1000, id);

describe('presetStorageKey', () => {
  it('namespaces by project and component so two components never collide', () => {
    const a = presetStorageKey('/proj', 'compA');
    const b = presetStorageKey('/proj', 'compB');
    const c = presetStorageKey('/other', 'compA');
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).toContain('compA');
  });
});

describe('createPreset', () => {
  it('trims the name and carries the state, id and clock verbatim', () => {
    const p = createPreset('  Brand  ', state({ tokenOverrides: { t1: '#f00' } }), 42, 'id1');
    expect(p.name).toBe('Brand');
    expect(p.id).toBe('id1');
    expect(p.createdAt).toBe(42);
    expect(p.state.tokenOverrides).toEqual({ t1: '#f00' });
  });
});

describe('addPreset (save)', () => {
  it('appends a new preset without mutating the input list', () => {
    const before: PresetList = [preset('a', 'A')];
    const after = addPreset(before, preset('b', 'B'));
    expect(after.map((p) => p.id)).toEqual(['a', 'b']);
    expect(before).toHaveLength(1);
    expect(after).not.toBe(before);
  });

  it('upserts by case-insensitive name, keeping the slot but taking the new value', () => {
    const before: PresetList = [
      preset('a', 'Brand', state({ tokenOverrides: { t1: '#000' } })),
      preset('b', 'Other'),
    ];
    const after = addPreset(before, preset('c', 'brand', state({ tokenOverrides: { t1: '#fff' } })));
    expect(after).toHaveLength(2);
    expect(after[0]?.name).toBe('brand');
    expect(after[0]?.id).toBe('c');
    expect(after[0]?.state.tokenOverrides).toEqual({ t1: '#fff' });
    expect(after[1]?.id).toBe('b');
  });
});

describe('renamePreset', () => {
  it('renames the matching preset, trimmed, and leaves the rest untouched', () => {
    const before: PresetList = [preset('a', 'A'), preset('b', 'B')];
    const after = renamePreset(before, 'b', '  Beta ');
    expect(after.find((p) => p.id === 'b')?.name).toBe('Beta');
    expect(after.find((p) => p.id === 'a')?.name).toBe('A');
    expect(before.find((p) => p.id === 'b')?.name).toBe('B');
  });

  it('is a no-op for an unknown id and never throws', () => {
    const before: PresetList = [preset('a', 'A')];
    const after = renamePreset(before, 'zzz', 'X');
    expect(after.map((p) => p.name)).toEqual(['A']);
  });
});

describe('deletePreset', () => {
  it('drops the matching preset immutably', () => {
    const before: PresetList = [preset('a', 'A'), preset('b', 'B')];
    const after = deletePreset(before, 'a');
    expect(after.map((p) => p.id)).toEqual(['b']);
    expect(before).toHaveLength(2);
  });

  it('leaves the list unchanged for an unknown id', () => {
    const before: PresetList = [preset('a', 'A')];
    expect(deletePreset(before, 'nope').map((p) => p.id)).toEqual(['a']);
  });
});

describe('findPreset (switch/apply target)', () => {
  it('returns the preset by id, or undefined', () => {
    const list: PresetList = [preset('a', 'A'), preset('b', 'B')];
    expect(findPreset(list, 'b')?.name).toBe('B');
    expect(findPreset(list, 'zzz')).toBeUndefined();
  });
});

describe('save/load round-trip through injected storage', () => {
  it('persists a list and reads back an equal one', () => {
    const key = presetStorageKey('/p', 'c');
    const storage = fakeStorage();
    const list: PresetList = [
      preset('a', 'A', state({ tokenOverrides: { t1: '#f00' }, designOverrides: { radius: '8' } })),
      preset('b', 'B', state({ propValues: { open: true } })),
    ];
    expect(savePresets(storage, key, list)).toBe(true);
    expect(loadPresets(storage, key)).toEqual(list);
  });

  it('returns an empty list when nothing was ever saved', () => {
    expect(loadPresets(fakeStorage(), presetStorageKey('/p', 'c'))).toEqual([]);
  });
});

describe('defensive load (never throws on corrupt or absent data)', () => {
  const key = presetStorageKey('/p', 'c');

  it('returns [] on malformed JSON', () => {
    expect(loadPresets(fakeStorage({ [key]: '{not json' }), key)).toEqual([]);
  });

  it('returns [] when the stored value is not an array', () => {
    expect(loadPresets(fakeStorage({ [key]: '{"nope":1}' }), key)).toEqual([]);
  });

  it('drops entries whose shape is invalid rather than failing the whole read', () => {
    const good = preset('a', 'A', state({ tokenOverrides: { t1: '#f00' } }));
    const raw = JSON.stringify([
      good,
      { id: 'b' }, // missing name/state
      { name: 'c', state: {} }, // missing id
      null,
      42,
    ]);
    const loaded = loadPresets(fakeStorage({ [key]: raw }), key);
    expect(loaded.map((p) => p.id)).toEqual(['a']);
  });

  it('coerces a state missing its maps into a valid empty-map state', () => {
    const raw = JSON.stringify([
      { id: 'a', name: 'A', createdAt: 1, state: { tokenOverrides: { t1: '#f00' } } },
    ]);
    const loaded = loadPresets(fakeStorage({ [key]: raw }), key);
    expect(loaded[0]?.state).toEqual({
      tokenOverrides: { t1: '#f00' },
      propValues: {},
      designOverrides: {},
    });
  });

  it('treats a null storage as absent (SSR / privacy mode) without throwing', () => {
    expect(loadPresets(null, key)).toEqual([]);
  });
});

describe('defensive save (a failing write is reported, never thrown)', () => {
  it('returns false when the storage rejects the write (quota / privacy)', () => {
    const throwing: PresetStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(savePresets(throwing, presetStorageKey('/p', 'c'), [preset('a', 'A')])).toBe(false);
  });

  it('returns false for a null storage rather than throwing', () => {
    expect(savePresets(null, presetStorageKey('/p', 'c'), [])).toBe(false);
  });
});
