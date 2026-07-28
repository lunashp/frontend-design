import { describe, it, expect } from 'vitest';
import {
  formatMiningSummary,
  groupTokensByCategory,
  partitionTokensBySource,
} from '../src/features/customize/token-sources.js';
import type { ThemeMiningDisclosure, Token } from '../src/api/types.js';

function token(id: string, source: Token['source'], over: Partial<Token> = {}): Token {
  return {
    id,
    name: `--${id}`,
    displayName: id,
    category: 'color',
    value: '#000000',
    fallback: '#000000',
    usages: [],
    source,
    ...over,
  };
}

describe('partitionTokensBySource (derived reference vs re-themeable)', () => {
  it('splits derived from extracted/user, preserving order within each side', () => {
    const tokens = [
      token('x', 'extracted'),
      token('d1', 'derived'),
      token('u', 'user'),
      token('d2', 'derived'),
    ];
    const { editable, derived } = partitionTokensBySource(tokens);
    expect(editable.map((t) => t.id)).toEqual(['x', 'u']);
    expect(derived.map((t) => t.id)).toEqual(['d1', 'd2']);
  });

  it('returns two empty lists for no tokens', () => {
    expect(partitionTokensBySource([])).toEqual({ editable: [], derived: [] });
  });

  it('never counts a derived token as editable (it would be a dead live-edit slider)', () => {
    const { editable, derived } = partitionTokensBySource([token('d', 'derived')]);
    expect(editable).toEqual([]);
    expect(derived).toHaveLength(1);
  });
});

describe('groupTokensByCategory (Foundations display order)', () => {
  it('groups by category and drops empty groups, colour first', () => {
    const groups = groupTokensByCategory([
      token('c', 'derived', { category: 'color' }),
      token('r', 'derived', { category: 'radius' }),
      token('c2', 'derived', { category: 'color' }),
    ]);
    expect(groups.map(([cat]) => cat)).toEqual(['color', 'radius']);
    expect(groups[0]?.[1].map((t) => t.id)).toEqual(['c', 'c2']);
  });

  it('is empty for no tokens', () => {
    expect(groupTokensByCategory([])).toEqual([]);
  });
});

describe('formatMiningSummary (the honest disclosure line)', () => {
  const disclosure = (resolved: number, unresolved: number): ThemeMiningDisclosure => ({
    file: '/src/theme.ts',
    exportName: 'theme',
    resolved,
    unresolved,
    unresolvedPaths: [],
  });

  it('reads "mined N, M unresolved" when some values could not be resolved', () => {
    const s = formatMiningSummary(disclosure(15, 2));
    expect(s).toMatch(/15/);
    expect(s).toMatch(/2/);
    expect(s).toMatch(/unresolved/i);
  });

  it('omits the unresolved clause when everything resolved', () => {
    const s = formatMiningSummary(disclosure(15, 0));
    expect(s).toMatch(/15/);
    expect(s).not.toMatch(/unresolved/i);
  });

  it('uses a singular count for exactly one value', () => {
    expect(formatMiningSummary(disclosure(1, 1))).toMatch(/1 value\b/);
  });
});
