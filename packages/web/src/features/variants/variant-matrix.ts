/**
 * Generates the Storybook-style variant matrix for a component from its prop
 * contract — PURE, so the whole strategy is unit-tested with no DOM.
 *
 * Only ENUMERABLE props produce variants: a select (its `options`) or a boolean
 * (true/false). The full matrix is the cartesian product of those, but that
 * explodes fast (four small props already reach the dozens), so it is hard-capped
 * and a disclosed subset is shown. When capping, we vary the HIGHEST-SIGNAL props
 * first — the ones a designer would reach for (variant/size/color/disabled) —
 * greedily fitting whole props into the cell budget; the rest are "pinned" and
 * omitted from the overrides so the host renders them at one constant default
 * across every cell. Non-enumerable props are never in the overrides at all, so
 * they too stay constant — the matrix isolates exactly the varied dimensions.
 */

import type { PropControl } from '../../api/types.js';

/**
 * Hard ceiling on rendered cells. Most components have far more combinations than
 * anyone wants as live iframes; past this we show a disclosed subset rather than
 * mounting dozens of sandboxes. 16 keeps a 4×4 grid worth of signal.
 */
export const MAX_VARIANT_CELLS = 16;

/**
 * Props whose variation carries the most design signal, highest first. When the
 * full space is over the cap these vary before anything else, so the shown subset
 * is the one a designer would pick by hand rather than an arbitrary prefix.
 */
const SIGNAL_PROPS: readonly string[] = ['variant', 'size', 'color', 'disabled'];

/** One value a varied prop can take, plus the caption fragment naming it. */
interface PropOption {
  readonly value: string | boolean;
  readonly label: string;
}

/** An enumerable prop reduced to its variable values. */
interface EnumProp {
  readonly name: string;
  readonly options: readonly PropOption[];
}

export interface VariantCell {
  /** Stable, unique React key — the encoded combination. */
  readonly key: string;
  /** prop name → value for LocalPreview's `propOverrides`. Varied props only. */
  readonly propOverrides: Readonly<Record<string, string | boolean>>;
  /** Human caption naming the varied prop values, e.g. `variant=outline · size=sm`. */
  readonly caption: string;
}

export interface VariantMatrix {
  readonly cells: readonly VariantCell[];
  /** Combinations in the FULL enumerable space, before capping. */
  readonly total: number;
  /** Cells actually shown (`cells.length`). */
  readonly shown: number;
  /** True when `shown < total` — a disclosed subset. */
  readonly capped: boolean;
  /** Names of the props that vary across the shown cells, in the order used. */
  readonly variedProps: readonly string[];
  /** Enumerable props NOT varied here — held at a constant default (declaration order). */
  readonly pinnedProps: readonly string[];
  /** True when the component has no enumerable props at all. */
  readonly empty: boolean;
}

const EMPTY_MATRIX: VariantMatrix = {
  cells: [],
  total: 0,
  shown: 0,
  capped: false,
  variedProps: [],
  pinnedProps: [],
  empty: true,
};

/**
 * Reduce a prop to its enumerable values, or `null` when it cannot vary. A
 * boolean always yields two values; an enum needs at least two options (a
 * single-option enum has nothing to vary, so it is treated as non-enumerable).
 */
function enumerable(prop: PropControl): EnumProp | null {
  if (prop.kind === 'boolean') {
    return {
      name: prop.name,
      // true reads as the bare prop name (`disabled`); false is spelled out so a
      // caption is never ambiguous about which state it names.
      options: [
        { value: true, label: prop.name },
        { value: false, label: `${prop.name}=false` },
      ],
    };
  }
  if (prop.kind === 'enum' && prop.options && prop.options.length >= 2) {
    return {
      name: prop.name,
      options: prop.options.map((o) => ({ value: o, label: `${prop.name}=${o}` })),
    };
  }
  return null;
}

/** Signal priority: lower is higher priority; non-signal props share the tail. */
function signalRank(name: string): number {
  const i = SIGNAL_PROPS.indexOf(name.toLowerCase());
  return i === -1 ? SIGNAL_PROPS.length : i;
}

/** Cartesian product; empty input yields a single empty combination. */
function cartesian<T>(lists: readonly (readonly T[])[]): T[][] {
  return lists.reduce<T[][]>(
    (acc, list) => acc.flatMap((combo) => list.map((item) => [...combo, item])),
    [[]],
  );
}

export function buildVariantMatrix(
  props: readonly PropControl[],
  cap: number = MAX_VARIANT_CELLS,
): VariantMatrix {
  // Enumerable props in DECLARATION order — the tie-break for "else first-declared".
  const enumProps = props
    .map(enumerable)
    .filter((p): p is EnumProp => p !== null);

  if (enumProps.length === 0) return EMPTY_MATRIX;

  const total = enumProps.reduce((n, p) => n * p.options.length, 1);

  // Priority order: signal props first (in SIGNAL_PROPS order), then declaration
  // order for the rest. Sorting by (rank, declaration index) makes the sort
  // total, so it does not lean on the engine's sort being stable.
  const bySignal = enumProps
    .map((p, i) => ({ p, i }))
    .sort((a, b) => signalRank(a.p.name) - signalRank(b.p.name) || a.i - b.i)
    .map((x) => x.p);

  // Greedily choose which props to VARY so their product stays within the cap.
  // Always vary at least the top-signal prop (its options are sliced below if it
  // alone exceeds the cap); the rest are pinned.
  const varied: EnumProp[] = [];
  let product = 1;
  for (const p of bySignal) {
    const count = p.options.length;
    if (varied.length === 0) {
      varied.push(p);
      product = count;
    } else if (product * count <= cap) {
      varied.push(p);
      product *= count;
    }
  }
  const variedNames = new Set(varied.map((p) => p.name));

  // Cartesian product of the varied options, then a defensive slice (only bites
  // when a single prop's options already exceed the cap).
  const combos = cartesian(
    varied.map((p) => p.options.map((o) => ({ name: p.name, value: o.value, label: o.label }))),
  ).slice(0, cap);

  const cells: VariantCell[] = combos.map((combo) => ({
    key: combo.map((c) => `${c.name}:${String(c.value)}`).join('|'),
    propOverrides: Object.fromEntries(combo.map((c) => [c.name, c.value])),
    caption: combo.map((c) => c.label).join(' · '),
  }));

  return {
    cells,
    total,
    shown: cells.length,
    capped: cells.length < total,
    variedProps: varied.map((p) => p.name),
    pinnedProps: enumProps.filter((p) => !variedNames.has(p.name)).map((p) => p.name),
    empty: false,
  };
}
