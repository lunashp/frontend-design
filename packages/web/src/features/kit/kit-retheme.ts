/**
 * Pure kit bulk-re-theme logic — applying ONE override map across the whole kit.
 *
 * WHY one map re-themes the entire kit: `resolveMany` tokenizes the MERGED file
 * set exactly once (packages/core/src/portability/resolve-many.ts), so a value
 * shared by several components becomes a SINGLE token id referenced by all of
 * them — the kit is one shared token namespace, not one per component. Overriding
 * that id therefore recolours every component that uses it in a single pass;
 * there is no per-component token to reconcile.
 *
 * This module holds only the DOM-free data transforms (the web package has no
 * jsdom, so testable logic lives in `.ts` and is unit-tested directly); the
 * KitPane wires them to state and controls.
 *
 * `emitRootCss` is imported from `lib/customize` rather than re-implemented: it is
 * byte-identical to the engine's `emitTokensCss`
 * (packages/core/src/tokenize/tokenization-transform.ts), which is what wrote the
 * kit's original `tokensCss`. Reusing it is what guarantees "no overrides →
 * original tokens.css, byte-for-byte" holds by construction instead of by luck.
 */

import type { Token } from '../../api/types.js';
import { emitRootCss } from '../../lib/customize.js';

/**
 * The kit's shared `tokens.css`, re-themed by applying `overrides` (keyed by
 * token id) to the shared token set. Empty overrides reproduce the engine's
 * original sheet exactly, so "nothing edited" is a genuine no-op, and an override
 * id that names no token is ignored (a stale preset applied to a changed basket
 * degrades quietly rather than corrupting the sheet).
 */
export function rethemeKitTokensCss(
  tokens: readonly Token[],
  overrides: Readonly<Record<string, string>>,
): string {
  // Spread into a fresh mutable map: emitRootCss only reads it, and this keeps the
  // caller's readonly map untouched.
  return emitRootCss(tokens, { ...overrides });
}

/**
 * The kit's file map with its `tokens.css` swapped for the re-themed sheet, so
 * the zip download, "copy all", and the file browser all carry the overrides
 * instead of the original. Immutable: the input map is never mutated and a fresh
 * object is returned. With empty overrides the swapped-in sheet is byte-identical
 * to the original, so this is a true reset target.
 */
export function rethemeKitFiles(
  files: Readonly<Record<string, string>>,
  tokensCssPath: string,
  tokens: readonly Token[],
  overrides: Readonly<Record<string, string>>,
): Record<string, string> {
  return { ...files, [tokensCssPath]: rethemeKitTokensCss(tokens, overrides) };
}

/**
 * The tokens the user has genuinely changed — an override is a change only when
 * it both names a real token in the set AND differs from that token's own value.
 * An override equal to the original value paints nothing (emitRootCss produces
 * the same line), so counting it as "changed" would be a lie; likewise an id that
 * names no token. This is the honest answer to "what did I change", and it drives
 * the enabled state of Reset/Save so neither offers a no-op action.
 */
export function changedKitTokens(
  tokens: readonly Token[],
  overrides: Readonly<Record<string, string>>,
): readonly Token[] {
  return tokens.filter((t) => {
    const next = overrides[t.id];
    return next !== undefined && next !== t.value;
  });
}

/** Whether the kit is actually re-themed (any real, visible change). */
export function isKitRethemed(
  tokens: readonly Token[],
  overrides: Readonly<Record<string, string>>,
): boolean {
  return changedKitTokens(tokens, overrides).length > 0;
}

/**
 * A stable synthetic "component id" identifying THIS kit basket for the presets
 * store (which is keyed by project + component). Sorted so basket order never
 * changes the scope, and derived from the exact id-set because kit token ids are
 * only stable within a single id-set's tokenization — a preset saved on one
 * basket therefore stays bound to the basket whose token ids it actually names.
 */
export function kitPresetScopeId(ids: readonly string[]): string {
  return `kit:${[...ids].sort().join(',')}`;
}
