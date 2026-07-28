/**
 * Pure helpers for the gallery card's thumbnail: the host route URL and the
 * small load/error state machine behind it. Kept out of the component so the URL
 * shape and the fallback logic are unit-testable without a DOM — the card just
 * wires an <img> to these.
 */

/**
 * Rendered width (CSS px) requested from the host. Fixed for the whole gallery
 * so every card requests the same size and the host caches one PNG per
 * component, not one per accidental width.
 */
export const THUMBNAIL_RENDER_WIDTH = 320;

/**
 * The host captures at deviceScaleFactor 2 (see thumbnail-renderer.ts), so the
 * PNG is twice the size the component actually rendered at.
 */
export const THUMBNAIL_CAPTURE_SCALE = 2;

/**
 * The CSS size the component rendered at, recovered from the PNG's pixel size.
 * Used as an upscale CAP: an 80px avatar stretched to fill the frame reads as a
 * blurry blob and misrepresents the component's real scale, so it is shown at
 * the size it actually is and centred. Anything larger than the frame is still
 * shrunk by `object-fit: contain`.
 */
export function naturalCssSize(
  naturalWidth: number,
  naturalHeight: number,
): { readonly width: number; readonly height: number } {
  return {
    width: Math.max(0, naturalWidth) / THUMBNAIL_CAPTURE_SCALE,
    height: Math.max(0, naturalHeight) / THUMBNAIL_CAPTURE_SCALE,
  };
}

/** Build the lazy thumbnail URL. The <img> loads it only when the card mounts,
 * and the grid is virtualized, so only visible cards ever fetch. */
export function thumbnailUrl(projectRoot: string, id: string, width = THUMBNAIL_RENDER_WIDTH): string {
  const params = new URLSearchParams({ path: projectRoot, id, w: String(width) });
  return `/api/thumbnail?${params.toString()}`;
}

/**
 * The card's thumbnail lifecycle:
 *   loading    — reserving the frame, <img> fetching (skeleton shown).
 *   ready      — the PNG decoded and is on screen.
 *   unavailable — the route answered 204/non-image, or the image failed; the
 *                 card shows its designed text-only placeholder instead.
 */
export type ThumbnailState = 'loading' | 'ready' | 'unavailable';

export type ThumbnailEvent = 'load' | 'error';

export function nextThumbnailState(state: ThumbnailState, event: ThumbnailEvent): ThumbnailState {
  // Terminal: once we've committed to the text fallback we do not flip back to a
  // broken <img> — the element is unmounted, so no further events arrive anyway.
  if (state === 'unavailable') return 'unavailable';
  return event === 'load' ? 'ready' : 'unavailable';
}
