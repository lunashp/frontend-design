import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import type { ReadOnlyFs } from '../../src/util/fs-readonly.js';
import {
  MAX_INLINE_ASSET_BYTES,
  assetMime,
  assetModuleKey,
  assetModuleSource,
  inlineAssetFile,
} from '../../src/portability/inline-asset.js';

/**
 * An asset an entry imports used to be dropped from the bundle with a warning,
 * leaving `import logo from './logo.png'` dangling — which marks the whole bundle
 * incomplete and forces the component to code-only, and shows a broken image in
 * any preview it does render. These prove the inlining that fixes that: read the
 * bytes, embed as a data URI, and expose it as a `.ts` module the existing
 * `./logo.png` import resolves to by extension.
 */

/** A ReadOnlyFs whose bytes come from a fixed map; missing paths throw. */
function fakeFs(bytes: Record<string, Buffer>): ReadOnlyFs {
  return {
    root: '/proj',
    readFile: async () => '',
    readFileSync: () => '',
    readBytesSync: (p: string) => {
      const b = bytes[p];
      if (!b) throw new Error(`no such file: ${p}`);
      return b;
    },
    readdir: async () => [],
    stat: async () => ({ isFile: true, isDirectory: false, size: 0 }),
    exists: () => true,
  };
}

describe('assetMime', () => {
  it('maps the inlinable image + font types', () => {
    expect(assetMime('/a/logo.png')).toBe('image/png');
    expect(assetMime('/a/photo.JPG')).toBe('image/jpeg');
    expect(assetMime('/a/icon.svg')).toBe('image/svg+xml');
    expect(assetMime('/a/font.woff2')).toBe('font/woff2');
  });

  it('returns null for a type it will not embed', () => {
    expect(assetMime('/a/data.json')).toBeNull();
    expect(assetMime('/a/movie.mkv')).toBeNull();
  });
});

describe('assetModuleKey', () => {
  it("appends .ts so `./logo.png` resolves to it by extension", () => {
    expect(assetModuleKey('/src/assets/logo.png')).toBe('/src/assets/logo.png.ts');
  });
});

describe('assetModuleSource', () => {
  it('default-exports the data URI as a JS string literal', () => {
    const src = assetModuleSource('data:image/png;base64,AAAA');
    expect(src).toContain('export default "data:image/png;base64,AAAA"');
  });
});

describe('inlineAssetFile', () => {
  it('embeds a small image as a base64 data-URI module', () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic
    const fs = fakeFs({ '/proj/logo.png': bytes });
    const result = inlineAssetFile('/proj/logo.png', fs);
    expect('source' in result).toBe(true);
    if ('source' in result) {
      expect(result.source).toContain(`data:image/png;base64,${bytes.toString('base64')}`);
    }
  });

  it('skips an unsupported type with a reason', () => {
    const result = inlineAssetFile('/proj/data.json', fakeFs({}));
    expect(result).toEqual({ skip: expect.stringContaining('unsupported asset type') });
  });

  it('skips an unreadable asset rather than throwing', () => {
    const result = inlineAssetFile('/proj/missing.png', fakeFs({}));
    expect(result).toEqual({ skip: expect.stringContaining('could not read asset') });
  });

  it('skips an asset over the size cap', () => {
    const big = Buffer.alloc(MAX_INLINE_ASSET_BYTES + 1);
    const result = inlineAssetFile('/proj/huge.png', fakeFs({ '/proj/huge.png': big }));
    expect(result).toEqual({ skip: expect.stringContaining('too large to inline') });
  });

  it('embeds an asset exactly at the cap (boundary is inclusive)', () => {
    const atCap = Buffer.alloc(MAX_INLINE_ASSET_BYTES, 1);
    const result = inlineAssetFile('/proj/edge.png', fakeFs({ '/proj/edge.png': atCap }));
    expect('source' in result).toBe(true);
  });
});
