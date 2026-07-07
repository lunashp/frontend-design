/**
 * Styling-strategy types. The StyleExtractor is a registry of adapters, one per
 * strategy; unknown strategies return empty facts and never block rendering.
 */

export type StyleStrategyId =
  | 'css-modules'
  | 'styled-components'
  | 'emotion'
  | 'tailwind'
  | 'vanilla-extract'
  | 'inline-style'
  | 'plain-css';

export interface StyleDeclaration {
  readonly property: string;
  readonly value: string;
  readonly selector: string;
  /** The class or component the declaration is scoped to. */
  readonly scope: string;
  readonly source: {
    /** Bundle-relative or absolute source path. */
    readonly file: string;
    readonly line: number;
  };
}

export interface StyleFacts {
  readonly strategy: StyleStrategyId | 'unknown';
  readonly declarations: readonly StyleDeclaration[];
}
