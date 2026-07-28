/**
 * Value-shape heuristics: what a CSS *value* looks like, independent of the
 * property it was written against. Property names classify standard
 * declarations; author-defined custom properties (`--brand-bg: #7367F0`) carry
 * no category in their name, so they are classified by these instead.
 */

import { isColor } from './color.js';

/**
 * True when the value references another custom property. Such a value is an
 * alias, not a literal — tokenizing it would either duplicate the alias or,
 * worse, produce a `var()` cycle.
 */
export function containsVar(value: string): boolean {
  return /\bvar\(/i.test(value);
}

const KEYWORD = /^(inherit|initial|unset|revert|revert-layer|none|auto|currentcolor)$/i;

/** True for a CSS-wide keyword or an "unset" sentinel — never a themeable value. */
export function isCssWideKeyword(value: string): boolean {
  return KEYWORD.test(value.trim());
}

/** Collapse internal whitespace so `0  1px   2px` and `0 1px 2px` de-duplicate. */
export function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** Split on a top-level separator; parens (`rgba(0, 0, 0, .1)`) stay intact. */
function splitTopLevel(value: string, separator: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let buffer = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (depth === 0 && (separator === ' ' ? /\s/.test(ch) : ch === separator)) {
      if (buffer.trim()) parts.push(buffer.trim());
      buffer = '';
      continue;
    }
    buffer += ch;
  }
  if (buffer.trim()) parts.push(buffer.trim());
  return parts;
}

/** Space-separated components of a value (`0 1px 2px rgba(0,0,0,.1)`). */
export function splitTopLevelSpace(value: string): readonly string[] {
  return splitTopLevel(value, ' ');
}

/** Comma-separated components of a value (a font stack, a shadow list). */
export function splitTopLevelComma(value: string): readonly string[] {
  return splitTopLevel(value, ',');
}

const LENGTH_PART = /^(0|-?[\d.]+(px|rem|em|vh|vw|%))$/;

/**
 * True for a shadow-shaped value: three or more leading lengths (offset-x,
 * offset-y, blur, …) plus a color or `inset`. The color/`inset` requirement is
 * what keeps a padding shorthand (`10px 16px 20px`) from reading as a shadow.
 */
export function isShadowValue(value: string): boolean {
  const first = splitTopLevelComma(value)[0];
  if (!first) return false;
  const parts = splitTopLevelSpace(first);
  const hasInset = parts.some((p) => p.toLowerCase() === 'inset');
  const lengths = parts.filter((p) => p.toLowerCase() !== 'inset');
  if (lengths.length < 3) return false;
  if (!lengths.slice(0, 3).every((p) => LENGTH_PART.test(p))) return false;
  return hasInset || lengths.slice(3).some((p) => isColor(p));
}

const FAMILY_PART = /^("[^"]*"|'[^']*'|-?[A-Za-z_][\w -]*)$/;

/** True for a font stack (`system-ui, "Segoe UI", sans-serif`) — two+ families. */
export function isFontStack(value: string): boolean {
  const parts = splitTopLevelComma(value);
  return parts.length >= 2 && parts.every((p) => FAMILY_PART.test(p));
}
