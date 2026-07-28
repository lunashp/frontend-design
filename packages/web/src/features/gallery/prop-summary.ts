/**
 * The card's prop count, made honest.
 *
 * It used to render `propModel.props.length`. For a wrapper around a library
 * component that number describes the LIBRARY: CustomAvatar reads 63 and
 * CustomTextField 82, while they declare 3 and 0 props of their own. Leading
 * with the own count and demoting the inherited surface to a secondary figure
 * makes the card answer "how big is this component's API?" instead of "how big
 * is MUI's?".
 *
 * Pure, so it is unit-tested without a DOM.
 */

import type { PropModel } from '../../api/types.js';

export interface PropSummary {
  /** The number to render large. */
  readonly lead: number;
  /** Word after `lead`: "own" when there is an inherited surface to contrast. */
  readonly noun: string;
  /** False when the engine could not determine the split — `lead` is the total. */
  readonly determined: boolean;
  readonly inherited: number;
  readonly unclassified: number;
  readonly total: number;
  /** Hover text spelling out where the numbers come from. */
  readonly title: string;
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

export function propSummary(model: PropModel): PropSummary {
  const total = model.props.length;
  const inherited = model.props.filter((p) => p.origin === 'inherited').length;
  const unclassified = model.props.filter((p) => p.origin === 'unknown').length;

  // `ownPropCount === null` means the engine could not resolve the props type,
  // so it has NO opinion. Rendering 0 there would assert the component declares
  // nothing of its own — a claim, not a measurement.
  if (model.ownPropCount === null) {
    return {
      lead: total,
      noun: plural(total, 'prop'),
      determined: false,
      inherited,
      unclassified,
      total,
      title:
        `${total} ${plural(total, 'prop')} in total. Which of them this component ` +
        'declares itself could not be determined, so the full count is shown.',
    };
  }

  const own = model.ownPropCount;
  const parts = [`${own} ${plural(own, 'prop')} declared by this component`];
  if (inherited > 0) parts.push(`${inherited} inherited from the components it wraps`);
  if (unclassified > 0) parts.push(`${unclassified} could not be placed`);

  return {
    lead: own,
    // With nothing inherited, "own" implies a distinction the component has not
    // got — a plain component's props are simply its props.
    noun: inherited > 0 ? 'own' : plural(own, 'prop'),
    determined: true,
    inherited,
    unclassified,
    total,
    title: `${parts.join(', ')}.`,
  };
}
