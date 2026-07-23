/**
 * Pure thumbnail helpers: the availability gate and the cache key. These decide
 * (a) whether a component can even produce a thumbnail without a browser, and
 * (b) the on-disk filename that lets a re-scan of unchanged pixels hit the cache
 * instead of re-launching Chromium. Both are pure, so they are unit-tested here
 * with no server and no browser.
 */

import { describe, it, expect } from 'vitest';
import type { SandpackSpec } from '@ce/core';
import { shouldRenderThumbnail, thumbnailCacheKey } from '../src/thumbnail.js';

function spec(overrides: Partial<SandpackSpec> = {}): SandpackSpec {
  return {
    files: { '/index.tsx': 'export default () => null;' },
    entryPath: '/index.tsx',
    template: 'react-ts',
    dependencies: {},
    renderability: 'full',
    notes: [],
    ...overrides,
  };
}

describe('shouldRenderThumbnail', () => {
  it('refuses a code-only component — it cannot render, so never launch a browser for it', () => {
    expect(shouldRenderThumbnail('code-only')).toBe(false);
  });

  it('renders full and stubbed components', () => {
    expect(shouldRenderThumbnail('full')).toBe(true);
    expect(shouldRenderThumbnail('stubbed')).toBe(true);
  });
});

describe('thumbnailCacheKey', () => {
  it('is stable for the same id, spec and width — a re-scan of unchanged pixels hits the cache', () => {
    const a = thumbnailCacheKey({ componentId: 'c1', spec: spec(), width: 320 });
    const b = thumbnailCacheKey({ componentId: 'c1', spec: spec(), width: 320 });
    expect(a).toBe(b);
  });

  it('is independent of file-key order — the same bundle keyed differently is one thumbnail', () => {
    const a = thumbnailCacheKey({
      componentId: 'c1',
      spec: spec({ files: { '/a.tsx': 'A', '/b.tsx': 'B' } }),
      width: 320,
    });
    const b = thumbnailCacheKey({
      componentId: 'c1',
      spec: spec({ files: { '/b.tsx': 'B', '/a.tsx': 'A' } }),
      width: 320,
    });
    expect(a).toBe(b);
  });

  it('changes when a file body changes — new pixels must not read a stale thumbnail', () => {
    const a = thumbnailCacheKey({ componentId: 'c1', spec: spec({ files: { '/index.tsx': 'v1' } }), width: 320 });
    const b = thumbnailCacheKey({ componentId: 'c1', spec: spec({ files: { '/index.tsx': 'v2' } }), width: 320 });
    expect(a).not.toBe(b);
  });

  it('changes with width — a wider render is a different image', () => {
    const a = thumbnailCacheKey({ componentId: 'c1', spec: spec(), width: 320 });
    const b = thumbnailCacheKey({ componentId: 'c1', spec: spec(), width: 480 });
    expect(a).not.toBe(b);
  });

  it('separates different components even with an identical spec', () => {
    const a = thumbnailCacheKey({ componentId: 'c1', spec: spec(), width: 320 });
    const b = thumbnailCacheKey({ componentId: 'c2', spec: spec(), width: 320 });
    expect(a).not.toBe(b);
  });

  it('is a filesystem-safe stem (no slashes, dots or separators to escape the cache dir)', () => {
    const key = thumbnailCacheKey({
      componentId: 'src/components/Button.tsx#Button',
      spec: spec(),
      width: 320,
    });
    expect(key).toMatch(/^[a-z0-9-]+$/);
  });
});
