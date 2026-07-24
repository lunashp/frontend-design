import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS, type FilterState } from '../src/lib/filter.js';
import {
  DEFAULT_URL_STATE,
  decodeUrlState,
  encodeUrlState,
  type UrlState,
} from '../src/lib/url-state.js';

/**
 * The gallery view (filters, open component, inspector tab) lived only in React
 * state, so a reload threw it away — after a scan that costs minutes on a real
 * project. These prove the query-string round trip that fixes that, and prove it
 * the way it will actually be used: a URL is hand-editable and outlives the code
 * that wrote it, so decode must survive garbage without throwing and must fall
 * back to the default for anything it does not recognise.
 *
 * The encoding is asserted LITERALLY on purpose. It is a persisted format: if a
 * refactor renames a param or a code, an old URL silently stops restoring, and
 * only a test that spells the string out can catch that.
 */

function filters(patch: Partial<FilterState>): FilterState {
  return { ...DEFAULT_FILTERS, ...patch };
}

function state(patch: Partial<UrlState>): UrlState {
  return { ...DEFAULT_URL_STATE, ...patch };
}

/** Every axis off its default, so nothing can round-trip by accident. */
const FULL: UrlState = {
  filters: {
    query: 'Btn',
    ranks: ['atom', 'organism'],
    kinds: ['layout'],
    roles: ['action', 'feedback'],
    presentationalOnly: true,
    sort: 'mostUsed',
    designOnly: false,
    dir: 'src/ui',
  },
  selectedId: 'abc123',
  tab: 'Customize',
};

describe('encodeUrlState', () => {
  it('encodes the default view as an empty query string', () => {
    expect(encodeUrlState(DEFAULT_URL_STATE)).toBe('');
  });

  it('omits every axis still at its default', () => {
    expect(encodeUrlState(state({ filters: filters({ query: 'card' }) }))).toBe('q=card');
  });

  it('spells the full state out in a short, stable form', () => {
    expect(encodeUrlState(FULL)).toBe('q=Btn&r=ao&k=l&ro=ab&dir=src/ui&s=u&p=1&all=1&c=abc123&t=c');
  });

  it('keeps directory separators readable rather than percent-encoded', () => {
    const encoded = encodeUrlState(state({ filters: filters({ dir: 'src/components/ui' }) }));
    expect(encoded).toBe('dir=src/components/ui');
  });

  it('escapes characters that would otherwise break the query string', () => {
    const encoded = encodeUrlState(state({ filters: filters({ query: 'a b&c=d' }) }));
    expect(encoded).toBe('q=a+b%26c%3Dd');
  });

  it('is deterministic — the same state always produces the same string', () => {
    expect(encodeUrlState(FULL)).toBe(encodeUrlState({ ...FULL }));
  });

  it('drops a selection of null and keeps the default tab silent', () => {
    expect(encodeUrlState(state({ selectedId: null, tab: 'Details' }))).toBe('');
  });
});

describe('decodeUrlState', () => {
  it('returns the defaults for an empty search', () => {
    expect(decodeUrlState('')).toEqual(DEFAULT_URL_STATE);
  });

  it('accepts the search with or without its leading ?', () => {
    expect(decodeUrlState('?q=card')).toEqual(decodeUrlState('q=card'));
  });

  it('ignores params it does not know', () => {
    expect(decodeUrlState('?zzz=1&q=card&utm_source=x')).toEqual(
      state({ filters: filters({ query: 'card' }) }),
    );
  });

  it('ignores unknown codes inside a set, keeping the ones it understands', () => {
    // 'z' is not a rank; 'a' (atom) still has to survive it.
    expect(decodeUrlState('?r=za').filters.ranks).toEqual(['atom']);
  });

  it('drops duplicate codes', () => {
    expect(decodeUrlState('?k=ppl').filters.kinds).toEqual(['presentational', 'layout']);
  });

  it('falls back to the default sort for a value it does not recognise', () => {
    expect(decodeUrlState('?s=nonsense').filters.sort).toBe(DEFAULT_FILTERS.sort);
  });

  it('falls back to the default tab for a value it does not recognise', () => {
    expect(decodeUrlState('?t=nonsense').tab).toBe(DEFAULT_URL_STATE.tab);
  });

  it('treats any flag value other than 1 as unset', () => {
    expect(decodeUrlState('?p=true&all=yes').filters.presentationalOnly).toBe(false);
    expect(decodeUrlState('?p=true&all=yes').filters.designOnly).toBe(true);
  });

  it('reads the flags when they are exactly 1', () => {
    expect(decodeUrlState('?p=1&all=1').filters.presentationalOnly).toBe(true);
    expect(decodeUrlState('?p=1&all=1').filters.designOnly).toBe(false);
  });

  it('treats an empty dir or selection as absent, not as an empty string', () => {
    const decoded = decodeUrlState('?dir=&c=');
    expect(decoded.filters.dir).toBeNull();
    expect(decoded.selectedId).toBeNull();
  });

  it('never throws on malformed input', () => {
    for (const search of ['?%%%', '?=', '?&&&', '?r', '?q=%E0%A4%A', '???']) {
      expect(() => decodeUrlState(search)).not.toThrow();
    }
  });
});

describe('round trip', () => {
  const cases: readonly UrlState[] = [
    DEFAULT_URL_STATE,
    FULL,
    state({ filters: filters({ query: 'a b&c=d' }) }),
    state({ filters: filters({ dir: 'packages/web/src/features' }) }),
    state({ filters: filters({ ranks: ['page', 'molecule'] }) }),
    state({ filters: filters({ roles: ['other'] }) }),
    state({ selectedId: 'c-7f3a', tab: 'Preview' }),
    state({ tab: 'Portable' }),
    state({ tab: 'Variants' }),
  ];

  for (const [index, original] of cases.entries()) {
    it(`survives encode → decode (case ${index})`, () => {
      expect(decodeUrlState(encodeUrlState(original))).toEqual(original);
    });
  }

  it('preserves the order the user picked chips in', () => {
    const original = state({ filters: filters({ ranks: ['organism', 'atom'] }) });
    expect(decodeUrlState(encodeUrlState(original)).filters.ranks).toEqual(['organism', 'atom']);
  });
});
