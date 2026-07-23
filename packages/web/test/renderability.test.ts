import { describe, it, expect } from 'vitest';
import { renderabilityLabel } from '../src/features/preview/renderability.js';
import type { ComponentArtifact, PortableBundle, Renderability, StubbedModule } from '../src/api/types.js';

function artifact(opts: {
  renderability: Renderability;
  previewTheme?: boolean;
  stubbedModules?: StubbedModule[];
}): ComponentArtifact {
  const bundle: PortableBundle = {
    files: { '/C.tsx': 'export const C = () => null;' },
    entryPath: '/C.tsx',
    externalDeps: {},
    assets: [],
    warnings: [],
    stubbedModules: opts.stubbedModules ?? [],
    danglingImports: [],
    ...(opts.previewTheme ? { previewTheme: { path: '/theme.ts', exportName: 'theme' } } : {}),
  };
  return {
    descriptor: {
      id: 'c1',
      name: 'C',
      filePath: '/C.tsx',
      exportName: 'C',
      isDefaultExport: false,
      loc: { file: '/C.tsx', line: 1, column: 1 },
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
    bundle,
    tokenModel: { tokens: [] },
    sandpack: {
      files: {},
      entryPath: '/index.tsx',
      template: 'react-ts',
      dependencies: {},
      renderability: opts.renderability,
      notes: [],
    },
  };
}

describe('renderabilityLabel', () => {
  it('marks a full render with the app theme as FAITHFUL, not merely isolated', () => {
    const l = renderabilityLabel(artifact({ renderability: 'full', previewTheme: true }));
    expect(l.tone).toBe('ok');
    expect(l.themeSupplied).toBe(true);
    expect(l.label.toLowerCase()).toContain('faithful');
  });

  it('marks a full render without app theme as ISOLATED', () => {
    const l = renderabilityLabel(artifact({ renderability: 'full', previewTheme: false }));
    expect(l.tone).toBe('ok');
    expect(l.themeSupplied).toBe(false);
    expect(l.label.toLowerCase()).toContain('isolated');
    // Must not overclaim faithfulness when the real theme was never supplied.
    expect(l.label.toLowerCase()).not.toContain('faithful');
  });

  it('marks a stubbed render as STUBBED and warns', () => {
    const l = renderabilityLabel(artifact({ renderability: 'stubbed' }));
    expect(l.tone).toBe('warn');
    expect(l.label.toLowerCase()).toContain('stubbed');
  });

  it('lists exactly what was stubbed, naming the specifier and the capability lost', () => {
    const stub: StubbedModule = {
      specifier: 'next/router',
      replacedWith: './__stubs__/next-router',
      lost: 'client-side prefetch and route awareness',
    };
    const l = renderabilityLabel(artifact({ renderability: 'stubbed', stubbedModules: [stub] }));
    expect(l.stubbed).toHaveLength(1);
    expect(l.stubbed[0]).toContain('next/router');
    expect(l.stubbed[0]).toContain('client-side prefetch and route awareness');
  });

  it('distinguishes a stubbed render that still used the real theme', () => {
    const bare = renderabilityLabel(artifact({ renderability: 'stubbed', previewTheme: false }));
    const themed = renderabilityLabel(artifact({ renderability: 'stubbed', previewTheme: true }));
    expect(bare.themeSupplied).toBe(false);
    expect(themed.themeSupplied).toBe(true);
    // Same verdict, different honesty about the theme.
    expect(bare.blurb).not.toBe(themed.blurb);
  });

  it('marks code-only as the most severe tone', () => {
    const l = renderabilityLabel(artifact({ renderability: 'code-only' }));
    expect(l.tone).toBe('danger');
    expect(l.label.toLowerCase()).toContain('code');
  });
});
