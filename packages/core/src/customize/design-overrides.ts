/**
 * Universal design overrides — customize a component's look even when it
 * exposes no design tokens. `emitDesignCss` produces the `#root > *` `!important`
 * form used by a live preview (the web app injects it into the sandbox iframe);
 * `emitDesignRule` produces a copyable, `!important`-free rule for porting whose
 * selector is a PLACEHOLDER — a component's real root class is not knowable from
 * outside (CSS-module hashes, library-generated classes), so a `.Name { … }` rule
 * would match nothing. Pure string logic — no framework or DOM dependency — so it
 * is shared by every consumer (web app, MCP).
 *
 * Interactive states are addressed by prefixing a field id with a state name and
 * a colon — `hover:background`, `focus:borderColor`, `active:scale` — which
 * keeps the transport a flat `Record<string, string>`; a plain unprefixed map
 * still means "the resting state" exactly as before.
 *
 * The web app keeps its own mirror of this module for the browser bundle (which
 * never imports @ce/core); keep the two in sync. `design-overrides-mirror.test`
 * fails when they drift.
 */

export type DesignControlKind = 'range' | 'color' | 'select' | 'text';

export interface DesignOption {
  readonly label: string;
  readonly value: string;
}

export interface DesignField {
  readonly id: string;
  readonly label: string;
  readonly control: DesignControlKind;
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly default?: string;
  readonly placeholder?: string;
  readonly options?: readonly DesignOption[];
}

export interface DesignGroup {
  readonly label: string;
  readonly fields: readonly DesignField[];
}

const WEIGHT_OPTIONS: readonly DesignOption[] = [
  { label: 'Default', value: '' },
  { label: 'Light 300', value: '300' },
  { label: 'Regular 400', value: '400' },
  { label: 'Medium 500', value: '500' },
  { label: 'Semibold 600', value: '600' },
  { label: 'Bold 700', value: '700' },
];

const FONT_OPTIONS: readonly DesignOption[] = [
  { label: 'Default', value: '' },
  { label: 'System sans', value: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Mono', value: 'ui-monospace, "SF Mono", Menlo, monospace' },
  { label: 'Rounded', value: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif' },
];

const SHADOW_OPTIONS: readonly DesignOption[] = [
  { label: 'Default', value: '' },
  { label: 'None', value: 'none' },
  { label: 'Small', value: 'sm' },
  { label: 'Medium', value: 'md' },
  { label: 'Large', value: 'lg' },
  { label: 'X-Large', value: 'xl' },
];

const SHADOW_PRESETS: Record<string, string> = {
  none: 'none',
  sm: '0 1px 2px rgba(15, 23, 42, 0.12)',
  md: '0 4px 12px rgba(15, 23, 42, 0.15)',
  lg: '0 10px 30px rgba(15, 23, 42, 0.18)',
  xl: '0 20px 50px rgba(15, 23, 42, 0.22)',
};

export const DESIGN_GROUPS: readonly DesignGroup[] = [
  {
    label: 'Size',
    fields: [
      { id: 'scale', label: 'Scale', control: 'range', min: 50, max: 200, step: 1, unit: '%', default: '100' },
      { id: 'width', label: 'Width', control: 'text', placeholder: 'auto · 240px · 100%' },
      { id: 'padding', label: 'Padding', control: 'range', min: 0, max: 64, step: 1, unit: 'px' },
    ],
  },
  {
    label: 'Color',
    fields: [
      { id: 'color', label: 'Text', control: 'color' },
      { id: 'background', label: 'Background', control: 'color' },
    ],
  },
  {
    label: 'Typography',
    fields: [
      { id: 'fontSize', label: 'Font size', control: 'range', min: 10, max: 40, step: 1, unit: 'px' },
      { id: 'fontWeight', label: 'Weight', control: 'select', options: WEIGHT_OPTIONS },
      { id: 'fontFamily', label: 'Font', control: 'select', options: FONT_OPTIONS },
    ],
  },
  {
    label: 'Border & shape',
    fields: [
      { id: 'radius', label: 'Radius', control: 'range', min: 0, max: 48, step: 1, unit: 'px' },
      { id: 'borderWidth', label: 'Border width', control: 'range', min: 0, max: 10, step: 1, unit: 'px' },
      { id: 'borderColor', label: 'Border color', control: 'color' },
    ],
  },
  {
    label: 'Effects',
    fields: [
      { id: 'shadow', label: 'Shadow', control: 'select', options: SHADOW_OPTIONS },
      { id: 'opacity', label: 'Opacity', control: 'range', min: 0, max: 100, step: 1, unit: '%', default: '100' },
    ],
  },
];

/** Every legal design-override field id, flattened out of `DESIGN_GROUPS`. */
export const DESIGN_FIELDS: readonly string[] = DESIGN_GROUPS.flatMap((g) =>
  g.fields.map((f) => f.id),
);

/** Interactive states an override map can address, beyond the resting state. */
export type DesignState = 'hover' | 'focus' | 'active';

export const DESIGN_STATES: readonly DesignState[] = ['hover', 'focus', 'active'];

/**
 * Selector suffix per state. `focus` uses `:focus-visible` deliberately — a
 * mouse click should not paint the focus treatment.
 *
 * Caveat, verified in headless Chromium: `:focus-visible` matches only the
 * focused element itself and never propagates to an ancestor, so a `focus:`
 * override paints nothing for a component whose root is a non-focusable wrapper
 * `<div>` — the common shape. Consumers that surface these states to a human
 * must say so; `design-state.ts` in the web app carries that disclosure.
 */
export const DESIGN_STATE_SELECTORS: Readonly<Record<DesignState, string>> = {
  hover: ':hover',
  focus: ':focus-visible',
  active: ':active',
};

/** Separates a state prefix from a field id: `hover:background`. */
export const DESIGN_STATE_SEPARATOR = ':';

const DESIGN_FIELD_SET = new Set<string>(DESIGN_FIELDS);
const DESIGN_STATE_SET = new Set<string>(DESIGN_STATES);

/** The override key addressing `field` in `state` (null state = resting). */
export function designStateKey(state: DesignState | null, field: string): string {
  return state === null ? field : `${state}${DESIGN_STATE_SEPARATOR}${field}`;
}

/** Split `hover:background` into its state and field; a bare id has no state. */
export function parseDesignKey(key: string): { state: DesignState | null; field: string } {
  const at = key.indexOf(DESIGN_STATE_SEPARATOR);
  if (at <= 0) return { state: null, field: key };
  const head = key.slice(0, at);
  if (!DESIGN_STATE_SET.has(head)) return { state: null, field: key };
  return { state: head as DesignState, field: key.slice(at + 1) };
}

/** True when `key` names a real design field, with or without a state prefix. */
export function isDesignKey(key: string): boolean {
  return DESIGN_FIELD_SET.has(parseDesignKey(key).field);
}

/** Partition a flat override map into its resting map and its per-state maps. */
export function splitDesignOverrides(overrides: Readonly<Record<string, string>> = {}): {
  base: Record<string, string>;
  states: Partial<Record<DesignState, Record<string, string>>>;
} {
  const base: Record<string, string> = {};
  const states: Partial<Record<DesignState, Record<string, string>>> = {};
  for (const [key, value] of Object.entries(overrides)) {
    const { state, field } = parseDesignKey(key);
    if (state === null) {
      base[field] = value;
      continue;
    }
    const bucket = states[state] ?? {};
    bucket[field] = value;
    states[state] = bucket;
  }
  return { base, states };
}

const IMPORTANT = ' !important';

/**
 * `scale` and `opacity` are percentages whose 100 means "unchanged". Emitting
 * `transform: scale(1) !important` at 100 would wipe out whatever transform the
 * component sets for itself, so the identity value is elided.
 */
const IDENTITY_PERCENT = 100;

/**
 * What `field` already is in the resting state — the baseline a state block is
 * measured against. Unset or blank means the resting state carries no override
 * of its own, so the baseline is the identity.
 */
function restingPercent(resting: Readonly<Record<string, string>>, field: string): number {
  const raw = resting[field];
  return raw === undefined || raw === '' ? IDENTITY_PERCENT : Number(raw);
}

/**
 * Build the list of CSS declarations for the set overrides (each with !important).
 *
 * `resting` is the resting-state map a state block sits on top of, and it exists
 * for one reason: the identity elision above has to be RELATIVE. Measured
 * absolutely, `hover:scale = 100` emitted nothing, so "enlarged at rest, normal
 * on hover" could not be authored and the Hover tab's Scale slider silently did
 * nothing at exactly the value it renders at. Left at its default `{}`, every
 * baseline is the identity and the resting state behaves exactly as before.
 */
export function emitDesignDeclarations(
  overrides: Readonly<Record<string, string>> = {},
  resting: Readonly<Record<string, string>> = {},
): string[] {
  const o = overrides;
  const has = (k: string) => o[k] !== undefined && o[k] !== '';
  const n = (k: string) => Number(o[k]);
  const d: string[] = [];

  if (has('scale') && n('scale') !== restingPercent(resting, 'scale')) {
    d.push(`transform: scale(${n('scale') / 100})${IMPORTANT}`);
    d.push(`transform-origin: top left${IMPORTANT}`);
  }
  if (has('width')) d.push(`width: ${o.width}${IMPORTANT}`);
  if (has('padding')) d.push(`padding: ${n('padding')}px${IMPORTANT}`);
  if (has('color')) d.push(`color: ${o.color}${IMPORTANT}`);
  if (has('background')) d.push(`background: ${o.background}${IMPORTANT}`);
  if (has('fontSize')) d.push(`font-size: ${n('fontSize')}px${IMPORTANT}`);
  if (has('fontWeight')) d.push(`font-weight: ${o.fontWeight}${IMPORTANT}`);
  if (has('fontFamily')) d.push(`font-family: ${o.fontFamily}${IMPORTANT}`);
  if (has('radius')) d.push(`border-radius: ${n('radius')}px${IMPORTANT}`);

  const bw = has('borderWidth');
  const bc = has('borderColor');
  if (bw && n('borderWidth') === 0) {
    d.push(`border: none${IMPORTANT}`);
  } else if (bw || bc) {
    d.push(`border-style: solid${IMPORTANT}`);
    d.push(`border-width: ${bw ? n('borderWidth') : 1}px${IMPORTANT}`);
    d.push(`border-color: ${bc ? o.borderColor : 'currentColor'}${IMPORTANT}`);
  }

  if (has('shadow')) {
    const sv = o.shadow ?? '';
    d.push(`box-shadow: ${SHADOW_PRESETS[sv] ?? sv}${IMPORTANT}`);
  }
  if (has('opacity') && n('opacity') !== restingPercent(resting, 'opacity')) {
    d.push(`opacity: ${n('opacity') / 100}${IMPORTANT}`);
  }

  return d;
}

/** One emitted rule: which state it paints, and the declarations it carries. */
export interface DesignBlock {
  /** null for the resting state. */
  readonly state: DesignState | null;
  /** Suffix to append to the target selector (empty for the resting state). */
  readonly selectorSuffix: string;
  readonly declarations: readonly string[];
}

/**
 * The rules an override map implies: the resting block first, then one block
 * per interactive state that has any override. Empty blocks are dropped, so this
 * — not the presence of a key — is the only honest answer to "does this override
 * map paint anything in state X?".
 *
 * Each state block is emitted against the resting map, so a state value that
 * merely restores the resting value drops out while one that returns the
 * component to its natural size/opacity is kept.
 */
export function emitDesignBlocks(overrides: Readonly<Record<string, string>> = {}): DesignBlock[] {
  const { base, states } = splitDesignOverrides(overrides);
  const blocks: DesignBlock[] = [];
  const baseDeclarations = emitDesignDeclarations(base);
  if (baseDeclarations.length > 0) {
    blocks.push({ state: null, selectorSuffix: '', declarations: baseDeclarations });
  }
  // A state declaration byte-identical to the resting one paints nothing — the
  // resting rule already sets it. `scale` and `opacity` carry an identity value
  // the emitter recognises per field; the other eleven do not, so only comparing
  // the emitted blocks catches them. It matters because the state sliders start
  // at the resting value: "drag it and put it back" would otherwise leave a dead
  // `:hover` rule, and a dead rule still lights the "has overrides" dot.
  const restingDeclarations = new Set(baseDeclarations);
  for (const state of DESIGN_STATES) {
    const declarations = emitDesignDeclarations(states[state] ?? {}, base).filter(
      (d) => !restingDeclarations.has(d),
    );
    if (declarations.length === 0) continue;
    blocks.push({ state, selectorSuffix: DESIGN_STATE_SELECTORS[state], declarations });
  }
  return blocks;
}

/**
 * Inline declaration string for injecting into `#root > * { … }` in a preview.
 * Resting state only — a preview that wants hover/focus/active needs whole
 * rules, so it uses `emitDesignStyleSheet` instead.
 */
export function emitDesignCss(overrides: Readonly<Record<string, string>> = {}): string {
  const d = emitDesignDeclarations(overrides);
  return d.length ? `${d.join('; ')};` : '';
}

/**
 * A complete preview stylesheet: the resting rule plus one rule per interactive
 * state, all `!important` so they win over the component's own styling.
 */
export function emitDesignStyleSheet(
  overrides: Readonly<Record<string, string>> = {},
  selector = '#root > *',
): string {
  return emitDesignBlocks(overrides)
    .map((b) => `${selector}${b.selectorSuffix} { ${b.declarations.join('; ')}; }`)
    .join('\n');
}

/**
 * The copyable rule's selector is a PLACEHOLDER. A component's real root class
 * cannot be known from outside — CSS-module names are hashed at build time and
 * library components (MUI, …) generate their own — so a literal `.Button { … }`
 * rule would silently match nothing wherever it is pasted. The component name
 * still labels the comment so the reader knows which component it came from.
 */
const ROOT_CLASS_PLACEHOLDER = '.your-root-class';

/** A copyable, human-readable CSS rule (no !important) for the component's root. */
export function emitDesignRule(name: string, overrides: Readonly<Record<string, string>> = {}): string {
  const blocks = emitDesignBlocks(overrides);
  if (blocks.length === 0) return '';
  const rules = blocks.map((b) => {
    const body = b.declarations.map((decl) => `  ${decl.replace(IMPORTANT, '')};`).join('\n');
    return `${ROOT_CLASS_PLACEHOLDER}${b.selectorSuffix} {\n${body}\n}`;
  });
  return (
    `/* Design overrides for ${name}. Apply to the component's ROOT element.\n` +
    `   ${ROOT_CLASS_PLACEHOLDER} is a PLACEHOLDER — the real root class is not\n` +
    `   knowable from outside (CSS-module hashes, library-generated classes).\n` +
    `   Replace it with the component's actual root class. */\n` +
    `${rules.join('\n\n')}\n`
  );
}
