import { describe, it, expect } from 'vitest';
import {
  ComponentNotFoundError,
  type ClassificationSignals,
  type ComponentArtifact,
  type ComponentSummary,
  type HeuristicWarning,
  type PortableKit,
  type PropControl,
  type ScanResult,
} from '@ce/core';
import {
  DEFAULT_LIST_LIMIT,
  DESIGN_FIELD_IDS,
  MAX_KIT_FILE_BYTES,
  MAX_TOKEN_USAGES,
  budgetKitFiles,
  filterComponents,
  paginate,
  projectComponent,
  ROOT_CLASS_PLACEHOLDER,
  toComponentList,
  toComponentRows,
  toCustomized,
  toPortableCode,
  toPortableKit,
  toScanSummary,
  toToolError,
  toUsageSnippet,
} from '../src/tools.js';

const SIGNALS: ClassificationSignals = {
  childComponentCount: 0,
  jsxDepth: 1,
  hookNames: [],
  usesRouter: false,
  usesStore: false,
  usesDataFetching: false,
  contextConsumers: [],
  isClientComponent: true,
  propCount: 0,
};

interface CompOpts {
  id?: string;
  score?: number;
  propCount?: number;
  filePath?: string;
  propNames?: string[];
  usedByCount?: number;
}

function props(opts: CompOpts): PropControl[] {
  const names = opts.propNames ?? Array.from({ length: opts.propCount ?? 0 }, (_, i) => `p${i}`);
  return names.map((name) => ({ name, tsType: 'string', kind: 'string' as const, required: false }));
}

function comp(
  name: string,
  atomicLevel: ComponentSummary['classification']['atomicLevel'],
  kind: ComponentSummary['classification']['kind'],
  opts: CompOpts = {},
): ComponentSummary {
  const filePath = opts.filePath ?? `/p/${name}.tsx`;
  return {
    descriptor: {
      id: opts.id ?? name.toLowerCase(),
      name,
      filePath,
      exportName: name,
      isDefaultExport: false,
      loc: { file: filePath, line: 1, column: 1 },
    },
    classification: {
      atomicLevel,
      kind,
      contextDependencyScore: opts.score ?? 0,
      confidence: 1,
    },
    signals: SIGNALS,
    propModel: { props: props(opts) },
    usage:
      opts.usedByCount === undefined
        ? undefined
        : { usedByCount: opts.usedByCount, usedByFiles: [] },
  };
}

const COMPONENTS: ComponentSummary[] = [
  comp('Button', 'atom', 'presentational', {
    filePath: '/p/src/ui/Button.tsx',
    propNames: ['label', 'onClick'],
    usedByCount: 12,
  }),
  comp('Card', 'molecule', 'presentational', { filePath: '/p/src/ui/Card.tsx', usedByCount: 3 }),
  comp('UserPanel', 'organism', 'container', { score: 5, filePath: '/p/src/app/UserPanel.tsx' }),
  comp('Dashboard', 'page', 'container', { score: 9, filePath: '/p/src/app/Dashboard.tsx' }),
];

const SCAN: ScanResult = {
  artifactVersion: 2,
  projectRoot: '/p',
  framework: 'react',
  components: COMPONENTS,
  failures: [{ componentId: '/p/X.tsx#X', name: 'X', filePath: '/p/X.tsx', message: 'boom' }],
  warnings: ['skipped X'],
  heuristicWarnings: [],
};

const COLLAPSED: HeuristicWarning = {
  signal: 'usesStore',
  dependency: 'zustand',
  scanned: 1133,
  message:
    'Heuristic check: this project depends on "zustand", but store usage was detected in 0 of ' +
    '1133 components. Either no component uses it, or the usesStore heuristic no longer matches ' +
    "this project's naming conventions.",
};

/** `n` distinct analysis failures, with the prose restatement the engine logs. */
function failureFlood(n: number): Pick<ScanResult, 'failures' | 'warnings'> {
  const failures = Array.from({ length: n }, (_, i) => ({
    componentId: `/p/C${i}.tsx#C${i}`,
    name: `C${i}`,
    filePath: `/p/C${i}.tsx`,
    message: 'checker exploded',
  }));
  return { failures, warnings: failures.map((f) => `Failed to analyze ${f.name}: ${f.message}`) };
}

function artifact(overrides: Partial<ComponentArtifact> = {}): ComponentArtifact {
  return {
    artifactVersion: 2,
    descriptor: {
      id: 'btn',
      name: 'Button',
      filePath: '/p/Button.tsx',
      exportName: 'Button',
      isDefaultExport: false,
      loc: { file: '/p/Button.tsx', line: 1, column: 1 },
    },
    classification: { atomicLevel: 'atom', kind: 'presentational', contextDependencyScore: 0, confidence: 1 },
    signals: SIGNALS,
    propModel: {
      props: [
        { name: 'label', tsType: 'string', kind: 'string', required: true },
        { name: 'children', tsType: 'React.ReactNode', kind: 'node', required: false },
        { name: 'onClick', tsType: '() => void', kind: 'unknown', required: true },
      ],
    },
    bundle: {
      files: { '/Button.tsx': 'export const Button = () => null;', '/tokens.css': ':root{}' },
      entryPath: '/Button.tsx',
      externalDeps: { clsx: '^2.1.1' },
      assets: [],
      warnings: ['left <DataTable> external'],
      stubbedModules: [
        { specifier: 'next/link', replacedWith: '/__stubs/next-link.tsx', lost: 'client-side prefetch' },
      ],
      danglingImports: ['/Button.tsx → ./missing'],
      incomplete: false,
      previewTheme: { path: '/src/theme.ts', exportName: 'theme' },
      previewMessages: '/src/messages.json',
      previewProviders: [{ path: '/src/ChatProvider.tsx', exportName: 'ChatProvider' }],
    },
    tokenModel: {
      tokens: [
        {
          id: 't1',
          name: '--color-1',
          displayName: 'Color 1',
          category: 'color',
          value: '#3b82f6',
          fallback: '#3b82f6',
          usages: [],
          source: 'extracted',
        },
      ],
    },
    sandpack: {
      files: {
        '/index.tsx': 'const props = {};\nconst root = createRoot(el);',
        '/tokens.css': ':root {\n  --color-1: #3b82f6;\n}\n',
      },
      entryPath: '/index.tsx',
      template: 'react-ts',
      renderability: 'stubbed',
      dependencies: {},
      notes: ['stubbed next/link'],
    },
    ...overrides,
  };
}

describe('toScanSummary', () => {
  it('tallies counts by atomic level and kind', () => {
    const s = toScanSummary(SCAN);
    expect(s.componentCount).toBe(4);
    expect(s.counts.byAtomicLevel).toEqual({ atom: 1, molecule: 1, organism: 1, page: 1 });
    expect(s.counts.byKind).toEqual({ presentational: 2, container: 2, layout: 0 });
    expect(s.framework).toBe('react');
    expect(s.warnings).toEqual(['skipped X']);
  });

  it('reports structured failures alongside the prose warnings', () => {
    const s = toScanSummary(SCAN);
    expect(s.failureCount).toBe(1);
    expect(s.failures[0]).toMatchObject({ name: 'X', filePath: '/p/X.tsx', message: 'boom' });
    expect(s.failuresTruncated).toBe(false);
  });

  it('caps long note lists and flags the cut', () => {
    const many = Array.from({ length: 40 }, (_, i) => `w${i}`);
    const s = toScanSummary({ ...SCAN, warnings: many });
    expect(s.warningCount).toBe(40);
    expect(s.warnings).toHaveLength(20);
    expect(s.warningsTruncated).toBe(true);
  });

  it('carries the heuristic diagnostic past the cap that used to eat it', () => {
    // The measured defect: 25 per-failure warnings + 1 scan-level finding
    // appended LAST meant 26 warnings, 20 on the wire, and the one finding worth
    // reading gone — on exactly the large targets whose scale makes it diagnostic.
    const s = toScanSummary({ ...SCAN, ...failureFlood(25), heuristicWarnings: [COLLAPSED] });

    expect(s.warningsTruncated).toBe(true);
    expect(s.heuristicWarnings).toEqual([COLLAPSED]);
  });

  it('never truncates the heuristic list — it is bounded by detectors, not project size', () => {
    // Three graded signals is the ceiling regardless of how big the target is,
    // so capping it could only ever drop signal for no budget saving.
    const all: HeuristicWarning[] = [
      COLLAPSED,
      { ...COLLAPSED, signal: 'usesRouter', dependency: 'react-router-dom' },
      { ...COLLAPSED, signal: 'usesDataFetching', dependency: 'swr' },
    ];
    const s = toScanSummary({ ...SCAN, ...failureFlood(40), heuristicWarnings: all });

    expect(s.heuristicWarnings).toHaveLength(3);
    expect(s.heuristicWarnings.map((h) => h.signal)).toEqual([
      'usesStore',
      'usesRouter',
      'usesDataFetching',
    ]);
  });

  it('reports zero findings as an empty list, not as a missing field', () => {
    // An agent must be able to read the field unconditionally; `undefined` would
    // be indistinguishable from an older server that never checked.
    expect(toScanSummary(SCAN).heuristicWarnings).toEqual([]);
  });
});

describe('filterComponents', () => {
  it('filters by atomic level', () => {
    expect(filterComponents(COMPONENTS, { atomicLevel: 'atom' }).map((c) => c.descriptor.name)).toEqual([
      'Button',
    ]);
  });
  it('filters by kind', () => {
    expect(filterComponents(COMPONENTS, { kind: 'container' })).toHaveLength(2);
  });
  it('filters by case-insensitive name substring', () => {
    expect(filterComponents(COMPONENTS, { nameIncludes: 'card' }).map((c) => c.descriptor.name)).toEqual([
      'Card',
    ]);
  });
  it('filters by file path substring', () => {
    expect(filterComponents(COMPONENTS, { pathIncludes: 'src/ui' }).map((c) => c.descriptor.name)).toEqual([
      'Button',
      'Card',
    ]);
  });
  it('combines name and path so "buttons under src/ui" is expressible', () => {
    expect(
      filterComponents(COMPONENTS, { nameIncludes: 'button', pathIncludes: 'src/ui' }),
    ).toHaveLength(1);
    expect(filterComponents(COMPONENTS, { nameIncludes: 'button', pathIncludes: 'src/app' })).toEqual([]);
  });
  it('filters by prop name substring', () => {
    expect(filterComponents(COMPONENTS, { propIncludes: 'onclick' }).map((c) => c.descriptor.name)).toEqual(
      ['Button'],
    );
  });
  it('filters by max context-dependency score', () => {
    expect(filterComponents(COMPONENTS, { maxContextDependencyScore: 5 })).toHaveLength(3);
  });
  it('combines filters (AND)', () => {
    expect(filterComponents(COMPONENTS, { kind: 'container', maxContextDependencyScore: 5 })).toHaveLength(1);
  });
});

describe('paginate', () => {
  const items = Array.from({ length: 10 }, (_, i) => i);

  it('applies a default limit and flags the truncation', () => {
    const big = Array.from({ length: DEFAULT_LIST_LIMIT + 5 }, (_, i) => i);
    const p = paginate(big);
    expect(p.returned).toBe(DEFAULT_LIST_LIMIT);
    expect(p.total).toBe(DEFAULT_LIST_LIMIT + 5);
    expect(p.truncated).toBe(true);
    expect(p.nextOffset).toBe(DEFAULT_LIST_LIMIT);
  });

  it('pages past the head with offset', () => {
    const p = paginate(items, { offset: 4, limit: 3 });
    expect(p.items).toEqual([4, 5, 6]);
    expect(p.offset).toBe(4);
    expect(p.nextOffset).toBe(7);
    expect(p.truncated).toBe(true);
  });

  it('omits nextOffset on the last page and reports no truncation from offset 0', () => {
    const p = paginate(items, { limit: 20 });
    expect(p.returned).toBe(10);
    expect(p.nextOffset).toBeUndefined();
    expect(p.truncated).toBe(false);
  });

  it('clamps a negative or out-of-range offset', () => {
    expect(paginate(items, { offset: -5, limit: 2 }).items).toEqual([0, 1]);
    expect(paginate(items, { offset: 99, limit: 2 }).returned).toBe(0);
  });
});

describe('toComponentRows / projectComponent', () => {
  it('emits compact rows with the id, path and prop names', () => {
    const rows = toComponentRows([COMPONENTS[0] as ComponentSummary]);
    expect(rows[0]).toMatchObject({
      id: 'button',
      name: 'Button',
      exportName: 'Button',
      filePath: '/p/src/ui/Button.tsx',
      atomicLevel: 'atom',
      kind: 'presentational',
      propCount: 2,
      propNames: ['label', 'onClick'],
    });
  });

  it('rejects an unknown view at the boundary', () => {
    expect(() =>
      projectComponent(COMPONENTS[0] as ComponentSummary, 'full' as 'compact'),
    ).toThrow(/Unknown component view/);
  });

  it('carries the reverse-import reuse signal, defaulting to 0 when a summary has no usage', () => {
    const [button] = toComponentRows([COMPONENTS[0] as ComponentSummary]);
    expect(button?.usedByCount).toBe(12);
    expect(Array.isArray(button?.usedByFiles)).toBe(true);
    // UserPanel was built without usage — the row reports 0, not undefined.
    const [panel] = toComponentRows([COMPONENTS[2] as ComponentSummary]);
    expect(panel?.usedByCount).toBe(0);
  });
});

describe('toComponentList', () => {
  it('reports the filtered total, the window, and the next offset', () => {
    const list = toComponentList(COMPONENTS, { kind: 'container' }, { limit: 1 });
    expect(list.scanned).toBe(4);
    expect(list.total).toBe(2);
    expect(list.returned).toBe(1);
    expect(list.nextOffset).toBe(1);
    expect(list.truncated).toBe(true);
    expect(list.components).toHaveLength(1);
  });

  it('keeps discovery order by default but ranks by usage when order="mostUsed"', () => {
    const names = (order: 'default' | 'mostUsed') =>
      toComponentList(COMPONENTS, {}, {}, order).components.map((c) => c.name);
    // Default: whatever order the components came in (discovery / name-sorted upstream).
    expect(names('default')).toEqual(['Button', 'Card', 'UserPanel', 'Dashboard']);
    // mostUsed: Button (12) and Card (3) lead; the usage-less rows (0) fall to the
    // context-score/name tie-break behind them.
    expect(names('mostUsed').slice(0, 2)).toEqual(['Button', 'Card']);
  });
});

describe('toUsageSnippet', () => {
  it('emits a named import and a JSX call site with the sample props', () => {
    const a = artifact();
    const snippet = toUsageSnippet(a.descriptor, a.bundle.entryPath, a.propModel, {
      label: 'Label',
      children: 'Button',
    });
    expect(snippet).toContain("import { Button } from './Button';");
    expect(snippet).toContain('label="Label"');
    // A required function prop JSON cannot carry still gets a call site.
    expect(snippet).toContain('onClick={() => {}}');
    expect(snippet).toContain('>\n  Button\n</Button>');
  });

  it('emits a default import and a self-closing tag when there are no props', () => {
    const a = artifact();
    const descriptor = { ...a.descriptor, isDefaultExport: true, exportName: 'default' };
    const snippet = toUsageSnippet(descriptor, '/Button.tsx', { props: [] }, {});
    expect(snippet).toContain("import Button from './Button';");
    expect(snippet).toContain('<Button />');
  });
});

describe('toPortableCode', () => {
  it('shapes the portable bundle with tokens and deps', () => {
    const p = toPortableCode(artifact());
    expect(p.entryPath).toBe('/Button.tsx');
    expect(Object.keys(p.files)).toContain('/tokens.css');
    expect(p.externalDeps).toEqual({ clsx: '^2.1.1' });
    expect(p.tokens).toEqual([
      {
        id: 't1',
        name: '--color-1',
        value: '#3b82f6',
        category: 'color',
        source: 'extracted',
        usageCount: 0,
        usages: [],
        usagesTruncated: false,
      },
    ]);
    expect(p.incomplete).toBe(false);
  });

  it("carries the engine's renderability verdict and its notes", () => {
    const p = toPortableCode(artifact());
    expect(p.renderability).toBe('stubbed');
    expect(p.renderNotes).toEqual(['stubbed next/link']);
  });

  it('discloses stubbed modules and dangling imports', () => {
    const p = toPortableCode(artifact());
    expect(p.stubbedModules).toEqual([
      { specifier: 'next/link', replacedWith: '/__stubs/next-link.tsx', lost: 'client-side prefetch' },
    ]);
    expect(p.danglingImports).toEqual(['/Button.tsx → ./missing']);
  });

  it("marks the SOURCE app's theme, messages and providers as not-the-component", () => {
    const p = toPortableCode(artifact());
    expect(p.sourceAppFiles).toEqual(['/src/theme.ts', '/src/messages.json', '/src/ChatProvider.tsx']);
    expect(p.previewTheme).toEqual({ path: '/src/theme.ts', exportName: 'theme' });
    expect(p.previewMessages).toBe('/src/messages.json');
    expect(p.previewProviders).toHaveLength(1);
  });

  it('exposes the prop contract, sample props and a usage snippet', () => {
    const p = toPortableCode(artifact());
    expect(p.props.map((x) => x.name)).toEqual(['label', 'children', 'onClick']);
    expect(p.props[0]).toMatchObject({ name: 'label', tsType: 'string', required: true });
    expect(p.sampleProps).toMatchObject({ label: 'Label', children: 'Button' });
    expect(p.usage).toContain("import { Button } from './Button';");
  });
});

describe('toPortableCode token rows (#4)', () => {
  it('carries usages + source and pre-sorts tokens by usage count desc', () => {
    // A bare {name,value,category} row hid which tokens are load-bearing: an
    // agent could not see where a token is used or rank it by that. The rows now
    // carry `source` + `usages` and arrive sorted by usage count, most-used first.
    const a = artifact({
      tokenModel: {
        tokens: [
          {
            id: 't1',
            name: '--a',
            displayName: 'A',
            category: 'color',
            value: '#000',
            fallback: '#000',
            source: 'extracted',
            usages: [{ file: '/Button.tsx', line: 3, property: 'color', selector: '.a' }],
          },
          {
            id: 't2',
            name: '--b',
            displayName: 'B',
            category: 'spacing',
            value: '8px',
            fallback: '8px',
            source: 'derived',
            usages: [
              { file: '/Button.tsx', line: 5, property: 'padding', selector: '.b' },
              { file: '/Button.tsx', line: 9, property: 'margin', selector: '.b2' },
            ],
          },
        ],
      },
    });
    const p = toPortableCode(a);
    expect(p.tokens.map((t) => t.id)).toEqual(['t2', 't1']);
    expect(p.tokens[0]).toMatchObject({ id: 't2', source: 'derived', usageCount: 2 });
    expect(p.tokens[0]?.usages).toEqual([
      { file: '/Button.tsx', line: 5, property: 'padding', selector: '.b' },
      { file: '/Button.tsx', line: 9, property: 'margin', selector: '.b2' },
    ]);
    expect(p.tokens[0]?.usagesTruncated).toBe(false);
  });

  it('caps usages per token and discloses the cut', () => {
    const many = Array.from({ length: MAX_TOKEN_USAGES + 5 }, (_, i) => ({
      file: '/Button.tsx',
      line: i,
      property: 'color',
      selector: `.s${i}`,
    }));
    const a = artifact({
      tokenModel: {
        tokens: [
          {
            id: 't1',
            name: '--a',
            displayName: 'A',
            category: 'color',
            value: '#000',
            fallback: '#000',
            source: 'extracted',
            usages: many,
          },
        ],
      },
    });
    const p = toPortableCode(a);
    // usageCount is the true total (the sort key); the array is capped and the
    // cut is disclosed rather than silently dropped.
    expect(p.tokens[0]?.usageCount).toBe(MAX_TOKEN_USAGES + 5);
    expect(p.tokens[0]?.usages).toHaveLength(MAX_TOKEN_USAGES);
    expect(p.tokens[0]?.usagesTruncated).toBe(true);
  });
});

describe('toCustomized', () => {
  it('applies token overrides by id and reports unknown ids', () => {
    const c = toCustomized(artifact(), {
      tokenOverrides: { t1: '#e11d48', ghost: '#000' },
      propValues: {},
      designOverrides: {},
    });
    expect(c.tokensCss).toContain('--color-1: #e11d48;');
    expect(c.appliedTokenOverrides).toEqual({ t1: '#e11d48' });
    expect(c.unknownTokenIds).toEqual(['ghost']);
  });

  it('returns the PORTABLE files with the re-themed stylesheet, never the preview harness', () => {
    const c = toCustomized(artifact(), { tokenOverrides: {}, propValues: {}, designOverrides: {} });
    expect(Object.keys(c.files).sort()).toEqual(['/Button.tsx', '/tokens.css']);
    expect(c.files['/tokens.css']).toBe(c.tokensCss);
    // The harness markers from sandpack.files must not leak into the payload.
    expect(JSON.stringify(c.files)).not.toContain('createRoot');
  });

  it('emits declarations plus a placeholder-selector rule, not a `.Name` rule that matches nothing', () => {
    const c = toCustomized(artifact(), {
      tokenOverrides: {},
      propValues: {},
      designOverrides: { background: '#111', radius: '10' },
    });
    expect(c.designDeclarations).toEqual(['background: #111', 'border-radius: 10px']);
    expect(c.designCss).toContain(`${ROOT_CLASS_PLACEHOLDER} {`);
    expect(c.designCss).not.toContain('.Button {');
    expect(c.designCss).not.toContain('!important');
    expect(c.designCss).toContain('border-radius: 10px;');
  });

  it('validates prop names and design fields the way it validates token ids', () => {
    const c = toCustomized(artifact(), {
      tokenOverrides: {},
      propValues: { label: 'Hi', nope: 1 },
      designOverrides: { radius: '4', bogus: 'x' },
    });
    expect(c.unknownPropNames).toEqual(['nope']);
    expect(c.knownPropNames).toEqual(['label', 'children', 'onClick']);
    expect(c.unknownDesignFields).toEqual(['bogus']);
  });

  it('emits a rule per interactive state so hover/focus/active survive the wire', () => {
    const c = toCustomized(artifact(), {
      tokenOverrides: {},
      propValues: {},
      designOverrides: { background: '#fff', 'hover:background': '#eee', 'focus:borderColor': '#00f' },
    });
    expect(c.designCss).toContain(`${ROOT_CLASS_PLACEHOLDER} {`);
    expect(c.designCss).toContain(`${ROOT_CLASS_PLACEHOLDER}:hover {`);
    expect(c.designCss).toContain('background: #eee;');
    // focus deliberately paints on :focus-visible, not :focus.
    expect(c.designCss).toContain(`${ROOT_CLASS_PLACEHOLDER}:focus-visible {`);
    expect(c.designCss).toContain('border-color: #00f;');
    expect(c.designCss).not.toContain('!important');
  });

  it('labels each block with the state it paints, keeping designDeclarations at rest', () => {
    const c = toCustomized(artifact(), {
      tokenOverrides: {},
      propValues: {},
      designOverrides: { background: '#fff', 'hover:background': '#eee', 'focus:borderColor': '#00f' },
    });
    expect(c.designBlocks.map((b) => b.state)).toEqual(['rest', 'hover', 'focus']);
    expect(c.designBlocks.find((b) => b.state === 'hover')).toEqual({
      state: 'hover',
      selector: `${ROOT_CLASS_PLACEHOLDER}:hover`,
      declarations: ['background: #eee'],
    });
    // The flat list stays what it always was: the resting state only.
    expect(c.designDeclarations).toEqual(['background: #fff']);
  });

  it('accepts state-prefixed keys but still reports a bogus field, prefixed or not', () => {
    const c = toCustomized(artifact(), {
      tokenOverrides: {},
      propValues: {},
      designOverrides: { 'hover:background': '#eee', nonsense: 'x', 'hover:nonsense': 'y' },
    });
    expect(c.unknownDesignFields).toEqual(['nonsense', 'hover:nonsense']);
    expect(c.unknownDesignFields).not.toContain('hover:background');
    expect(c.appliedDesignOverrides).toEqual({ 'hover:background': '#eee' });
  });
});

describe('toCustomized design VALUE validation (#5)', () => {
  it('clamps out-of-range numerics, drops NaN and out-of-enum, reporting each', () => {
    // KEY validation (unknownDesignFields) let a bad VALUE on a real field pass
    // straight to the emitter: radius:"9999" painted a 9999px corner, scale:"NaN"
    // emitted `scale(NaN)`, shadow:"bogus" emitted `box-shadow: bogus`.
    const c = toCustomized(artifact(), {
      tokenOverrides: {},
      propValues: {},
      designOverrides: { radius: '9999', scale: 'NaN', shadow: 'bogus' },
    });
    // radius is clamped to its max (48) and the CSS uses the corrected value.
    expect(c.designCss).toContain('border-radius: 48px;');
    // NaN scale and out-of-enum shadow are dropped from the emitted CSS entirely.
    expect(c.designCss).not.toContain('transform: scale');
    expect(c.designCss).not.toContain('box-shadow');
    // Only the corrected, valid override survives on the applied map.
    expect(c.appliedDesignOverrides).toEqual({ radius: '48' });

    const byKey = Object.fromEntries(c.invalidDesignValues.map((v) => [v.key, v]));
    expect(byKey.radius).toMatchObject({ given: '9999', corrected: '48', omitted: false });
    expect(byKey.scale).toMatchObject({ given: 'NaN', omitted: true });
    expect(byKey.scale.corrected).toBeUndefined();
    expect(byKey.shadow).toMatchObject({ given: 'bogus', omitted: true });
    expect(c.invalidDesignValues).toHaveLength(3);
  });

  it('reports no invalid values for in-range and in-enum overrides', () => {
    const c = toCustomized(artifact(), {
      tokenOverrides: {},
      propValues: {},
      designOverrides: { radius: '10', shadow: 'md', 'hover:opacity': '80' },
    });
    expect(c.invalidDesignValues).toEqual([]);
  });

  it('accepts a raw-CSS box-shadow despite the select options', () => {
    // shadow's contract is "none|sm|md|lg|xl OR raw CSS" — a real box-shadow must
    // not be mistaken for an out-of-enum value.
    const c = toCustomized(artifact(), {
      tokenOverrides: {},
      propValues: {},
      designOverrides: { shadow: '0 1px 2px rgba(0,0,0,0.3)' },
    });
    expect(c.invalidDesignValues).toEqual([]);
    expect(c.designCss).toContain('box-shadow: 0 1px 2px rgba(0,0,0,0.3);');
  });

  it('validates the field behind a state prefix', () => {
    const c = toCustomized(artifact(), {
      tokenOverrides: {},
      propValues: {},
      designOverrides: { 'hover:radius': '9999' },
    });
    expect(c.appliedDesignOverrides).toEqual({ 'hover:radius': '48' });
    const [only] = c.invalidDesignValues;
    expect(only).toMatchObject({ key: 'hover:radius', field: 'radius', given: '9999', corrected: '48' });
  });
});

describe('projectComponent score decomposition (#9)', () => {
  it('carries the scoreBreakdown and the hook / context signal names', () => {
    // A bare `contextDependencyScore: 6.5` cannot be reasoned about: an eyeless
    // agent can now see it is routing+2, store+3, useAuth+1.5, and can find a
    // component by the hook it uses.
    const signals: ClassificationSignals = {
      ...SIGNALS,
      usesRouter: true,
      usesStore: true,
      hookNames: ['useCart', 'useAuth'],
      contextConsumers: ['useAuth'],
    };
    const summary: ComponentSummary = { ...comp('Cart', 'organism', 'container', { score: 6.5 }), signals };
    const row = projectComponent(summary);
    expect(row.scoreBreakdown).toEqual([
      { label: 'routing', weight: 2 },
      { label: 'store subscription', weight: 3 },
      { label: 'useAuth', weight: 1.5 },
    ]);
    expect(row.hooks).toEqual(['useCart', 'useAuth']);
    expect(row.contextConsumers).toEqual(['useAuth']);
  });

  it('emits an empty breakdown for a presentational atom', () => {
    const row = projectComponent(comp('Button', 'atom', 'presentational'));
    expect(row.scoreBreakdown).toEqual([]);
    expect(row.hooks).toEqual([]);
    expect(row.contextConsumers).toEqual([]);
  });
});

describe('DESIGN_FIELD_IDS', () => {
  // The tool description used to name 6 fields while the engine accepted 13.
  // Derived from DESIGN_GROUPS, so it stays right if the engine gains a field —
  // this asserts the superset the docs were missing, not a frozen count.
  const KNOWN = [
    'scale',
    'width',
    'padding',
    'color',
    'background',
    'fontSize',
    'fontWeight',
    'fontFamily',
    'radius',
    'borderWidth',
    'borderColor',
    'shadow',
    'opacity',
  ];

  it('covers every design-override field the engine accepts', () => {
    expect(DESIGN_FIELD_IDS).toEqual(expect.arrayContaining(KNOWN));
    expect(DESIGN_FIELD_IDS.length).toBeGreaterThanOrEqual(KNOWN.length);
  });
});

describe('toToolError', () => {
  it('maps an EngineError code and sets isError', () => {
    const e = toToolError(new ComponentNotFoundError('xyz'));
    expect(e.isError).toBe(true);
    expect(e.content[0]?.text).toContain('[COMPONENT_NOT_FOUND]');
  });
  it('falls back to MCP_ERROR for a plain error', () => {
    expect(toToolError(new Error('boom')).content[0]?.text).toContain('[MCP_ERROR]');
  });
});

/** A synthetic two-component kit: Card + Button share a file, a token, and a conflicting dep. */
function kit(overrides: Partial<PortableKit> = {}): PortableKit {
  return {
    files: {
      '/components/Card/Card.tsx': "import { Button } from '../Button/Button';\nexport const Card = () => <Button />;",
      '/components/Button/Button.tsx': 'export const Button = () => null;',
      '/tokens.css': ':root {\n  --color-1: #3b82f6;\n}\n',
    },
    entryPaths: {
      card: '/components/Card/Card.tsx',
      button: '/components/Button/Button.tsx',
    },
    components: [
      { id: 'card', name: 'Card', entryPath: '/components/Card/Card.tsx' },
      { id: 'button', name: 'Button', entryPath: '/components/Button/Button.tsx' },
    ],
    externalDeps: { clsx: '^2.1.1', react: '^19.0.0' },
    depConflicts: [
      {
        package: 'shared-lib',
        requirements: [
          { componentId: 'card', range: 'latest' },
          { componentId: 'button', range: '^3.1.0' },
        ],
      },
    ],
    tokensCssPath: '/tokens.css',
    tokensCss: ':root {\n  --color-1: #3b82f6;\n}\n',
    tokenModel: {
      tokens: [
        {
          id: 't1',
          name: '--color-1',
          displayName: 'Color 1',
          category: 'color',
          value: '#3b82f6',
          fallback: '#3b82f6',
          source: 'extracted',
          usages: [{ file: '/components/Card/Card.tsx', line: 2, property: 'color', selector: '.a' }],
        },
      ],
    },
    stubbedModules: [
      { specifier: 'next/link', replacedWith: '/__stubs/next-link.tsx', lost: 'client-side prefetch' },
    ],
    danglingImports: ['/components/Card/Card.tsx → ./missing'],
    warnings: ['left <DataTable> external'],
    previewTheme: { path: '/src/theme.ts', exportName: 'theme' },
    previewMessages: '/src/messages.json',
    previewProviders: [{ path: '/src/ChatProvider.tsx', exportName: 'ChatProvider' }],
    ...overrides,
  };
}

describe('toPortableKit', () => {
  it('shapes ONE merged folder over a single token namespace', () => {
    const p = toPortableKit(kit());
    // One de-duplicated file map with exactly one /tokens.css that IS tokensCss.
    expect(p.componentCount).toBe(2);
    expect(p.components.map((c) => c.id)).toEqual(['card', 'button']);
    expect(p.components[0]).toEqual({ id: 'card', name: 'Card', entryPath: '/components/Card/Card.tsx' });
    expect(p.entryPaths).toEqual({
      card: '/components/Card/Card.tsx',
      button: '/components/Button/Button.tsx',
    });
    expect(p.tokensCssPath).toBe('/tokens.css');
    expect(p.files['/tokens.css']).toBe(p.tokensCss);
    // The Button file the two components share appears exactly once.
    expect(Object.keys(p.files).filter((k) => /\/Button\/Button\.tsx$/.test(k))).toHaveLength(1);
  });

  it('merges external deps and SURFACES conflicting ranges rather than hiding them', () => {
    const p = toPortableKit(kit());
    expect(p.externalDeps).toEqual({ clsx: '^2.1.1', react: '^19.0.0' });
    expect(p.depConflicts).toEqual([
      {
        package: 'shared-lib',
        requirements: [
          { componentId: 'card', range: 'latest' },
          { componentId: 'button', range: '^3.1.0' },
        ],
      },
    ]);
  });

  it('exposes the shared token namespace compactly (no per-token usages on the wire)', () => {
    const p = toPortableKit(kit());
    expect(p.tokens).toEqual([
      { id: 't1', name: '--color-1', value: '#3b82f6', category: 'color', source: 'extracted' },
    ]);
    // usages are deliberately dropped here — the kit payload stays compact.
    expect(JSON.stringify(p.tokens)).not.toContain('usages');
  });

  it('discloses stubbed modules, dangling imports and warnings across the set', () => {
    const p = toPortableKit(kit());
    expect(p.stubbedModules).toEqual([
      { specifier: 'next/link', replacedWith: '/__stubs/next-link.tsx', lost: 'client-side prefetch' },
    ]);
    expect(p.danglingImports).toEqual(['/components/Card/Card.tsx → ./missing']);
    expect(p.warnings).toEqual(['left <DataTable> external']);
  });

  it("marks the SOURCE app's theme / i18n / providers as not-the-component", () => {
    const p = toPortableKit(kit());
    expect(p.sourceAppFiles).toEqual(['/src/theme.ts', '/src/messages.json', '/src/ChatProvider.tsx']);
    expect(p.previewTheme).toEqual({ path: '/src/theme.ts', exportName: 'theme' });
    expect(p.previewMessages).toBe('/src/messages.json');
    expect(p.previewProviders).toEqual([{ path: '/src/ChatProvider.tsx', exportName: 'ChatProvider' }]);
  });

  it('reports an empty providers list rather than undefined when none are bundled', () => {
    const p = toPortableKit(
      kit({ previewTheme: undefined, previewMessages: undefined, previewProviders: undefined }),
    );
    expect(p.sourceAppFiles).toEqual([]);
    expect(p.previewProviders).toEqual([]);
  });
});

/**
 * A kit's file bodies are unbounded — they are every merged source file of every
 * component in the set. Measured against a real target, TWO components produced
 * an 86KB payload (95% of it file bodies) and the MCP client refused it outright:
 * the agent got nothing at all from the very call the tool description tells it
 * to prefer over N single-component calls. So the files carry a budget, and what
 * did not fit is NAMED rather than quietly dropped.
 */
describe('kit file budget', () => {
  const big = (n: number): string => 'x'.repeat(n);

  it('keeps a small kit whole and says so', () => {
    const r = budgetKitFiles({ '/a.tsx': big(100), '/b.tsx': big(100) }, ['/a.tsx']);
    expect(r.filesTruncated).toBe(false);
    expect(r.filesOmitted).toEqual([]);
    expect(Object.keys(r.files).sort()).toEqual(['/a.tsx', '/b.tsx']);
  });

  it('never drops an entry file — it is the component itself', () => {
    const r = budgetKitFiles(
      { '/entry.tsx': big(MAX_KIT_FILE_BYTES), '/dep.tsx': big(MAX_KIT_FILE_BYTES) },
      ['/entry.tsx'],
    );
    expect(r.files['/entry.tsx']).toBeDefined();
    expect(r.filesTruncated).toBe(true);
    expect(r.filesOmitted).toEqual(['/dep.tsx']);
  });

  it('fits as many files as the budget allows, smallest first', () => {
    const r = budgetKitFiles(
      { '/entry.tsx': big(10), '/small.ts': big(10), '/huge.ts': big(MAX_KIT_FILE_BYTES + 1) },
      ['/entry.tsx'],
    );
    expect(Object.keys(r.files).sort()).toEqual(['/entry.tsx', '/small.ts']);
    expect(r.filesOmitted).toEqual(['/huge.ts']);
  });

  it('stays under the budget once the entries are in', () => {
    const files: Record<string, string> = { '/entry.tsx': big(1000) };
    for (let i = 0; i < 200; i += 1) files[`/f${i}.ts`] = big(1000);
    const r = budgetKitFiles(files, ['/entry.tsx']);
    const total = Object.values(r.files).reduce((n, s) => n + s.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_KIT_FILE_BYTES);
    expect(r.filesOmitted.length).toBeGreaterThan(0);
  });
});
