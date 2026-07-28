/**
 * Helpers for the Foundations view: the app's mined design-system values.
 *
 * Derived tokens (source: 'derived') are read STATICALLY from a TS theme file's
 * object literal — they are a faithful reference to the real system and the seed
 * for the copyable themed output, but they do NOT live-edit a MUI preview (MUI
 * reads its theme object, not CSS vars). So they must be kept out of the
 * re-themeable token panel, whose sliders DO drive the live preview: a control
 * that claims to re-theme but cannot is worse than an absent one.
 *
 * `partitionTokensBySource` draws exactly that line. The rest formats the honest
 * mining disclosure the core lane exposes.
 */

import type { ThemeMiningDisclosure, Token, TokenCategory } from '../../api/types.js';

export interface TokenSourceGroups {
  /** Extracted (CSS custom props) + user tokens — the re-themeable, live sliders. */
  readonly editable: readonly Token[];
  /** Mined theme tokens — reference + copy seed, never a live-edit slider. */
  readonly derived: readonly Token[];
}

/** Split tokens into the re-themeable set and the derived (reference) set. */
export function partitionTokensBySource(tokens: readonly Token[]): TokenSourceGroups {
  const editable: Token[] = [];
  const derived: Token[] = [];
  for (const token of tokens) {
    if (token.source === 'derived') derived.push(token);
    else editable.push(token);
  }
  return { editable, derived };
}

/** Display order for Foundations, colour first (the load-bearing part of a system). */
const CATEGORY_ORDER: readonly TokenCategory[] = [
  'color',
  'typography',
  'radius',
  'spacing',
  'size',
  'shadow',
  'other',
];

/** Group tokens by category in display order, dropping empty groups. Input order
 *  is preserved within each group. */
export function groupTokensByCategory(
  tokens: readonly Token[],
): ReadonlyArray<readonly [TokenCategory, readonly Token[]]> {
  return CATEGORY_ORDER.map(
    (cat) => [cat, tokens.filter((t) => t.category === cat)] as const,
  ).filter(([, ts]) => ts.length > 0);
}

/** English pluralization for the one honest count in the disclosure line. */
function values(n: number): string {
  return `${n} value${n === 1 ? '' : 's'}`;
}

/**
 * The honest one-liner over the mined tokens: how many literal values were
 * resolved, and — only when there were any — how many could not be. The count of
 * unresolved is the whole point: it says out loud what static extraction could
 * not reach, so the panel never implies it mined the entire theme.
 */
export function formatMiningSummary(disclosure: ThemeMiningDisclosure): string {
  const mined = `Mined ${values(disclosure.resolved)}`;
  return disclosure.unresolved > 0
    ? `${mined} · ${disclosure.unresolved} unresolved`
    : mined;
}
