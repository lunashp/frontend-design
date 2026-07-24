/**
 * Public entry for the shared catalog export: scan slice → self-contained HTML.
 *
 * Composes the two pure halves — `buildCatalogModel` (flatten the scan result)
 * and `renderCatalogHtml` (emit the document) — behind one call the button wires
 * up. Kept pure and free of DOM/Blob code so it is fully unit-tested; the only
 * non-pure piece is the button's download click (see download-html.ts).
 */

import type { ComponentSummary } from '../../api/types.js';
import { buildCatalogModel, projectNameFromRoot } from './catalog-model.js';
import { renderCatalogHtml } from './render-catalog.js';

export interface CatalogSource {
  /** Absolute host path — used ONLY to derive the basename + strip file paths. */
  readonly projectRoot: string;
  readonly framework: string;
  /** The components to include — typically the current filtered/shown view. */
  readonly components: readonly ComponentSummary[];
  /** Full scanned design set, for the "showing N of M" header context. */
  readonly totalComponents: number;
  /** Injected for deterministic tests; defaults to now at call time. */
  readonly generatedAt?: Date;
  /** Prop names sampled per row. Default 4. */
  readonly propSampleLimit?: number;
  /** Rendered-thumbnail data URIs by component id, captured before the build.
   *  Inlined into rows; ids without one fall back to the monogram tile. */
  readonly thumbnails?: ReadonlyMap<string, string>;
}

/** Build the complete, self-contained catalog HTML document. Pure. */
export function buildCatalogHtml(source: CatalogSource): string {
  const model = buildCatalogModel(source.components, {
    projectRoot: source.projectRoot,
    framework: source.framework,
    totalCount: source.totalComponents,
    generatedAt: source.generatedAt ?? new Date(),
    propSampleLimit: source.propSampleLimit,
    thumbnails: source.thumbnails,
  });
  return renderCatalogHtml(model);
}

/** Filesystem-safe slug: keep alnums, collapse the rest to single dashes. */
function slugify(value: string): string {
  return (
    value
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'project'
  );
}

/** e.g. `component-catalog-my-app-2026-07-23.html`. */
export function catalogFileName(projectName: string, generatedAt: Date): string {
  const day = generatedAt.toISOString().slice(0, 10);
  return `component-catalog-${slugify(projectName)}-${day}.html`;
}

/** Convenience for the button: the download name from a raw project root. */
export function catalogFileNameForRoot(projectRoot: string, generatedAt: Date): string {
  return catalogFileName(projectNameFromRoot(projectRoot), generatedAt);
}
