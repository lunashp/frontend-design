/**
 * contextDependencyScore — the key signal for "will this render cheaply in
 * isolation?". 0 = a presentational atom; higher = more app context required.
 */

import type { ClassificationSignals } from '../types/component.js';

export function contextDependencyScore(s: ClassificationSignals): number {
  let score = 0;
  if (s.usesRouter) score += 2;
  if (s.usesStore) score += 3;
  if (s.usesDataFetching) score += 3;
  score += s.contextConsumers.length * 1.5;
  if (!s.isClientComponent) score += 1;
  return Math.round(score * 10) / 10;
}
