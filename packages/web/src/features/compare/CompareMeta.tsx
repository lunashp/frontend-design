import { RANKS } from '../../lib/taxonomy.js';
import { KIND_LABEL } from '../../lib/taxonomy.js';
import type { AtomicLevel, ComponentKind } from '../../api/types.js';
import type { MetaField, MetaKey } from './compare.js';
import styles from './ComparePane.module.css';

/**
 * The classification strip: the scalar facts that are part of a component's
 * contract (kind, atomic level, renderability) plus the export name. Identity and
 * reuse (name / path / usedBy) already live in the sticky column header, so they
 * are deliberately not repeated here — this strip is only the "are they the same
 * KIND of thing" facts, with any field that differs highlighted.
 */
const SHOWN_KEYS: readonly MetaKey[] = ['kind', 'atomicLevel', 'renderability', 'exportName'];

function displayValue(key: MetaKey, raw: string): string {
  if (key === 'kind') return KIND_LABEL[raw as ComponentKind] ?? raw;
  if (key === 'atomicLevel') return RANKS[raw as AtomicLevel]?.label ?? raw;
  return raw;
}

export function CompareMeta({
  meta,
  gridTemplate,
}: {
  meta: readonly MetaField[];
  gridTemplate: string;
}) {
  const rows = SHOWN_KEYS.map((k) => meta.find((m) => m.key === k)).filter(
    (m): m is MetaField => m !== undefined,
  );

  return (
    <div className={styles.meta}>
      {rows.map((field) => (
        <div
          key={field.key}
          className={styles.metaRow}
          style={{ gridTemplateColumns: gridTemplate }}
          data-differs={!field.identical}
        >
          <span className={styles.metaLabel}>{field.label}</span>
          {field.values.map((value, i) => (
            // Column order is stable and short (2–3); index keys are safe here.
            <span key={i} className={styles.metaCell}>
              {displayValue(field.key, value)}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
