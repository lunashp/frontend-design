import styles from './CompareButton.module.css';

/**
 * Header affordance that opens the Compare view over the current kit selection.
 * Reuses the basket rather than a second holding pen: the basket is already "the
 * components I'm weighing together", which is exactly the compare set. The button
 * stays enabled at any count (so it's always keyboard-reachable and can explain
 * itself) but reads "ready" only at the 2–3 the view accepts; out of range the
 * pane guides the user to the right count.
 */
export function CompareButton({ count, onClick }: { count: number; onClick: () => void }) {
  const ready = count >= 2 && count <= 3;
  const label = ready
    ? `Compare ${count} selected components`
    : 'Compare components — select 2 to 3 in the kit';
  return (
    <button
      type="button"
      className={styles.button}
      data-ready={ready}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <span className={styles.icon} aria-hidden>
        ⇄
      </span>
      Compare
    </button>
  );
}
