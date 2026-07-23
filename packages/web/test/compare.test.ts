import { describe, it, expect } from 'vitest';
import {
  compareComponents,
  compareMany,
  type Comparison,
} from '../src/features/compare/compare.js';
import type {
  ComponentArtifact,
  ControlKind,
  PropControl,
  Token,
  TokenCategory,
} from '../src/api/types.js';

const ROOT = '/proj';

interface PropSpec {
  name: string;
  tsType?: string;
  kind?: ControlKind;
  required?: boolean;
  defaultValue?: string;
}

interface Overrides {
  id?: string;
  name?: string;
  filePath?: string;
  exportName?: string;
  kind?: 'presentational' | 'container' | 'layout';
  atomicLevel?: 'atom' | 'molecule' | 'organism' | 'page';
  renderability?: 'full' | 'stubbed' | 'code-only';
  usedByCount?: number;
  props?: PropSpec[];
  tokens?: { name: string; value: string; category?: TokenCategory }[];
  deps?: Record<string, string>;
}

function prop(spec: PropSpec): PropControl {
  return {
    name: spec.name,
    tsType: spec.tsType ?? 'string',
    kind: spec.kind ?? 'string',
    required: spec.required ?? false,
    ...(spec.defaultValue !== undefined ? { defaultValue: spec.defaultValue } : {}),
  };
}

function token(name: string, value: string, category: TokenCategory = 'color'): Token {
  return {
    id: `tok:${name}`,
    name,
    displayName: name,
    category,
    value,
    fallback: value,
    usages: [],
    source: 'extracted',
  };
}

/** Build a full ComponentArtifact fixture; only the fields compare reads matter. */
function artifact(o: Overrides = {}): ComponentArtifact {
  const id = o.id ?? o.name ?? 'C';
  const filePath = o.filePath ?? `${ROOT}/${id}.tsx`;
  return {
    descriptor: {
      id,
      name: o.name ?? id,
      filePath,
      exportName: o.exportName ?? (o.name ?? id),
      isDefaultExport: false,
      loc: { file: filePath, line: 1, column: 1 },
    },
    classification: {
      atomicLevel: o.atomicLevel ?? 'atom',
      kind: o.kind ?? 'presentational',
      contextDependencyScore: 0,
      confidence: 1,
    },
    signals: {
      childComponentCount: 0,
      jsxDepth: 1,
      hookNames: [],
      usesRouter: false,
      usesStore: false,
      usesDataFetching: false,
      contextConsumers: [],
      isClientComponent: false,
      propCount: (o.props ?? []).length,
    },
    propModel: { props: (o.props ?? []).map(prop) },
    usage: { usedByCount: o.usedByCount ?? 0, usedByFiles: [] },
    artifactVersion: 1,
    bundle: {
      files: {},
      entryPath: filePath,
      externalDeps: o.deps ?? {},
      assets: [],
      warnings: [],
      stubbedModules: [],
      danglingImports: [],
    },
    tokenModel: {
      tokens: (o.tokens ?? []).map((t) => token(t.name, t.value, t.category)),
    },
    sandpack: {
      files: {},
      entryPath: '/index.tsx',
      template: 'react-ts',
      dependencies: {},
      renderability: o.renderability ?? 'full',
      notes: [],
    },
  };
}

function propRowKeys(c: Comparison, bucket: 'differing' | 'same'): string[] {
  return c.props[bucket].map((r) => r.key);
}

describe('compareComponents — identical', () => {
  it('reports no meaningful differences when the two are the same contract', () => {
    const a = artifact({
      name: 'Button',
      props: [{ name: 'label', tsType: 'string', required: true }],
      tokens: [{ name: '--btn-bg', value: '#111' }],
      deps: { clsx: '^2.0.0' },
    });
    const b = artifact({
      id: 'B',
      name: 'Button',
      filePath: `${ROOT}/B.tsx`,
      props: [{ name: 'label', tsType: 'string', required: true }],
      tokens: [{ name: '--btn-bg', value: '#111' }],
      deps: { clsx: '^2.0.0' },
    });

    const result = compareComponents(a, b, ROOT);

    expect(result.identical).toBe(true);
    expect(result.props.differing).toHaveLength(0);
    expect(result.tokens.differing).toHaveLength(0);
    expect(result.deps.differing).toHaveLength(0);
    expect(propRowKeys(result, 'same')).toEqual(['label']);
  });
});

describe('compareComponents — disjoint props', () => {
  it('places a prop present in only one column into differing', () => {
    const a = artifact({ name: 'A', props: [{ name: 'x' }] });
    const b = artifact({ id: 'B', name: 'B', props: [{ name: 'y' }] });

    const result = compareComponents(a, b, ROOT);

    expect(result.identical).toBe(false);
    expect(propRowKeys(result, 'differing').sort()).toEqual(['x', 'y']);
    expect(result.props.same).toHaveLength(0);

    const rowX = result.props.differing.find((r) => r.key === 'x');
    expect(rowX?.cells[0]).not.toBeNull(); // present in A
    expect(rowX?.cells[1]).toBeNull(); // absent in B
    expect(rowX?.allPresent).toBe(false);
  });
});

describe('compareComponents — shared prop, differing type', () => {
  it('marks a prop present in both but with a different type as differing', () => {
    const a = artifact({ name: 'A', props: [{ name: 'size', tsType: 'number', kind: 'number' }] });
    const b = artifact({
      id: 'B',
      name: 'B',
      props: [{ name: 'size', tsType: '"sm" | "lg"', kind: 'enum' }],
    });

    const result = compareComponents(a, b, ROOT);

    expect(result.identical).toBe(false);
    expect(propRowKeys(result, 'differing')).toEqual(['size']);
    const row = result.props.differing[0];
    expect(row.allPresent).toBe(true);
    expect(row.identical).toBe(false);
    expect(row.cells[0]?.tsType).toBe('number');
    expect(row.cells[1]?.tsType).toBe('"sm" | "lg"');
  });

  it('treats a required/default change on a shared prop as differing', () => {
    const a = artifact({ name: 'A', props: [{ name: 'open', required: true }] });
    const b = artifact({
      id: 'B',
      name: 'B',
      props: [{ name: 'open', required: false, defaultValue: 'false' }],
    });
    const result = compareComponents(a, b, ROOT);
    expect(propRowKeys(result, 'differing')).toEqual(['open']);
  });
});

describe('compareComponents — token value differences', () => {
  it('flags a token whose value differs and keeps a shared one muted', () => {
    const a = artifact({
      name: 'A',
      tokens: [
        { name: '--accent', value: '#f00' },
        { name: '--gap', value: '8px', category: 'spacing' },
      ],
    });
    const b = artifact({
      id: 'B',
      name: 'B',
      tokens: [
        { name: '--accent', value: '#00f' },
        { name: '--gap', value: '8px', category: 'spacing' },
      ],
    });

    const result = compareComponents(a, b, ROOT);

    expect(result.identical).toBe(false);
    expect(result.tokens.differing.map((r) => r.key)).toEqual(['--accent']);
    expect(result.tokens.same.map((r) => r.key)).toEqual(['--gap']);
    const accent = result.tokens.differing[0];
    expect(accent.cells[0]?.value).toBe('#f00');
    expect(accent.cells[1]?.value).toBe('#00f');
  });
});

describe('compareComponents — dependency version differences', () => {
  it('flags a dep required at different versions and one present in only one', () => {
    const a = artifact({ name: 'A', deps: { clsx: '^2.0.0', 'date-fns': '^3.0.0' } });
    const b = artifact({ id: 'B', name: 'B', deps: { clsx: '^1.0.0' } });

    const result = compareComponents(a, b, ROOT);

    expect(result.identical).toBe(false);
    expect(result.deps.differing.map((r) => r.key).sort()).toEqual(['clsx', 'date-fns']);
    const clsx = result.deps.differing.find((r) => r.key === 'clsx');
    expect(clsx?.cells).toEqual(['^2.0.0', '^1.0.0']);
    const df = result.deps.differing.find((r) => r.key === 'date-fns');
    expect(df?.cells).toEqual(['^3.0.0', null]);
  });
});

describe('compareComponents — same name, different file (the duplicate case)', () => {
  it('shows the name matching and the path differing, but no meaningful contract diff', () => {
    const a = artifact({
      id: 'a1',
      name: 'Button',
      filePath: `${ROOT}/ui/Button.tsx`,
      props: [{ name: 'label' }],
    });
    const b = artifact({
      id: 'b1',
      name: 'Button',
      filePath: `${ROOT}/legacy/Button.tsx`,
      props: [{ name: 'label' }],
    });

    const result = compareComponents(a, b, ROOT);

    const name = result.meta.find((m) => m.key === 'name');
    const path = result.meta.find((m) => m.key === 'path');
    expect(name?.identical).toBe(true);
    expect(path?.identical).toBe(false);
    expect(path?.values).toEqual(['ui/Button.tsx', 'legacy/Button.tsx']);
    // Contract is identical, so location alone does not count as a "meaningful" diff.
    expect(result.identical).toBe(true);
  });
});

describe('compareComponents — meta contract differences', () => {
  it('counts a renderability difference as meaningful', () => {
    const a = artifact({ name: 'A', renderability: 'full' });
    const b = artifact({ id: 'B', name: 'B', renderability: 'code-only' });
    const result = compareComponents(a, b, ROOT);
    expect(result.identical).toBe(false);
    expect(result.meta.find((m) => m.key === 'renderability')?.identical).toBe(false);
  });
});

describe('compareComponents — canonical (most used)', () => {
  it('names the strictly-most-used column', () => {
    const a = artifact({ name: 'A', usedByCount: 3 });
    const b = artifact({ id: 'B', name: 'B', usedByCount: 9 });
    const result = compareComponents(a, b, ROOT);
    expect(result.mostUsedIndex).toBe(1);
    expect(result.meta.find((m) => m.key === 'usedByCount')?.values).toEqual(['3', '9']);
  });

  it('returns null when the top usage is tied', () => {
    const a = artifact({ name: 'A', usedByCount: 4 });
    const b = artifact({ id: 'B', name: 'B', usedByCount: 4 });
    expect(compareComponents(a, b, ROOT).mostUsedIndex).toBeNull();
  });

  it('returns null when nothing is used', () => {
    const a = artifact({ name: 'A', usedByCount: 0 });
    const b = artifact({ id: 'B', name: 'B', usedByCount: 0 });
    expect(compareComponents(a, b, ROOT).mostUsedIndex).toBeNull();
  });
});

describe('compareMany — three columns', () => {
  it('aligns cells across three components and requires all three for "same"', () => {
    const a = artifact({ name: 'A', props: [{ name: 'label' }, { name: 'onClick' }] });
    const b = artifact({ id: 'B', name: 'B', props: [{ name: 'label' }, { name: 'onClick' }] });
    const c = artifact({ id: 'C', name: 'C', props: [{ name: 'label' }] });

    const result = compareMany([a, b, c], ROOT);

    expect(result.columns).toHaveLength(3);
    // label is in all three -> same; onClick missing from C -> differing.
    expect(result.props.same.map((r) => r.key)).toEqual(['label']);
    expect(result.props.differing.map((r) => r.key)).toEqual(['onClick']);
    const onClick = result.props.differing[0];
    expect(onClick.cells.map((cell) => cell !== null)).toEqual([true, true, false]);
    expect(onClick.presentCount).toBe(2);
  });
});
