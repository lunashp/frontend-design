/**
 * Groups a component's props so the inspector shows its OWN API first.
 *
 * A MUI wrapper's prop table is 60+ rows of `@types/react` and `@mui/material`
 * surface with the two props the component actually adds buried alphabetically
 * among them. Nothing is dropped — the full contract still matters when porting
 * — but the component's own props come first, and the inherited ones are
 * bucketed by the package that declares them so a reader can tell whose API
 * they are looking at.
 *
 * Pure, so it is unit-tested without a DOM.
 */

import type { PropControl, PropOrigin } from '../../api/types.js';

export interface PropGroup {
  /** Stable identity: `'own'`, `'unknown'`, or the package name. */
  readonly key: string;
  readonly origin: PropOrigin;
  /** Heading text. */
  readonly label: string;
  readonly props: readonly PropControl[];
}

const OWN_KEY = 'own';
const UNKNOWN_KEY = 'unknown';
/** Inherited, but the declaring package could not be named. */
const UNNAMED_PACKAGE_KEY = 'inherited';

function keyOf(prop: PropControl): string {
  if (prop.origin === 'own') return OWN_KEY;
  if (prop.origin === 'unknown') return UNKNOWN_KEY;
  return prop.originPackage ?? UNNAMED_PACKAGE_KEY;
}

function labelOf(key: string, origin: PropOrigin): string {
  if (origin === 'own') return 'Own props';
  // Deliberately not "Other" or "Own": the checker could not place these, and
  // the whole point of the split is that we never guess in favour of "own".
  if (origin === 'unknown') return 'Unclassified';
  return key === UNNAMED_PACKAGE_KEY ? 'Inherited' : key;
}

/** Own API first, then libraries by how much surface each contributes, then unclassified. */
function rank(origin: PropOrigin): number {
  if (origin === 'own') return 0;
  return origin === 'inherited' ? 1 : 2;
}

export function groupPropsByOrigin(props: readonly PropControl[]): readonly PropGroup[] {
  const buckets = new Map<string, { origin: PropOrigin; props: PropControl[] }>();

  for (const prop of props) {
    const key = keyOf(prop);
    const bucket = buckets.get(key);
    if (bucket) bucket.props.push(prop);
    else buckets.set(key, { origin: prop.origin, props: [prop] });
  }

  return [...buckets.entries()]
    .map(([key, { origin, props: grouped }]) => ({
      key,
      origin,
      label: labelOf(key, origin),
      props: grouped as readonly PropControl[],
    }))
    .sort(
      (a, b) =>
        rank(a.origin) - rank(b.origin) ||
        b.props.length - a.props.length ||
        a.key.localeCompare(b.key),
    );
}
