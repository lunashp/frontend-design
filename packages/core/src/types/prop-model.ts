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
}

export interface PropModel {
  readonly props: readonly PropControl[];
}
