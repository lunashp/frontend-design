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
import type { PropModel } from '../types/prop-model.js';
import { atomicLevel } from './atomic-level.js';
import { componentKind } from './kind.js';
import { componentRole } from './role.js';
import { contextDependencyScore } from './context-score.js';

/** Shared empty prop contract, so the default arg never allocates per call. */
const NO_PROPS: PropModel = { props: [] };

function computeConfidence(s: ClassificationSignals): number {
  let c = 0.6;
  if (s.hookNames.length > 0 || s.childComponentCount > 0) c += 0.15;
  if (s.propCount > 0) c += 0.15;
  return Math.min(0.95, Math.round(c * 100) / 100);
}

export function classify(
  descriptor: ComponentDescriptor,
  signals: ClassificationSignals,
  // Optional so the many 2-arg synthetic-signal callers (tests) still compile;
  // a real scan always passes the extracted prop model, which the role facet
  // needs for its prop-contract signal (value+onChange, open+onClose, …).
  propModel: PropModel = NO_PROPS,
): Classification {
  return {
    atomicLevel: atomicLevel(descriptor.name, signals),
    kind: componentKind(descriptor.name, signals),
    role: componentRole(
      descriptor.name,
      signals,
      propModel.props.map((p) => p.name),
    ),
    contextDependencyScore: contextDependencyScore(signals),
    confidence: computeConfidence(signals),
  };
}
