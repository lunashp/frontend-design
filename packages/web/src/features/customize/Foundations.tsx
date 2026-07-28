import type { ThemeMiningDisclosure, Token, TokenCategory } from '../../api/types.js';
import { relativePath } from '../../lib/editor-links.js';
import { formatMiningSummary, groupTokensByCategory } from './token-sources.js';
import styles from './Customize.module.css';

const CATEGORY_LABEL: Record<TokenCategory, string> = {
  color: 'Palette',
  typography: 'Typography',
  radius: 'Radius',
  spacing: 'Spacing',
  size: 'Size',
  shadow: 'Shadow',
  other: 'Other',
};

/** One derived value, read-only: a swatch for colours, the value verbatim
 *  otherwise. The effective value reflects a seeded theme preset, so choosing a
 *  scheme visibly updates the reference (and the copied output) — never a slider. */
function FoundationRow({ token, value }: { token: Token; value: string }) {
  return (
    <div className={styles.foundationRow}>
      <span className={styles.foundationName} title={token.name}>
        {token.displayName}
      </span>
      {token.category === 'color' && (
        <span className={styles.foundationSwatch} style={{ background: value }} aria-hidden />
      )}
      <span className={styles.foundationValue}>{value}</span>
    </div>
  );
}

/**
 * The app's real design-system values, mined statically from its TS theme file.
 *
 * This is a REFERENCE of the system and the seed for the copyable themed output —
 * NOT a set of live-edit sliders. Derived tokens come from reading a
 * `createTheme({...})` object literal, so they cannot drive a MUI preview (MUI
 * reads its theme object, not CSS vars). The disclosure states, out loud, how
 * much was mined and what could not be — the honesty bar this whole view exists
 * to hold. It renders only when there are derived tokens to show.
 */
export function Foundations({
  tokens,
  disclosure,
  overrides,
  projectRoot,
}: {
  /** Derived tokens only (source: 'derived'). */
  tokens: readonly Token[];
  disclosure?: ThemeMiningDisclosure;
  /** Live overrides, so a seeded theme preset shows through here. */
  overrides: Readonly<Record<string, string>>;
  projectRoot: string;
}) {
  if (tokens.length === 0) return null;
  const groups = groupTokensByCategory(tokens);

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className="eyebrow">Foundations</span>
        <span className={styles.sectionNote}>the app’s design system · reference</span>
      </div>

      {disclosure && (
        <p className={styles.foundationDisclosure}>
          {formatMiningSummary(disclosure)} from{' '}
          <code title={disclosure.file}>{relativePath(projectRoot, disclosure.file)}</code> (
          <code>{disclosure.exportName}</code>). Read statically from the theme literal — reference
          values, not live controls.
        </p>
      )}

      {groups.map(([cat, ts]) => (
        <fieldset key={cat} className={styles.group}>
          <legend className="eyebrow">{CATEGORY_LABEL[cat]}</legend>
          {ts.map((t) => (
            <FoundationRow key={t.id} token={t} value={overrides[t.id] ?? t.value} />
          ))}
        </fieldset>
      ))}

      {disclosure && disclosure.unresolvedPaths.length > 0 && (
        <details className={styles.foundationUnresolved}>
          <summary>{disclosure.unresolved} value(s) couldn’t be resolved statically</summary>
          <ul>
            {disclosure.unresolvedPaths.map((path) => (
              <li key={path}>
                <code>{path}</code>
              </li>
            ))}
          </ul>
          <p>
            Each is a variable, spread, or call the reader won’t execute — counted and named here
            rather than guessed.
          </p>
        </details>
      )}
    </section>
  );
}
