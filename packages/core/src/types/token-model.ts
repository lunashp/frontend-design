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

/**
 * Honest disclosure of a static theme-file mining pass. `derived` tokens come
 * from reading a `createTheme({...})` object LITERAL (never executing it), so a
 * value that is a variable ref / spread / call / template cannot be resolved.
 * Those are counted and their dotted paths listed rather than guessed, so the UI
 * can say "mined N values, M unresolved" and link the source.
 */
export interface ThemeMiningDisclosure {
  /** Absolute path of the theme file that was mined. */
  readonly file: string;
  /** The exported theme name, e.g. `appTheme`. */
  readonly exportName: string;
  /** Count of literal values successfully mined into derived tokens. */
  readonly resolved: number;
  /** Count of values that were NOT literals and so could not be mined. */
  readonly unresolved: number;
  /** Dotted paths of the unresolved values (e.g. `palette.primary.dark`). */
  readonly unresolvedPaths: readonly string[];
}

export interface TokenModel {
  readonly tokens: readonly Token[];
  /** Optional named theme presets: theme -> (tokenId -> value). */
  readonly themes?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Present when derived tokens were mined from a TS theme file. */
  readonly derivedFrom?: ThemeMiningDisclosure;
}
