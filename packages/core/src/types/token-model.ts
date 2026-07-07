/**
 * Design-token model. Tokens are theme-level values (color/spacing/radius/…)
 * emitted as CSS custom properties, so ported code stays re-themeable.
 */

export type TokenCategory =
  | 'color'
  | 'size'
  | 'spacing'
  | 'radius'
  | 'typography'
  | 'shadow'
  | 'other';

export interface TokenUsage {
  /** Bundle-relative path where the token is used. */
  readonly file: string;
  readonly line: number;
  readonly property: string;
  readonly selector: string;
}

export interface Token {
  /** Stable hash id. */
  readonly id: string;
  /** CSS variable name, e.g. `--btn-bg`. */
  readonly name: string;
  readonly displayName: string;
  readonly category: TokenCategory;
  /** Current default value, e.g. `#3b82f6`. */
  readonly value: string;
  /** Literal fallback baked into `var(--btn-bg, <fallback>)`. */
  readonly fallback: string;
  readonly usages: readonly TokenUsage[];
  readonly source: 'extracted' | 'derived' | 'user';
}

export interface TokenModel {
  readonly tokens: readonly Token[];
  /** Optional named theme presets: theme -> (tokenId -> value). */
  readonly themes?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}
