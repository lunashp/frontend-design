import { contextLoad, contextLoadLabel } from '../../lib/taxonomy.js';
import styles from './ContextMeter.module.css';

const SEGMENTS = 8;

/**
 * The signature device: a segmented gauge encoding contextDependencyScore —
 * "how much app context this component needs to render in isolation". Low = it
 * will render cleanly in the sandbox; high = expect stubs (foreshadows P2).
 */
export function ContextMeter({ score, compact = false }: { score: number; compact?: boolean }) {
  const load = contextLoad(score);
  const filled = Math.round(load * SEGMENTS);
  const tone = load < 0.3 ? 'ok' : load < 0.65 ? 'warn' : 'danger';

  return (
    <div className={compact ? `${styles.meter} ${styles.compact}` : styles.meter} data-tone={tone}>
      {!compact && <span className={styles.label}>Context load</span>}
      <div className={styles.track} role="meter" aria-valuenow={score} aria-label="Context load">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span key={i} className={styles.seg} data-on={i < filled} data-tone={tone} />
        ))}
      </div>
      {!compact && <span className={styles.readout}>{contextLoadLabel(score)}</span>}
    </div>
  );
}
