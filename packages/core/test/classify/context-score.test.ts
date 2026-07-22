/**
 * The score alone is a verdict with no argument attached: a consumer showing
 * "4.5" cannot say which signal bought which part of it without re-deriving the
 * weights, and a second copy of the weights drifts from the scorer the first
 * time one of them is tuned. These tests pin the two together.
 */

import { describe, it, expect } from 'vitest';
import {
  contextDependencyScore,
  explainContextScore,
} from '../../src/classify/context-score.js';
import type { ClassificationSignals } from '../../src/types/component.js';

function signals(over: Partial<ClassificationSignals> = {}): ClassificationSignals {
  return {
    childComponentCount: 0,
    jsxDepth: 1,
    hookNames: [],
    usesRouter: false,
    usesStore: false,
    usesDataFetching: false,
    contextConsumers: [],
    isClientComponent: true,
    propCount: 0,
    ...over,
  };
}

function total(s: ClassificationSignals): number {
  const sum = explainContextScore(s).reduce((acc, c) => acc + c.weight, 0);
  return Math.round(sum * 10) / 10;
}

const CASES: ReadonlyArray<readonly [string, Partial<ClassificationSignals>]> = [
  ['a presentational atom', {}],
  ['a routed component', { usesRouter: true }],
  ['a store consumer', { usesStore: true }],
  ['a data fetcher', { usesDataFetching: true }],
  ['a server component', { isClientComponent: false }],
  ['one app context', { contextConsumers: ['useAuth'] }],
  ['three app contexts', { contextConsumers: ['useAuth', 'useSession', 'useCart'] }],
  ['theme only', { contextConsumers: ['useTheme'] }],
  ['theme plus app context', { contextConsumers: ['useTheme', 'useAuth'] }],
  [
    'everything at once',
    {
      usesRouter: true,
      usesStore: true,
      usesDataFetching: true,
      isClientComponent: false,
      contextConsumers: ['useTheme', 'useAuth'],
    },
  ],
];

describe('explainContextScore', () => {
  it.each(CASES)('contributions sum to the score for %s', (_label, over) => {
    const s = signals(over);
    expect(total(s)).toBe(contextDependencyScore(s));
  });

  it('returns nothing to explain when the score is zero', () => {
    expect(explainContextScore(signals())).toEqual([]);
  });

  it('names each app context consumer individually so a UI can list them', () => {
    const s = signals({ contextConsumers: ['useAuth', 'useCart'] });
    const labels = explainContextScore(s).map((c) => c.label);
    expect(labels).toContain('useAuth');
    expect(labels).toContain('useCart');
  });

  it('omits styling contexts, exactly as the scorer does', () => {
    // useTheme is free (see styling-context.ts). An explainer that listed it
    // with a weight would contradict the score it is supposed to explain.
    const s = signals({ contextConsumers: ['useTheme'] });
    expect(explainContextScore(s)).toEqual([]);
    expect(contextDependencyScore(s)).toBe(0);
  });

  it('explains a mixed score term by term', () => {
    const s = signals({ usesStore: true, usesDataFetching: true, contextConsumers: ['useAuth'] });
    expect(contextDependencyScore(s)).toBe(7.5);
    expect(explainContextScore(s).map((c) => c.weight)).toEqual([3, 3, 1.5]);
  });
});
