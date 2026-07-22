/** Map a CSS property — or an author-defined custom property — to a token category. */

import type { TokenCategory } from '../types/token-model.js';
import { isColor, isSingleLength } from './color.js';
import { isCssWideKeyword, isFontStack, isShadowValue } from './value-shape.js';

const COLOR_PROP =
  /^(color|background|background-color|border(-top|-right|-bottom|-left)?-color|outline-color|fill|stroke|caret-color|accent-color)$/;
const RADIUS_PROP = /border-radius$/;
const FONT_SIZE_PROP = /^font-size$/;
const SIZE_PROP = /^(width|height|min-width|min-height|max-width|max-height)$/;
// padding/margin are as re-themeable as gap — including their per-side and
// logical longhands. Omitting them made "re-themeable" only half true.
const SPACING_PROP =
  /^(gap|row-gap|column-gap|(padding|margin)(-(top|right|bottom|left|inline|block)(-(start|end))?)?)$/;
const SHADOW_PROP = /^(box-shadow|text-shadow)$/;

/**
 * `backgroundColor` (style objects) and `background-color` (stylesheets) are the
 * same property; without this, camelCased names fell straight through to 'other'.
 */
export function normalizeProperty(property: string): string {
  return property.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

export function categoryFor(property: string): TokenCategory {
  // A custom property's NAME says nothing about its category, and it is
  // case-sensitive, so it must never go through the normalization below.
  // Classify those by value instead — see categoryForCustomProperty.
  if (property.startsWith('--')) return 'other';
  const p = normalizeProperty(property);
  if (COLOR_PROP.test(p)) return 'color';
  if (RADIUS_PROP.test(p)) return 'radius';
  if (FONT_SIZE_PROP.test(p)) return 'typography';
  if (SIZE_PROP.test(p)) return 'size';
  if (SPACING_PROP.test(p)) return 'spacing';
  if (SHADOW_PROP.test(p)) return 'shadow';
  return 'other';
}

/** Categories we tokenize as single length values. */
export const LENGTH_CATEGORIES = new Set<TokenCategory>(['radius', 'size', 'spacing', 'typography']);

const RADIUS_HINT = /(radius|rounded)/;
const SPACING_HINT = /(gap|space|spacing|padding|margin|inset)/;
const FONT_SIZE_HINT = /(font-?size|text-?size|leading|line-?height)/;
const SHADOW_HINT = /(shadow|elevation)/;

/**
 * Classify an author-defined custom property (`--primary-color: #7367F0`) by
 * its VALUE, falling back to name hints only to tell one length axis from
 * another (a bare `12px` cannot say whether it is a radius or a gap).
 * Returns 'other' for anything not worth theming (aliases, keywords, …).
 */
export function categoryForCustomProperty(name: string, value: string): TokenCategory {
  const v = value.trim();
  if (v === '' || isCssWideKeyword(v)) return 'other';
  const hint = name.toLowerCase();
  if (isColor(v)) return 'color';
  if (SHADOW_HINT.test(hint) || isShadowValue(v)) return 'shadow';
  if (isSingleLength(v)) {
    if (RADIUS_HINT.test(hint)) return 'radius';
    if (FONT_SIZE_HINT.test(hint)) return 'typography';
    if (SPACING_HINT.test(hint)) return 'spacing';
    return 'size';
  }
  if (isFontStack(v)) return 'typography';
  return 'other';
}
