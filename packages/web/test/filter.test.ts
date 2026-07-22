import { describe, it, expect } from 'vitest';
import { applyFilters, DEFAULT_FILTERS, toggle } from '../src/lib/filter.js';
import type { AtomicLevel, ComponentKind, ComponentSummary } from '../src/api/types.js';

function comp(
  name: string,
  atomicLevel: AtomicLevel,
  opts: { kind?: ComponentKind; ctx?: number; path?: string; props?: string[] } = {},
): ComponentSummary {
  return {
    descriptor: { name, filePath: opts.path ?? `/p/${name}.tsx` },
    classification: {
      atomicLevel,
      kind: opts.kind ?? 'presentational',
      contextDependencyScore: opts.ctx ?? 0,
    },
    propModel: { props: (opts.props ?? []).map((p) => ({ name: p })) },
  } as unknown as ComponentSummary;
}

const SET: ComponentSummary[] = [
  comp('Button', 'atom'),
  comp('FilterBar', 'molecule'),
  comp('DataTable', 'organism', { kind: 'container' }),
  comp('SettingsPage', 'page'),
  comp('HomeScreen', 'page'),
];

const names = (list: readonly ComponentSummary[]) => list.map((c) => c.descriptor.name);

describe('applyFilters — designOnly (hide pages)', () => {
  it('hides pages by default', () => {
    const out = applyFilters(SET, DEFAULT_FILTERS);
    expect(names(out)).not.toContain('SettingsPage');
    expect(names(out)).not.toContain('HomeScreen');
    expect(out).toHaveLength(3);
  });

  it('shows pages when designOnly is off', () => {
    const out = applyFilters(SET, { ...DEFAULT_FILTERS, designOnly: false });
    expect(out).toHaveLength(5);
    expect(names(out)).toContain('SettingsPage');
  });
});

describe('applyFilters — other axes', () => {
  it('rank filter includes only selected levels', () => {
    expect(names(applyFilters(SET, { ...DEFAULT_FILTERS, ranks: ['atom'] }))).toEqual(['Button']);
  });

  it('presentationalOnly excludes container/layout kinds', () => {
    const out = applyFilters(SET, { ...DEFAULT_FILTERS, presentationalOnly: true });
    expect(names(out)).not.toContain('DataTable');
  });

  it('query matches name and path, case-insensitively', () => {
    expect(names(applyFilters(SET, { ...DEFAULT_FILTERS, query: 'filter' }))).toEqual(['FilterBar']);
    expect(
      names(applyFilters([comp('Card', 'atom', { path: '/p/ui/widgets/Card.tsx' })], {
        ...DEFAULT_FILTERS,
        query: 'WIDGETS',
      })),
    ).toEqual(['Card']);
  });
});

describe('applyFilters — query matches prop names', () => {
  const SHEET = comp('Sheet', 'organism', { props: ['open', 'onClose', 'children'] });
  const BUTTON = comp('Button', 'atom', { props: ['variant'] });

  it('finds a component by a prop it exposes', () => {
    expect(names(applyFilters([SHEET, BUTTON], { ...DEFAULT_FILTERS, query: 'onClose' }))).toEqual([
      'Sheet',
    ]);
  });

  it('matches prop names case-insensitively and on a substring', () => {
    expect(names(applyFilters([SHEET, BUTTON], { ...DEFAULT_FILTERS, query: 'varia' }))).toEqual([
      'Button',
    ]);
  });

  it('still excludes components whose name, path and props all miss', () => {
    expect(applyFilters([SHEET, BUTTON], { ...DEFAULT_FILTERS, query: 'zzz' })).toEqual([]);
  });

  it('tolerates a component with no props', () => {
    expect(names(applyFilters([comp('Icon', 'atom')], { ...DEFAULT_FILTERS, query: 'icon' }))).toEqual(
      ['Icon'],
    );
  });

  it('sorts by context score, then name', () => {
    const set = [
      comp('B', 'atom', { ctx: 2 }),
      comp('A', 'atom', { ctx: 2 }),
      comp('C', 'atom', { ctx: 0 }),
    ];
    expect(names(applyFilters(set, DEFAULT_FILTERS))).toEqual(['C', 'A', 'B']);
  });
});

describe('toggle', () => {
  it('adds when absent, removes when present', () => {
    expect(toggle(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggle(['a', 'b'], 'a')).toEqual(['b']);
  });
});
