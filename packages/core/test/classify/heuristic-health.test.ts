/**
 * A signal detector that silently never fires is indistinguishable, in the
 * output, from a project that genuinely has nothing to detect. The measured
 * case: the old STORE_HOOKS regex matched 0 of 617 files on a target where 111
 * files read a Zustand store, and the scan reported that as "no stores" without
 * a word of doubt. These tests pin the detection of that collapse.
 */

import { describe, it, expect } from 'vitest';
import { detectDegenerateHeuristics } from '../../src/classify/heuristic-health.js';
import type { ComponentSummary } from '../../src/types/artifact.js';
import type { ClassificationSignals } from '../../src/types/component.js';
import type { PackageInfo } from '../../src/types/project.js';

function pkg(deps: Readonly<Record<string, string>> = {}): PackageInfo {
  return { name: 'target', dependencies: deps, devDependencies: {} };
}

function summary(index: number, over: Partial<ClassificationSignals> = {}): ComponentSummary {
  const name = `C${index}`;
  const signals: ClassificationSignals = {
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
  return {
    descriptor: {
      id: name,
      name,
      filePath: `/${name}.tsx`,
      exportName: name,
      isDefaultExport: false,
      loc: { file: `/${name}.tsx`, line: 1, column: 1 },
    },
    classification: {
      atomicLevel: 'atom',
      kind: 'presentational',
      contextDependencyScore: 0,
      confidence: 0.8,
    },
    signals,
    propModel: { props: [] },
  };
}

/** `n` components, of which the first `hits` carry `over`. */
function components(n: number, hits = 0, over: Partial<ClassificationSignals> = {}): ComponentSummary[] {
  return Array.from({ length: n }, (_, i) => (i < hits ? summary(i, over) : summary(i)));
}

describe('detectDegenerateHeuristics', () => {
  it('reports a store detector that never fired on a project that depends on zustand', () => {
    const warnings = detectDegenerateHeuristics(components(200), pkg({ zustand: '^4.5.0' }));
    expect(warnings).toHaveLength(1);
    const [w] = warnings;
    expect(w!.signal).toBe('usesStore');
    expect(w!.dependency).toBe('zustand');
    expect(w!.scanned).toBe(200);
    expect(w!.message).toMatch(/zustand/);
    expect(w!.message).toMatch(/0 of 200/);
  });

  it('stays quiet as soon as the detector fires even once', () => {
    // One hit proves the heuristic still matches this project's conventions.
    // A LOW rate is a legitimate project shape and must not be second-guessed.
    const warnings = detectDegenerateHeuristics(
      components(200, 1, { usesStore: true }),
      pkg({ zustand: '^4.5.0' }),
    );
    expect(warnings).toEqual([]);
  });

  it('stays quiet when the library is not a declared dependency', () => {
    // Zero hits with no corroborating dependency is just a project without
    // stores — the overwhelmingly common case, and never worth a warning.
    expect(detectDegenerateHeuristics(components(200), pkg())).toEqual([]);
  });

  it('stays quiet on a project too small for a zero to mean anything', () => {
    const warnings = detectDegenerateHeuristics(components(12), pkg({ zustand: '^4.5.0' }));
    expect(warnings).toEqual([]);
  });

  it('checks devDependencies too', () => {
    const warnings = detectDegenerateHeuristics(components(200), {
      name: 'target',
      dependencies: {},
      devDependencies: { swr: '^2.2.0' },
    });
    expect(warnings.map((w) => w.signal)).toEqual(['usesDataFetching']);
  });

  it('reports every collapsed detector, not just the first', () => {
    const warnings = detectDegenerateHeuristics(
      components(200),
      pkg({ zustand: '^4.5.0', swr: '^2.2.0', 'react-router-dom': '^6.26.0' }),
    );
    expect(warnings.map((w) => w.signal).sort()).toEqual([
      'usesDataFetching',
      'usesRouter',
      'usesStore',
    ]);
  });

  it('names one dependency per signal rather than repeating the signal', () => {
    const warnings = detectDegenerateHeuristics(
      components(200),
      pkg({ zustand: '^4.5.0', 'react-redux': '^9.1.0', jotai: '^2.9.0' }),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.dependency).toMatch(/zustand|react-redux|jotai/);
  });

  it('does not treat next as proof that components must route', () => {
    // `next` is the framework itself, not an opt-in routing library: a Next app
    // can legitimately keep every navigation in an app shell that is not a
    // scanned component. Treating it as corroboration would fire on Next
    // projects with a perfectly healthy router heuristic.
    expect(detectDegenerateHeuristics(components(200), pkg({ next: '^15.0.0' }))).toEqual([]);
  });

  it('says both explanations out loud instead of asserting a bug', () => {
    const [w] = detectDegenerateHeuristics(components(200), pkg({ zustand: '^4.5.0' }));
    expect(w!.message).toMatch(/Either/i);
  });
});
