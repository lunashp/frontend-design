/**
 * Captures rendered thumbnails as inline data URIs, so the exported catalog — a
 * single self-contained .html file with no tool behind it — can SHOW each
 * component instead of a monogram tile.
 *
 * The host renders and caches the PNGs already (the same route the gallery cards
 * use). Here we fetch them at export time, base64-inline the ones that exist, and
 * skip the rest (a code-only component answers 204). Bounded concurrency so a
 * few-hundred-component catalog doesn't open a few-hundred sockets at once, and a
 * progress callback so the button can show how far along the capture is.
 *
 * Everything network/Blob lives here; the catalog HTML build stays a pure
 * function that just receives the resulting id → data-URI map.
 */

import { thumbnailUrl } from '../gallery/thumbnail.js';

const CONCURRENCY = 6;

/** Read a Blob as a `data:` URL. Rejects are handled by the caller (skip). */
function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

/** Fetch one component's thumbnail as a data URI, or null when there isn't one
 *  (a 204/non-image answer, a network error) — a missing thumbnail is normal. */
async function fetchThumbnail(projectRoot: string, id: string): Promise<string | null> {
  try {
    const res = await fetch(thumbnailUrl(projectRoot, id));
    if (!res.ok || res.status === 204) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/') || blob.size === 0) return null;
    return await blobToDataUri(blob);
  } catch {
    return null;
  }
}

/**
 * Capture thumbnails for every id, into a `Map<id, dataUri>` holding only the
 * ones that exist. Runs at most `CONCURRENCY` fetches at a time; `onProgress` is
 * called after each completes with (done, total). Never throws — a failed fetch
 * is simply an id absent from the map (the row falls back to its monogram).
 */
export async function captureThumbnails(
  projectRoot: string,
  ids: readonly string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let cursor = 0;
  let done = 0;

  async function worker(): Promise<void> {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      if (id === undefined) break;
      const uri = await fetchThumbnail(projectRoot, id);
      if (uri) out.set(id, uri);
      done += 1;
      onProgress?.(done, ids.length);
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker);
  await Promise.all(workers);
  return out;
}
