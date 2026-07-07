/** Map a CSS property to a token category. */

import type { TokenCategory } from '../types/token-model.js';

const COLOR_PROP =
  /^(color|background|background-color|border(-top|-right|-bottom|-left)?-color|outline-color|fill|stroke|caret-color|accent-color)$/;
const RADIUS_PROP = /border-radius$/;
const FONT_SIZE_PROP = /^font-size$/;
const SIZE_PROP = /^(width|height|min-width|min-height|max-width|max-height)$/;
const SPACING_PROP = /^(gap|row-gap|column-gap)$/;
const SHADOW_PROP = /^(box-shadow|text-shadow)$/;

export function categoryFor(property: string): TokenCategory {
  const p = property.toLowerCase();
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
