import { describe, it, expect } from 'vitest';
import { computeGridWindow, rowOffset, type GridWindowInput } from '../src/features/gallery/windowing.js';

/**
 * The gallery grid virtualizes by ROW: N components are chunked into
 * `columnCount`-wide rows and only the rows intersecting the scroll viewport
 * (plus overscan) are mounted. This is the pure math behind that — the thing the
 * headline 1000+-component target used to pay for by mounting every card at once.
 * The component wiring (scroll listeners, ResizeObserver, measuring) is untested
 * here on purpose; this proves the arithmetic in isolation, at every boundary.
 */

const BASE: GridWindowInput = {
  itemCount: 1000,
  columnCount: 4,
  rowHeight: 160,
  rowGap: 16,
  scrollOffset: 0,
  viewportHeight: 600,
  overscanRows: 2,
};

function win(overrides: Partial<GridWindowInput>) {
  return computeGridWindow({ ...BASE, ...overrides });
}

describe('computeGridWindow — empty', () => {
  it('renders nothing for zero items and reports zero height', () => {
    const w = win({ itemCount: 0 });
    expect(w.rowCount).toBe(0);
    expect(w.totalHeight).toBe(0);
    // endIndex < startIndex is the "slice is empty" signal the component reads.
    expect(w.endIndex).toBeLessThan(w.startIndex);
    // components.slice(startIndex, endIndex + 1) must yield [].
    expect([1, 2, 3].slice(w.startIndex, w.endIndex + 1)).toEqual([]);
  });

  it('treats negative item counts as empty, never crashes', () => {
    const w = win({ itemCount: -5 });
    expect(w.rowCount).toBe(0);
    expect(w.totalHeight).toBe(0);
  });
});

describe('computeGridWindow — fewer items than one screen', () => {
  it('mounts every item when they all fit', () => {
    const w = win({ itemCount: 3, viewportHeight: 5000 });
    expect(w.rowCount).toBe(1);
    expect(w.startIndex).toBe(0);
    expect(w.endIndex).toBe(2); // all three, indices 0..2
    expect(w.totalHeight).toBe(160); // one row, no trailing gap
  });

  it('a partial last row does not over-report item indices', () => {
    // 6 items / 4 cols = 2 rows; the second row holds only 2 items.
    const w = win({ itemCount: 6, viewportHeight: 5000, overscanRows: 0 });
    expect(w.rowCount).toBe(2);
    expect(w.endIndex).toBe(5); // clamped to itemCount-1, not (row+1)*cols-1 = 7
  });
});

describe('computeGridWindow — total height', () => {
  it('stacks rows with a gap between and no trailing gap', () => {
    // 8 items / 4 cols = 2 rows: 2*160 + 1*16 = 336.
    expect(win({ itemCount: 8 }).totalHeight).toBe(336);
    // 12 items / 4 cols = 3 rows: 3*160 + 2*16 = 512.
    expect(win({ itemCount: 12 }).totalHeight).toBe(512);
  });

  it('rowPitch is height plus gap', () => {
    expect(win({}).rowPitch).toBe(176);
  });
});

describe('computeGridWindow — scroll position', () => {
  it('at the top, starts at row 0 and mounts only a bounded window', () => {
    const w = win({ scrollOffset: 0 });
    expect(w.startRow).toBe(0);
    expect(w.startIndex).toBe(0);
    // Nowhere near all 1000 items: a few visible rows + overscan.
    expect(w.endIndex).toBeLessThan(60);
  });

  it('scrolled to the middle mounts a window around the offset, not from row 0', () => {
    // pitch 176; offset 8800 => row 50.
    const w = win({ scrollOffset: 8800, overscanRows: 2 });
    expect(w.startRow).toBe(48); // 50 - overscan 2
    expect(w.startIndex).toBe(48 * 4);
    // Bounded window height: ~viewport/pitch rows + overscan on both sides.
    const rowsMounted = w.endRow - w.startRow + 1;
    expect(rowsMounted).toBeLessThan(12);
  });

  it('scrolled to the bottom keeps the very last item reachable', () => {
    const w = win({ scrollOffset: 1_000_000 });
    expect(w.endRow).toBe(w.rowCount - 1);
    expect(w.endIndex).toBe(999); // last of 1000 items
  });

  it('a huge N never mounts more than the visible window plus overscan', () => {
    const w = win({ itemCount: 1_000_000, scrollOffset: 500_000 });
    const rowsMounted = w.endRow - w.startRow + 1;
    // viewport 600 / pitch 176 ~= 4 visible rows, + 2*overscan.
    expect(rowsMounted).toBeLessThanOrEqual(4 + 2 * BASE.overscanRows + 2);
    expect(w.endIndex - w.startIndex + 1).toBeLessThan(60);
  });
});

describe('computeGridWindow — overscan and clamping', () => {
  it('overscan never pulls startRow below 0 at the top', () => {
    const w = win({ scrollOffset: 0, overscanRows: 10 });
    expect(w.startRow).toBe(0);
    expect(w.startIndex).toBe(0);
  });

  it('overscan never pushes endRow past the last row at the bottom', () => {
    const w = win({ scrollOffset: 1_000_000, overscanRows: 10 });
    expect(w.endRow).toBe(w.rowCount - 1);
  });

  it('a grid scrolled far above the viewport still yields a valid, bounded window', () => {
    // Negative scrollOffset: the grid begins below the scroll container's top.
    const w = win({ scrollOffset: -5000 });
    expect(w.startRow).toBe(0);
    expect(w.startIndex).toBeGreaterThanOrEqual(0);
    expect(w.endIndex).toBeLessThan(BASE.itemCount);
  });
});

describe('computeGridWindow — degenerate geometry', () => {
  it('coerces a zero/one column count to at least one column', () => {
    const w = win({ columnCount: 0, itemCount: 3, viewportHeight: 5000 });
    expect(w.rowCount).toBe(3); // 1 column => one row per item
    expect(w.endIndex).toBe(2);
  });

  it('floors a fractional column count', () => {
    const w = win({ columnCount: 3.9, itemCount: 9, viewportHeight: 5000 });
    expect(w.rowCount).toBe(3); // floor(3.9)=3 columns => 3 rows
  });

  it('never divides by a zero row height', () => {
    const w = win({ rowHeight: 0, viewportHeight: 600 });
    expect(Number.isFinite(w.totalHeight)).toBe(true);
    expect(Number.isFinite(w.endRow)).toBe(true);
  });
});

describe('rowOffset', () => {
  it('is the row index times the pitch', () => {
    expect(rowOffset(0, 176)).toBe(0);
    expect(rowOffset(3, 176)).toBe(528);
  });
});
