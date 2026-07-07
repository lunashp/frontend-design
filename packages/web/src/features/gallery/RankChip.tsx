import type { AtomicLevel } from '../../api/types.js';
import { RANKS } from '../../lib/taxonomy.js';
import styles from './RankChip.module.css';

export function RankChip({ level, dot = false }: { level: AtomicLevel; dot?: boolean }) {
  const meta = RANKS[level];
  return (
    <span
      className={dot ? `${styles.chip} ${styles.dotOnly}` : styles.chip}
      style={{ ['--rank' as string]: meta.colorVar }}
      title={meta.blurb}
    >
      <span className={styles.dot} />
      {!dot && meta.label}
    </span>
  );
}
