import styles from './BuildError.module.css';

/**
 * The failure state for the four live tabs (Preview / Variants / Portable /
 * Customize), which all depend on one artifact build. Previously a single grey
 * line ("Failed to build artifact.") replaced every one of them with no
 * diagnosis and no way forward — the highest-traffic dead end in the app.
 *
 * This gives the failure a shape: what happened, the engine's own message, the
 * most likely cause, and a Retry that actually rebuilds (the hook drops the
 * failed component from its memo first). A build can fail transiently — the host
 * mid-restart, a file being written during the scan — so one failure must not be
 * terminal.
 */
export function BuildError({
  error,
  componentName,
  onRetry,
}: {
  error: string | null;
  componentName: string;
  onRetry: () => void;
}) {
  return (
    <div className={styles.wrap} role="alert">
      <p className={styles.headline}>Couldn't build {componentName} for a live view.</p>
      {error && <pre className={styles.detail}>{error}</pre>}
      <p className={styles.hint}>
        This usually means the component can't be assembled in isolation — a deep
        app dependency, a file that changed mid-scan, or the host restarting. The
        Details tab still works, and the copyable code is unaffected.
      </p>
      <button type="button" className={styles.retry} onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
