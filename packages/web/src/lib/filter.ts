/** Filtering + sorting for the gallery. Low context score first = renders most reliably. */

import type { AtomicLevel, ComponentKind, ComponentSummary } from '../api/types.js';

export interface FilterState {
  query: string;
  ranks: AtomicLevel[];
  kinds: ComponentKind[];
  presentationalOnly: boolean;
  /** Show only reusable design components (atoms/molecules/organisms), hiding
   *  full pages (route-level `~Page`/`~Screen`/`~View` compositions). Default
   *  on: pages are app-specific, not part of a design system, and mixing them
   *  into the catalogue is what makes it confusing. */
  designOnly: boolean;
}

export const DEFAULT_FILTERS: FilterState = {
  query: '',
  ranks: [],
  kinds: [],
  presentationalOnly: false,
  designOnly: true,
};

/**
 * Name + path + prop names. Prop names are the best discriminator when you
 * don't know what a component is called: "onClose" finds the Dialog you had
 * been searching for as "Modal".
 */
function haystack(c: ComponentSummary): string {
  const propNames = c.propModel.props.map((p) => p.name).join(' ');
  return `${c.descriptor.name} ${c.descriptor.filePath} ${propNames}`.toLowerCase();
}

export function applyFilters(
  components: readonly ComponentSummary[],
  f: FilterState,
): ComponentSummary[] {
  const q = f.query.trim().toLowerCase();
  return components
    .filter((c) => {
      if (f.designOnly && c.classification.atomicLevel === 'page') return false;
      if (f.presentationalOnly && c.classification.kind !== 'presentational') return false;
      if (f.ranks.length && !f.ranks.includes(c.classification.atomicLevel)) return false;
      if (f.kinds.length && !f.kinds.includes(c.classification.kind)) return false;
      if (q && !haystack(c).includes(q)) return false;
      return true;
    })
    .slice()
    .sort(
      (a, b) =>
        a.classification.contextDependencyScore - b.classification.contextDependencyScore ||
        a.descriptor.name.localeCompare(b.descriptor.name),
    );
}

export function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}
