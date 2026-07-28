import { describe, expect, it } from 'vitest';
import type { PropControl } from '../src/api/types.js';
import { MAX_VARIANT_CELLS, buildVariantMatrix } from '../src/features/variants/variant-matrix.js';

function prop(name: string, kind: PropControl['kind'], options?: string[]): PropControl {
  return { name, tsType: kind, kind, options, required: false };
}
const enumProp = (name: string, ...options: string[]) => prop(name, 'enum', options);
const boolProp = (name: string) => prop(name, 'boolean');

describe('buildVariantMatrix — enumerable detection', () => {
  it('reports empty when there are NO enumerable props', () => {
    const m = buildVariantMatrix([
      prop('label', 'string'),
      prop('count', 'number'),
      prop('children', 'node'),
      // A single-option enum has nothing to vary, so it is not enumerable either.
      enumProp('single', 'only'),
    ]);
    expect(m.empty).toBe(true);
    expect(m.cells).toEqual([]);
    expect(m.total).toBe(0);
    expect(m.shown).toBe(0);
    expect(m.variedProps).toEqual([]);
  });

  it('treats a single boolean as two cells (true / false)', () => {
    const m = buildVariantMatrix([boolProp('disabled')]);
    expect(m.empty).toBe(false);
    expect(m.total).toBe(2);
    expect(m.shown).toBe(2);
    expect(m.capped).toBe(false);
    expect(m.variedProps).toEqual(['disabled']);
    expect(m.cells.map((c) => c.propOverrides)).toEqual([{ disabled: true }, { disabled: false }]);
    // Boolean true reads as the bare prop name; false is spelled out.
    expect(m.cells.map((c) => c.caption)).toEqual(['disabled', 'disabled=false']);
  });

  it('takes the cartesian product of two selects, first prop outermost', () => {
    const m = buildVariantMatrix([
      enumProp('variant', 'solid', 'outline'),
      enumProp('size', 'sm', 'lg'),
    ]);
    expect(m.total).toBe(4);
    expect(m.shown).toBe(4);
    expect(m.capped).toBe(false);
    expect(m.cells.map((c) => c.caption)).toEqual([
      'variant=solid · size=sm',
      'variant=solid · size=lg',
      'variant=outline · size=sm',
      'variant=outline · size=lg',
    ]);
    // Keys are stable & unique so React can list them.
    expect(new Set(m.cells.map((c) => c.key)).size).toBe(4);
  });
});

describe('buildVariantMatrix — capping', () => {
  it('caps an over-limit space and discloses the REAL total', () => {
    // 4 × 3 × 2 × 2 = 48 combinations, far over the cap.
    const m = buildVariantMatrix([
      enumProp('variant', 'a', 'b', 'c', 'd'),
      enumProp('size', 's', 'm', 'l'),
      enumProp('color', 'x', 'y'),
      boolProp('disabled'),
    ]);
    expect(m.total).toBe(48);
    expect(m.shown).toBeLessThanOrEqual(MAX_VARIANT_CELLS);
    expect(m.capped).toBe(true);
    // Highest-signal props vary first: variant (4) × size (3) = 12 ≤ 16.
    expect(m.variedProps).toEqual(['variant', 'size']);
    expect(m.pinnedProps).toEqual(['color', 'disabled']);
    expect(m.shown).toBe(12);
    // Pinned props never appear in a cell's overrides (held at host defaults).
    for (const cell of m.cells) {
      expect(Object.keys(cell.propOverrides).sort()).toEqual(['size', 'variant']);
    }
  });

  it('slices a single enum whose options alone exceed the cap', () => {
    const options = Array.from({ length: 20 }, (_, i) => `o${i}`);
    const m = buildVariantMatrix([enumProp('variant', ...options)]);
    expect(m.total).toBe(20);
    expect(m.shown).toBe(MAX_VARIANT_CELLS);
    expect(m.capped).toBe(true);
    expect(m.variedProps).toEqual(['variant']);
  });

  it('honours a custom cap argument', () => {
    const m = buildVariantMatrix(
      [enumProp('variant', 'a', 'b', 'c'), enumProp('size', 's', 'm', 'l')],
      4,
    );
    expect(m.total).toBe(9);
    expect(m.shown).toBeLessThanOrEqual(4);
    expect(m.capped).toBe(true);
  });
});

describe('buildVariantMatrix — highest-signal-first ordering', () => {
  it('varies variant/size before a non-signal prop declared first', () => {
    // `alpha` is declared first but carries no signal; variant+size should win
    // the limited cell budget. alpha(2) × variant(4) × size(3) = 24 > 16.
    const m = buildVariantMatrix([
      enumProp('alpha', 'p', 'q'),
      enumProp('variant', 'a', 'b', 'c', 'd'),
      enumProp('size', 's', 'm', 'l'),
    ]);
    expect(m.total).toBe(24);
    expect(m.capped).toBe(true);
    expect(m.variedProps).toEqual(['variant', 'size']);
    expect(m.pinnedProps).toEqual(['alpha']);
  });

  it('matches signal names case-insensitively', () => {
    const m = buildVariantMatrix([
      enumProp('Nope', 'p', 'q'),
      enumProp('Variant', 'a', 'b', 'c', 'd'),
      enumProp('Size', 's', 'm', 'l'),
    ]);
    expect(m.variedProps).toEqual(['Variant', 'Size']);
  });

  it('falls back to first-declared order among equal (non-signal) props', () => {
    // Two 5-option non-signal enums: 25 > 16, so only one can vary — the first.
    const m = buildVariantMatrix([
      enumProp('aaa', 'a1', 'a2', 'a3', 'a4', 'a5'),
      enumProp('bbb', 'b1', 'b2', 'b3', 'b4', 'b5'),
    ]);
    expect(m.total).toBe(25);
    expect(m.variedProps).toEqual(['aaa']);
    expect(m.shown).toBe(5);
  });
});
