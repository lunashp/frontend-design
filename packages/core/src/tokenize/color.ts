/** Color + length detection/normalization built on culori. */

import { parse, formatHex } from 'culori';

/** True when the value parses as a CSS color (hex, rgb, hsl, named, …). */
export function isColor(value: string): boolean {
  return parse(value.trim()) !== undefined;
}

/** Normalize a color to hex for de-duplication; null if not a color. */
export function normalizeColor(value: string): string | null {
  const parsed = parse(value.trim());
  if (!parsed) return null;
  return formatHex(parsed) ?? null;
}

const SINGLE_LENGTH = /^-?[\d.]+(px|rem|em|vh|vw|%)$/;

/** True for a single length value (not a multi-value shorthand like `10px 16px`). */
export function isSingleLength(value: string): boolean {
  return SINGLE_LENGTH.test(value.trim());
}
