// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureThumbnails } from '../src/features/catalog/capture-thumbnails.js';

/**
 * The catalog export inlines rendered thumbnails so the shared .html SHOWS each
 * component. This proves the capture: existing thumbnails become data URIs, a
 * 204 / error / non-image is simply skipped (the row falls back to a monogram),
 * and the whole thing never throws.
 */

function pngResponse(): Response {
  const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
  return { ok: true, status: 200, blob: async () => blob } as unknown as Response;
}
function noContent(): Response {
  return { ok: true, status: 204, blob: async () => new Blob([]) } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('captureThumbnails', () => {
  it('returns a data URI for each id that has a thumbnail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => pngResponse()));
    const out = await captureThumbnails('/proj', ['a', 'b']);
    expect(out.size).toBe(2);
    expect(out.get('a')).toMatch(/^data:image\/png;base64,/);
    expect(out.get('b')).toMatch(/^data:image\/png;base64,/);
  });

  it('skips a component with no thumbnail (204) rather than failing the export', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (url.includes('id=gap') ? noContent() : pngResponse())),
    );
    const out = await captureThumbnails('/proj', ['ok', 'gap']);
    expect(out.has('ok')).toBe(true);
    expect(out.has('gap')).toBe(false);
  });

  it('skips a network error without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('id=boom')) throw new Error('offline');
        return pngResponse();
      }),
    );
    const out = await captureThumbnails('/proj', ['fine', 'boom']);
    expect(out.has('fine')).toBe(true);
    expect(out.has('boom')).toBe(false);
  });

  it('reports progress for every id (done/total), even skipped ones', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => noContent())); // all skipped
    const seen: number[] = [];
    await captureThumbnails('/proj', ['a', 'b', 'c'], (done, total) => {
      expect(total).toBe(3);
      seen.push(done);
    });
    expect(seen.sort((x, y) => x - y)).toEqual([1, 2, 3]);
  });

  it('handles an empty id list', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const out = await captureThumbnails('/proj', []);
    expect(out.size).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});
