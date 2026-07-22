import type { ContextScoreContribution } from '../../lib/context-score.js';
import { contextLoad, contextLoadLabel } from '../../lib/taxonomy.js';
import styles from './ContextMeter.module.css';

const SEGMENTS = 8;

/**
 * The signature device: a segmented gauge encoding contextDependencyScore —
 * "how much app context this component needs to render in isolation". Low = it
 * will render cleanly in the sandbox; high = expect stubs.
 *
 * `contributions` decomposes the number into the terms that produced it. A bare
 * "6.5" is unactionable — nobody can tell whether it came from one store or four
 * contexts, and therefore what stubbing this component would cost. Passed in
 * (rather than derived here) so the card's compact meter stays a glance.
 */
export function ContextMeter({
  score,
  compact = false,
  contributions,
}: {
  score: number;
  compact?: boolean;
  contributions?: readonly ContextScoreContribution[];
}) {
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
      {!compact && contributions && (
        <p className={styles.breakdown}>
          <span className={styles.total}>{score}</span>
          {contributions.length === 0 ? (
            <span className={styles.none}>needs no app context</span>
          ) : (
            <>
              <span className={styles.eq} aria-hidden>
                =
              </span>
              {contributions.map((c, i) => (
                <span key={`${c.label}-${i}`} className={styles.term}>
                  {c.label}
                  <span className={styles.weight}>+{c.weight}</span>
                </span>
              ))}
            </>
          )}
        </p>
      )}
    </div>
  );
}
