/**
 * Renders a component's preview into a PNG by loading the SAME self-contained
 * preview HTML the /api/preview route serves (esbuild bundle, no CDN) in a
 * headless Chromium and screenshotting the component's own root element.
 *
 * Graceful degradation is the whole point of this file's shape. Playwright and
 * its Chromium binary may be entirely absent (they are excluded from the cloud
 * gate), so:
 *   - Playwright is imported DYNAMICALLY. If the import or the browser launch
 *     fails, thumbnails are disabled for the process and every call returns
 *     `null` — the route then answers "no thumbnail" and the card renders its
 *     text-only self. A missing browser must never become a hang or a 500.
 *   - Exactly ONE browser is launched, lazily, on the first request and reused
 *     (a module-level singleton). Pages are drawn from a small bounded pool with
 *     a queue, and each render has a hard timeout, so one slow or broken
 *     component cannot stall the others or leak a page.
 *
 * `import type` from playwright is erased at compile time, so it adds no runtime
 * dependency; only the dynamic `import('playwright')` touches the package, and
 * that is wrapped so its absence degrades cleanly.
 */

import type { Browser, Page } from 'playwright';
import type { SandpackSpec } from '@ce/core';
import { renderPreviewHtml } from './bundle-preview.js';
import { createBoundedQueue } from './bounded-queue.js';
import {
  DEFAULT_THUMBNAIL_HEIGHT,
  DEFAULT_THUMBNAIL_TIMEOUT_MS,
  DEFAULT_THUMBNAIL_WIDTH,
  THUMBNAIL_PAGE_POOL,
} from './thumbnail.js';

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

/** How Chromium is obtained — swapped in tests to exercise the launch-failure path. */
export type BrowserLauncher = () => Promise<Browser>;

function stderr(message: string): void {
  // stdout is reserved for the host's own protocol needs; all diagnostics go to
  // stderr so nothing here can corrupt a response body.
  process.stderr.write(`[ce:host] ${message}\n`);
}

/** Launch one headless Chromium. Sandbox is left ON — we render arbitrary target
 * code, so the OS sandbox is the containment; we do NOT pass --no-sandbox. */
async function defaultLauncher(): Promise<Browser> {
  const { chromium } = await import('playwright');
  return chromium.launch({
    headless: true,
    // --disable-dev-shm-usage: /dev/shm is tiny in many containers and Chromium
    // crashes writing there; --hide-scrollbars keeps scrollbar chrome out of the
    // screenshot; --disable-gpu avoids a GPU process we don't need for a raster.
    args: ['--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars'],
  });
}

/**
 * Screenshot one preview document. Draws a page from the bounded pool, points
 * the shot at the component's own root (`#root > *`, falling back to `#root`,
 * then the viewport), and always closes the page — a leaked page is capacity
 * lost from a pool of three.
 */
async function screenshotHtml(
  browser: Browser,
  html: string,
  width: number,
  height: number,
  timeoutMs: number,
): Promise<Buffer> {
  const page: Page = await browser.newPage({
    viewport: { width, height },
    // Crisp on HiDPI card frames without shipping a huge image: 2x a small box.
    deviceScaleFactor: 2,
  });
  try {
    // The bundle is inline (no network), so 'load' is enough; the explicit
    // timeout is the guard against a component that spins forever on mount.
    await page.setContent(html, { waitUntil: 'load', timeout: timeoutMs });
    // A short settle lets React commit and any mount effect paint before we
    // shoot — without it, a component that renders on an effect shows blank.
    await page.waitForTimeout(120);
    const target = (await page.$('#root > *')) ?? (await page.$('#root'));
    if (target) return await target.screenshot({ type: 'png' });
    return await page.screenshot({ type: 'png' });
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * A renderer bound to a single lazily-launched browser and a bounded page pool.
 * `close()` is exposed for tests and shutdown; the module-level default keeps
 * the browser alive for the process lifetime.
 */
export function createThumbnailRenderer(launch: BrowserLauncher = defaultLauncher): {
  render: ThumbnailRenderer;
  close: () => Promise<void>;
} {
  const queue = createBoundedQueue(THUMBNAIL_PAGE_POOL);
  let browserPromise: Promise<Browser | null> | null = null;
  let disabled = false;

  const browser = async (): Promise<Browser | null> => {
    if (disabled) return null;
    if (!browserPromise) {
      browserPromise = launch().catch((err: unknown) => {
        // One-time notice, then silence: the whole gallery degrades to text-only
        // cards, and repeating this per card would drown the log.
        disabled = true;
        stderr(
          `thumbnails disabled: could not launch a headless browser (${
            err instanceof Error ? err.message : 'unknown error'
          })`,
        );
        return null;
      });
    }
    const b = await browserPromise;
    // A browser that died mid-session (crash, OOM) must not wedge every later
    // render on a dead handle: disable rather than retry-loop.
    if (b && !b.isConnected()) {
      disabled = true;
      return null;
    }
    return b;
  };

  const render: ThumbnailRenderer = async (input) => {
    const b = await browser();
    if (!b) return null;

    let html: string;
    try {
      // The identical bundle the live preview uses — one implementation, so a
      // thumbnail can never diverge from what the Preview tab shows.
      html = await renderPreviewHtml({ targetRoot: input.targetRoot, spec: input.spec });
    } catch (err) {
      // An unbundlable component (missing dep, broken source) has no thumbnail;
      // that is a text-only card, not a server error.
      stderr(`thumbnail bundle failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      return null;
    }

    const width = input.width ?? DEFAULT_THUMBNAIL_WIDTH;
    const height = input.height ?? DEFAULT_THUMBNAIL_HEIGHT;
    const timeoutMs = input.timeoutMs ?? DEFAULT_THUMBNAIL_TIMEOUT_MS;

    try {
      return await queue.run(() => screenshotHtml(b, html, width, height, timeoutMs));
    } catch (err) {
      stderr(`thumbnail render failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      return null;
    }
  };

  return {
    render,
    async close() {
      if (!browserPromise) return;
      const b = await browserPromise.catch(() => null);
      await b?.close().catch(() => {});
      browserPromise = null;
      disabled = false;
    },
  };
}

/** Process-wide default renderer: one browser, reused for the session's lifetime. */
export const renderThumbnail: ThumbnailRenderer = createThumbnailRenderer().render;
