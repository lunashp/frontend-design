import { describe, it, expect } from 'vitest';
import {
  addToBasket,
  clearBasket,
  EMPTY_BASKET,
  inBasket,
  removeFromBasket,
  toggleInBasket,
  type Basket,
} from '../src/features/kit/basket.js';

describe('basket', () => {
  it('starts empty', () => {
    expect(EMPTY_BASKET.size).toBe(0);
    expect(inBasket(EMPTY_BASKET, 'a')).toBe(false);
  });

  it('adds an id and reports membership', () => {
    const next = addToBasket(EMPTY_BASKET, 'a');
    expect(inBasket(next, 'a')).toBe(true);
    expect(next.size).toBe(1);
  });

  it('does not mutate the input set when adding', () => {
    const before: Basket = new Set(['a']);
    const snapshot = new Set(before);
    const next = addToBasket(before, 'b');
    expect(before).toEqual(snapshot); // untouched
    expect(next).not.toBe(before); // fresh object
    expect(inBasket(next, 'b')).toBe(true);
    expect(inBasket(before, 'b')).toBe(false);
  });

  it('adding an existing id is idempotent in membership', () => {
    const first = addToBasket(EMPTY_BASKET, 'a');
    const again = addToBasket(first, 'a');
    expect(again.size).toBe(1);
    expect(inBasket(again, 'a')).toBe(true);
  });

  it('removes an id without mutating the input', () => {
    const before: Basket = new Set(['a', 'b']);
    const snapshot = new Set(before);
    const next = removeFromBasket(before, 'a');
    expect(before).toEqual(snapshot);
    expect(inBasket(next, 'a')).toBe(false);
    expect(inBasket(next, 'b')).toBe(true);
    expect(next.size).toBe(1);
  });

  it('removing an absent id yields an equal-membership fresh set', () => {
    const before: Basket = new Set(['a']);
    const next = removeFromBasket(before, 'zzz');
    expect([...next]).toEqual(['a']);
    expect(next).not.toBe(before);
  });

  it('toggles membership in both directions without mutating the input', () => {
    const before: Basket = new Set(['a']);
    const snapshot = new Set(before);

    const added = toggleInBasket(before, 'b');
    expect(inBasket(added, 'b')).toBe(true);

    const removed = toggleInBasket(before, 'a');
    expect(inBasket(removed, 'a')).toBe(false);

    expect(before).toEqual(snapshot); // both toggles left the input alone
  });

  it('clears to a fresh empty set', () => {
    const cleared = clearBasket();
    expect(cleared.size).toBe(0);
    expect(cleared).not.toBe(EMPTY_BASKET);
  });
});
