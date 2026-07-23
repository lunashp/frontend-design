import { describe, it, expect } from 'vitest';
import { applyFilters, DEFAULT_FILTERS, toggle } from '../src/lib/filter.js';
import type { AtomicLevel, ComponentKind, ComponentSummary } from '../src/api/types.js';

function comp(
  name: string,
  atomicLevel: AtomicLevel,
  opts: {
    kind?: ComponentKind;
    ctx?: number;
    path?: string;
    props?: string[];
    hooks?: string[];
    contexts?: string[];
  } = {},
): ComponentSummary {
  return {
    descriptor: { name, filePath: opts.path ?? `/p/${name}.tsx` },
    classification: {
      atomicLevel,
      kind: opts.kind ?? 'presentational',
      contextDependencyScore: opts.ctx ?? 0,
    },
    signals: { hookNames: opts.hooks ?? [], contextConsumers: opts.contexts ?? [] },
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

// The real noise on a scan is not pages by name — it's icons, page-widgets filed
// under views/, and style wrappers, none caught by the atomic-level regex.
describe('applyFilters — designOnly (area-based noise, real-target shapes)', () => {
  const NOISY: ComponentSummary[] = [
    comp('Button', 'atom', { path: '/r/src/components/Button.tsx' }),
    comp('ConfirmDialog', 'molecule', { path: '/r/src/components/dialogs/ConfirmDialog.tsx' }),
    comp('ChevronRight', 'atom', { path: '/r/src/@menu/svg/ChevronRight.tsx' }), // icon
    comp('APIUsageRatio', 'organism', { path: '/r/src/views/pages/dashboard/APIUsageRatio.tsx' }), // page-widget
    comp('AppReactToastify', 'molecule', { path: '/r/src/libs/styles/AppReactToastify.tsx' }), // style wrapper
    comp('AuthGuard', 'molecule', { path: '/r/src/hocs/AuthGuard.tsx' }), // infra
  ];

  it('keeps only the genuine design components, hiding icons/page-widgets/infra', () => {
    const out = applyFilters(NOISY, DEFAULT_FILTERS, '/r');
    expect(names(out).sort()).toEqual(['Button', 'ConfirmDialog']);
  });

  it('brings every one back when designOnly is off', () => {
    const out = applyFilters(NOISY, { ...DEFAULT_FILTERS, designOnly: false }, '/r');
    expect(out).toHaveLength(6);
  });
});

describe('applyFilters — directory facet', () => {
  const SET2: ComponentSummary[] = [
    comp('Button', 'atom', { path: '/r/src/components/Button.tsx' }),
    comp('Dialog', 'molecule', { path: '/r/src/components/dialogs/Dialog.tsx' }),
    comp('Chip', 'atom', { path: '/r/src/@core/Chip.tsx' }),
  ];

  it('scopes to a directory and its descendants', () => {
    const out = applyFilters(SET2, { ...DEFAULT_FILTERS, dir: 'src/components' }, '/r');
    expect(names(out).sort()).toEqual(['Button', 'Dialog']); // Dialog is under components/dialogs
    expect(names(out)).not.toContain('Chip');
  });

  it('an exact directory match includes the file directly in it', () => {
    const out = applyFilters(SET2, { ...DEFAULT_FILTERS, dir: 'src/components/dialogs' }, '/r');
    expect(names(out)).toEqual(['Dialog']);
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
    // `Badge`, not `Icon`: a name ending in "Icon" now reads as the icons area and
    // is hidden by the default designOnly. This test is about prop-less query
    // tolerance, so it uses a plain design component to isolate that.
    expect(names(applyFilters([comp('Badge', 'atom')], { ...DEFAULT_FILTERS, query: 'badge' }))).toEqual(
      ['Badge'],
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

describe('applyFilters — query matches the signals behind the classification', () => {
  const FEED = comp('Feed', 'organism', { hooks: ['useQuery', 'useSession'] });
  const THEMED = comp('Themed', 'atom', { contexts: ['ThemeContext'] });
  const PLAIN = comp('Plain', 'atom');

  it('finds components by a hook they call', () => {
    expect(names(applyFilters([FEED, THEMED, PLAIN], { ...DEFAULT_FILTERS, query: 'useSession' })))
      .toEqual(['Feed']);
  });

  it('finds components by a context they consume, case-insensitively', () => {
    expect(names(applyFilters([FEED, THEMED, PLAIN], { ...DEFAULT_FILTERS, query: 'themecontext' })))
      .toEqual(['Themed']);
  });

  it('still excludes components whose name, path, props and signals all miss', () => {
    expect(applyFilters([FEED, THEMED, PLAIN], { ...DEFAULT_FILTERS, query: 'useRouter' })).toEqual(
      [],
    );
  });
});

describe('toggle', () => {
  it('adds when absent, removes when present', () => {
    expect(toggle(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggle(['a', 'b'], 'a')).toEqual(['b']);
  });
});
