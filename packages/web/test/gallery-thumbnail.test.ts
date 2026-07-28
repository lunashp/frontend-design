/**
 * Pure thumbnail helpers for the gallery card: the URL the <img> points at, and
 * the tiny load/error state machine that decides skeleton vs image vs text
 * fallback. Both are pure, so they are unit-tested with no DOM.
 */

import { describe, it, expect } from 'vitest';
import {
  THUMBNAIL_RENDER_WIDTH,
  naturalCssSize,
  nextThumbnailState,
  thumbnailUrl,
} from '../src/features/gallery/thumbnail.js';

describe('thumbnailUrl', () => {
  it('targets the host route with an encoded path and id', () => {
    const url = thumbnailUrl('/Users/me/proj', 'src/Button.tsx#Button');
    expect(url.startsWith('/api/thumbnail?')).toBe(true);
    expect(url).toContain(`path=${encodeURIComponent('/Users/me/proj')}`);
    expect(url).toContain(`id=${encodeURIComponent('src/Button.tsx#Button')}`);
  });

  it('carries the render width so the host caches one size per gallery', () => {
    expect(thumbnailUrl('/p', 'a')).toContain(`w=${THUMBNAIL_RENDER_WIDTH}`);
  });

  it('is stable for the same inputs and separated by id and project', () => {
    expect(thumbnailUrl('/p', 'a')).toBe(thumbnailUrl('/p', 'a'));
    expect(thumbnailUrl('/p', 'a')).not.toBe(thumbnailUrl('/p', 'b'));
    expect(thumbnailUrl('/p', 'a')).not.toBe(thumbnailUrl('/q', 'a'));
  });
});

describe('nextThumbnailState', () => {
  it('shows the image once it loads', () => {
    expect(nextThumbnailState('loading', 'load')).toBe('ready');
  });

  it('falls back to text when the image errors (204/unavailable render)', () => {
    expect(nextThumbnailState('loading', 'error')).toBe('unavailable');
  });

  it('falls back even if the image fails after it had loaded', () => {
    expect(nextThumbnailState('ready', 'error')).toBe('unavailable');
  });

  it('stays fallen back once unavailable — no flicker back to a broken image', () => {
    expect(nextThumbnailState('unavailable', 'load')).toBe('unavailable');
    expect(nextThumbnailState('unavailable', 'error')).toBe('unavailable');
  });
});

// A small component (an 80px avatar) captured at 2x is a 160px PNG; stretched to
// fill the frame it reads as a blurry blob and misstates the component's scale.
describe('naturalCssSize (upscale cap)', () => {
  it('halves the 2x capture back to the size the component rendered at', () => {
    expect(naturalCssSize(160, 160)).toEqual({ width: 80, height: 80 });
    expect(naturalCssSize(1152, 1936)).toEqual({ width: 576, height: 968 });
  });
  it('never returns a negative size', () => {
    expect(naturalCssSize(-10, 0)).toEqual({ width: 0, height: 0 });
  });
});
