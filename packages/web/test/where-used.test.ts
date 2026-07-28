import { describe, expect, it } from 'vitest';
import type { ComponentUsage, PortableBundle } from '../src/api/types.js';
import { mapUsedBy, mapUses } from '../src/features/inspector/where-used.js';

const ROOT = '/Users/me/proj';

describe('mapUsedBy', () => {
  it('makes importing files project-relative and keeps the exact count', () => {
    const usage: ComponentUsage = {
      usedByCount: 2,
      usedByFiles: [`${ROOT}/src/App.tsx`, `${ROOT}/src/pages/Home.tsx`],
    };
    const v = mapUsedBy(usage, ROOT);
    expect(v.count).toBe(2);
    expect(v.files).toEqual(['src/App.tsx', 'src/pages/Home.tsx']);
    expect(v.sampled).toBe(false);
    expect(v.none).toBe(false);
  });

  it('flags a sample when the count exceeds the listed files', () => {
    const usage: ComponentUsage = {
      usedByCount: 42,
      usedByFiles: Array.from({ length: 10 }, (_, i) => `${ROOT}/src/f${i}.tsx`),
    };
    const v = mapUsedBy(usage, ROOT);
    expect(v.count).toBe(42);
    expect(v.files).toHaveLength(10);
    expect(v.sampled).toBe(true);
    expect(v.none).toBe(false);
  });

  it('reports the honest zero case (no analyzed importers)', () => {
    expect(mapUsedBy({ usedByCount: 0, usedByFiles: [] }, ROOT)).toEqual({
      count: 0,
      files: [],
      sampled: false,
      none: true,
    });
  });

  it('treats missing usage (hand-built summary) as the zero case', () => {
    const v = mapUsedBy(undefined, ROOT);
    expect(v.none).toBe(true);
    expect(v.count).toBe(0);
    expect(v.files).toEqual([]);
  });
});

describe('mapUses', () => {
  function bundle(over: Partial<PortableBundle> = {}): PortableBundle {
    return {
      files: {},
      entryPath: '/Button.tsx',
      externalDeps: {},
      assets: [],
      warnings: [],
      stubbedModules: [],
      danglingImports: [],
      ...over,
    };
  }

  it('sorts external deps by name, carrying their versions', () => {
    const v = mapUses(bundle({ externalDeps: { react: '^19.0.0', clsx: '^2.0.0' } }));
    expect(v.deps).toEqual([
      { name: 'clsx', version: '^2.0.0' },
      { name: 'react', version: '^19.0.0' },
    ]);
    expect(v.selfContained).toBe(false);
  });

  it('reports self-contained when there are no deps, dangling, or stubs', () => {
    const v = mapUses(bundle());
    expect(v.deps).toEqual([]);
    expect(v.dangling).toEqual([]);
    expect(v.stubbed).toEqual([]);
    expect(v.selfContained).toBe(true);
  });

  it('carries unresolved dangling imports and stubbed modules verbatim', () => {
    const v = mapUses(
      bundle({
        danglingImports: ['/Button.tsx → ./missing'],
        stubbedModules: [
          {
            specifier: 'next/router',
            replacedWith: './__stubs__/next-router',
            lost: 'route awareness',
          },
        ],
      }),
    );
    expect(v.dangling).toEqual(['/Button.tsx → ./missing']);
    expect(v.stubbed).toEqual([
      { specifier: 'next/router', replacedWith: './__stubs__/next-router', lost: 'route awareness' },
    ]);
    expect(v.selfContained).toBe(false);
  });

  it('does not mutate the input bundle collections', () => {
    const deps = { react: '^19.0.0' };
    const b = bundle({ externalDeps: deps });
    mapUses(b);
    expect(b.externalDeps).toBe(deps);
    expect(Object.keys(deps)).toEqual(['react']);
  });
});
