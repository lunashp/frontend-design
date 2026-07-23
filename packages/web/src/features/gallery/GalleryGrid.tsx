import type { CSSProperties } from 'react';
import type { ComponentSummary } from '../../api/types.js';
import { ComponentCard } from './ComponentCard.js';
import { useGridWindow } from './useGridWindow.js';
import { rowOffset } from './windowing.js';
import styles from './GalleryGrid.module.css';

interface GalleryGridProps {
  components: readonly ComponentSummary[];
  projectRoot: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function GalleryGrid({ components, projectRoot, selectedId, onSelect }: GalleryGridProps) {
  if (components.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>No components match these filters.</p>
        <p className={styles.emptyBody}>Clear a filter or widen the search to see more.</p>
      </div>
    );
  }

  return (
    <VirtualGrid
      components={components}
      projectRoot={projectRoot}
      selectedId={selectedId}
      onSelect={onSelect}
    />
  );
}

/**
 * Only the rows whose band intersects the scroll viewport (plus overscan) are
 * mounted. The full collection's height is reserved on the spacer so the
 * scrollbar stays honest, and each mounted row is absolutely positioned at its
 * real offset via `translateY` (a compositor-friendly transform, not `top`).
 *
 * Each row is its own responsive CSS grid of exactly `columnCount` equal tracks,
 * so the layout is identical to the old single auto-fill grid at every width —
 * `columnCount` is derived from the same `minmax(248px, 1fr)` rule. DOM order is
 * row-then-column, matching the visual order, so a card scrolled into view is a
 * real focusable <button> in the natural tab sequence.
 */
function VirtualGrid({ components, projectRoot, selectedId, onSelect }: GalleryGridProps) {
  const { outerRef, measureRef, range, columnCount } = useGridWindow(components.length);

  const rows = [];
  for (let row = range.startRow; row <= range.endRow; row++) {
    const from = row * columnCount;
    const slice = components.slice(from, Math.min(from + columnCount, components.length));
    if (slice.length === 0) continue;
    const rowStyle: CSSProperties = {
      transform: `translateY(${rowOffset(row, range.rowPitch)}px)`,
      // A number CSS var: substituted into `repeat(var(--cols), …)` in the module.
      ['--cols' as string]: columnCount,
    };
    rows.push(
      <div
        key={row}
        className={styles.row}
        style={rowStyle}
        ref={row === range.startRow ? measureRef : undefined}
      >
        {slice.map((component) => (
          <ComponentCard
            key={component.descriptor.id}
            component={component}
            projectRoot={projectRoot}
            selected={component.descriptor.id === selectedId}
            onSelect={() => onSelect(component.descriptor.id)}
          />
        ))}
      </div>,
    );
  }

  return (
    <div ref={outerRef} className={styles.viewport} style={{ height: range.totalHeight }}>
      {rows}
    </div>
  );
}
