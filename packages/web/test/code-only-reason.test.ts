import { describe, expect, it } from 'vitest';
import type { PortableBundle } from '../src/api/types.js';
import { classifyCodeOnly } from '../src/features/preview/code-only-reason.js';

/**
 * A code-only component used to show one generic "can't render" line whatever
 * the reason. These prove the reason is now specific — above all that a genuine
 * Server Component is named as such (an architectural fact), not lumped in with
 * "too complex".
 */

function bundle(over: Partial<PortableBundle>): PortableBundle {
  return {
    files: {},
    entryPath: '/index.tsx',
    externalDeps: {},
    assets: [],
    warnings: [],
    stubbedModules: [],
    danglingImports: [],
    ...over,
  };
}

describe('classifyCodeOnly', () => {
  it('names a Server Component from the engine’s server-only warning', () => {
    const r = classifyCodeOnly(
      bundle({ warnings: ['Uses server-only Next.js modules that cannot be stubbed: next/headers.'] }),
    );
    expect(r.kind).toBe('server-component');
    expect(r.headline).toMatch(/Server Component/i);
    expect(r.detail).toMatch(/Portable tab/);
  });

  it('names a Server Component from an unstubbed next/* dep', () => {
    expect(classifyCodeOnly(bundle({ externalDeps: { next: '^15' } })).kind).toBe('server-component');
    expect(classifyCodeOnly(bundle({ externalDeps: { 'next/server': '^15' } })).kind).toBe(
      'server-component',
    );
    expect(classifyCodeOnly(bundle({ externalDeps: { 'react-dom/server': '^19' } })).kind).toBe(
      'server-component',
    );
  });

  it('flags a Node.js runtime dependency', () => {
    expect(classifyCodeOnly(bundle({ externalDeps: { fs: '*' } })).kind).toBe('node-runtime');
    expect(classifyCodeOnly(bundle({ externalDeps: { 'node:crypto': '*' } })).kind).toBe(
      'node-runtime',
    );
  });

  it('flags a workspace/local dependency the sandbox can’t install', () => {
    const r = classifyCodeOnly(bundle({ externalDeps: { '@company/ui': 'workspace:*' } }));
    expect(r.kind).toBe('unresolvable-deps');
    expect(r.detail).toMatch(/@company\/ui/);
  });

  it('server-only takes precedence over an also-uninstallable dep', () => {
    // Worst-and-most-specific first: a server component that ALSO has a workspace
    // dep is still, primarily, a server component.
    const r = classifyCodeOnly(
      bundle({ externalDeps: { next: '^15', '@company/ui': 'workspace:*' } }),
    );
    expect(r.kind).toBe('server-component');
  });

  it('flags an incomplete subtree', () => {
    const r = classifyCodeOnly(
      bundle({ incomplete: true, danglingImports: ['/a.tsx → ./missing'] }),
    );
    expect(r.kind).toBe('incomplete');
  });

  it('falls back to "complex" when nothing specific applies', () => {
    expect(classifyCodeOnly(bundle({})).kind).toBe('complex');
  });

  it('every kind carries a headline and a Portable-tab pointer', () => {
    const cases = [
      bundle({ externalDeps: { next: '^15' } }),
      bundle({ externalDeps: { fs: '*' } }),
      bundle({ externalDeps: { x: 'workspace:*' } }),
      bundle({ incomplete: true, danglingImports: ['a → b'] }),
      bundle({}),
    ];
    for (const b of cases) {
      const r = classifyCodeOnly(b);
      expect(r.headline.length).toBeGreaterThan(0);
      expect(r.detail).toMatch(/Portable tab/);
    }
  });
});
