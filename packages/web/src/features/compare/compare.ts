/**
 * Pure structured diff between 2–3 component artifacts. No React, no DOM — the
 * Compare view renders whatever this returns, and every case is unit-tested here.
 *
 * WHY structured facts, not a byte diff of the bundle: the portable bundle is a
 * REWRITE of the source (imports re-pathed, CSS literals turned into
 * `var(--token, …)`), so a line diff of two bundles is mostly noise about the
 * tool's own transforms, not real differences between the components. We compare
 * the DESIGN CONTRACT instead — props, tokens, external deps, and a handful of
 * classification facts — because that is what answers "are these the same
 * component, and which is the canonical one to keep?".
 */

import type {
  AtomicLevel,
  ComponentArtifact,
  ComponentKind,
  ControlKind,
  Renderability,
  TokenCategory,
} from '../../api/types.js';

/** One component's column-header facts, in the order the components were passed. */
export interface CompareColumn {
  id: string;
  name: string;
  /** filePath made relative to the scanned project root (absolute if outside it). */
  relativePath: string;
  exportName: string;
  kind: ComponentKind;
  atomicLevel: AtomicLevel;
  renderability: Renderability;
  usedByCount: number;
}

export type MetaKey =
  | 'name'
  | 'path'
  | 'exportName'
  | 'kind'
  | 'atomicLevel'
  | 'renderability'
  | 'usedByCount';

/**
 * A single scalar fact shown once per column (name, path, kind, …). `contract`
 * marks the fields that count toward the overall "no meaningful differences"
 * verdict: two duplicate files legitimately differ in `path` and may differ in
 * `name`, so those stay informational; `kind`/`atomicLevel`/`renderability` are
 * part of what makes two components actually different.
 */
export interface MetaField {
  key: MetaKey;
  label: string;
  values: readonly string[];
  identical: boolean;
  contract: boolean;
}

/** A prop's shape in one column; `null` in a row means the prop is absent there. */
export interface PropCell {
  tsType: string;
  kind: ControlKind;
  required: boolean;
  defaultValue: string | null;
}

/** A design token's value in one column. */
export interface TokenCell {
  value: string;
  category: TokenCategory;
}

/** A dependency's version range in one column. */
export type DepCell = string;

/**
 * One keyed row across all columns (a prop name, a token name, a package name).
 * `cells` is aligned to the column order; `null` = absent in that column.
 */
export interface KeyedRow<C> {
  key: string;
  cells: readonly (C | null)[];
  presentCount: number;
  allPresent: boolean;
  /** Present in EVERY column AND every present cell is equal — a true match. */
  identical: boolean;
}

/**
 * A facet split into the rows that differ (present in only some columns, or
 * present everywhere but not equal) and the rows that match. The view renders
 * `differing` loud and `same` muted; both are sorted by key for stable output.
 */
export interface FacetDiff<C> {
  differing: readonly KeyedRow<C>[];
  same: readonly KeyedRow<C>[];
}

export interface Comparison {
  columns: readonly CompareColumn[];
  meta: readonly MetaField[];
  props: FacetDiff<PropCell>;
  tokens: FacetDiff<TokenCell>;
  deps: FacetDiff<DepCell>;
  /** True when no facet and no contract meta-field reports a difference. */
  identical: boolean;
  /**
   * Index of the column with the strictly-highest `usedByCount` — the canonical
   * candidate to keep. `null` when the top usage is tied or everything reads 0,
   * because then reuse cannot pick a winner and the UI must not pretend it can.
   */
  mostUsedIndex: number | null;
}

function relativePath(root: string, filePath: string): string {
  if (root && filePath.startsWith(root)) return filePath.slice(root.length).replace(/^\//, '');
  return filePath;
}

function toColumn(artifact: ComponentArtifact, root: string): CompareColumn {
  const { descriptor, classification, sandpack, usage } = artifact;
  return {
    id: descriptor.id,
    name: descriptor.name,
    relativePath: relativePath(root, descriptor.filePath),
    exportName: descriptor.exportName,
    kind: classification.kind,
    atomicLevel: classification.atomicLevel,
    renderability: sandpack.renderability,
    usedByCount: usage?.usedByCount ?? 0,
  };
}

/** Sorted union of keys across per-column maps. */
function unionKeys<C>(perColumn: readonly ReadonlyMap<string, C>[]): string[] {
  const keys = new Set<string>();
  for (const map of perColumn) for (const key of map.keys()) keys.add(key);
  return [...keys].sort();
}

/**
 * Build one facet from per-column key→cell maps and a cell-equality predicate.
 * The equality predicate is the whole reason a facet knows "same vs differing";
 * absence in any column always counts as a difference (a missing prop is a real
 * signal, not a match).
 */
function buildFacet<C>(
  perColumn: readonly ReadonlyMap<string, C>[],
  cellsEqual: (a: C, b: C) => boolean,
): FacetDiff<C> {
  const differing: KeyedRow<C>[] = [];
  const same: KeyedRow<C>[] = [];

  for (const key of unionKeys(perColumn)) {
    const cells: (C | null)[] = perColumn.map((map) => {
      const cell = map.get(key);
      return cell === undefined ? null : cell;
    });

    let presentCount = 0;
    let reference: C | null = null;
    for (const cell of cells) {
      if (cell !== null) {
        presentCount += 1;
        if (reference === null) reference = cell;
      }
    }

    const allPresent = presentCount === perColumn.length;
    const ref = reference;
    // A match requires presence in EVERY column and equality of every cell to the
    // first; a prop/token/dep missing anywhere is a difference, never a match.
    const identical =
      allPresent && ref !== null && cells.every((cell) => cell !== null && cellsEqual(cell, ref));

    const row: KeyedRow<C> = { key, cells, presentCount, allPresent, identical };
    (identical ? same : differing).push(row);
  }

  return { differing, same };
}

function propMap(artifact: ComponentArtifact): Map<string, PropCell> {
  const map = new Map<string, PropCell>();
  for (const p of artifact.propModel.props) {
    map.set(p.name, {
      tsType: p.tsType,
      kind: p.kind,
      required: p.required,
      defaultValue: p.defaultValue ?? null,
    });
  }
  return map;
}

function propsEqual(a: PropCell, b: PropCell): boolean {
  return (
    a.tsType === b.tsType &&
    a.kind === b.kind &&
    a.required === b.required &&
    a.defaultValue === b.defaultValue
  );
}

function tokenMap(artifact: ComponentArtifact): Map<string, TokenCell> {
  const map = new Map<string, TokenCell>();
  // Key by the CSS variable name so the same token across components lines up;
  // last write wins on the rare intra-component duplicate name.
  for (const t of artifact.tokenModel.tokens) {
    map.set(t.name, { value: t.value, category: t.category });
  }
  return map;
}

function tokensEqual(a: TokenCell, b: TokenCell): boolean {
  // The VALUE is the design fact; two components agreeing on `--accent: #f00`
  // match even if one filed it under a different category.
  return a.value === b.value;
}

function depMap(artifact: ComponentArtifact): Map<string, DepCell> {
  return new Map(Object.entries(artifact.bundle.externalDeps));
}

function depsEqual(a: DepCell, b: DepCell): boolean {
  return a === b;
}

function metaField(
  key: MetaKey,
  label: string,
  values: readonly string[],
  contract: boolean,
): MetaField {
  const identical = values.every((v) => v === values[0]);
  return { key, label, values, identical, contract };
}

function buildMeta(columns: readonly CompareColumn[]): MetaField[] {
  return [
    metaField('name', 'Name', columns.map((c) => c.name), false),
    metaField('path', 'Location', columns.map((c) => c.relativePath), false),
    metaField('exportName', 'Export', columns.map((c) => c.exportName), false),
    metaField('kind', 'Kind', columns.map((c) => c.kind), true),
    metaField('atomicLevel', 'Atomic level', columns.map((c) => c.atomicLevel), true),
    metaField('renderability', 'Renderability', columns.map((c) => c.renderability), true),
    metaField('usedByCount', 'Used by', columns.map((c) => String(c.usedByCount)), false),
  ];
}

/**
 * The canonical candidate: the single column with strictly the most importers.
 * A tie at the top or an all-zero corpus (e.g. every candidate is used only by
 * stories/tests, which the scan excludes) yields `null` — reuse then can't crown
 * a winner and the UI says so rather than picking arbitrarily.
 */
function findMostUsed(columns: readonly CompareColumn[]): number | null {
  let bestIndex = -1;
  let best = -1;
  let tied = false;
  columns.forEach((col, i) => {
    if (col.usedByCount > best) {
      best = col.usedByCount;
      bestIndex = i;
      tied = false;
    } else if (col.usedByCount === best) {
      tied = true;
    }
  });
  if (best <= 0 || tied) return null;
  return bestIndex;
}

/** Compare N (2–3 in practice) component artifacts into a structured diff. */
export function compareMany(
  artifacts: readonly ComponentArtifact[],
  projectRoot: string,
): Comparison {
  const columns = artifacts.map((a) => toColumn(a, projectRoot));
  const meta = buildMeta(columns);

  const props = buildFacet(artifacts.map(propMap), propsEqual);
  const tokens = buildFacet(artifacts.map(tokenMap), tokensEqual);
  const deps = buildFacet(artifacts.map(depMap), depsEqual);

  const contractMetaIdentical = meta.filter((m) => m.contract).every((m) => m.identical);
  const identical =
    props.differing.length === 0 &&
    tokens.differing.length === 0 &&
    deps.differing.length === 0 &&
    contractMetaIdentical;

  return {
    columns,
    meta,
    props,
    tokens,
    deps,
    identical,
    mostUsedIndex: findMostUsed(columns),
  };
}

/** Two-way convenience over {@link compareMany}. */
export function compareComponents(
  a: ComponentArtifact,
  b: ComponentArtifact,
  projectRoot: string,
): Comparison {
  return compareMany([a, b], projectRoot);
}
