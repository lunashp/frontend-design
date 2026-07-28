import styles from './Customize.module.css';

/**
 * Starting presets the engine mined from the app's own theme (`tokenModel.themes`
 * — one entry per colorScheme, keyed by token id). Picking one seeds the token
 * overrides with that scheme's values.
 *
 * Honest by construction: these seed the exported `tokens.css` and the
 * Foundations reference below, NOT the live MUI preview — MUI reads its theme
 * object at build time, so a CSS-var override cannot restyle it. The caption says
 * so, because a control that looks like it re-themes the preview but does not is
 * worse than no control at all. This section renders only when the model carries
 * themes, so on a plain-CSS target it is simply absent.
 */
export function ThemePresets({
  themes,
  onSeed,
}: {
  themes: Readonly<Record<string, Readonly<Record<string, string>>>>;
  onSeed: (overrides: Readonly<Record<string, string>>) => void;
}) {
  const names = Object.keys(themes);
  if (names.length === 0) return null;

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className="eyebrow">Theme presets</span>
        <span className={styles.sectionNote}>from the app’s colorSchemes</span>
      </div>

      <div className={styles.themeRow} role="group" aria-label="Theme presets">
        {names.map((name) => (
          <button
            key={name}
            type="button"
            className={styles.themeChip}
            onClick={() => onSeed(themes[name] ?? {})}
            title={`Seed the token overrides with the ${name} scheme`}
          >
            {name}
          </button>
        ))}
      </div>

      <p className={styles.stateNote}>
        Seeds the exported <code>tokens.css</code> and the Foundations reference below — MUI reads
        its theme object at build time, so this does not restyle the live preview.
      </p>
    </section>
  );
}
