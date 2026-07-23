import type { PreviewBacking } from './backing.js';
import { BACKINGS } from './backing.js';
import styles from './PreviewPane.module.css';

/**
 * Light/dark/checker control for the preview stage (#6). The choice is held by
 * the caller as component state, so it persists while the inspector stays open
 * and resets naturally when a different component is selected.
 */
export function BackingToggle({
  value,
  onChange,
}: {
  value: PreviewBacking;
  onChange: (backing: PreviewBacking) => void;
}) {
  return (
    <div className={styles.backing} role="group" aria-label="Preview backing">
      {BACKINGS.map((b) => (
        <button
          key={b.value}
          type="button"
          className={styles.backingBtn}
          data-active={b.value === value}
          aria-pressed={b.value === value}
          onClick={() => onChange(b.value)}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}
