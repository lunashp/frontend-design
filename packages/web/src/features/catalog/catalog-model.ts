/**
 * Pure scan-result → view-model transform for the shared catalog export.
 *
 * The catalog is a self-contained artifact a teammate opens WITHOUT the tool, so
 * everything it needs must be flattened here from the scan result into a plain,
 * display-ready model — no live host, no per-component fetch. Kept separate from
 * the HTML renderer so the shape is unit-testable without touching a string of
 * markup, and so the renderer never has to know the engine's `ComponentSummary`.
 *
 * WHY project-RELATIVE only: `projectRoot` is an absolute host path
 * (`/Users/…`). A shared file must never leak the author's filesystem, so the
 * root is reduced to its basename for the title and stripped from every file
 * path. The absolute root never reaches the model.
 */

import type { AtomicLevel, ComponentKind, ComponentSummary } from '../../api/types.js';
import { RANK_ORDER } from '../../lib/taxonomy.js';
import { relativeDir, relativePath } from '../../lib/source-area.js';

/** One component, flattened to the facts the catalog shows. */
export interface CatalogRow {
  readonly name: string;
  readonly exportName: string;
  /** Project-relative source path (absolute root stripped). */
  readonly relativePath: string;
  /** Project-relative directory — the grouping key. */
  readonly dir: string;
  readonly atomicLevel: AtomicLevel;
  readonly kind: ComponentKind;
  readonly usedByCount: number;
  /** 0..~10 engine context-dependency score; lower renders more standalone. */
  readonly contextScore: number;
  readonly propCount: number;
  /** A bounded sample of prop names for the summary column. */
  readonly propSample: readonly string[];
}

/** Components sharing a directory — the author's own structure, as a section. */
export interface CatalogGroup {
  readonly dir: string;
  readonly rows: readonly CatalogRow[];
}

export interface LevelCount {
  readonly level: AtomicLevel;
  readonly count: number;
}

export interface KindCount {
  readonly kind: ComponentKind;
  readonly count: number;
}

/** The fully display-ready catalog — the only input the HTML renderer needs. */
export interface CatalogModel {
  readonly projectName: string;
  readonly framework: string;
  /** Components in THIS catalog (the exported view). */
  readonly shownCount: number;
  /** Full scanned design set, for "showing N of M" context. */
  readonly totalCount: number;
  /** Deterministic UTC display label (see formatTimestamp). */
  readonly generatedAtLabel: string;
  readonly groups: readonly CatalogGroup[];
  readonly levelCounts: readonly LevelCount[];
  readonly kindCounts: readonly KindCount[];
}

export interface CatalogModelOptions {
  readonly projectRoot: string;
  readonly framework: string;
  /** Full scanned design set count, for the "N of M" header context. */
  readonly totalCount: number;
  /** Injected for deterministic output; the caller defaults it to `new Date()`. */
  readonly generatedAt: Date;
  /** How many prop names to surface per row. Default 4. */
  readonly propSampleLimit?: number;
}

const DEFAULT_PROP_SAMPLE = 4;
const KIND_ORDER: readonly ComponentKind[] = ['presentational', 'container', 'layout'];

/** Last non-empty path segment — the project's own folder name, never the root. */
export function projectNameFromRoot(projectRoot: string): string {
  const segments = projectRoot.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? projectRoot;
}

/**
 * Stable UTC label, e.g. `2026-07-23 14:05 UTC`. UTC (not locale) so the same
 * scan renders the same bytes on any machine — the pure builder stays testable,
 * and a shared file reads the same for everyone regardless of timezone.
 */
export function formatTimestamp(date: Date): string {
  const iso = date.toISOString(); // 2026-07-23T14:05:00.000Z
  const day = iso.slice(0, 10);
  const time = iso.slice(11, 16);
  return `${day} ${time} UTC`;
}

function toRow(c: ComponentSummary, projectRoot: string, sampleLimit: number): CatalogRow {
  const props = c.propModel.props;
  return {
    name: c.descriptor.name,
    exportName: c.descriptor.exportName,
    relativePath: relativePath(projectRoot, c.descriptor.filePath),
    dir: relativeDir(projectRoot, c.descriptor.filePath),
    atomicLevel: c.classification.atomicLevel,
    kind: c.classification.kind,
    usedByCount: c.usage?.usedByCount ?? 0,
    contextScore: c.classification.contextDependencyScore,
    propCount: props.length,
    propSample: props.slice(0, sampleLimit).map((p) => p.name),
  };
}

/**
 * Row ordering inside a group: most-imported first (the canonical member of a
 * duplicate-name cluster), then the more isolable, then name — the same
 * tie-break the gallery's "most used" sort uses, so the catalog and the app
 * agree on which component leads.
 */
function compareRows(a: CatalogRow, b: CatalogRow): number {
  return (
    b.usedByCount - a.usedByCount ||
    a.contextScore - b.contextScore ||
    a.name.localeCompare(b.name)
  );
}

function groupByDir(rows: readonly CatalogRow[]): CatalogGroup[] {
  const byDir = new Map<string, CatalogRow[]>();
  for (const row of rows) {
    const bucket = byDir.get(row.dir);
    if (bucket) bucket.push(row);
    else byDir.set(row.dir, [row]);
  }
  return [...byDir.entries()]
    .map(([dir, groupRows]) => ({ dir, rows: [...groupRows].sort(compareRows) }))
    // Most-populated directory first, then alphabetical — a stable, scannable order.
    .sort((a, b) => b.rows.length - a.rows.length || a.dir.localeCompare(b.dir));
}

function countLevels(rows: readonly CatalogRow[]): LevelCount[] {
  return RANK_ORDER.map((level) => ({
    level,
    count: rows.filter((r) => r.atomicLevel === level).length,
  }));
}

function countKinds(rows: readonly CatalogRow[]): KindCount[] {
  return KIND_ORDER.map((kind) => ({
    kind,
    count: rows.filter((r) => r.kind === kind).length,
  }));
}

/** Flatten a scan slice into the display-ready catalog model. Pure. */
export function buildCatalogModel(
  components: readonly ComponentSummary[],
  opts: CatalogModelOptions,
): CatalogModel {
  const sampleLimit = opts.propSampleLimit ?? DEFAULT_PROP_SAMPLE;
  const rows = components.map((c) => toRow(c, opts.projectRoot, sampleLimit));
  return {
    projectName: projectNameFromRoot(opts.projectRoot),
    framework: opts.framework,
    shownCount: rows.length,
    totalCount: opts.totalCount,
    generatedAtLabel: formatTimestamp(opts.generatedAt),
    groups: groupByDir(rows),
    levelCounts: countLevels(rows),
    kindCounts: countKinds(rows),
  };
}
