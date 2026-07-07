import type { AtomicLevel, ComponentSummary } from '../../api/types.js';
import { RANKS, RANK_ORDER } from '../../lib/taxonomy.js';
import styles from './CollectionSummary.module.css';

export function CollectionSummary({
  components,
  shown,
}: {
  components: readonly ComponentSummary[];
  shown: number;
}) {
  const total = components.length;
  const counts = RANK_ORDER.map((level) => ({
    level,
    n: components.filter((c) => c.classification.atomicLevel === level).length,
  }));

  return (
    <section className={styles.summary} aria-label="Collection summary">
      <div className={styles.head}>
        <div>
          <span className={styles.count}>{total}</span>
          <span className={styles.unit}>components catalogued</span>
        </div>
        {shown !== total && <span className={styles.shown}>{shown} shown</span>}
      </div>

      <div className={styles.bar}>
        {counts.map(({ level, n }) =>
          n === 0 ? null : (
            <span
              key={level}
              className={styles.seg}
              style={{ flex: n, ['--rank' as string]: RANKS[level].colorVar }}
              title={`${n} ${RANKS[level].label}`}
            />
          ),
        )}
      </div>

      <ul className={styles.legend}>
        {counts.map(({ level, n }) => (
          <li key={level} className={styles.item} data-empty={n === 0}>
            <span className={styles.dot} style={{ ['--rank' as string]: RANKS[level].colorVar }} />
            <span className={styles.name}>{RANKS[level].label}</span>
            <span className={styles.n}>{n}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
