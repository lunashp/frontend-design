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
import { pickThumbnailTarget, PORTAL_CONTENT_SELECTOR } from '../src/thumbnail-renderer.js';

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

/**
 * What the shot is aimed at. A dialog/drawer/menu renders through a portal onto
 * document.body, so `#root` is empty and photographing it yields the backdrop —
 * a flat grey band. This selection is pure over a `$`-only page, so it is unit
 * tested with a fake instead of a browser.
 */
describe('pickThumbnailTarget', () => {
  const fakePage = (present: readonly string[]) => ({
    $: async (selector: string) => (present.includes(selector) ? { sel: selector } : null),
  });

  it('prefers the component root child when the component renders in place', async () => {
    const t = await pickThumbnailTarget(fakePage(['#root > *', PORTAL_CONTENT_SELECTOR]));
    expect(t).toEqual({ sel: '#root > *' });
  });

  it('falls back to an overlay portal surface when #root is empty', async () => {
    const t = await pickThumbnailTarget(fakePage([PORTAL_CONTENT_SELECTOR]));
    expect(t).toEqual({ sel: PORTAL_CONTENT_SELECTOR });
  });

  it('returns null when nothing was painted — a monogram beats a grey tile', async () => {
    expect(await pickThumbnailTarget(fakePage([]))).toBeNull();
  });

  it('aims at roles first so a non-MUI overlay is still photographed', () => {
    expect(PORTAL_CONTENT_SELECTOR.startsWith('[role="dialog"]')).toBe(true);
    for (const role of ['dialog', 'alertdialog', 'menu', 'tooltip', 'listbox']) {
      expect(PORTAL_CONTENT_SELECTOR).toContain(`[role="${role}"]`);
    }
  });
});
