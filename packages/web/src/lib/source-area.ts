/**
 * What KIND OF PLACE a component was filed under, read from its directory.
 *
 * Measured on a real 192-component MUI target: the noise a user wants gone —
 * ~36 SVG icons, 32 dashboard page-widgets, ~30 style wrappers/HOCs — is
 * INDISTINGUISHABLE by classification `kind`: an icon and a Button are both
 * presentational atoms, and most page-widgets are not named `~Page` so the
 * atomic-level regex misses them. The one signal that actually separates "our
 * design system" from the rest is the FOLDER the author chose. So the gallery's
 * "design components only" default and its directory facet are derived here,
 * from the path — not from kind.
 */

import type { ComponentSummary } from '../api/types.js';

export type SourceArea = 'design-system' | 'icons' | 'pages' | 'infra' | 'layout' | 'other';

/** Normalize a path segment for keyword matching: lowercased, `@scope` stripped. */
function normSegment(seg: string): string {
  return seg.replace(/^@/, '').toLowerCase();
}

// Keyword sets are checked against normalized segments. Order of the checks
// below is deliberate — a more specific signal wins over a broader one.
const ICON_SEGMENTS = new Set(['svg', 'svgs', 'icon', 'icons']);
const PAGE_SEGMENTS = new Set(['page', 'pages', 'view', 'views', 'screen', 'screens', 'route', 'routes']);

/**
 * A page-context folder. Beyond the exact words, this catches compounds like
 * `page-components` / `page-sections` — measured on a real target, a component
 * filed under `src/page-components/PromptPage/components/…` is page-scoped, not a
 * reusable design piece, even though a deeper `components/` segment exists.
 */
function isPageSegment(seg: string): boolean {
  return PAGE_SEGMENTS.has(seg) || /^pages?[-_.]/.test(seg) || /[-_.]pages?$/.test(seg);
}
const INFRA_SEGMENTS = new Set([
  'hoc', 'hocs', 'provider', 'providers', 'context', 'contexts',
  'guard', 'guards', 'middleware', 'style', 'styles', 'store', 'stores', 'lib', 'libs',
]);
const DESIGN_SEGMENTS = new Set([
  'ui', 'component', 'components', 'design-system', 'designsystem', 'ds',
  'widget', 'widgets', 'element', 'elements', 'primitive', 'primitives',
]);
const LAYOUT_SEGMENTS = new Set(['layout', 'layouts']);

// Next.js app-router conventions are FILENAMES, not folders: `app/…/page.tsx`
// is a route even though no path segment says "page".
const ROUTE_FILES = new Set(['page', 'template', 'default', 'loading', 'error', 'not-found']);

/**
 * Classify a bundle-relative path into a source area. Icons win first (an
 * `*Icon` file, or anything under an `svg`/`icons` folder, is an icon even inside
 * `ui/`); then page compositions; then app infrastructure; then the design
 * system; then a bare layout shell. `other` when nothing is decisive — kept
 * visible, because hiding a real design component is worse than showing a stray.
 */
export function sourceArea(relPath: string): SourceArea {
  const segments = relPath.split('/').filter(Boolean);
  const file = segments[segments.length - 1] ?? '';
  const dirs = segments.slice(0, -1).map(normSegment);
  const baseName = file.replace(/\.[^.]+$/, '');

  const baseLower = baseName.toLowerCase();
  if (/icon$/i.test(baseName) || dirs.some((d) => ICON_SEGMENTS.has(d))) return 'icons';
  if (baseLower === 'layout') return 'layout';
  if (ROUTE_FILES.has(baseLower) || dirs.some(isPageSegment)) return 'pages';
  if (dirs.some((d) => INFRA_SEGMENTS.has(d))) return 'infra';
  if (dirs.some((d) => DESIGN_SEGMENTS.has(d))) return 'design-system';
  if (dirs.some((d) => LAYOUT_SEGMENTS.has(d))) return 'layout';
  return 'other';
}

const NON_DESIGN: ReadonlySet<SourceArea> = new Set<SourceArea>(['icons', 'pages', 'infra']);

/** True for the areas the "design components only" toggle keeps. Reversible: the
 *  toggle is one click, and the directory facet always shows every area. */
export function isDesignArea(area: SourceArea): boolean {
  return !NON_DESIGN.has(area);
}

/** POSIX directory of `filePath` relative to `projectRoot` (no leading/trailing slash). */
export function relativeDir(projectRoot: string, filePath: string): string {
  const root = projectRoot.replace(/\/+$/, '');
  const rel = filePath.startsWith(`${root}/`) ? filePath.slice(root.length + 1) : filePath;
  const at = rel.lastIndexOf('/');
  return at === -1 ? '' : rel.slice(0, at);
}

/** Bundle-relative path of a component (for area + directory derivation). */
export function relativePath(projectRoot: string, filePath: string): string {
  const root = projectRoot.replace(/\/+$/, '');
  return filePath.startsWith(`${root}/`) ? filePath.slice(root.length + 1) : filePath;
}

export interface DirectoryFacet {
  readonly dir: string;
  readonly count: number;
  readonly area: SourceArea;
}

/**
 * The project's own directories, with a component count and the area each maps
 * to — the user's real structure, offered as a precise filter. This is the
 * highest-precision way to say "just show me shared/ui": it is the author's own
 * layout, not a heuristic.
 */
export function directoryFacets(
  components: readonly ComponentSummary[],
  projectRoot: string,
): DirectoryFacet[] {
  const counts = new Map<string, number>();
  for (const c of components) {
    const dir = relativeDir(projectRoot, c.descriptor.filePath);
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([dir, count]) => ({ dir, count, area: sourceArea(`${dir}/x.tsx`) }))
    .sort((a, b) => b.count - a.count || a.dir.localeCompare(b.dir));
}
