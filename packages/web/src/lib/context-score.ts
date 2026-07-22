/**
 * HAND-MAINTAINED MIRROR of the engine's `classify/context-score.ts` and the
 * `isStylingContext` half of `classify/styling-context.ts`. The browser bundle
 * never imports @ce/core (Node-only deps), and the API sends the finished score
 * without its terms, so the only way the gallery can answer "why is this a 6.5?"
 * is to recompute the breakdown here — from the same weights.
 *
 * Two copies of a weight table drift the first time one is tuned, which is the
 * exact failure the engine's single-table refactor exists to prevent, so
 * `packages/web/test/context-score-mirror.test.ts` runs both sides over the same
 * signals and fails on the first disagreement. Same arrangement as
 * `packages/web/src/lib/design-overrides.ts`. Change one side, change both.
 */

import type { ClassificationSignals } from '../api/types.js';

/** One term of the sum: what pushed the score up, and by how much. */
export interface ContextScoreContribution {
  /** What caused it — a signal name, or the consumed context's own hook name. */
  readonly label: string;
  readonly weight: number;
}

const WEIGHTS = {
  router: 2,
  store: 3,
  dataFetching: 3,
  /** Charged once per app-context consumer, so five contexts cost more than one. */
  appContext: 1.5,
  serverComponent: 1,
} as const;

const STYLING_CONTEXT =
  /^(use(Theme|ThemeUI|Styled(Theme)?|ColorMode|ColorScheme|DarkMode|Emotion(Theme)?|Tokens|DesignTokens|MediaQuery|Breakpoints?)|(Styled)?ThemeContext|ColorModeContext)$/;

/** True when a context consumer only affects how the component looks. */
export function isStylingContext(consumer: string): boolean {
  return STYLING_CONTEXT.test(consumer);
}

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
  for (const consumer of s.contextConsumers.filter((c) => !isStylingContext(c))) {
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
