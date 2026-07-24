/**
 * A large synthetic collection for the virtualization harness. Plain data (no
 * DOM, no Node) so the harness and the spec can share the exact count and the
 * last card's marker name — the spec proves the LAST of N is reachable only if it
 * knows which name to look for.
 */

import type {
  AtomicLevel,
  ComponentKind,
  ComponentSummary,
} from '../src/api/types.js';

export const GALLERY_ITEM_COUNT = 1000;

/** The last card's name — distinctive so the spec can assert it appears only after a scroll. */
export const LAST_CARD_MARKER = 'ZzLastCardMarker';

const LEVELS: readonly AtomicLevel[] = ['atom', 'molecule', 'organism'];
const KINDS: readonly ComponentKind[] = ['presentational', 'container', 'layout'];

function makeComponent(index: number): ComponentSummary {
  const isLast = index === GALLERY_ITEM_COUNT - 1;
  // Every fourth name is long, to exercise the two-line clamp that keeps card
  // heights uniform — the invariant the fixed-row windowing depends on.
  const base = isLast
    ? LAST_CARD_MARKER
    : index % 4 === 0
      ? `VeryLongDescriptiveComponentName${index}`
      : `Component${index}`;
  const level = LEVELS[index % LEVELS.length] as AtomicLevel;
  const kind = KINDS[index % KINDS.length] as ComponentKind;
  const propNames = Array.from({ length: index % 5 }, (_, p) => `prop${p}`);
  return {
    descriptor: {
      id: `src/components/${base}.tsx::${base}`,
      name: base,
      filePath: `/fixture/src/components/${base}.tsx`,
      exportName: base,
      isDefaultExport: index % 3 === 0,
      loc: { file: `/fixture/src/components/${base}.tsx`, line: 1, column: 0 },
    },
    classification: {
      atomicLevel: level,
      kind,
      contextDependencyScore: index % 9,
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
      propCount: propNames.length,
    },
    propModel: {
      // A synthetic component declaring its own props: nothing here wraps a
      // library, so every prop is `own` and the own count is the full list.
      props: propNames.map((name) => ({
        name,
        tsType: 'string',
        kind: 'string' as const,
        required: false,
        origin: 'own' as const,
      })),
      ownPropCount: propNames.length,
    },
  };
}

export const GALLERY_COMPONENTS: readonly ComponentSummary[] = Array.from(
  { length: GALLERY_ITEM_COUNT },
  (_, i) => makeComponent(i),
);
