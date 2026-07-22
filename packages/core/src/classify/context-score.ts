/**
 * contextDependencyScore — the key signal for "will this render cheaply in
 * isolation?". 0 = a presentational atom; higher = more app context required.
 */

import type { ClassificationSignals } from '../types/component.js';
import { appContextConsumers } from './styling-context.js';

export function contextDependencyScore(s: ClassificationSignals): number {
  let score = 0;
  if (s.usesRouter) score += 2;
  if (s.usesStore) score += 3;
  if (s.usesDataFetching) score += 3;
  // Styling contexts cost nothing: a theme has a default or a stubbed provider,
  // so needing one does not stop the component rendering in isolation.
  score += appContextConsumers(s.contextConsumers).length * 1.5;
  if (!s.isClientComponent) score += 1;
  return Math.round(score * 10) / 10;
}
