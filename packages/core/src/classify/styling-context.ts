/**
 * Which context consumers are a *styling* concern rather than an app-data one.
 *
 * `useTheme` used to cost the same as `useAuth`: it forced kind=container, added
 * 1.5 to the context score, and so downgraded renderability to `stubbed`. On a
 * real target that single hook demoted 98 files on its own. A theme is not data
 * — it has a default value or a provider the preview already stubs — so a
 * component that reads nothing but the theme is still a presentational atom.
 *
 * It stays visible either way: `ClassificationSignals.contextConsumers` still
 * lists it, so a consumer can show *why* and disagree.
 */

const STYLING_CONTEXT =
  /^(use(Theme|ThemeUI|Styled(Theme)?|ColorMode|ColorScheme|DarkMode|Emotion(Theme)?|Tokens|DesignTokens|MediaQuery|Breakpoints?)|(Styled)?ThemeContext|ColorModeContext)$/;

/** True when a context consumer only affects how the component looks. */
export function isStylingContext(consumer: string): boolean {
  return STYLING_CONTEXT.test(consumer);
}

/** The consumers that carry real app state (everything but styling). */
export function appContextConsumers(consumers: readonly string[]): readonly string[] {
  return consumers.filter((c) => !isStylingContext(c));
}
