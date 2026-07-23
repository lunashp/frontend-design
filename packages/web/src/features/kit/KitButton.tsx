import styles from './KitButton.module.css';

/**
 * The persistent header affordance for the basket: shows the count so the user
 * always knows the kit is non-empty, and opens the kit drawer. Rendered whenever
 * a project is loaded, even at zero, so the feature is discoverable before the
 * first component is added.
 */
export function KitButton({ count, onClick }: { count: number; onClick: () => void }) {
  const label = count === 0 ? 'Open component kit (empty)' : `Open component kit (${count} selected)`;
  return (
    <button
      type="button"
      className={styles.button}
      data-filled={count > 0}
      onClick={onClick}
      aria-label={label}
    >
      <span className={styles.icon} aria-hidden>
        ▦
      </span>
      Kit
      {count > 0 && (
        <span className={styles.count} aria-hidden>
          {count}
        </span>
      )}
    </button>
  );
}
