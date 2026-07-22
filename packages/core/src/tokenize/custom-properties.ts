/**
 * Helpers for hoisting author-defined custom properties (`:root { --brand: … }`)
 * into the emitted `tokens.css`.
 *
 * Hoisting — rather than rewriting the declaration in place — is forced by two
 * things. First, `--brand: var(--brand, …)` is self-referential and therefore
 * invalid, so the declaration cannot become a token reference. Second, the entry
 * imports `tokens.css` BEFORE the component's own stylesheet, and `:root` vs
 * `:root` is decided by source order — so an author `:root` left in place would
 * silently beat every re-theme. Moving the declaration into `tokens.css` makes
 * the token the single definition.
 */

import type { Declaration, Rule } from 'postcss';

/**
 * True for a declaration in a top-level `:root { … }` block.
 *
 * Deliberately narrow: a theme block (`.dark { --bg: #000 }`) or an at-rule
 * (`@media (prefers-color-scheme: dark) { :root { … } }`) is a conditional
 * override that must keep both its value and its position in source order.
 * Hoisting those would collapse a two-theme stylesheet into one theme.
 */
export function isTopLevelRootDecl(decl: Declaration): boolean {
  const rule = decl.parent as Rule | undefined;
  if (!rule || rule.type !== 'rule') return false;
  if (rule.parent?.type !== 'root') return false;
  return rule.selector.split(',').some((s) => s.trim() === ':root');
}

/** `--primary-color` → `Primary color`: the author's name beats `Color 7`. */
export function displayNameForCustomProperty(name: string): string {
  const words = name.replace(/^--/, '').replace(/[-_]+/g, ' ').trim();
  if (words === '') return name;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Give bare `var(--name)` references the hoisted literal as a fallback.
 *
 * Hoisting removes the only in-file definition, so without this the bundle
 * would stop rendering when copied WITHOUT `tokens.css` — the invariant the
 * whole `var(--token, <literal>)` scheme exists to protect. References that
 * already carry a fallback are left alone.
 */
export function applyBareVarFallbacks(
  css: string,
  hoisted: ReadonlyMap<string, string>,
): string {
  let out = css;
  for (const [name, value] of hoisted) {
    out = out.replace(new RegExp(`var\\(\\s*${escapeRegExp(name)}\\s*\\)`, 'g'), `var(${name}, ${value})`);
  }
  return out;
}
