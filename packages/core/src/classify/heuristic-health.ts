/**
 * Watches the signal detectors for the one failure mode they cannot report
 * themselves: silence.
 *
 * Measured motivation — the old STORE_HOOKS regex matched 0 of 617 files on a
 * Zustand target where 111 files read a store, because nobody names their hook
 * `useStore`. The scan reported "no component uses a store", which is exactly
 * what a healthy scan of a store-free project reports. A detector that has
 * stopped matching is indistinguishable from an absence unless something
 * outside the detector contradicts it.
 *
 * The contradiction used here is the target's own package.json: a project that
 * installs Zustand uses Zustand. Zero hits alongside a declared dependency is
 * either a real (and notable) absence or a broken heuristic, and the warning
 * says both — it never asserts a bug it cannot prove.
 *
 * This lives beside the classifiers rather than inside the pipeline because it
 * is a pure function of (summaries, package.json): it is the classifiers it
 * grades, and it is testable without a project on disk.
 */

import type { ComponentSummary, GradedSignal, HeuristicWarning } from '../types/artifact.js';
import type { ClassificationSignals } from '../types/component.js';
import type { PackageInfo } from '../types/project.js';

// The finding is part of the scan's wire contract (`ScanResult.heuristicWarnings`)
// and is declared there with it; re-exported here so this module still reads as
// the one place that owns detector grading.
export type { GradedSignal, HeuristicWarning };

/**
 * Below this many analysed components, a zero hit-rate carries no information.
 * A genuine zero has probability (1-p)^n for a true usage rate p: at n=40 and
 * p=5% that is still ~13%, and small projects legitimately keep every store
 * read in pages, hooks, or route handlers that are not components at all. Firing
 * there would put a warning on the projects least able to act on it — worse than
 * no rule, because a warning that cries wolf is one nobody reads on the 1000-
 * component project where it is actually diagnostic.
 */
const MIN_COMPONENTS = 40;

/**
 * Packages whose presence proves the corresponding signal has something to find.
 *
 * Deliberately NOT here: `next`. It is the framework itself rather than an
 * opt-in routing library, so a Next app that keeps navigation in an app shell
 * outside the component set would trip the router rule with a perfectly healthy
 * heuristic. Every entry below is a library a project only installs in order to
 * do the thing the signal detects.
 */
const CORROBORATING_DEPENDENCIES: Readonly<Record<GradedSignal, readonly string[]>> = {
  usesStore: [
    'zustand',
    'jotai',
    'recoil',
    'valtio',
    'redux',
    'react-redux',
    '@reduxjs/toolkit',
    'mobx-react',
    'mobx-react-lite',
  ],
  usesDataFetching: [
    '@tanstack/react-query',
    'react-query',
    'swr',
    '@apollo/client',
    'urql',
    '@urql/next',
  ],
  usesRouter: ['react-router', 'react-router-dom', '@tanstack/react-router', '@remix-run/react'],
};

/** What the signal means in a sentence, for the warning prose. */
const SIGNAL_PROSE: Readonly<Record<GradedSignal, string>> = {
  usesStore: 'store usage',
  usesDataFetching: 'data fetching',
  usesRouter: 'router usage',
};

function declaredDependency(pkg: PackageInfo, candidates: readonly string[]): string | null {
  return (
    candidates.find((name) => name in pkg.dependencies || name in pkg.devDependencies) ?? null
  );
}

function hitCount(
  components: readonly ComponentSummary[],
  signal: keyof ClassificationSignals,
): number {
  return components.filter((c) => c.signals[signal] === true).length;
}

/**
 * Signal detectors that produced ZERO hits across the scan while the project
 * declares a dependency that exists to be detected. Empty for every healthy
 * scan, and for every project too small for a zero to mean anything.
 */
export function detectDegenerateHeuristics(
  components: readonly ComponentSummary[],
  pkg: PackageInfo,
): readonly HeuristicWarning[] {
  const scanned = components.length;
  if (scanned < MIN_COMPONENTS) return [];

  const warnings: HeuristicWarning[] = [];
  for (const [signal, candidates] of Object.entries(CORROBORATING_DEPENDENCIES) as [
    GradedSignal,
    readonly string[],
  ][]) {
    // Any hit at all proves the heuristic still matches this project's
    // conventions. A LOW rate is a legitimate shape and is never second-guessed
    // — only the complete silence the detector cannot distinguish from absence.
    if (hitCount(components, signal) > 0) continue;
    const dependency = declaredDependency(pkg, candidates);
    if (!dependency) continue;
    warnings.push({
      signal,
      dependency,
      scanned,
      message:
        `Heuristic check: this project depends on "${dependency}", but ${SIGNAL_PROSE[signal]} ` +
        `was detected in 0 of ${scanned} components. Either no component uses it, or the ` +
        `${signal} heuristic no longer matches this project's naming conventions.`,
    });
  }
  return warnings;
}
