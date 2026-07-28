import { describe, it, expect } from 'vitest';
import {
  categoryFor,
  categoryForCustomProperty,
  normalizeProperty,
} from '../../src/tokenize/categorize.js';
import {
  containsVar,
  isCssWideKeyword,
  isFontStack,
  isShadowValue,
  splitTopLevelComma,
  splitTopLevelSpace,
} from '../../src/tokenize/value-shape.js';

describe('categoryFor', () => {
  it('maps the standard themeable properties', () => {
    expect(categoryFor('color')).toBe('color');
    expect(categoryFor('border-top-color')).toBe('color');
    expect(categoryFor('border-radius')).toBe('radius');
    expect(categoryFor('font-size')).toBe('typography');
    expect(categoryFor('max-width')).toBe('size');
    expect(categoryFor('box-shadow')).toBe('shadow');
    expect(categoryFor('display')).toBe('other');
  });

  it('treats padding/margin as spacing, alongside gap', () => {
    for (const p of [
      'gap',
      'row-gap',
      'padding',
      'margin',
      'padding-top',
      'margin-bottom',
      'padding-inline',
      'margin-block-end',
    ]) {
      expect(categoryFor(p)).toBe('spacing');
    }
    // Not spacing: a different property that merely starts the same way.
    expect(categoryFor('padding-box')).toBe('other');
  });

  it('normalizes camelCased property names from style objects', () => {
    expect(normalizeProperty('backgroundColor')).toBe('background-color');
    expect(normalizeProperty('borderTopLeftRadius')).toBe('border-top-left-radius');
    expect(categoryFor('backgroundColor')).toBe('color');
    expect(categoryFor('borderRadius')).toBe('radius');
    expect(categoryFor('paddingInlineStart')).toBe('spacing');
    expect(categoryFor('boxShadow')).toBe('shadow');
  });

  it('refuses to classify a custom property by name (it is case-sensitive)', () => {
    expect(categoryFor('--primary-color')).toBe('other');
    expect(categoryFor('--Brand')).toBe('other');
  });
});

describe('categoryForCustomProperty', () => {
  it('classifies by value', () => {
    expect(categoryForCustomProperty('--primary', '#7367F0')).toBe('color');
    expect(categoryForCustomProperty('--x', 'rgba(0,0,0,.5)')).toBe('color');
    expect(categoryForCustomProperty('--x', 'red')).toBe('color');
    expect(categoryForCustomProperty('--x', 'rebeccapurple')).toBe('color');
    expect(categoryForCustomProperty('--x', 'transparent')).toBe('color');
    expect(categoryForCustomProperty('--x', '0 1px 2px rgba(0,0,0,.1)')).toBe('shadow');
    expect(categoryForCustomProperty('--x', 'system-ui, sans-serif')).toBe('typography');
  });

  // E-color: a value only counts as a color when it is WRITTEN as one. These
  // were classified 'color' — and the transform then rewrote them into hex.
  it('never reads a bare unitless value as a color', () => {
    expect(categoryForCustomProperty('--font-weight-bold', '700')).toBe('other');
    expect(categoryForCustomProperty('--z-index-modal', '1000')).toBe('other');
    expect(categoryForCustomProperty('--tracking', 'abc')).toBe('other');
    expect(categoryForCustomProperty('--opacity-disabled', '0.5')).toBe('other');
  });

  it('uses the name only to pick which length axis a bare length belongs to', () => {
    expect(categoryForCustomProperty('--card-radius', '10px')).toBe('radius');
    expect(categoryForCustomProperty('--grid-gap', '8px')).toBe('spacing');
    expect(categoryForCustomProperty('--body-font-size', '14px')).toBe('typography');
    expect(categoryForCustomProperty('--sidebar-width', '240px')).toBe('size');
  });

  it('returns other for values that are not worth theming', () => {
    expect(categoryForCustomProperty('--transition', 'all 0.2s ease')).toBe('other');
    expect(categoryForCustomProperty('--x', 'inherit')).toBe('other');
    expect(categoryForCustomProperty('--x', '')).toBe('other');
  });
});

describe('value-shape helpers', () => {
  it('splits on top-level separators only', () => {
    expect(splitTopLevelSpace('0 1px 2px rgba(0, 0, 0, .1)')).toEqual([
      '0',
      '1px',
      '2px',
      'rgba(0, 0, 0, .1)',
    ]);
    expect(splitTopLevelComma('system-ui, "Segoe UI", sans-serif')).toEqual([
      'system-ui',
      '"Segoe UI"',
      'sans-serif',
    ]);
  });

  it('detects shadow-shaped values without swallowing length shorthands', () => {
    expect(isShadowValue('0 1px 2px rgba(0,0,0,.1)')).toBe(true);
    expect(isShadowValue('inset 0 0 0 1px')).toBe(true);
    expect(isShadowValue('0 1px 2px #000, 0 4px 8px #111')).toBe(true);
    expect(isShadowValue('0 0 4px currentcolor')).toBe(true);
    expect(isShadowValue('10px 16px 20px')).toBe(false); // padding shorthand
    expect(isShadowValue('1px solid #000')).toBe(false);
    // E-color: a trailing bare number is not a color, so this is not a shadow.
    expect(isShadowValue('0 1px 2px 700')).toBe(false);
    expect(isShadowValue('')).toBe(false);
  });

  it('detects font stacks, not single identifiers', () => {
    expect(isFontStack('system-ui, -apple-system, "Segoe UI", sans-serif')).toBe(true);
    expect(isFontStack('Inter')).toBe(false);
    expect(isFontStack('0 1px 2px #000, 0 4px 8px #111')).toBe(false);
  });

  it('recognizes var() references and CSS-wide keywords', () => {
    expect(containsVar('var(--a)')).toBe(true);
    expect(containsVar('calc(var(--a) * 2)')).toBe(true);
    expect(containsVar('#fff')).toBe(false);
    expect(isCssWideKeyword('inherit')).toBe(true);
    expect(isCssWideKeyword('none')).toBe(true);
    expect(isCssWideKeyword('#fff')).toBe(false);
  });
});
