/**
 * Renders a component's preview into a PNG by loading the SAME self-contained
 * preview HTML the /api/preview route serves, in the shared headless-Chromium
 * render pool (render-pool.ts), and screenshotting the component's own root
 * element.
 *
 * This module is now thin: the browser lifecycle, the bounded page queue, the
 * preview bundling, and the graceful degradation all live in render-pool.ts and
 * are SHARED with the accessibility auditor — so there is exactly one browser for
 * the process and thumbnails and audits can never diverge from the live preview.
 * A thumbnail is just "open the preview page, screenshot #root's child".
 */

import type { Page } from 'playwright';
import type { SandpackSpec } from '@ce/core';
import {
  createRenderPool,
  sharedRenderPool,
  type BrowserLauncher,
  type RenderPool,
} from './render-pool.js';
import {
  DEFAULT_THUMBNAIL_HEIGHT,
  DEFAULT_THUMBNAIL_TIMEOUT_MS,
  DEFAULT_THUMBNAIL_WIDTH,
} from './thumbnail.js';

export type { BrowserLauncher } from './render-pool.js';

export interface RenderThumbnailInput {
  /** The scanned project root — read-only; esbuild resolves its node_modules. */
  readonly targetRoot: string;
  readonly spec: SandpackSpec;
  readonly width?: number;
  readonly height?: number;
  readonly timeoutMs?: number;
}

/**
 * The injectable render seam. The default is the real browser-backed renderer;
 * the host accepts an override so the route can be tested end-to-end (session
 * resolution, renderability gate, caching, response shaping) with no browser.
 */
export type ThumbnailRenderer = (input: RenderThumbnailInput) => Promise<Buffer | null>;

/**
 * An overlay renders through a PORTAL, onto document.body — outside `#root`. So
 * for a dialog, drawer, menu or tooltip, `#root` holds nothing and shooting it
 * catches only the full-viewport backdrop: a flat grey band that reads as broken.
 * These selectors aim the shot at the overlay's own surface instead. Roles first
 * (framework-agnostic), then MUI's paper classes for the overlays that carry no
 * role of their own.
 */
export const PORTAL_CONTENT_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="tooltip"]',
  '[role="listbox"]',
  '.MuiDialog-paper',
  '.MuiDrawer-paper',
  '.MuiPopover-paper',
  '.MuiMenu-paper',
  '.MuiTooltip-tooltip',
].join(', ');

/** The subset of Playwright's `Page` this selection needs — so it is testable. */
export interface ThumbnailPage<T> {
  $(selector: string): Promise<T | null>;
}

/**
 * Choose what to photograph: the component's own root child, else an overlay's
 * portal surface, else nothing. Returning null means "no thumbnail" — a card
 * showing its monogram is honest, a grey tile is not.
 */
export async function pickThumbnailTarget<T>(page: ThumbnailPage<T>): Promise<T | null> {
  const inRoot = await page.$('#root > *');
  if (inRoot) return inRoot;
  return page.$(PORTAL_CONTENT_SELECTOR);
}

/** Screenshot the component's own root, or an overlay's portal surface. */
async function screenshotComponent(page: Page): Promise<Buffer | null> {
  // A component that can't render in isolation shows the boundary's explanation.
  // Shooting THAT gives every such card a cropped paragraph of prose where a
  // picture should be — worse than no thumbnail, so report none and let the card
  // fall back to its monogram.
  if (await page.$('[data-ce-unrenderable]')) return null;

  const target = await pickThumbnailTarget(page);
  if (!target) return null;
  // An empty render (zero-size box) photographs as a blank grey tile, which reads
  // as broken; the monogram is the honest placeholder.
  const box = await target.boundingBox();
  if (!box || box.width < 2 || box.height < 2) return null;
  return target.screenshot({ type: 'png' });
}

/** Bind a thumbnail renderer to a pool — `#root`'s child, screenshotted at 2x. */
function thumbnailOver(pool: RenderPool): ThumbnailRenderer {
  return (input) =>
    pool.withPage({
      targetRoot: input.targetRoot,
      spec: input.spec,
      viewport: {
        width: input.width ?? DEFAULT_THUMBNAIL_WIDTH,
        height: input.height ?? DEFAULT_THUMBNAIL_HEIGHT,
      },
      // Crisp on HiDPI card frames without shipping a huge image: 2x a small box.
      deviceScaleFactor: 2,
      timeoutMs: input.timeoutMs ?? DEFAULT_THUMBNAIL_TIMEOUT_MS,
      run: screenshotComponent,
    });
}

/**
 * A renderer bound to its OWN pool (own browser). Used by the e2e proof and by
 * tests that inject a launcher; the process default below shares the singleton
 * pool with the auditor instead.
 */
export function createThumbnailRenderer(launch?: BrowserLauncher): {
  render: ThumbnailRenderer;
  close: () => Promise<void>;
} {
  const pool = createRenderPool(launch);
  return { render: thumbnailOver(pool), close: () => pool.close() };
}

/** Process-wide default renderer: the shared browser, reused for the session's lifetime. */
export const renderThumbnail: ThumbnailRenderer = thumbnailOver(sharedRenderPool);
