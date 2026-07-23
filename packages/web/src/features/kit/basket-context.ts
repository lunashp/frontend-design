/**
 * Basket state, delivered by context rather than props.
 *
 * The basket toggle lives on `ComponentCard`, but the card is rendered by
 * `GalleryGrid` — which the kit feature does not own and must not change. Passing
 * basket state down as props would mean threading it through that grid. Context
 * lets `app.tsx` publish the controls and the card consume them directly, leaving
 * the grid untouched. The default value is a no-op so a card rendered outside a
 * provider (e.g. in isolation) is inert rather than a crash.
 */

import { createContext, useContext } from 'react';

export interface BasketControls {
  /** Whether this component id is currently in the basket. */
  readonly has: (id: string) => boolean;
  /** Add the id if absent, remove it if present. */
  readonly toggle: (id: string) => void;
  /** How many components are in the basket right now. */
  readonly count: number;
}

const INERT: BasketControls = {
  has: () => false,
  toggle: () => {},
  count: 0,
};

export const BasketContext = createContext<BasketControls>(INERT);

export function useBasket(): BasketControls {
  return useContext(BasketContext);
}
