import { describe, expect, it } from 'vitest';
import { gridDirectionFor, nextGridIndex } from '../src/features/gallery/grid-nav.js';

/**
 * Arrow-key movement across the gallery grid, as pure index arithmetic.
 *
 * It has to be pure: the grid is VIRTUALIZED, so the card the user is moving to
 * is frequently not in the DOM at all — there is nothing to measure and nothing
 * to walk. The index is computed first and the DOM catches up afterwards, which
 * also means every edge case (last partial row, one column, an empty collection,
 * a focus index that no longer exists) is decidable here, with no browser.
 *
 * 10 items over 4 columns is the shape most cases use:
 *
 *   row 0 | 0 1 2 3
 *   row 1 | 4 5 6 7
 *   row 2 | 8 9        <- partial
 */
const COUNT = 10;
const COLS = 4;

describe('nextGridIndex — horizontal', () => {
  it('moves one card right', () => {
    expect(nextGridIndex(0, 'right', COUNT, COLS)).toBe(1);
  });

  it('moves one card left', () => {
    expect(nextGridIndex(5, 'left', COUNT, COLS)).toBe(4);
  });

  it('crosses the row boundary — the collection reads left-to-right, top-to-bottom', () => {
    expect(nextGridIndex(3, 'right', COUNT, COLS)).toBe(4);
    expect(nextGridIndex(4, 'left', COUNT, COLS)).toBe(3);
  });

  it('stops at the first card rather than wrapping to the end', () => {
    expect(nextGridIndex(0, 'left', COUNT, COLS)).toBe(0);
  });

  it('stops at the last card rather than wrapping to the start', () => {
    expect(nextGridIndex(9, 'right', COUNT, COLS)).toBe(9);
  });
});

describe('nextGridIndex — vertical', () => {
  it('moves down one row, keeping the column', () => {
    expect(nextGridIndex(1, 'down', COUNT, COLS)).toBe(5);
  });

  it('moves up one row, keeping the column', () => {
    expect(nextGridIndex(6, 'up', COUNT, COLS)).toBe(2);
  });

  it('holds position on the top row — there is no row above it', () => {
    expect(nextGridIndex(2, 'up', COUNT, COLS)).toBe(2);
  });

  it('holds position on the last row — there is no row below it', () => {
    expect(nextGridIndex(9, 'down', COUNT, COLS)).toBe(9);
  });

  it('lands on the last card when the row below is partial', () => {
    // index 6 -> 10 does not exist; the last row ends at 9, so that is the target.
    expect(nextGridIndex(6, 'down', COUNT, COLS)).toBe(9);
  });

  it('lands exactly when the column does exist in the partial row', () => {
    expect(nextGridIndex(5, 'down', COUNT, COLS)).toBe(9);
    expect(nextGridIndex(4, 'down', COUNT, COLS)).toBe(8);
  });
});

describe('nextGridIndex — jumps', () => {
  it('home goes to the first card', () => {
    expect(nextGridIndex(7, 'home', COUNT, COLS)).toBe(0);
  });

  it('end goes to the last card', () => {
    expect(nextGridIndex(0, 'end', COUNT, COLS)).toBe(COUNT - 1);
  });
});

describe('nextGridIndex — degenerate input', () => {
  it('reports "nothing to focus" for an empty collection', () => {
    for (const direction of ['left', 'right', 'up', 'down', 'home', 'end'] as const) {
      expect(nextGridIndex(0, direction, 0, COLS)).toBe(-1);
    }
  });

  it('enters at the first card when nothing is focused yet', () => {
    expect(nextGridIndex(-1, 'down', COUNT, COLS)).toBe(0);
    expect(nextGridIndex(-1, 'right', COUNT, COLS)).toBe(0);
  });

  it('enters at the last card when nothing is focused and End is pressed', () => {
    expect(nextGridIndex(-1, 'end', COUNT, COLS)).toBe(COUNT - 1);
  });

  it('clamps a focus index the collection no longer contains', () => {
    // The filter narrowed under a stale focus index: 99 is not a card any more.
    expect(nextGridIndex(99, 'left', COUNT, COLS)).toBe(COUNT - 2);
    expect(nextGridIndex(99, 'down', COUNT, COLS)).toBe(COUNT - 1);
  });

  it('treats a zero or fractional column count as a single column', () => {
    expect(nextGridIndex(0, 'down', COUNT, 0)).toBe(1);
    expect(nextGridIndex(3, 'up', COUNT, 1.7)).toBe(2);
    expect(nextGridIndex(0, 'down', COUNT, Number.NaN)).toBe(1);
  });

  it('never returns an index outside the collection', () => {
    for (let count = 1; count <= 12; count++) {
      for (let columns = 1; columns <= 5; columns++) {
        for (let from = 0; from < count; from++) {
          for (const direction of ['left', 'right', 'up', 'down', 'home', 'end'] as const) {
            const next = nextGridIndex(from, direction, count, columns);
            expect(next).toBeGreaterThanOrEqual(0);
            expect(next).toBeLessThan(count);
          }
        }
      }
    }
  });
});

describe('gridDirectionFor', () => {
  it('maps the arrow keys', () => {
    expect(gridDirectionFor('ArrowLeft')).toBe('left');
    expect(gridDirectionFor('ArrowRight')).toBe('right');
    expect(gridDirectionFor('ArrowUp')).toBe('up');
    expect(gridDirectionFor('ArrowDown')).toBe('down');
  });

  it('maps Home and End', () => {
    expect(gridDirectionFor('Home')).toBe('home');
    expect(gridDirectionFor('End')).toBe('end');
  });

  it('leaves every other key to the browser', () => {
    // Enter and Space are the native <button> activation and must NOT be claimed.
    for (const key of ['Enter', ' ', 'Tab', 'Escape', 'a', 'PageDown']) {
      expect(gridDirectionFor(key)).toBeNull();
    }
  });
});
