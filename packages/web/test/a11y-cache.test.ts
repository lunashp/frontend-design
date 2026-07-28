/**
 * The lazy audit memo behind useA11y: keyed by project + id so re-opening a
 * component is instant and never re-audits, and two projects that share an id
 * never cross. Pure Map behaviour, so it is unit-tested with no network or DOM.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  a11yCacheKey,
  clearA11yCache,
  getCachedA11y,
  setCachedA11y,
} from '../src/api/useA11y.js';
import type { A11yResponse } from '../src/api/types.js';

function report(critical: number): A11yResponse {
  return {
    available: true,
    renderability: 'full',
    stubbedContext: false,
    summary: { critical, serious: 0, moderate: 0, minor: 0 },
    total: critical,
    findings: [],
    truncated: false,
    disclosure: 'advisory',
  };
}

const UNAVAILABLE: A11yResponse = {
  available: false,
  reason: 'unavailable',
  disclosure: 'no browser',
};

describe('a11yCacheKey', () => {
  it('is stable for the same project + id', () => {
    expect(a11yCacheKey('/proj', 'a')).toBe(a11yCacheKey('/proj', 'a'));
  });

  it('separates by id and by project', () => {
    expect(a11yCacheKey('/proj', 'a')).not.toBe(a11yCacheKey('/proj', 'b'));
    expect(a11yCacheKey('/proj', 'a')).not.toBe(a11yCacheKey('/other', 'a'));
  });
});

describe('a11y cache get/set', () => {
  beforeEach(() => clearA11yCache());

  it('returns undefined on a miss', () => {
    expect(getCachedA11y(a11yCacheKey('/proj', 'missing'))).toBeUndefined();
  });

  it('round-trips a stored audit so a re-open is instant', () => {
    const key = a11yCacheKey('/proj', 'a');
    const r = report(2);
    setCachedA11y(key, r);
    expect(getCachedA11y(key)).toBe(r);
  });

  it('caches an unavailable response too — a code-only component is not re-fetched on re-open', () => {
    const key = a11yCacheKey('/proj', 'code-only');
    setCachedA11y(key, UNAVAILABLE);
    expect(getCachedA11y(key)).toBe(UNAVAILABLE);
  });

  it('does not confuse two projects that share an id', () => {
    setCachedA11y(a11yCacheKey('/projA', 'shared'), report(1));
    setCachedA11y(a11yCacheKey('/projB', 'shared'), report(9));
    const a = getCachedA11y(a11yCacheKey('/projA', 'shared'));
    const b = getCachedA11y(a11yCacheKey('/projB', 'shared'));
    expect(a?.available && a.summary.critical).toBe(1);
    expect(b?.available && b.summary.critical).toBe(9);
  });

  it('clearA11yCache empties the store', () => {
    const key = a11yCacheKey('/proj', 'a');
    setCachedA11y(key, report(1));
    clearA11yCache();
    expect(getCachedA11y(key)).toBeUndefined();
  });
});
