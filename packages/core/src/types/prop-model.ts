/**
 * Prop metadata used to (a) render a components sample instance and
 * (b) drive the customization "prop controls" panel.
 */

export type ControlKind =
  | 'boolean'
  | 'enum'
  | 'string'
  | 'number'
  | 'color'
  | 'node'
  | 'unknown';

/**
 * Where a prop is DECLARED — the difference between a component's own API and
 * the surface it inherits by wrapping something else.
 *
 * A wrapper around a library component (`styled(MuiChip)`, `forwardRef<_,
 * ChipProps>`) absorbs that library's entire prop contract, so a component that
 * adds two props reports 64. `own` is the number that describes the component;
 * `inherited` is the library's. `unknown` is reserved for props the TypeScript
 * checker could not place — never folded into `own`, because inflating the own
 * count is the exact failure this facet exists to prevent.
 */
export type PropOrigin = 'own' | 'inherited' | 'unknown';

export interface PropControl {
  readonly name: string;
  /** Raw TS type, shown to the user (e.g. `'sm' | 'md' | 'lg'`). */
  readonly tsType: string;
  readonly kind: ControlKind;
  /** Options for `enum` controls, derived from union types. */
  readonly options?: readonly string[];
  /** Default value as a display string, when discoverable. */
  readonly defaultValue?: string;
  readonly required: boolean;
  /** JSDoc description, if any. */
  readonly description?: string;
  readonly origin: PropOrigin;
  /**
   * For `inherited` props only: the installed package that declares it
   * (`@mui/material`, `@types/react`). Lets a reader see *whose* API they are
   * looking at instead of one undifferentiated wall of props.
   */
  readonly originPackage?: string;
}

export interface PropModel {
  readonly props: readonly PropControl[];
  /**
   * How many of `props` the component declares ITSELF — the honest headline
   * number, as opposed to `props.length`, which counts the wrapped library's
   * API too.
   *
   * `null` means "not determined": the props type could not be resolved at all,
   * so every prop is `unknown`. That is deliberately NOT reported as `0`, which
   * would be an assertion the engine cannot support. `0` is reserved for the
   * true statement "this component adds nothing of its own" (a pass-through
   * wrapper), and for a component with no props at all.
   */
  readonly ownPropCount: number | null;
}
