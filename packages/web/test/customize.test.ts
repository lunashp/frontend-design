import { describe, it, expect } from 'vitest';
import {
  emitRootCss,
  emptyTokensReason,
  getCustomization,
  setCustomization,
  isCustomized,
  sortTokensByUsage,
  previewDesignMessage,
  EMPTY_CUSTOMIZATION,
  type CustomizationMap,
} from '../src/lib/customize.js';
import {
  emitDesignCss,
  emitDesignRule,
  DESIGN_GROUPS,
  DESIGN_STATES,
  type DesignField,
  type DesignState,
} from '../src/lib/design-overrides.js';
import {
  DESIGN_STATE_TABS,
  designFieldBindings,
  designStateCaveat,
  statesWithOverrides,
} from '../src/features/customize/design-state.js';
import {
  alphaPercent,
  formatColorValue,
  parseColorValue,
  swatchValue,
  withAlphaPercent,
  withPickedColor,
} from '../src/features/customize/color-value.js';
import type { Token } from '../src/api/types.js';

function token(id: string, name: string, value: string): Token {
  return {
    id,
    name,
    displayName: name,
    category: 'color',
    value,
    fallback: value,
    usages: [],
    source: 'extracted',
  };
}

const TOKENS: Token[] = [token('t1', '--color-1', '#3b82f6'), token('t2', '--radius-1', '8px')];

describe('emitRootCss', () => {
  it('emits :root defaults and applies overrides by token id', () => {
    expect(emitRootCss(TOKENS, {})).toContain('--color-1: #3b82f6;');
    expect(emitRootCss(TOKENS, { t1: '#ff0000' })).toContain('--color-1: #ff0000;');
  });
  it('handles no tokens', () => {
    expect(emitRootCss([], {})).toBe(':root {\n}\n');
  });
});

describe('customization map (survives tab + card switches)', () => {
  it('returns the empty state for an unknown or null id', () => {
    const empty: CustomizationMap = new Map();
    expect(getCustomization(empty, 'nope')).toBe(EMPTY_CUSTOMIZATION);
    expect(getCustomization(empty, null)).toBe(EMPTY_CUSTOMIZATION);
  });

  it('keeps each component’s edits under its own id', () => {
    const a = { ...EMPTY_CUSTOMIZATION, tokenOverrides: { t1: '#f00' } };
    const b = { ...EMPTY_CUSTOMIZATION, propValues: { open: true } };
    const map = setCustomization(setCustomization(new Map(), 'A', a), 'B', b);
    expect(getCustomization(map, 'A')).toEqual(a);
    expect(getCustomization(map, 'B')).toEqual(b);
  });

  it('does not mutate the map it is given', () => {
    const before: CustomizationMap = new Map();
    const after = setCustomization(before, 'A', EMPTY_CUSTOMIZATION);
    expect(before.size).toBe(0);
    expect(after.size).toBe(1);
    expect(after).not.toBe(before);
  });

  it('replaces an existing entry rather than merging it', () => {
    const first = setCustomization(new Map(), 'A', {
      ...EMPTY_CUSTOMIZATION,
      tokenOverrides: { t1: '#f00' },
    });
    const second = setCustomization(first, 'A', EMPTY_CUSTOMIZATION);
    expect(getCustomization(second, 'A').tokenOverrides).toEqual({});
  });
});

describe('isCustomized', () => {
  it('is false for the empty state', () => {
    expect(isCustomized(EMPTY_CUSTOMIZATION)).toBe(false);
  });
  it('is true when any of tokens, props or design are set', () => {
    expect(isCustomized({ ...EMPTY_CUSTOMIZATION, tokenOverrides: { t1: '#f00' } })).toBe(true);
    expect(isCustomized({ ...EMPTY_CUSTOMIZATION, propValues: { open: true } })).toBe(true);
    expect(isCustomized({ ...EMPTY_CUSTOMIZATION, designOverrides: { radius: '8' } })).toBe(true);
  });
  it('tolerates a state predating designOverrides', () => {
    expect(isCustomized({ tokenOverrides: {}, propValues: {} })).toBe(false);
  });
});

describe('sortTokensByUsage', () => {
  const used = (id: string, name: string, count: number): Token => ({
    ...token(id, name, '#000'),
    usages: Array.from({ length: count }, (_, i) => ({
      file: '/src/A.module.css',
      line: i + 1,
      property: 'color',
      selector: '.a',
    })),
  });

  it('puts the most-used tokens first', () => {
    const sorted = sortTokensByUsage([used('a', '--c-1', 1), used('b', '--c-2', 9)]);
    expect(sorted.map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('breaks ties by token name, and does not mutate the input', () => {
    const input = [used('b', '--c-2', 3), used('a', '--c-1', 3)];
    expect(sortTokensByUsage(input).map((t) => t.name)).toEqual(['--c-1', '--c-2']);
    expect(input.map((t) => t.id)).toEqual(['b', 'a']);
  });
});

describe('emitDesignCss (universal design overrides)', () => {
  it('is empty when nothing is set', () => {
    expect(emitDesignCss({})).toBe('');
  });
  it('maps colour and spacing to !important declarations', () => {
    const css = emitDesignCss({ color: '#fff', background: '#000', padding: '12' });
    expect(css).toContain('color: #fff !important;');
    expect(css).toContain('background: #000 !important;');
    expect(css).toContain('padding: 12px !important;');
  });
  it('turns scale into a transform, and skips a no-op scale of 100', () => {
    expect(emitDesignCss({ scale: '120' })).toContain('transform: scale(1.2) !important;');
    expect(emitDesignCss({ scale: '100' })).toBe('');
  });
  it('composes a border from width + colour, and border:none at width 0', () => {
    const css = emitDesignCss({ borderWidth: '2', borderColor: '#f00' });
    expect(css).toContain('border-style: solid !important;');
    expect(css).toContain('border-width: 2px !important;');
    expect(css).toContain('border-color: #f00 !important;');
    expect(emitDesignCss({ borderWidth: '0' })).toContain('border: none !important;');
  });
  it('resolves shadow presets and opacity', () => {
    expect(emitDesignCss({ shadow: 'md' })).toContain('box-shadow: 0 4px 12px');
    expect(emitDesignCss({ opacity: '50' })).toContain('opacity: 0.5 !important;');
    expect(emitDesignCss({ opacity: '100' })).toBe('');
  });
});

// A component's real root class is unknowable from outside — CSS-module hashes,
// library-generated classes — so the copyable `.MyButton { … }` rule the Copy
// button used to hand out silently matched nothing. The rule now targets a
// labelled PLACEHOLDER the reader replaces, matching the MCP side.
describe('emitDesignRule (copyable CSS)', () => {
  it('targets a placeholder root class with an explaining comment, never `.Name`', () => {
    const rule = emitDesignRule('MyButton', { color: '#111', radius: '8' });
    expect(rule).toContain('.your-root-class {');
    expect(rule).not.toContain('.MyButton');
    expect(rule).toContain('PLACEHOLDER');
    expect(rule).toContain('color: #111;');
    expect(rule).toContain('border-radius: 8px;');
    expect(rule).not.toContain('!important');
  });
  it('keeps hover (and every state) on the placeholder selector', () => {
    const rule = emitDesignRule('MyButton', { color: '#111', 'hover:color': '#222' });
    expect(rule).toContain('.your-root-class {\n  color: #111;\n}');
    expect(rule).toContain('.your-root-class:hover {\n  color: #222;\n}');
    expect(rule).not.toContain('.MyButton');
    expect(rule).not.toContain('!important');
  });
  it('is empty when nothing is set', () => {
    expect(emitDesignRule('X', {})).toBe('');
  });
});

// The token panel is hidden when a component exposes no re-themeable tokens; an
// empty area with no explanation reads as a bug. `emptyTokensReason` derives an
// honest sentence from the bundle itself — the synthesized /tokens.css is always
// present, so a *source* stylesheet is any other .css/.scss/… file.
describe('emptyTokensReason (why the token panel is empty)', () => {
  it('says CSS-in-JS / inline when the bundle ships no source stylesheet', () => {
    const reason = emptyTokensReason({ '/Button.tsx': 'x', '/tokens.css': ':root{}' });
    expect(reason).toMatch(/CSS-in-JS|inline/i);
    expect(reason).toMatch(/Design/);
  });

  it('says no custom properties were declared when a source stylesheet exists', () => {
    const reason = emptyTokensReason({
      '/Button.tsx': 'x',
      '/Button.module.css': '.a{}',
      '/tokens.css': ':root{}',
    });
    expect(reason).toMatch(/custom propert/i);
    expect(reason).not.toMatch(/CSS-in-JS/i);
    expect(reason).toMatch(/Design/);
  });

  it('ignores the synthesized /tokens.css when deciding', () => {
    // /tokens.css is our own output and always present; counting it would call
    // every CSS-in-JS component "has a stylesheet" and give the wrong reason.
    expect(emptyTokensReason({ '/tokens.css': ':root{}' })).toMatch(/CSS-in-JS|inline/i);
  });
});

describe('previewDesignMessage (what the preview iframe is actually told)', () => {
  it('sends a whole stylesheet, the only form that can carry hover/focus/active', () => {
    const msg = previewDesignMessage({ background: '#ffffff', 'hover:background': '#000000' });
    expect(msg.type).toBe('ce:design');
    expect(msg.sheet).toContain('#root > * { background: #ffffff !important; }');
    expect(msg.sheet).toContain('#root > *:hover { background: #000000 !important; }');
  });

  it('never sends the legacy `css` field, which the host wraps as resting-only', () => {
    // A `css` payload is spliced into `#root > * { … }`, so a hover override sent
    // that way silently repaints the resting state instead.
    expect(Object.keys(previewDesignMessage({ 'hover:color': '#ff0000' })).sort()).toEqual([
      'sheet',
      'type',
    ]);
  });

  it('sends an empty sheet when nothing is overridden, which clears the layer', () => {
    expect(previewDesignMessage({}).sheet).toBe('');
    expect(previewDesignMessage(undefined).sheet).toBe('');
  });
});

describe('design state tabs', () => {
  it('offers the resting state first, then every interactive state', () => {
    expect(DESIGN_STATE_TABS.map((t) => t.state)).toEqual([null, ...DESIGN_STATES]);
  });

  it('names the selector each tab paints, so `focus` is not mistaken for :focus', () => {
    const focus = DESIGN_STATE_TABS.find((t) => t.state === 'focus');
    expect(focus?.title).toContain(':focus-visible');
  });

  it('reports which states carry an override, so none can be set unseen', () => {
    expect(statesWithOverrides({})).toEqual(new Set());
    expect(statesWithOverrides({ background: '#ffffff' })).toEqual(new Set([null]));
    expect(statesWithOverrides({ 'hover:background': '#000000' })).toEqual(new Set(['hover']));
    expect(statesWithOverrides({ radius: '8', 'active:scale': '90' })).toEqual(
      new Set([null, 'active']),
    );
  });

  it('ignores blank values and unknown fields, which emit no CSS at all', () => {
    expect(statesWithOverrides({ 'hover:background': '' })).toEqual(new Set());
    expect(statesWithOverrides({ 'hover:nonsense': '#000000' })).toEqual(new Set());
  });

  // The marker used to be derived from key PRESENCE, which the emitter does not
  // agree with: it elides no-op values. The Hover tab's Scale slider renders at
  // 100 while unset, so dragging it to 120 and back to 100 stores
  // `hover:scale: '100'` for good (CustomizePane deletes a key only on ''), and
  // the dot plus "(has overrides)" then advertised a state that paints nothing.
  it('does not mark a state whose only override emits no CSS', () => {
    expect(statesWithOverrides({ 'hover:scale': '100' })).toEqual(new Set());
    expect(statesWithOverrides({ 'active:opacity': '100' })).toEqual(new Set());
  });

  it('marks a state whose value differs from the resting one, and only then', () => {
    expect(statesWithOverrides({ scale: '120', 'hover:scale': '100' })).toEqual(
      new Set([null, 'hover']),
    );
    expect(statesWithOverrides({ scale: '120', 'hover:scale': '120' })).toEqual(new Set([null]));
  });

  it('does not mark a state for a no-op in a field with no identity value', () => {
    // The state sliders start at the resting value, so "drag it and put it back"
    // stores exactly the resting value. For the eleven fields without an identity
    // that used to emit a dead `:hover` rule and light the dot forever.
    expect(statesWithOverrides({ radius: '8', 'hover:radius': '8' })).toEqual(new Set([null]));
    expect(statesWithOverrides({ background: '#eee', 'focus:background': '#eee' })).toEqual(
      new Set([null]),
    );
    expect(statesWithOverrides({ radius: '8', 'hover:radius': '12' })).toEqual(
      new Set([null, 'hover']),
    );
  });
});

/**
 * The state prefix is the entire mechanism that makes hover/focus/active
 * authorable. It used to be one inline expression inside DesignControls, so
 * reverting it to a bare `field.id` left the tab strip as pure decoration with
 * every test still green. It lives here now: one seam, directly tested, and the
 * key it produces is branded so a control cannot be handed a hand-built string.
 */
describe('design field bindings (the state selector is the whole feature)', () => {
  const FIELDS: readonly DesignField[] = DESIGN_GROUPS.flatMap((g) => g.fields);
  const field = (id: string): DesignField => {
    const found = FIELDS.find((f) => f.id === id);
    if (!found) throw new Error(`no such design field: ${id}`);
    return found;
  };
  const keyOf = (state: DesignState | null, id: string): string => {
    const [binding] = designFieldBindings(state, [field(id)], {});
    if (!binding) throw new Error('designFieldBindings dropped a field');
    return binding.key;
  };

  it('addresses the resting state with a bare field id', () => {
    expect(keyOf(null, 'radius')).toBe('radius');
  });

  it('prefixes the key of every interactive state', () => {
    expect(DESIGN_STATES.map((s) => keyOf(s, 'radius'))).toEqual([
      'hover:radius',
      'focus:radius',
      'active:radius',
    ]);
  });

  it('reads the value stored under its own key, never the resting one', () => {
    const overrides = { radius: '4', 'hover:radius': '12' };
    const valueIn = (state: DesignState | null): string =>
      designFieldBindings(state, [field('radius')], overrides)[0]?.value ?? 'missing';
    expect(valueIn('hover')).toBe('12');
    expect(valueIn(null)).toBe('4');
    expect(valueIn('active')).toBe('');
  });

  // A slider has to sit somewhere while unset. Parked at the field default it
  // lied: with the component resting at 120%, the Hover tab showed Scale at 100
  // and dragging it to 100 looked like a no-op the user had already made.
  it('shows an unset state slider the resting value it inherits, not the field default', () => {
    const inherited = (state: DesignState | null, o: Record<string, string>): string =>
      designFieldBindings(state, [field('scale')], o)[0]?.inherited ?? 'missing';
    expect(inherited('hover', { scale: '120' })).toBe('120');
    expect(inherited('hover', {})).toBe('100');
    expect(inherited(null, {})).toBe('100');
    expect(inherited('hover', { scale: '' })).toBe('100');
  });

  it('carries the field itself, so no control can be paired with another key', () => {
    const bindings = designFieldBindings('focus', FIELDS, {});
    expect(bindings.map((b) => b.field.id)).toEqual(FIELDS.map((f) => f.id));
    expect(bindings.every((b) => b.key === `focus:${b.field.id}`)).toBe(true);
  });
});

describe('state disclosure (a control that silently does nothing is worse than none)', () => {
  // Verified in headless Chromium: :focus-visible does not propagate to
  // ancestors, so on the common wrapper-<div> root the Focus tab paints nothing.
  it('warns that focus needs a focusable root', () => {
    const caveat = designStateCaveat('focus');
    expect(caveat).toBeTruthy();
    expect(caveat).toMatch(/focusable/i);
  });

  it('has nothing to add for rest, hover or active', () => {
    expect(designStateCaveat(null)).toBeNull();
    expect(designStateCaveat('hover')).toBeNull();
    expect(designStateCaveat('active')).toBeNull();
  });
});

describe('colour values with alpha (the swatch must not eat it)', () => {
  it('splits every hex form into an opaque half plus an alpha byte', () => {
    expect(parseColorValue('#3B82F6')).toEqual({ hex6: '#3b82f6', alpha: 255 });
    expect(parseColorValue('#00000080')).toEqual({ hex6: '#000000', alpha: 0x80 });
    expect(parseColorValue('#abc')).toEqual({ hex6: '#aabbcc', alpha: 255 });
    expect(parseColorValue('#abcd')).toEqual({ hex6: '#aabbcc', alpha: 0xdd });
  });

  it('understands rgb()/rgba() in comma, space and slash syntax', () => {
    expect(parseColorValue('rgba(0, 0, 0, 0.5)')).toEqual({ hex6: '#000000', alpha: 128 });
    expect(parseColorValue('rgb(255 0 0 / 50%)')).toEqual({ hex6: '#ff0000', alpha: 128 });
    expect(parseColorValue('rgb(100%, 0%, 0%)')).toEqual({ hex6: '#ff0000', alpha: 255 });
  });

  it('reads `transparent` as a colour with zero alpha, not as an unknown', () => {
    // The engine emits `transparent` verbatim (core's normalizeColor keeps the
    // author's intent), so the swatch meets it often; treated as unparseable,
    // the first drag would have repainted it fully opaque.
    expect(parseColorValue('transparent')).toEqual({ hex6: '#000000', alpha: 0 });
    expect(withPickedColor('transparent', '#ff0000')).toBe('#ff000000');
  });

  it('returns null for anything it cannot faithfully represent', () => {
    expect(parseColorValue('')).toBeNull();
    expect(parseColorValue('var(--brand)')).toBeNull();
    expect(parseColorValue('#12345')).toBeNull();
    expect(parseColorValue('oklch(70% 0.1 250)')).toBeNull();
  });

  it('formats hex6 while opaque and hex8 once alpha drops, matching the engine', () => {
    expect(formatColorValue({ hex6: '#ff0000', alpha: 255 })).toBe('#ff0000');
    expect(formatColorValue({ hex6: '#ff0000', alpha: 0x80 })).toBe('#ff000080');
    expect(formatColorValue({ hex6: '#ff0000', alpha: 0 })).toBe('#ff000000');
  });

  it('feeds <input type="color"> the opaque half, never the alpha bytes', () => {
    // The element only accepts `#rrggbb`; handed `#00000080` it silently falls
    // back to black — which is exactly how an alpha token read as opaque.
    expect(swatchValue('#00000080', '#888888')).toBe('#000000');
    expect(swatchValue('rgba(255, 0, 0, 0.25)', '#888888')).toBe('#ff0000');
    expect(swatchValue('var(--brand)', '#888888')).toBe('#888888');
    expect(swatchValue('', '#888888')).toBe('#888888');
  });

  it('keeps the alpha the user started with when only the swatch moves', () => {
    expect(withPickedColor('#00000080', '#ff0000')).toBe('#ff000080');
    expect(withPickedColor('rgba(0, 0, 0, 0.5)', '#ff0000')).toBe('#ff000080');
    expect(withPickedColor('#3b82f6', '#ff0000')).toBe('#ff0000');
    // Nothing parseable to preserve: the pick is the whole answer.
    expect(withPickedColor('var(--brand)', '#ff0000')).toBe('#ff0000');
    expect(withPickedColor('', '#ff0000')).toBe('#ff0000');
  });

  it('edits alpha without disturbing the colour, and leaves unparseable values alone', () => {
    expect(withAlphaPercent('#ff0000', 50)).toBe('#ff000080');
    expect(withAlphaPercent('#ff000080', 100)).toBe('#ff0000');
    expect(withAlphaPercent('#ff000080', 0)).toBe('#ff000000');
    expect(withAlphaPercent('var(--brand)', 50)).toBe('var(--brand)');
  });

  it('reports alpha as a whole percentage for display', () => {
    expect(alphaPercent(255)).toBe(100);
    expect(alphaPercent(128)).toBe(50);
    expect(alphaPercent(0)).toBe(0);
  });
});
