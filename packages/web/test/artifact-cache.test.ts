import { describe, it, expect, beforeEach } from 'vitest';
import {
  artifactCacheKey,
  getCachedArtifact,
  setCachedArtifact,
  clearArtifactCache,
} from '../src/api/useArtifact.js';
import type { ComponentArtifact } from '../src/api/types.js';

function fakeArtifact(id: string): ComponentArtifact {
  return {
    descriptor: {
      id,
      name: id,
      filePath: `/${id}.tsx`,
      exportName: id,
      isDefaultExport: false,
      loc: { file: `/${id}.tsx`, line: 1, column: 1 },
    },
    classification: { atomicLevel: 'atom', kind: 'presentational', contextDependencyScore: 0, confidence: 1 },
    signals: {
      childComponentCount: 0,
      jsxDepth: 1,
      hookNames: [],
      usesRouter: false,
      usesStore: false,
      usesDataFetching: false,
      contextConsumers: [],
      isClientComponent: false,
      propCount: 0,
    },
    propModel: { props: [] },
    artifactVersion: 1,
    bundle: {
      files: {},
      entryPath: `/${id}.tsx`,
      externalDeps: {},
      assets: [],
      warnings: [],
      stubbedModules: [],
      danglingImports: [],
    },
    tokenModel: { tokens: [] },
    sandpack: {
      files: {},
      entryPath: '/index.tsx',
      template: 'react-ts',
      dependencies: {},
      renderability: 'full',
      notes: [],
    },
  };
}

describe('artifactCacheKey', () => {
  it('is stable for the same project + id', () => {
    expect(artifactCacheKey('/proj', 'a')).toBe(artifactCacheKey('/proj', 'a'));
  });

  it('separates by id and by project', () => {
    expect(artifactCacheKey('/proj', 'a')).not.toBe(artifactCacheKey('/proj', 'b'));
    expect(artifactCacheKey('/proj', 'a')).not.toBe(artifactCacheKey('/other', 'a'));
  });
});

describe('artifact cache get/set', () => {
  beforeEach(() => clearArtifactCache());

  it('returns undefined on a miss', () => {
    expect(getCachedArtifact(artifactCacheKey('/proj', 'missing'))).toBeUndefined();
  });

  it('round-trips a stored artifact by key so a re-open is instant', () => {
    const key = artifactCacheKey('/proj', 'a');
    const art = fakeArtifact('a');
    setCachedArtifact(key, art);
    expect(getCachedArtifact(key)).toBe(art);
  });

  it('does not confuse two projects that share an id', () => {
    setCachedArtifact(artifactCacheKey('/projA', 'shared'), fakeArtifact('A'));
    setCachedArtifact(artifactCacheKey('/projB', 'shared'), fakeArtifact('B'));
    expect(getCachedArtifact(artifactCacheKey('/projA', 'shared'))?.descriptor.name).toBe('A');
    expect(getCachedArtifact(artifactCacheKey('/projB', 'shared'))?.descriptor.name).toBe('B');
  });

  it('clearArtifactCache empties the store', () => {
    const key = artifactCacheKey('/proj', 'a');
    setCachedArtifact(key, fakeArtifact('a'));
    clearArtifactCache();
    expect(getCachedArtifact(key)).toBeUndefined();
  });
});
