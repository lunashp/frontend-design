import { describe, expect, it } from 'vitest';
import type {
  AtomicLevel,
  ComponentKind,
  ComponentSummary,
  PropControl,
} from '../src/api/types.js';
import {
  buildCatalogHtml,
  catalogFileName,
  type CatalogSource,
} from '../src/features/catalog/build-catalog.js';
import { buildCatalogModel } from '../src/features/catalog/catalog-model.js';
import { escapeHtml } from '../src/features/catalog/render-catalog.js';

/** A fully-typed prop control — no `as any`, every required field present. */
function prop(name: string): PropControl {
  return { name, tsType: 'string', kind: 'string', required: false };
}

interface FixtureInput {
  readonly id: string;
  readonly name: string;
  readonly filePath: string;
  readonly exportName?: string;
  readonly atomicLevel?: AtomicLevel;
  readonly kind?: ComponentKind;
  readonly usedByCount?: number;
  readonly contextScore?: number;
  readonly props?: readonly string[];
}

/** Build a complete ComponentSummary fixture — all engine fields filled. */
function comp(input: FixtureInput): ComponentSummary {
  const props = input.props ?? [];
  return {
    descriptor: {
      id: input.id,
      name: input.name,
      filePath: input.filePath,
      exportName: input.exportName ?? input.name,
      isDefaultExport: false,
      loc: { file: input.filePath, line: 1, column: 0 },
    },
    classification: {
      atomicLevel: input.atomicLevel ?? 'atom',
      kind: input.kind ?? 'presentational',
      contextDependencyScore: input.contextScore ?? 0,
      confidence: 1,
    },
    signals: {
      childComponentCount: 0,
      jsxDepth: 0,
      hookNames: [],
      usesRouter: false,
      usesStore: false,
      usesDataFetching: false,
      contextConsumers: [],
      isClientComponent: false,
      propCount: props.length,
    },
    propModel: { props: props.map(prop) },
    usage: { usedByCount: input.usedByCount ?? 0, usedByFiles: [] },
  };
}

const ROOT = '/Users/luna/secret/my-app';
const FIXED = new Date('2026-07-23T14:05:00Z');

function source(components: readonly ComponentSummary[], total?: number): CatalogSource {
  return {
    projectRoot: ROOT,
    framework: 'React',
    components,
    totalComponents: total ?? components.length,
    generatedAt: FIXED,
  };
}

const SAMPLE: readonly ComponentSummary[] = [
  comp({
    id: 'a',
    name: 'Button',
    filePath: `${ROOT}/src/components/Button.tsx`,
    kind: 'presentational',
    usedByCount: 12,
    props: ['variant', 'size', 'onClick'],
  }),
  comp({
    id: 'b',
    name: 'Card',
    filePath: `${ROOT}/src/components/Card.tsx`,
    atomicLevel: 'molecule',
    usedByCount: 5,
    contextScore: 2,
    props: ['title', 'children'],
  }),
  comp({
    id: 'c',
    name: 'Sidebar',
    filePath: `${ROOT}/src/layout/Sidebar.tsx`,
    atomicLevel: 'organism',
    kind: 'layout',
    usedByCount: 1,
    contextScore: 6,
  }),
];

describe('buildCatalogModel', () => {
  it('derives the project name from the root basename, never the absolute path', () => {
    const model = buildCatalogModel(SAMPLE, {
      projectRoot: ROOT,
      framework: 'React',
      totalCount: 3,
      generatedAt: FIXED,
    });
    expect(model.projectName).toBe('my-app');
    expect(model.framework).toBe('React');
    expect(model.shownCount).toBe(3);
    expect(model.totalCount).toBe(3);
  });

  it('groups rows by project-relative directory, most-populated group first', () => {
    const model = buildCatalogModel(SAMPLE, {
      projectRoot: ROOT,
      framework: 'React',
      totalCount: 3,
      generatedAt: FIXED,
    });
    expect(model.groups[0]?.dir).toBe('src/components');
    expect(model.groups[0]?.rows.map((r) => r.name)).toEqual(['Button', 'Card']);
    expect(model.groups[1]?.dir).toBe('src/layout');
    // Paths are relative — the absolute root prefix is stripped.
    expect(model.groups[0]?.rows[0]?.relativePath).toBe('src/components/Button.tsx');
  });

  it('sorts rows within a group by used-by count descending', () => {
    const model = buildCatalogModel(SAMPLE, {
      projectRoot: ROOT,
      framework: 'React',
      totalCount: 3,
      generatedAt: FIXED,
    });
    const usedBy = model.groups[0]?.rows.map((r) => r.usedByCount);
    expect(usedBy).toEqual([12, 5]);
  });

  it('counts components by atomic level', () => {
    const model = buildCatalogModel(SAMPLE, {
      projectRoot: ROOT,
      framework: 'React',
      totalCount: 3,
      generatedAt: FIXED,
    });
    const atoms = model.levelCounts.find((l) => l.level === 'atom');
    const molecules = model.levelCounts.find((l) => l.level === 'molecule');
    expect(atoms?.count).toBe(1);
    expect(molecules?.count).toBe(1);
  });

  it('samples a bounded number of prop names', () => {
    const model = buildCatalogModel(SAMPLE, {
      projectRoot: ROOT,
      framework: 'React',
      totalCount: 3,
      generatedAt: FIXED,
      propSampleLimit: 2,
    });
    const button = model.groups[0]?.rows[0];
    expect(button?.propCount).toBe(3);
    expect(button?.propSample).toEqual(['variant', 'size']);
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml('<a href="x" & \'y\'>')).toBe(
      '&lt;a href=&quot;x&quot; &amp; &#39;y&#39;&gt;',
    );
  });
});

describe('buildCatalogHtml', () => {
  const html = buildCatalogHtml(source(SAMPLE));

  it('is a single self-contained HTML document', () => {
    expect(html.trimStart().toLowerCase().startsWith('<!doctype html')).toBe(true);
    expect(html.match(/<\/html>/g)?.length).toBe(1);
  });

  it('makes no external requests: no remote URLs, links, or scripts', () => {
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<script\s+[^>]*src=/i);
    expect(html).not.toMatch(/url\(\s*['"]?https?:/i);
    expect(html).not.toMatch(/@import/i);
  });

  it('lists every component by name', () => {
    expect(html).toContain('Button');
    expect(html).toContain('Card');
    expect(html).toContain('Sidebar');
  });

  it('shows the project name, framework, and counts in the header', () => {
    expect(html).toContain('my-app');
    expect(html).toContain('React');
    // shown vs total scanned design set
    expect(html).toContain('3');
  });

  it('renders relative paths and never leaks the absolute project root', () => {
    expect(html).toContain('src/components/Button.tsx');
    expect(html).not.toContain('/Users/luna/secret');
  });

  it('shows the "shown of total" context when the view is filtered', () => {
    const filtered = buildCatalogHtml(source([SAMPLE[0] as ComponentSummary], 3));
    // one shown, three scanned — both numbers present
    expect(filtered).toContain('1');
    expect(filtered).toContain('3');
  });

  it('escapes a malicious component name instead of emitting live markup', () => {
    const evil = comp({
      id: 'x',
      name: '<img src=x onerror=alert(1)>',
      filePath: `${ROOT}/src/components/Evil.tsx`,
    });
    const out = buildCatalogHtml(source([evil]));
    expect(out).not.toContain('<img src=x onerror=alert(1)>');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes a malicious file path (attribute-context injection)', () => {
    const evil = comp({
      id: 'y',
      name: 'Ok',
      filePath: `${ROOT}/src/"><script>alert(1)</script>/Bad.tsx`,
    });
    const out = buildCatalogHtml(source([evil]));
    expect(out).not.toContain('"><script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;');
  });
});

describe('catalogFileName', () => {
  it('builds a dated, project-scoped filename', () => {
    expect(catalogFileName('my-app', FIXED)).toBe('component-catalog-my-app-2026-07-23.html');
  });

  it('sanitizes filesystem-unsafe characters in the project name', () => {
    expect(catalogFileName('@scope/pkg name', FIXED)).toBe(
      'component-catalog-scope-pkg-name-2026-07-23.html',
    );
  });
});
