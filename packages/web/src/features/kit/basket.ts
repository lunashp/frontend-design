/**
 * The kit basket: the set of component ids the user has marked to harvest
 * together into one PortableKit.
 *
 * Held as an immutable `ReadonlySet` so a toggle in the gallery never mutates the
 * value React is already rendering from. Every operation returns a FRESH set and
 * leaves the input untouched — a mutated Set would keep the same reference, so
 * React would skip the re-render and the basket count would silently lag the UI
 * (the concrete bug the immutability rule prevents here).
 */

export type Basket = ReadonlySet<string>;

/**
 * The initial empty basket. Typed `ReadonlySet` so callers cannot `.add()` to
 * this shared constant (Object.freeze does not protect a Set's internal slots,
 * so the type is the real guard); all mutations go through the copying helpers.
 */
export const EMPTY_BASKET: Basket = new Set<string>();

export function inBasket(basket: Basket, id: string): boolean {
  return basket.has(id);
}

export function addToBasket(basket: Basket, id: string): Set<string> {
  const next = new Set(basket);
  next.add(id);
  return next;
}

export function removeFromBasket(basket: Basket, id: string): Set<string> {
  const next = new Set(basket);
  next.delete(id);
  return next;
}

export function toggleInBasket(basket: Basket, id: string): Set<string> {
  return basket.has(id) ? removeFromBasket(basket, id) : addToBasket(basket, id);
}

export function clearBasket(): Set<string> {
  return new Set<string>();
}
