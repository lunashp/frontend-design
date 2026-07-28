/**
 * contextDependencyScore — the key signal for "will this render cheaply in
 * isolation?". 0 = a presentational atom; higher = more app context required.
 *
 * The score is a bare verdict: shown on its own, nobody can tell whether a 4.5
 * came from a store or from three contexts, and a consumer that reconstructs
 * the breakdown needs its own copy of the weights — which then drifts the first
 * time one is tuned. So the sum and its explanation are produced by the SAME
 * pass over WEIGHTS, and the scorer is defined in terms of the explainer.
 */

import type { ClassificationSignals } from '../types/component.js';
import { appContextConsumers } from './styling-context.js';

/** One term of the sum: what pushed the score up, and by how much. */
export interface ContextScoreContribution {
  /** What caused it — a signal name, or the consumed context's own hook name. */
  readonly label: string;
  readonly weight: number;
}

/** The ONE definition of every weight. Nothing else may restate these numbers. */
const WEIGHTS = {
  router: 2,
  store: 3,
  dataFetching: 3,
  /** Charged once per app-context consumer, so five contexts cost more than one. */
  appContext: 1.5,
  serverComponent: 1,
} as const;

/** Weights land on halves, so one decimal is exact — this only trims float dust. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Every term behind `contextDependencyScore(s)`, in the order they are summed.
 * Empty when the score is 0 — there is nothing to explain about an atom.
 */
export function explainContextScore(
  s: ClassificationSignals,
): readonly ContextScoreContribution[] {
  const contributions: ContextScoreContribution[] = [];
  if (s.usesRouter) contributions.push({ label: 'routing', weight: WEIGHTS.router });
  if (s.usesStore) contributions.push({ label: 'store subscription', weight: WEIGHTS.store });
  if (s.usesDataFetching) {
    contributions.push({ label: 'data fetching', weight: WEIGHTS.dataFetching });
  }
  // Styling contexts cost nothing: a theme has a default or a stubbed provider,
  // so needing one does not stop the component rendering in isolation.
  for (const consumer of appContextConsumers(s.contextConsumers)) {
    contributions.push({ label: consumer, weight: WEIGHTS.appContext });
  }
  if (!s.isClientComponent) {
    contributions.push({ label: 'server component', weight: WEIGHTS.serverComponent });
  }
  return contributions;
}

export function contextDependencyScore(s: ClassificationSignals): number {
  return round1(explainContextScore(s).reduce((sum, c) => sum + c.weight, 0));
}
