import { describe, it, expect } from 'vitest';
import { ComponentNotFoundError, type ComponentArtifact, type ComponentSummary, type ScanResult } from '@ce/core';
import {
  filterComponents,
  toComponentRows,
  toCustomized,
  toPortableCode,
  toScanSummary,
  toToolError,
} from '../src/tools.js';

interface CompOpts {
  id?: string;
  score?: number;
  propCount?: number;
}

function comp(
  name: string,
  atomicLevel: ComponentSummary['classification']['atomicLevel'],
  kind: ComponentSummary['classification']['kind'],
  opts: CompOpts = {},
): ComponentSummary {
  return {
    descriptor: {
      id: opts.id ?? name.toLowerCase(),
      name,
      filePath: `/p/${name}.tsx`,
      exportName: name,
      isDefaultExport: false,
      loc: { file: `/p/${name}.tsx`, line: 1, column: 1 },
    },
    classification: {
      atomicLevel,
      kind,
      contextDependencyScore: opts.score ?? 0,
      confidence: 1,
    },
    propModel: {
      props: Array.from({ length: opts.propCount ?? 0 }, (_, i) => ({
        name: `p${i}`,
        tsType: 'string',
        kind: 'string' as const,
        required: false,
      })),
    },
  };
}

const COMPONENTS: ComponentSummary[] = [
  comp('Button', 'atom', 'presentational', { propCount: 2 }),
  comp('Card', 'molecule', 'presentational'),
  comp('UserPanel', 'organism', 'container', { score: 5 }),
  comp('Dashboard', 'page', 'container', { score: 9 }),
];

const SCAN: ScanResult = {
  artifactVersion: 1,
  projectRoot: '/p',
  framework: 'react',
  components: COMPONENTS,
  warnings: ['skipped X'],
};

function artifact(): ComponentArtifact {
  return {
    artifactVersion: 1,
    descriptor: {
      id: 'btn',
      name: 'Button',
      filePath: '/p/Button.tsx',
      exportName: 'Button',
      isDefaultExport: false,
      loc: { file: '/p/Button.tsx', line: 1, column: 1 },
    },
    classification: { atomicLevel: 'atom', kind: 'presentational', contextDependencyScore: 0, confidence: 1 },
    propModel: { props: [] },
    bundle: {
      files: { '/Button.tsx': 'export const Button = () => null;', '/tokens.css': ':root{}' },
      entryPath: '/Button.tsx',
      externalDeps: { clsx: '^2.1.1' },
      assets: [],
      warnings: ['left <DataTable> external'],
      incomplete: false,
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
      dependencies: {},
      renderability: 'full',
      notes: [],
    },
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
  it('filters by max context-dependency score', () => {
    expect(filterComponents(COMPONENTS, { maxContextDependencyScore: 5 })).toHaveLength(3);
  });
  it('caps results with limit', () => {
    expect(filterComponents(COMPONENTS, { limit: 2 })).toHaveLength(2);
  });
  it('combines filters (AND)', () => {
    expect(filterComponents(COMPONENTS, { kind: 'container', maxContextDependencyScore: 5 })).toHaveLength(1);
  });
});

describe('toComponentRows', () => {
  it('emits compact rows with the id and real field names', () => {
    const rows = toComponentRows([COMPONENTS[0] as ComponentSummary]);
    expect(rows[0]).toMatchObject({
      id: 'button',
      name: 'Button',
      exportName: 'Button',
      atomicLevel: 'atom',
      kind: 'presentational',
      propCount: 2,
    });
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
});

describe('toCustomized', () => {
  it('applies token overrides by id, emits design CSS, reports unknown ids', () => {
    const c = toCustomized(artifact(), {
      tokenOverrides: { t1: '#e11d48', ghost: '#000' },
      propValues: {},
      designOverrides: { background: '#111', radius: '10' },
    });
    expect(c.tokensCss).toContain('--color-1: #e11d48;');
    expect(c.appliedTokenOverrides).toEqual({ t1: '#e11d48' });
    expect(c.unknownTokenIds).toEqual(['ghost']);
    expect(c.designCss).toContain('.Button {');
    expect(c.designCss).toContain('background: #111;');
    expect(c.designCss).toContain('border-radius: 10px;');
    expect(Object.keys(c.files)).toContain('/tokens.css');
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
