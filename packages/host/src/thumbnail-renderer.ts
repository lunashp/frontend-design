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
 * Screenshot the component's own root. Points the shot at `#root > *`, falling
 * back to `#root`, then the viewport — the same target selection the pre-pool
 * renderer used, so the pixels are unchanged.
 */
async function screenshotComponent(page: Page): Promise<Buffer> {
  const target = (await page.$('#root > *')) ?? (await page.$('#root'));
  if (target) return target.screenshot({ type: 'png' });
  return page.screenshot({ type: 'png' });
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
