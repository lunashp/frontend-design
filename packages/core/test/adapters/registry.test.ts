import { describe, it, expect } from 'vitest';
import { AdapterRegistry } from '../../src/adapters/registry.js';
import { UnsupportedFrameworkError } from '../../src/util/errors.js';
import type { FrameworkAdapter } from '../../src/types/adapter.js';
import type { Framework } from '../../src/types/project.js';

/** Minimal fake adapter exercising only detect()/id for registry tests. */
function fakeAdapter(id: Framework, confidence: number, matches = true): FrameworkAdapter {
  return {
    id,
    detect: () => ({ matches, confidence }),
    createProgram: () => ({ framework: id, project: {} as never, handle: null }),
    discoverComponents: () => [],
    extractProps: () => ({ props: [] }),
    extractSignals: () => ({
      childComponentCount: 0,
      jsxDepth: 0,
      hookNames: [],
      usesRouter: false,
      usesStore: false,
      usesDataFetching: false,
      contextConsumers: [],
      isClientComponent: true,
      propCount: 0,
    }),
    styleStrategies: () => [],
    sandpackTemplate: () => 'react-ts',
    buildEntry: () => '',
    generateProviderStubs: () => ({
      providersFile: '',
      wrapperJsxOpen: '',
      wrapperJsxClose: '',
      imports: '',
      dependencies: {},
      unresolved: [],
    }),
  };
}

describe('AdapterRegistry', () => {
  it('registers and retrieves adapters by id', () => {
    const reg = new AdapterRegistry().register(fakeAdapter('react', 1));
    expect(reg.has('react')).toBe(true);
    expect(reg.get('react').id).toBe('react');
    expect(reg.list()).toHaveLength(1);
  });

  it('throws for unregistered frameworks', () => {
    const reg = new AdapterRegistry();
    expect(() => reg.get('vue')).toThrow(UnsupportedFrameworkError);
  });

  it('detect() picks the highest-confidence match', () => {
    const reg = new AdapterRegistry()
      .register(fakeAdapter('react', 0.6))
      .register(fakeAdapter('vue', 0.9));
    expect(reg.detect({ rootPath: '/x' })?.id).toBe('vue');
  });

  it('detect() ignores non-matching adapters and returns null when none match', () => {
    const reg = new AdapterRegistry().register(fakeAdapter('react', 0.9, false));
    expect(reg.detect({ rootPath: '/x' })).toBeNull();
  });
});
