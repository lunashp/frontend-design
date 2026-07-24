import styles from './ShortcutHints.module.css';

/**
 * The keyboard shortcuts, stated where they are used.
 *
 * A shortcut nobody can find is a shortcut nobody has. This is a native
 * <details> disclosure in the sidebar — collapsed to one quiet line until it is
 * asked — rather than a `?` modal: a modal would need its own focus trap and its
 * own Escape handling, and Escape is one of the shortcuts being documented.
 * Native disclosure is keyboard-operable and screen-reader-labelled for free.
 */

interface Shortcut {
  readonly keys: readonly string[];
  readonly description: string;
}

const SHORTCUTS: readonly Shortcut[] = [
  { keys: ['/'], description: 'Focus the filter' },
  { keys: ['↑', '↓', '←', '→'], description: 'Move between cards' },
  { keys: ['Home', 'End'], description: 'First / last card' },
  { keys: ['Enter'], description: 'Open the focused card' },
  { keys: ['Esc'], description: 'Clear the filter, or close the inspector' },
];

export function ShortcutHints() {
  return (
    <details className={styles.hints}>
      <summary className={styles.summary}>
        <span className={styles.mark} aria-hidden>
          ?
        </span>
        Keyboard shortcuts
      </summary>
      <dl className={styles.list}>
        {SHORTCUTS.map((shortcut) => (
          <div key={shortcut.description} className={styles.row}>
            <dt className={styles.keys}>
              {shortcut.keys.map((key) => (
                <kbd key={key} className={styles.key}>
                  {key}
                </kbd>
              ))}
            </dt>
            <dd className={styles.description}>{shortcut.description}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
