import { useState } from 'react';
import { nextThumbnailState, thumbnailUrl, type ThumbnailState } from '../gallery/thumbnail.js';
import type { CompareColumn } from './compare.js';
import styles from './ComparePane.module.css';

/**
 * One column's rendered thumbnail — the visual half of the comparison. Reuses the
 * gallery's thumbnail route and its load/error state machine, degrading to a
 * two-letter placeholder when the component cannot render (code-only, no browser).
 */
function ColumnThumb({ projectRoot, column }: { projectRoot: string; column: CompareColumn }) {
  const [thumb, setThumb] = useState<ThumbnailState>('loading');
  return (
    <div className={styles.colThumb} aria-hidden="true">
      {thumb !== 'unavailable' && (
        <img
          className={styles.colThumbImg}
          src={thumbnailUrl(projectRoot, column.id)}
          alt=""
          loading="lazy"
          decoding="async"
          data-ready={thumb === 'ready'}
          onLoad={() => setThumb((s) => nextThumbnailState(s, 'load'))}
          onError={() => setThumb((s) => nextThumbnailState(s, 'error'))}
        />
      )}
      {thumb === 'loading' && <span className={styles.colThumbSkeleton} />}
      {thumb === 'unavailable' && (
        <span className={styles.colThumbFallback}>{column.name.slice(0, 2)}</span>
      )}
    </div>
  );
}

/**
 * The sticky column header: a rendered thumbnail, the name/location, and the
 * usedByCount shown prominently — the reuse count is the plainest answer to
 * "which of these duplicates is the real one". The strictly-most-used column is
 * crowned "canonical" so the eye lands on the one to keep.
 */
export function CompareColumns({
  projectRoot,
  columns,
  mostUsedIndex,
  gridTemplate,
  onRemove,
}: {
  projectRoot: string;
  columns: readonly CompareColumn[];
  mostUsedIndex: number | null;
  gridTemplate: string;
  onRemove: (id: string) => void;
}) {
  return (
    <div className={styles.columns} style={{ gridTemplateColumns: gridTemplate }}>
      {/* Leftmost cell is the row-label gutter the facet tables share. */}
      <div className={styles.colGutter} aria-hidden="true" />
      {columns.map((column, i) => (
        <div key={column.id} className={styles.col} data-canonical={i === mostUsedIndex}>
          <ColumnThumb projectRoot={projectRoot} column={column} />
          <div className={styles.colIdentity}>
            <span className={styles.colName} title={column.name}>
              {column.name}
            </span>
            <span className={styles.colPath} title={column.relativePath}>
              {column.relativePath}
            </span>
          </div>
          <div className={styles.colStats}>
            <span
              className={styles.usedBy}
              data-canonical={i === mostUsedIndex}
              title={`Imported by ${column.usedByCount} scanned file${
                column.usedByCount === 1 ? '' : 's'
              } (stories & tests excluded)`}
            >
              <span className={styles.usedByNum}>{column.usedByCount}</span> used by
            </span>
            {i === mostUsedIndex && <span className={styles.canonicalTag}>canonical</span>}
          </div>
          <button
            type="button"
            className={styles.colRemove}
            onClick={() => onRemove(column.id)}
            aria-label={`Remove ${column.name} from comparison`}
            title="Remove from comparison"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
