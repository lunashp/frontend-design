/**
 * User customization state. Token overrides touch only `:root` defaults in the
 * emitted `tokens.css`; prop values touch only the mounted instance. Component
 * source literals are never rewritten, preserving re-themeability.
 */

export interface CustomizationState {
  /** tokenId -> overridden value. */
  readonly tokenOverrides: Readonly<Record<string, string>>;
  /** propName -> value. */
  readonly propValues: Readonly<Record<string, unknown>>;
  /**
   * Universal design overrides (size/colour/spacing/…) applied to the
   * component's root element — independent of any tokens.
   */
  readonly designOverrides?: Readonly<Record<string, string>>;
  readonly activeTheme?: string;
}

export const EMPTY_CUSTOMIZATION: CustomizationState = {
  tokenOverrides: {},
  propValues: {},
  designOverrides: {},
};
