/**
 * `packages/web/src/lib/context-score.ts` is a hand-maintained mirror of the
 * engine's `classify/context-score.ts` + `classify/styling-context.ts`: the
 * browser bundle never imports @ce/core, so the weights exist twice and would
 * drift silently the first time one is tuned — the exact failure the engine's
 * single-weight-table refactor exists to prevent.
 *
 * It follows `packages/core/test/customize/design-overrides-mirror.test.ts`:
 * compare BEHAVIOUR on both sides, not file text, so doc comments and the DTO's
 * mutable-vs-readonly types never make it fail. It lives here rather than in
 * core/test because core is a different lane's file set.
 */

import { describe, it, expect } from 'vitest';
import * as core from '../../core/src/classify/context-score.js';
import * as coreStyling from '../../core/src/classify/styling-context.js';
import * as mirror from '../src/lib/context-score.js';
import type { ClassificationSignals } from '../src/api/types.js';

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

/** Every branch of the scorer, plus the combinations that stack. */
const CASES: ReadonlyArray<readonly [string, ClassificationSignals]> = [
  ['an isolated atom', signals()],
  ['routing', signals({ usesRouter: true })],
  ['a store subscription', signals({ usesStore: true })],
  ['data fetching', signals({ usesDataFetching: true })],
  ['a server component', signals({ isClientComponent: false })],
  ['one app context', signals({ contextConsumers: ['useAuth'] })],
  ['several app contexts', signals({ contextConsumers: ['useAuth', 'useCart', 'useSession'] })],
  ['a styling context only', signals({ contextConsumers: ['useTheme'] })],
  ['styling mixed with app context', signals({ contextConsumers: ['useTheme', 'useAuth'] })],
  [
    'everything at once',
    signals({
      usesRouter: true,
      usesStore: true,
      usesDataFetching: true,
      isClientComponent: false,
      contextConsumers: ['useTheme', 'useAuth', 'useFlags'],
    }),
  ],
];

describe('web context-score mirror', () => {
  it.each(CASES)('explains %s identically to the engine', (_label, s) => {
    expect(mirror.explainContextScore(s)).toEqual([...core.explainContextScore(s)]);
  });

  it.each(CASES)('scores %s identically to the engine', (_label, s) => {
    expect(mirror.contextDependencyScore(s)).toBe(core.contextDependencyScore(s));
  });

  it('agrees on which context consumers are styling-only', () => {
    for (const consumer of [
      'useTheme',
      'useColorMode',
      'useDarkMode',
      'ThemeContext',
      'useBreakpoint',
      'useAuth',
      'useThemePicker',
      'useSession',
    ]) {
      expect(mirror.isStylingContext(consumer)).toBe(coreStyling.isStylingContext(consumer));
    }
  });

  it('self-guard: the cases actually exercise non-zero, differing scores', () => {
    // Without this, a mirror that returned [] for everything would pass.
    const scores = CASES.map(([, s]) => mirror.contextDependencyScore(s));
    expect(new Set(scores).size).toBeGreaterThan(3);
    expect(Math.max(...scores)).toBeGreaterThan(8);
  });

  it('sums exactly to the score it explains', () => {
    for (const [, s] of CASES) {
      const sum = mirror.explainContextScore(s).reduce((n, c) => n + c.weight, 0);
      expect(Math.round(sum * 10) / 10).toBe(mirror.contextDependencyScore(s));
    }
  });
});
