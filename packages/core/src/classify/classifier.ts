/**
 * The Classifier — pure, filesystem-free. Turns a ComponentDescriptor + its
 * ClassificationSignals into a Classification (atomic level, kind, context score,
 * confidence). Fully unit-testable with synthetic signals.
 */

import type {
  Classification,
  ClassificationSignals,
  ComponentDescriptor,
} from '../types/component.js';
import { atomicLevel } from './atomic-level.js';
import { componentKind } from './kind.js';
import { contextDependencyScore } from './context-score.js';

function computeConfidence(s: ClassificationSignals): number {
  let c = 0.6;
  if (s.hookNames.length > 0 || s.childComponentCount > 0) c += 0.15;
  if (s.propCount > 0) c += 0.15;
  return Math.min(0.95, Math.round(c * 100) / 100);
}

export function classify(
  descriptor: ComponentDescriptor,
  signals: ClassificationSignals,
): Classification {
  return {
    atomicLevel: atomicLevel(descriptor.name, signals),
    kind: componentKind(descriptor.name, signals),
    contextDependencyScore: contextDependencyScore(signals),
    confidence: computeConfidence(signals),
  };
}
