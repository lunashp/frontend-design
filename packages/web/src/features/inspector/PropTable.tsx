import type { PropControl } from '../../api/types.js';
import { CONTROL_GLYPH } from '../../lib/taxonomy.js';
import styles from './PropTable.module.css';

export function PropTable({ props }: { props: readonly PropControl[] }) {
  if (props.length === 0) {
    return <p className={styles.none}>This component takes no props.</p>;
  }

  return (
    <ul className={styles.table}>
      {props.map((p) => (
        <li key={p.name} className={styles.row}>
          <span className={styles.glyph} title={p.kind}>
            {CONTROL_GLYPH[p.kind]}
          </span>
          <div className={styles.main}>
            <div className={styles.nameRow}>
              <span className={styles.name}>{p.name}</span>
              {p.required && <span className={styles.req} title="Required">*</span>}
              {p.defaultValue != null && (
                <span className={styles.default}>= {p.defaultValue}</span>
              )}
            </div>
            <code className={styles.type}>{p.tsType}</code>
            {p.description && <p className={styles.desc}>{p.description}</p>}
            {p.options && (
              <div className={styles.options}>
                {p.options.map((o) => (
                  <span key={o} className={styles.option}>
                    {o}
                  </span>
                ))}
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
