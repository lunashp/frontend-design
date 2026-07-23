/**
 * The shared headless-Chromium render pool: ONE lazily-launched, pooled browser
 * that loads the SAME self-contained preview HTML the /api/preview route serves
 * (renderPreviewHtml) and hands a live page to a caller-supplied callback. Both
 * the thumbnail renderer and the accessibility auditor build on this, so there is
 * exactly one browser for the process and one implementation of "bundle the
 * component, open a page, let it settle, do something with it".
 *
 * Graceful degradation is the whole point of this file's shape. Playwright and
 * its Chromium binary may be entirely absent (they are excluded from the cloud
 * gate), so:
 *   - Playwright is imported DYNAMICALLY. If the import or the browser launch
 *     fails, rendering is disabled for the process and every call returns `null`
 *     — the routes then answer "no thumbnail" / "audit unavailable" and the UI
 *     degrades. A missing browser must never become a hang or a 500.
 *   - Exactly ONE browser is launched, lazily, on the first request and reused (a
 *     module-level singleton, `sharedRenderPool`). Pages are drawn from a small
 *     bounded pool with a queue, and each render has a hard timeout, so one slow
 *     or broken component cannot stall the others or leak a page.
 *
 * `import type` from playwright is erased at compile time, so it adds no runtime
 * dependency; only the dynamic `import('playwright')` touches the package, and
 * that is wrapped so its absence degrades cleanly.
 */

import type { Browser, Page } from 'playwright';
import type { SandpackSpec } from '@ce/core';
import { renderPreviewHtml } from './bundle-preview.js';
import { createBoundedQueue } from './bounded-queue.js';

/** Concurrent Chromium pages. Small: one browser, a handful of tabs, a queue behind it. */
export const RENDER_PAGE_POOL = 3;

/** A page that has finished loading before the callback runs, unless overridden. */
const DEFAULT_SETTLE_MS = 120;

/** Fallback per-render timeout when a caller does not pass one. */
const DEFAULT_TIMEOUT_MS = 6000;

/** How Chromium is obtained — swapped in tests to exercise the launch-failure path. */
export type BrowserLauncher = () => Promise<Browser>;

/**
 * One page job over the shared pool. The component is bundled to preview HTML,
 * loaded into a fresh page at `viewport`, allowed to settle, then `run` is called
 * with that page and its result returned. The page is always closed afterward.
 */
export interface RenderPageInput<T> {
  /** The scanned project root — read-only; esbuild resolves its node_modules. */
  readonly targetRoot: string;
  readonly spec: SandpackSpec;
  readonly viewport: { readonly width: number; readonly height: number };
  /** HiDPI factor for crisp screenshots; irrelevant to DOM analysis. Default 1. */
  readonly deviceScaleFactor?: number;
  /** setContent timeout — the guard against a component that spins forever on mount. */
  readonly timeoutMs?: number;
  /** Post-load pause so React can commit and any mount effect can paint. */
  readonly settleMs?: number;
  /** What to do with the loaded page; its result is what withPage resolves to. */
  readonly run: (page: Page) => Promise<T>;
}

/**
 * Run a job over the pool. Returns the job's result, or `null` when the browser
 * is unavailable, the bundle failed, or the page work threw/timed out — the
 * single, definitive degradation signal every caller maps to its own "no result".
 */
export type PageRenderer = <T>(input: RenderPageInput<T>) => Promise<T | null>;

export interface RenderPool {
  readonly withPage: PageRenderer;
  /** Close the browser (tests, shutdown). The module default stays open for the process. */
  readonly close: () => Promise<void>;
}

function stderr(message: string): void {
  // stdout is reserved for the host's own protocol needs; all diagnostics go to
  // stderr so nothing here can corrupt a response body.
  process.stderr.write('[ce:host] ' + message + '\n');
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown error';
}

/**
 * Launch one headless Chromium. Sandbox is left ON — we render arbitrary target
 * code, so the OS sandbox is the containment; we do NOT pass --no-sandbox.
 */
async function defaultLauncher(): Promise<Browser> {
  const { chromium } = await import('playwright');
  return chromium.launch({
    headless: true,
    // --disable-dev-shm-usage: /dev/shm is tiny in many containers and Chromium
    // crashes writing there; --hide-scrollbars keeps scrollbar chrome out of a
    // screenshot; --disable-gpu avoids a GPU process we don't need for a raster.
    args: ['--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars'],
  });
}

/**
 * Open a page, load the preview HTML, let it settle, run `fn`, and ALWAYS close
 * the page — a leaked page is capacity lost from a pool of three.
 */
async function inLoadedPage<T>(
  browser: Browser,
  html: string,
  input: RenderPageInput<T>,
): Promise<T> {
  const page: Page = await browser.newPage({
    viewport: { width: input.viewport.width, height: input.viewport.height },
    deviceScaleFactor: input.deviceScaleFactor ?? 1,
  });
  try {
    // The bundle is inline (no network), so 'load' is enough; the explicit
    // timeout is the guard against a component that spins forever on mount.
    await page.setContent(html, { waitUntil: 'load', timeout: input.timeoutMs ?? DEFAULT_TIMEOUT_MS });
    await page.waitForTimeout(input.settleMs ?? DEFAULT_SETTLE_MS);
    return await input.run(page);
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * A pool bound to a single lazily-launched browser and a bounded page queue.
 * `close()` is exposed for tests and shutdown; the module-level default keeps the
 * browser alive for the process lifetime.
 */
export function createRenderPool(launch: BrowserLauncher = defaultLauncher): RenderPool {
  const queue = createBoundedQueue(RENDER_PAGE_POOL);
  let browserPromise: Promise<Browser | null> | null = null;
  let disabled = false;

  const browser = async (): Promise<Browser | null> => {
    if (disabled) return null;
    if (!browserPromise) {
      browserPromise = launch().catch((err: unknown) => {
        // One-time notice, then silence: the whole gallery degrades, and repeating
        // this per card / per component would drown the log.
        disabled = true;
        stderr('headless rendering disabled: could not launch a browser (' + errText(err) + ')');
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

  const withPage: PageRenderer = async <T>(input: RenderPageInput<T>): Promise<T | null> => {
    const b = await browser();
    if (!b) return null;

    let html: string;
    try {
      // The identical bundle the live preview uses — one implementation, so a
      // thumbnail or audit can never diverge from what the Preview tab shows.
      html = await renderPreviewHtml({ targetRoot: input.targetRoot, spec: input.spec });
    } catch (err) {
      // An unbundlable component (missing dep, broken source) has no render; that
      // is a degraded result, not a server error.
      stderr('render bundle failed: ' + errText(err));
      return null;
    }

    try {
      return await queue.run(() => inLoadedPage(b, html, input));
    } catch (err) {
      stderr('page render failed: ' + errText(err));
      return null;
    }
  };

  return {
    withPage,
    async close() {
      if (!browserPromise) return;
      const b = await browserPromise.catch(() => null);
      await b?.close().catch(() => {});
      browserPromise = null;
      disabled = false;
    },
  };
}

/** Process-wide default pool: one browser, reused by thumbnails AND the a11y audit. */
export const sharedRenderPool: RenderPool = createRenderPool();
