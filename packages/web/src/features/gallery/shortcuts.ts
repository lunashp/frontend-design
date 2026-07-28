/**
 * The one guard every global shortcut needs: a text field owns the keys typed
 * into it.
 *
 * Without it `/` would yank focus out of the scan form mid-path — you could not
 * type `/Users/...` at all — and Escape would close the inspector instead of
 * clearing the filter it was pressed in. Kept in its own module because the
 * filter input (Filters.tsx) and the app-level Escape handler (app.tsx) must
 * agree on the answer; two copies would eventually disagree.
 *
 * DOM-touching by nature, so it is not part of the pure, unit-tested surface —
 * `instanceof` is the only reliable way to ask, and there is no jsdom here.
 */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
