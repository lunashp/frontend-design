/** Filtering + sorting for the gallery. Low context score first = renders most reliably. */

import type { AtomicLevel, ComponentKind, ComponentSummary } from '../api/types.js';
import { isDesignArea, relativeDir, relativePath, sourceArea } from './source-area.js';

/**
 * Result ordering. `reliability` leads with the most isolable components (lowest
 * context score) — the ones that render cleanest. `mostUsed` leads with the most
 * imported — the real design component in a duplicate-name cluster. Usage counts
 * imports from analyzed source only (stories/tests are excluded from the scan),
 * so it is a rank signal, never a way to hide anything.
 */
export type SortOrder = 'reliability' | 'mostUsed';

export interface FilterState {
  query: string;
  ranks: AtomicLevel[];
  kinds: ComponentKind[];
  presentationalOnly: boolean;
  sort: SortOrder;
  /** Show only genuine design components, hiding the categories that dominate a
   *  real scan as noise: SVG icons, route/page compositions, and app
   *  infrastructure (HOCs, providers, style wrappers). Measured on a 192-component
   *  MUI target, this is what separates the ~90 reusable UI pieces under
   *  `components/…` from the ~100 icons/page-widgets/wrappers. Kind alone cannot:
   *  an icon and a Button are both presentational atoms. Reversible — one click
   *  off shows everything, and the directory facet always exposes every area. */
  designOnly: boolean;
  /** When set, show only components whose directory is, or sits under, this one
   *  (the directory facet). The most precise filter — the author's own layout. */
  dir: string | null;
}

export const DEFAULT_FILTERS: FilterState = {
  query: '',
  ranks: [],
  kinds: [],
  presentationalOnly: false,
  sort: 'reliability',
  designOnly: true,
  dir: null,
};

/** Imports from analyzed source; absent on hand-built summaries, so default to 0. */
function usedBy(c: ComponentSummary): number {
  return c.usage?.usedByCount ?? 0;
}

/**
 * Name + path + prop names + the signals behind the classification. Prop names
 * are the best discriminator when you don't know what a component is called:
 * "onClose" finds the Dialog you had been searching for as "Modal". Hooks and
 * consumed contexts answer the other question — "what here touches auth?" —
 * which is otherwise unanswerable from the gallery even though the scan already
 * knows: searching "useSession" or "ThemeContext" is how you find every
 * component that would need that provider stubbed.
 */
function haystack(c: ComponentSummary): string {
  const propNames = c.propModel.props.map((p) => p.name).join(' ');
  const signals = [...c.signals.hookNames, ...c.signals.contextConsumers].join(' ');
  return `${c.descriptor.name} ${c.descriptor.filePath} ${propNames} ${signals}`.toLowerCase();
}

/** True when `dir` is the component's directory or an ancestor of it. */
function underDir(componentDir: string, dir: string): boolean {
  return componentDir === dir || componentDir.startsWith(`${dir}/`);
}

export function applyFilters(
  components: readonly ComponentSummary[],
  f: FilterState,
  projectRoot = '',
): ComponentSummary[] {
  const q = f.query.trim().toLowerCase();
  return components
    .filter((c) => {
      const relPath = relativePath(projectRoot, c.descriptor.filePath);
      if (f.designOnly) {
        // A name-based page (`~Page`) OR a directory that reads as icons / route
        // compositions / app infrastructure — both are noise, not a design system.
        if (c.classification.atomicLevel === 'page') return false;
        if (!isDesignArea(sourceArea(relPath))) return false;
      }
      if (f.dir && !underDir(relativeDir(projectRoot, c.descriptor.filePath), f.dir)) return false;
      if (f.presentationalOnly && c.classification.kind !== 'presentational') return false;
      if (f.ranks.length && !f.ranks.includes(c.classification.atomicLevel)) return false;
      if (f.kinds.length && !f.kinds.includes(c.classification.kind)) return false;
      if (q && !haystack(c).includes(q)) return false;
      return true;
    })
    .slice()
    .sort((a, b) =>
      f.sort === 'mostUsed'
        ? // Most-imported first; ties fall to the more isolable, then name.
          usedBy(b) - usedBy(a) ||
          a.classification.contextDependencyScore - b.classification.contextDependencyScore ||
          a.descriptor.name.localeCompare(b.descriptor.name)
        : // Reliability: most isolable first, then the more-used one — the
          // tie-break that surfaces the canonical member of a duplicate-name
          // cluster — then name.
          a.classification.contextDependencyScore - b.classification.contextDependencyScore ||
          usedBy(b) - usedBy(a) ||
          a.descriptor.name.localeCompare(b.descriptor.name),
    );
}

export function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}
