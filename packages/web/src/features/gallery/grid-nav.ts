/**
 * Arrow-key movement across the gallery grid, as pure index arithmetic.
 *
 * It has to be pure. The grid is VIRTUALIZED (see windowing.ts), so the card
 * being moved to is routinely not in the DOM — there is no element to measure
 * and no sibling to walk to. The target INDEX is decided here first; the grid
 * then scrolls that row into view and focuses the card once it renders.
 *
 * Layout model: items fill `columns`-wide rows in reading order, so index
 * `i` sits at row `floor(i / columns)`, column `i % columns` — the same
 * chunking GalleryGrid renders and windowing.ts measures.
 */

export type GridDirection = 'left' | 'right' | 'up' | 'down' | 'home' | 'end';

const KEY_DIRECTION: Readonly<Record<string, GridDirection>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Home: 'home',
  End: 'end',
};

/**
 * The movement a key means, or null when the grid should not claim it. Enter and
 * Space are absent on purpose: they are the native <button> activation that
 * already selects a card, and intercepting them would replace working behaviour
 * with a reimplementation of it.
 */
export function gridDirectionFor(key: string): GridDirection | null {
  return KEY_DIRECTION[key] ?? null;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Where focus goes from `from` in `direction`.
 *
 * Returns -1 when there is nothing to focus (an empty collection). Otherwise the
 * result is always a real index in [0, count):
 *
 *  - Left/Right step one card in reading order, so they cross row boundaries —
 *    the catalogue is one sequence, and stopping dead at a row's edge would make
 *    the last card of a row a cul-de-sac.
 *  - Up/Down step one row, holding position when there is no row that way (the
 *    top and bottom edges), and landing on the last card when the row below is
 *    partial and the column does not exist in it.
 *  - Home/End jump to the first/last card.
 *  - `from` outside the collection means "nothing is focused yet" (-1) or a
 *    stale index after the filter narrowed: both are clamped into range rather
 *    than propagating a target no card can satisfy.
 */
export function nextGridIndex(
  from: number,
  direction: GridDirection,
  count: number,
  columns: number,
): number {
  const total = Math.max(0, Math.floor(count || 0));
  if (total === 0) return -1;
  const last = total - 1;
  if (direction === 'home') return 0;
  if (direction === 'end') return last;

  // A 0, negative, fractional or NaN column count can only come from a
  // mid-resize measurement; one column keeps every step well-defined.
  const cols = Math.max(1, Math.floor(columns || 0) || 1);
  // Nothing focused yet: any step enters the grid at the first card.
  if (!Number.isFinite(from) || from < 0) return 0;
  const current = clamp(Math.floor(from), 0, last);

  switch (direction) {
    case 'left':
      return Math.max(0, current - 1);
    case 'right':
      return Math.min(last, current + 1);
    case 'up': {
      const target = current - cols;
      return target >= 0 ? target : current;
    }
    case 'down': {
      const target = current + cols;
      if (target <= last) return target;
      // Past the end: either the row below is partial (land on its last card) or
      // there is no row below at all (hold).
      const onLastRow = Math.floor(current / cols) === Math.floor(last / cols);
      return onLastRow ? current : last;
    }
  }
}
