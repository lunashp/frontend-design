/**
 * Row-windowing math for the virtualized gallery grid.
 *
 * GalleryGrid used to `components.map(...)` over the whole collection, mounting a
 * ComponentCard (+ RankChip + ContextMeter) for every one — on the 1000+-component
 * headline target that is a multi-thousand-node grid, the worst first-paint and
 * scroll cliff on the human surface. Virtualizing means only the cards whose row
 * intersects the scroll viewport (plus a small overscan) are ever in the DOM.
 *
 * The grid stays a responsive CSS grid: items are chunked into `columnCount`-wide
 * rows and rows are the unit of virtualization. This module is the pure arithmetic
 * — no DOM, no React — so it can be unit-tested at every boundary. The component
 * feeds it measured geometry (card height, gap, column count, scroll offset,
 * viewport height) and positions the mounted rows from what it returns.
 */

export interface GridWindowInput {
  /** Total number of components after filtering. */
  readonly itemCount: number;
  /** Cards per row, derived from container width (mirrors the CSS auto-fill count). */
  readonly columnCount: number;
  /** Measured height of one (uniform) card, in px. */
  readonly rowHeight: number;
  /** Gap between rows, in px. */
  readonly rowGap: number;
  /**
   * Scroll container's top edge relative to the grid's top, in px. Positive once
   * the grid has scrolled up under the fold; negative while the grid still starts
   * below the container's visible top (e.g. summary/issues panels above it).
   */
  readonly scrollOffset: number;
  /** Visible height of the scroll container, in px. */
  readonly viewportHeight: number;
  /** Extra rows mounted above and below the visible window, to hide scroll churn. */
  readonly overscanRows: number;
}

export interface GridWindow {
  /** Total rows the full collection would occupy. */
  readonly rowCount: number;
  /** First mounted row (inclusive). 0 when the window is empty. */
  readonly startRow: number;
  /** Last mounted row (inclusive). `startRow - 1` when nothing is mounted. */
  readonly endRow: number;
  /** First mounted item index (inclusive). */
  readonly startIndex: number;
  /**
   * Last mounted item index (inclusive). When the window is empty this is
   * `< startIndex`, so `components.slice(startIndex, endIndex + 1)` yields [].
   */
  readonly endIndex: number;
  /** Height of the full grid in px — the scroll spacer that keeps the scrollbar honest. */
  readonly totalHeight: number;
  /** Row height + row gap: the distance from one row's top to the next. */
  readonly rowPitch: number;
}

/** The absolute top offset of a row within the grid, in px. */
export function rowOffset(rowIndex: number, rowPitch: number): number {
  return rowIndex * rowPitch;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Given the collection size and the measured grid geometry, return which rows
 * (and therefore which item indices) to mount, and the full grid height.
 *
 * Invariants the callers and tests rely on:
 *  - `columnCount` is coerced to at least 1 and floored — a 0 or fractional count
 *    (mid-resize, or a bad measurement) must never divide by zero or wrap rows.
 *  - `rowHeight` is coerced to at least 1 for the same reason.
 *  - The window is clamped to [0, rowCount) on both ends, so overscan can never
 *    reach past the real rows.
 *  - An empty collection returns `endIndex < startIndex` rather than throwing.
 */
export function computeGridWindow(input: GridWindowInput): GridWindow {
  const columnCount = Math.max(1, Math.floor(input.columnCount || 0));
  const itemCount = Math.max(0, Math.floor(input.itemCount || 0));
  const rowHeight = Math.max(1, input.rowHeight || 0);
  const rowGap = Math.max(0, input.rowGap || 0);
  const overscan = Math.max(0, Math.floor(input.overscanRows || 0));
  const viewportHeight = Math.max(0, input.viewportHeight || 0);

  const rowPitch = rowHeight + rowGap;
  const rowCount = Math.ceil(itemCount / columnCount);

  if (rowCount === 0) {
    return {
      rowCount: 0,
      startRow: 0,
      endRow: -1,
      startIndex: 0,
      endIndex: -1,
      totalHeight: 0,
      rowPitch,
    };
  }

  // Rows stack with a gap between and no trailing gap: the last row's bottom edge
  // is exactly this height, which is what the scroll spacer must be.
  const totalHeight = rowCount * rowHeight + (rowCount - 1) * rowGap;

  const top = input.scrollOffset;
  const bottom = input.scrollOffset + viewportHeight;

  // First row whose band contains the viewport top; last row whose top edge is
  // still above the viewport bottom. `floor(top/pitch)` is deliberately
  // conservative — if `top` lands in the gap after a row, that row is mounted too,
  // which overscan would have covered anyway.
  const firstVisible = Math.floor(top / rowPitch);
  const lastVisible = Math.ceil(bottom / rowPitch) - 1;

  const startRow = clamp(firstVisible - overscan, 0, rowCount - 1);
  const endRow = clamp(lastVisible + overscan, 0, rowCount - 1);

  const startIndex = startRow * columnCount;
  const endIndex = Math.min(itemCount - 1, (endRow + 1) * columnCount - 1);

  return { rowCount, startRow, endRow, startIndex, endIndex, totalHeight, rowPitch };
}
