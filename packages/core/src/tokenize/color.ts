/** Color + length detection/normalization built on culori. */

import { parse, formatHex, formatHex8, colorsNamed } from 'culori';

// culori's `parse` accepts hex WITHOUT a leading '#', so `700`, `1000` and `abc`
// all came back as colors. That is not a cosmetic misclassification: a `--*`
// declaration classified as 'color' is REMOVED from the author's stylesheet and
// re-emitted through normalizeColor, so a :root layer of font weights, z-indexes
// and unitless line-heights was silently rewritten into bogus hex. Detection
// therefore demands the value be WRITTEN as a color, not merely parseable as one.
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
// Only what culori 4 actually parses. `color-mix()` is deliberately absent — culori
// returns undefined for it, so accepting it here would mint a "color" that
// normalizeColor cannot normalize.
const COLOR_FUNCTION = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
// Colors to CSS but missing from culori's named table: `transparent` is parseable,
// `currentcolor` is not (see normalizeColor).
const COLOR_KEYWORD = /^(?:transparent|currentcolor)$/i;

/**
 * True when the value is WRITTEN as a CSS color: `#`-prefixed hex, a color
 * function culori supports, a CSS named color, `transparent` or `currentcolor`.
 *
 * Shape is checked before culori, not instead of it — the shape test rules out
 * bare hex, culori still rejects malformed arguments (`#12345`, `rgb(nope)`).
 */
export function isColor(value: string): boolean {
  const trimmed = value.trim();
  if (COLOR_KEYWORD.test(trimmed)) return true;
  const written =
    HEX.test(trimmed) ||
    COLOR_FUNCTION.test(trimmed) ||
    Object.hasOwn(colorsNamed, trimmed.toLowerCase());
  return written && parse(trimmed) !== undefined;
}

/**
 * Normalize a color for de-duplication; null if not a color.
 *
 * `currentcolor` lands here as null on purpose: it passes isColor (it is written
 * as a color, and a shadow may end with it) but resolves against the element's
 * `color`, so there is no literal to freeze into a token.
 *
 * Alpha is PART of the value: `formatHex` alone collapses `transparent` and
 * `rgba(0,0,0,.5)` to `#000000`, and because the emitted `:root` default wins
 * over the `var(--token, <fallback>)` literal, a copied overlay would render
 * solid black in the user's project. So: hex6 while opaque, hex8 once alpha
 * drops below 1. Keeping hex6 for opaque values confines the token-id churn
 * (ids hash the normalized value) to alpha-bearing colors only.
 */
export function normalizeColor(value: string): string | null {
  const trimmed = value.trim();
  if (!isColor(trimmed)) return null;
  // `transparent` is kept verbatim rather than emitted as `#00000000`: it is the
  // author's intent, it reads far better in the token table, and it round-trips
  // through every CSS context (including gradient interpolation).
  if (trimmed.toLowerCase() === 'transparent') return 'transparent';
  const parsed = parse(trimmed);
  if (!parsed) return null;
  const alpha = parsed.alpha ?? 1;
  return (alpha < 1 ? formatHex8(parsed) : formatHex(parsed)) ?? null;
}

const SINGLE_LENGTH = /^-?[\d.]+(px|rem|em|vh|vw|%)$/;

/** True for a single length value (not a multi-value shorthand like `10px 16px`). */
export function isSingleLength(value: string): boolean {
  return SINGLE_LENGTH.test(value.trim());
}
