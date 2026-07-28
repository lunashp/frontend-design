/**
 * `packages/web/src/lib/design-overrides.ts` is a hand-maintained mirror of the
 * engine's `design-overrides.ts`: the browser bundle never imports @ce/core, so
 * the two files are copies that drift the moment one side gains a field. This
 * test compares what actually matters — the field list, the state vocabulary and
 * the emitted CSS — rather than the file text, so formatting or doc-comment
 * differences (the headers legitimately differ) never fail it.
 */

import { describe, it, expect } from 'vitest';
import * as core from '../../src/customize/design-overrides.js';
import * as mirror from '../../../web/src/lib/design-overrides.js';

/** Every field exercised at once, in both the resting and every state. */
const EVERY_OVERRIDE: Record<string, string> = Object.fromEntries(
  [null, ...core.DESIGN_STATES].flatMap((state) =>
    [
      ['scale', '120'],
      ['width', '240px'],
      ['padding', '12'],
      ['color', '#111111'],
      ['background', '#eeeeee'],
      ['fontSize', '18'],
      ['fontWeight', '600'],
      ['fontFamily', 'Georgia, serif'],
      ['radius', '8'],
      ['borderWidth', '2'],
      ['borderColor', '#ff0000'],
      ['shadow', 'md'],
      ['opacity', '50'],
    ].map(([field, value]) => [
      core.designStateKey(state as core.DesignState | null, field as string),
      value as string,
    ]),
  ),
);

/**
 * State values that differ from the resting ones, so the relative no-op elision
 * (a state `scale`/`opacity` is dropped only when it equals the resting value)
 * is exercised on both sides rather than short-circuited by identical inputs.
 */
const RELATIVE_OVERRIDES: Record<string, string> = {
  scale: '120',
  'hover:scale': '100',
  'focus:scale': '120',
  'active:scale': '80',
  opacity: '50',
  'hover:opacity': '100',
  'active:opacity': '50',
};

describe('web design-overrides mirror', () => {
  it('exposes the same field ids in the same order', () => {
    expect(mirror.DESIGN_FIELDS).toEqual(core.DESIGN_FIELDS);
  });

  it('self-guard: the field list is non-trivial on both sides', () => {
    expect(core.DESIGN_FIELDS.length).toBeGreaterThanOrEqual(13);
    expect(mirror.DESIGN_FIELDS.length).toBeGreaterThanOrEqual(13);
  });

  it('exposes the same control metadata (DESIGN_GROUPS)', () => {
    expect(mirror.DESIGN_GROUPS).toEqual(core.DESIGN_GROUPS);
  });

  it('exposes the same interactive states and selectors', () => {
    expect(mirror.DESIGN_STATES).toEqual(core.DESIGN_STATES);
    expect(mirror.DESIGN_STATE_SELECTORS).toEqual(core.DESIGN_STATE_SELECTORS);
    expect(mirror.DESIGN_STATE_SEPARATOR).toBe(core.DESIGN_STATE_SEPARATOR);
  });

  it('emits byte-identical CSS for every field in every state', () => {
    expect(mirror.emitDesignCss(EVERY_OVERRIDE)).toBe(core.emitDesignCss(EVERY_OVERRIDE));
    expect(mirror.emitDesignStyleSheet(EVERY_OVERRIDE)).toBe(
      core.emitDesignStyleSheet(EVERY_OVERRIDE),
    );
    expect(mirror.emitDesignRule('Card', EVERY_OVERRIDE)).toBe(
      core.emitDesignRule('Card', EVERY_OVERRIDE),
    );
    expect(mirror.emitDesignStyleObject(EVERY_OVERRIDE)).toBe(
      core.emitDesignStyleObject(EVERY_OVERRIDE),
    );
  });

  it('elides state no-ops against the resting value identically on both sides', () => {
    expect(mirror.emitDesignStyleSheet(RELATIVE_OVERRIDES)).toBe(
      core.emitDesignStyleSheet(RELATIVE_OVERRIDES),
    );
    // Self-guard: the fixture must actually reach the relative branch, or this
    // pair would agree on an empty string and prove nothing.
    expect(core.emitDesignStyleSheet(RELATIVE_OVERRIDES)).toContain(
      '#root > *:hover { transform: scale(1) !important',
    );
    expect(core.emitDesignStyleSheet(RELATIVE_OVERRIDES)).not.toContain('#root > *:focus-visible');
  });

  it('emits the placeholder root selector on both sides, never `.Name`', () => {
    // A copyable rule cannot know the component's real root class (CSS-module
    // hashes, library-generated classes), so both halves must emit the shared
    // placeholder — a `.Card { … }` rule would silently match nothing.
    const overrides = { color: '#111', 'hover:color': '#222' };
    for (const rule of [
      core.emitDesignRule('Card', overrides),
      mirror.emitDesignRule('Card', overrides),
    ]) {
      expect(rule).toContain('.your-root-class {');
      expect(rule).toContain('.your-root-class:hover {');
      expect(rule).not.toContain('.Card {');
    }
  });

  it('agrees on which keys are real design fields', () => {
    for (const key of [...Object.keys(EVERY_OVERRIDE), 'borderRadius', 'hover:nope', 'nope:color']) {
      expect(mirror.isDesignKey(key)).toBe(core.isDesignKey(key));
    }
  });
});
