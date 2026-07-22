import { describe, it, expect } from 'vitest';
import {
  ComponentNotFoundError,
  type ClassificationSignals,
  type ComponentArtifact,
  type ComponentSummary,
  type PropControl,
  type ScanResult,
} from '@ce/core';
import {
  DEFAULT_LIST_LIMIT,
  DESIGN_FIELD_IDS,
  filterComponents,
  paginate,
  projectComponent,
  ROOT_CLASS_PLACEHOLDER,
  toComponentList,
  toComponentRows,
  toCustomized,
  toPortableCode,
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
  };
}

const COMPONENTS: ComponentSummary[] = [
  comp('Button', 'atom', 'presentational', {
    filePath: '/p/src/ui/Button.tsx',
    propNames: ['label', 'onClick'],
  }),
  comp('Card', 'molecule', 'presentational', { filePath: '/p/src/ui/Card.tsx' }),
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
};

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
    expect(p.tokens).toEqual([{ id: 't1', name: '--color-1', value: '#3b82f6', category: 'color' }]);
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
