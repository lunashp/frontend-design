import { describe, it, expect } from 'vitest';
import { isColor, isSingleLength, normalizeColor } from '../../src/tokenize/color.js';

describe('isColor', () => {
  it('accepts every CSS color notation', () => {
    for (const v of ['#fff', '#3b82f6', 'rgb(1,2,3)', 'hsl(210 100% 50%)', 'red', 'transparent']) {
      expect(isColor(v)).toBe(true);
    }
  });

  it('accepts the modern color functions and the level-4 named colors', () => {
    for (const v of [
      '#7367F0',
      '#0000007f',
      'rgba(0,0,0,.5)',
      'hsl(210 100% 50% / 40%)',
      'hwb(210 20% 30%)',
      'lab(50% 40 59.5)',
      'lch(50% 40 30)',
      'oklab(0.5 0.1 0.1)',
      'oklch(0.7 0.1 250)',
      'color(display-p3 1 0 0)',
      'rebeccapurple',
      'currentcolor',
    ]) {
      expect(isColor(v)).toBe(true);
    }
  });

  it('rejects non-colors', () => {
    for (const v of ['8px', 'inherit', '1px solid #000', 'system-ui', '']) {
      expect(isColor(v)).toBe(false);
    }
  });

  // E-color: culori's `parse` accepts hex WITHOUT a '#', so a font weight, a
  // z-index or any three/six-letter word came back as a color.
  it('rejects a bare token that merely happens to be valid hex without a #', () => {
    for (const v of ['700', '1000', 'abc', 'fff', 'dad', 'beef', '0080ff']) {
      expect(isColor(v)).toBe(false);
    }
  });

  it('rejects a malformed value that has color shape but no valid arguments', () => {
    for (const v of ['#12345', '#nothex', 'rgb(nope)']) {
      expect(isColor(v)).toBe(false);
    }
  });
});

describe('normalizeColor', () => {
  it('emits hex6 while opaque', () => {
    expect(normalizeColor('#3b82f6')).toBe('#3b82f6');
    expect(normalizeColor(' RED ')).toBe('#ff0000');
    expect(normalizeColor('rgba(59, 130, 246, 1)')).toBe('#3b82f6');
  });

  it('emits hex8 once alpha drops below 1', () => {
    // Previously both of these collapsed to #000000, and the :root default beat
    // the var() fallback — so a copied overlay rendered solid black.
    expect(normalizeColor('rgba(0, 0, 0, 0.5)')).toBe('#00000080');
    expect(normalizeColor('hsl(210 100% 50% / 40%)')).toBe('#0080ff66');
  });

  it('keeps `transparent` verbatim', () => {
    expect(normalizeColor('transparent')).toBe('transparent');
    expect(normalizeColor('TRANSPARENT')).toBe('transparent');
  });

  it('returns null for a non-color', () => {
    expect(normalizeColor('12px')).toBeNull();
  });

  // E-color: these used to normalize to #770000 / #11000000 / #aabbcc and were
  // written back over the author's declaration.
  it('returns null for a value that is not written as a color', () => {
    expect(normalizeColor('700')).toBeNull();
    expect(normalizeColor('1000')).toBeNull();
    expect(normalizeColor('abc')).toBeNull();
  });

  it('returns null for `currentcolor`, which is contextual rather than literal', () => {
    expect(normalizeColor('currentcolor')).toBeNull();
  });
});

describe('isSingleLength', () => {
  it('accepts one length, rejects shorthands and keywords', () => {
    expect(isSingleLength('10px')).toBe(true);
    expect(isSingleLength('-0.5rem')).toBe(true);
    expect(isSingleLength('50%')).toBe(true);
    expect(isSingleLength('10px 16px')).toBe(false);
    expect(isSingleLength('auto')).toBe(false);
  });
});
