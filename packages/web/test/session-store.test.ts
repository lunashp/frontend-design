import { describe, expect, it } from 'vitest';
import type { CustomizationState } from '../src/lib/customize.js';
import {
  EMPTY_SNAPSHOT,
  decodeSnapshot,
  loadSession,
  pruneBasket,
  saveSession,
  sessionStorageKey,
  type SessionSnapshot,
  type SessionStorageLike,
} from '../src/lib/session-store.js';

/**
 * The basket + live customizations lived only in React state, so a reload after
 * a minutes-long scan threw them away. This proves the localStorage round trip
 * that fixes that, the way it will actually be hit: everything read back is
 * untrusted (corrupt JSON, an older shape, a hand-edited value, a throwing
 * privacy-mode storage), so decode must survive garbage without ever throwing.
 */

/** An in-memory storage, optionally rigged to throw like a privacy-mode one. */
function fakeStorage(opts: { throwOnGet?: boolean; throwOnSet?: boolean } = {}) {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      getItem(key: string): string | null {
        if (opts.throwOnGet) throw new Error('blocked');
        return map.get(key) ?? null;
      },
      setItem(key: string, value: string): void {
        if (opts.throwOnSet) throw new Error('quota');
        map.set(key, value);
      },
    } satisfies SessionStorageLike,
  };
}

const CUST: CustomizationState = {
  tokenOverrides: { 't1': '#fff' },
  propValues: { size: 'lg', disabled: true },
  designOverrides: { width: '200px' },
};

const SNAP: SessionSnapshot = {
  basket: ['a', 'b', 'c'],
  customizations: { a: CUST },
};

describe('sessionStorageKey', () => {
  it('namespaces by project root under a versioned prefix', () => {
    expect(sessionStorageKey('/Users/x/proj')).toBe('ce:session:v1:/Users/x/proj');
  });

  it('separates two projects', () => {
    expect(sessionStorageKey('/a')).not.toBe(sessionStorageKey('/b'));
  });
});

describe('round trip', () => {
  it('saves and loads a snapshot unchanged', () => {
    const { storage } = fakeStorage();
    const key = sessionStorageKey('/p');
    expect(saveSession(storage, key, SNAP)).toBe(true);
    expect(loadSession(storage, key)).toEqual(SNAP);
  });

  it('an unwritten key loads as the empty snapshot', () => {
    const { storage } = fakeStorage();
    expect(loadSession(storage, sessionStorageKey('/never'))).toEqual(EMPTY_SNAPSHOT);
  });

  it('keeps two projects independent', () => {
    const { storage } = fakeStorage();
    saveSession(storage, sessionStorageKey('/a'), { basket: ['x'], customizations: {} });
    saveSession(storage, sessionStorageKey('/b'), { basket: ['y'], customizations: {} });
    expect(loadSession(storage, sessionStorageKey('/a')).basket).toEqual(['x']);
    expect(loadSession(storage, sessionStorageKey('/b')).basket).toEqual(['y']);
  });
});

describe('decodeSnapshot — defensive', () => {
  it('null (nothing stored) → empty', () => {
    expect(decodeSnapshot(null)).toEqual(EMPTY_SNAPSHOT);
  });

  it('malformed JSON → empty, never throws', () => {
    expect(() => decodeSnapshot('{not json')).not.toThrow();
    expect(decodeSnapshot('{not json')).toEqual(EMPTY_SNAPSHOT);
  });

  it('a non-object payload → empty', () => {
    expect(decodeSnapshot('42')).toEqual(EMPTY_SNAPSHOT);
    expect(decodeSnapshot('"str"')).toEqual(EMPTY_SNAPSHOT);
    expect(decodeSnapshot('[1,2]')).toEqual(EMPTY_SNAPSHOT);
  });

  it('keeps only string basket ids', () => {
    const s = decodeSnapshot(JSON.stringify({ basket: ['a', 1, null, 'b', {}], customizations: {} }));
    expect(s.basket).toEqual(['a', 'b']);
  });

  it('drops customization entries that are not objects', () => {
    const s = decodeSnapshot(
      JSON.stringify({ basket: [], customizations: { good: CUST, bad: 5, worse: null } }),
    );
    expect(Object.keys(s.customizations)).toEqual(['good']);
  });

  it('backfills a partial customization state to empty maps', () => {
    const s = decodeSnapshot(JSON.stringify({ basket: [], customizations: { p: { tokenOverrides: { t: '#000' } } } }));
    expect(s.customizations.p).toEqual({
      tokenOverrides: { t: '#000' },
      propValues: {},
      designOverrides: {},
    });
  });

  it('ignores a non-string token override value', () => {
    const s = decodeSnapshot(
      JSON.stringify({ basket: [], customizations: { p: { tokenOverrides: { good: '#000', bad: 7 } } } }),
    );
    expect(s.customizations.p.tokenOverrides).toEqual({ good: '#000' });
  });
});

describe('storage that throws (privacy mode / quota)', () => {
  it('a throwing getItem loads empty rather than crashing', () => {
    const { storage } = fakeStorage({ throwOnGet: true });
    expect(loadSession(storage, sessionStorageKey('/p'))).toEqual(EMPTY_SNAPSHOT);
  });

  it('a throwing setItem reports false rather than crashing', () => {
    const { storage } = fakeStorage({ throwOnSet: true });
    expect(saveSession(storage, sessionStorageKey('/p'), SNAP)).toBe(false);
  });

  it('a null storage loads empty and reports save false', () => {
    expect(loadSession(null, 'k')).toEqual(EMPTY_SNAPSHOT);
    expect(saveSession(null, 'k', SNAP)).toBe(false);
  });
});

describe('pruneBasket', () => {
  it('drops ids the scan no longer contains, preserving order', () => {
    expect(pruneBasket(['a', 'b', 'c'], new Set(['c', 'a']))).toEqual(['a', 'c']);
  });

  it('an empty scan set drops everything', () => {
    expect(pruneBasket(['a', 'b'], new Set())).toEqual([]);
  });

  it('keeps everything when all ids are present', () => {
    expect(pruneBasket(['a', 'b'], new Set(['a', 'b', 'z']))).toEqual(['a', 'b']);
  });
});
