/**
 * The state dimension of the design controls: one flat override map addresses
 * the resting state *and* hover / focus-visible / active (`hover:background`).
 *
 * Everything that maps a control onto an override key lives here rather than
 * inline in `DesignControls`. The state prefix is the whole mechanism that makes
 * hover/focus/active authorable, and while it was one inline expression in the
 * component, reverting it to a bare `field.id` turned the tab strip into pure
 * decoration with the entire web suite still green.
 */

import {
  DESIGN_STATES,
  DESIGN_STATE_SELECTORS,
  designStateKey,
  emitDesignBlocks,
  type DesignField,
  type DesignState,
} from '../../lib/design-overrides.js';

export interface DesignStateTab {
  /** null is the resting state — a bare, unprefixed field id. */
  readonly state: DesignState | null;
  readonly label: string;
  /** The selector this tab paints, spelled out so `focus` isn't read as `:focus`. */
  readonly title: string;
}

const STATE_LABEL: Readonly<Record<DesignState, string>> = {
  hover: 'Hover',
  focus: 'Focus',
  active: 'Active',
};

export const DESIGN_STATE_TABS: readonly DesignStateTab[] = [
  { state: null, label: 'Rest', title: 'The component at rest' },
  ...DESIGN_STATES.map((state) => ({
    state,
    label: STATE_LABEL[state],
    title: `Applied on ${DESIGN_STATE_SELECTORS[state]}`,
  })),
];

declare const designOverrideKeyBrand: unique symbol;

/**
 * A key into the design-override map. Branded so it can only be produced by
 * `designFieldBindings` below: a control handed a hand-built `string` is how the
 * state prefix went missing unnoticed in the first place, and the brand turns
 * that mistake into a compile error instead of a silently inert tab strip.
 */
export type DesignOverrideKey = string & { readonly [designOverrideKeyBrand]: true };

/** One design control wired to the state currently being edited. */
export interface DesignFieldBinding {
  readonly field: DesignField;
  /** The override-map key this control reads and writes. */
  readonly key: DesignOverrideKey;
  /** The stored value, `''` when this field is unset in this state. */
  readonly value: string;
  /**
   * What a control with no value of its own effectively shows. On a state tab
   * that is the resting value it inherits — parked at the field default instead,
   * the Hover tab rendered Scale at 100 while the component rested at 120, so
   * the slider's own starting position was a lie.
   */
  readonly inherited: string;
}

/** Where a range control sits when neither this state nor the resting state set it. */
function fieldDefault(field: DesignField): string {
  return field.default ?? String(field.min ?? 0);
}

/**
 * Bind `fields` to `state`: the key each control reads and writes, its stored
 * value, and the value it inherits when unset. The single place a design
 * override key is built.
 */
export function designFieldBindings(
  state: DesignState | null,
  fields: readonly DesignField[],
  overrides: Readonly<Record<string, string>>,
): readonly DesignFieldBinding[] {
  return fields.map((field) => {
    const key = designStateKey(state, field.id) as DesignOverrideKey;
    const resting = state === null ? '' : (overrides[field.id] ?? '');
    return {
      field,
      key,
      value: overrides[key] ?? '',
      inherited: resting === '' ? fieldDefault(field) : resting,
    };
  });
}

/**
 * Which states have at least one override that actually emits CSS.
 *
 * Derived from the emitter rather than from key presence, because the two
 * disagree: no-op values are elided. Dragging the Hover tab's Scale slider to
 * 120 and back to 100 stores `hover:scale: '100'` for good — `CustomizePane`
 * drops a key only on `''` — and a marker read off key presence then advertised
 * a state that paints nothing, permanently.
 */
export function statesWithOverrides(
  overrides: Readonly<Record<string, string>> = {},
): ReadonlySet<DesignState | null> {
  return new Set(emitDesignBlocks(overrides).map((block) => block.state));
}

/**
 * Verified in headless Chromium: `:focus-visible` matches the focused element
 * itself and never propagates to an ancestor, so in the SHIPPED CSS a focus
 * override only applies when the component's own root is focusable (a wrapper
 * `<div>` never receives it). The preview sidesteps that — it FORCES the focus
 * styling visible while the tab is being edited, so the controls are never inert
 * — but the caveat stays, honestly, about where the copied CSS will and won't
 * take effect in the user's app.
 */
export const FOCUS_ROOT_CAVEAT =
  'Shown forced here so you can style it. In your app it applies only when the ' +
  'component’s own root is focusable (a button, input, or link) — :focus-visible ' +
  'does not reach a wrapper element around it.';

/** The caveat a state carries, or null when it behaves exactly as advertised. */
export function designStateCaveat(state: DesignState | null): string | null {
  return state === 'focus' ? FOCUS_ROOT_CAVEAT : null;
}
