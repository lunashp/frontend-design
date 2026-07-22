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
  });

  it('agrees on which keys are real design fields', () => {
    for (const key of [...Object.keys(EVERY_OVERRIDE), 'borderRadius', 'hover:nope', 'nope:color']) {
      expect(mirror.isDesignKey(key)).toBe(core.isDesignKey(key));
    }
  });
});
