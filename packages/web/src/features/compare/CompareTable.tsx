import type { ReactNode } from 'react';
import type { KeyedRow } from './compare.js';
import styles from './ComparePane.module.css';

/**
 * A generic facet table: one grid row per key (a prop, a token, a dependency),
 * one cell per component column. Differing rows are rendered loud and up top;
 * matching rows are tucked into a collapsed "in common" disclosure so the
 * differences dominate the view — the whole point is "are these the same?".
 *
 * Generic over the cell type so props, tokens, and deps all reuse it; each facet
 * supplies its own `renderCell` (a null cell means "absent in that column").
 */
export function CompareTable<C>({
  title,
  differing,
  same,
  renderCell,
  gridTemplate,
  emptyLabel,
}: {
  title: string;
  differing: readonly KeyedRow<C>[];
  same: readonly KeyedRow<C>[];
  renderCell: (cell: C | null) => ReactNode;
  gridTemplate: string;
  emptyLabel: string;
}) {
  const total = differing.length + same.length;

  const renderRow = (row: KeyedRow<C>, differs: boolean) => (
    <div
      key={row.key}
      className={styles.tableRow}
      style={{ gridTemplateColumns: gridTemplate }}
      data-differs={differs}
    >
      <span className={styles.rowKey} title={row.key}>
        {row.key}
      </span>
      {row.cells.map((cell, i) => (
        // Column order is stable and short (2–3); index keys are safe.
        <span key={i} className={styles.rowCell} data-absent={cell === null}>
          {renderCell(cell)}
        </span>
      ))}
    </div>
  );

  return (
    <section className={styles.facet}>
      <header className={styles.facetHead}>
        <span className="eyebrow">{title}</span>
        <span className={styles.facetCount}>
          {total === 0
            ? emptyLabel
            : `${differing.length} differ · ${same.length} in common`}
        </span>
      </header>

      {total === 0 ? (
        <p className={styles.facetEmpty}>{emptyLabel}</p>
      ) : (
        <div className={styles.table}>
          {differing.map((row) => renderRow(row, true))}
          {same.length > 0 && (
            <details className={styles.common}>
              <summary className={styles.commonSummary}>
                {same.length} in common
              </summary>
              {same.map((row) => renderRow(row, false))}
            </details>
          )}
        </div>
      )}
    </section>
  );
}
