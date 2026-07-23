/**
 * Browser regression test for the virtualized gallery grid.
 *
 * GalleryGrid used to mount a card (with a ContextMeter + RankChip) for every one
 * of the 1000+ components at once — the worst first-paint and scroll cliff on the
 * human surface. It now mounts only the rows whose band intersects the scroll
 * viewport, plus overscan. Reading the code cannot prove that: only a real browser
 * with a real scroll container and real layout can. So this drives Chromium
 * against the SHIPPED GalleryGrid and asserts the four things that must hold:
 *
 *   1. Only a bounded number of cards are ever in the DOM, far below N.
 *   2. The layout stays responsive multi-column across 320/768/1024/1440 — never a
 *      forced single column at desktop — with no horizontal overflow.
 *   3. Scrolling brings later rows (incl. the very last card) into the DOM and
 *      drops earlier ones, staying bounded throughout.
 *   4. On-screen cards are real, keyboard-reachable, keyboard-operable <button>s.
 *
 * Like keyboard-trap.spec.ts this is deliberately NOT a vitest file and does not
 * live in a `test` directory — the two things vitest's `include` globs collect.
 * Per CLAUDE.md a browser test must never join the `pnpm test` gate (the cloud VM
 * may lack Playwright's system libraries and would hang the loop). Run it with
 * `pnpm --filter @ce/web test:browser:gallery`.
 */

import assert from 'node:assert/strict';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';
import { GALLERY_COMPONENTS, GALLERY_ITEM_COUNT, LAST_CARD_MARKER } from './gallery-fixture.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

/** Cold Vite transform of the app's real sources is the slow part of the boot. */
const BOOT_TIMEOUT_MS = 30000;
/** How long a scrolled-in card may take to appear before we call windowing broken. */
const REVEAL_TIMEOUT_MS = 4000;

/** Every card is a <button aria-pressed>; nothing else in the harness is. */
const CARD = 'button[aria-pressed]';

/**
 * The whole point is that the DOM never holds all N. A generous ceiling: a few
 * visible rows plus overscan on both sides, times the widest column count, is far
 * under this — but this is still a tiny fraction of GALLERY_ITEM_COUNT.
 */
const MAX_CARDS_IN_DOM = 160;

const FIRST_CARD_NAME = GALLERY_COMPONENTS[0]?.descriptor.name ?? '';

function log(message: string): void {
  process.stderr.write(`[e2e] ${message}\n`);
}

/** Cards in the DOM right now. Windowing keeps this bounded regardless of N. */
function cardCount(page: Page): Promise<number> {
  return page.locator(CARD).count();
}

/**
 * How many cards sit in the topmost row — the live column count. Cards in one row
 * are absolutely positioned at the same top, so grouping by rounded top and
 * taking the fullest near-the-top group gives the responsive column count without
 * needing any test-only markup on the grid.
 */
function topRowColumns(page: Page): Promise<number> {
  return page.evaluate((sel: string) => {
    const rects = Array.from(document.querySelectorAll<HTMLElement>(sel)).map((el) =>
      Math.round(el.getBoundingClientRect().top),
    );
    if (rects.length === 0) return 0;
    const counts = new Map<number, number>();
    for (const top of rects) counts.set(top, (counts.get(top) ?? 0) + 1);
    const minTop = Math.min(...rects);
    return counts.get(minTop) ?? 0;
  }, CARD);
}

/** True if the grid content fits its scroll container's width — no sideways scroll. */
function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.getElementById('scroller');
    if (!el) return true;
    return el.scrollWidth > el.clientWidth + 2;
  });
}

async function scrollToBottom(page: Page): Promise<void> {
  await page.locator('#scroller').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
}

async function openHarness(browser: Browser, url: string, width: number): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height: 700 } });
  page.on('console', (m) => log(`console.${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => log(`pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(CARD, { timeout: BOOT_TIMEOUT_MS });
  return page;
}

interface Result {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const results: Result[] = [];

async function scenario(name: string, run: () => Promise<string>): Promise<void> {
  try {
    results.push({ name, ok: true, detail: await run() });
  } catch (error) {
    results.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

async function run(browser: Browser, url: string): Promise<void> {
  const page = await openHarness(browser, url, 1440);
  try {
    await scenario('mounts only a bounded window, never all N cards', async () => {
      const count = await cardCount(page);
      assert.ok(count > 0, 'no cards mounted at all');
      assert.ok(
        count < MAX_CARDS_IN_DOM,
        `expected far fewer than ${GALLERY_ITEM_COUNT} cards in the DOM, got ${count}`,
      );
      return `${count} of ${GALLERY_ITEM_COUNT} cards in the DOM`;
    });

    await scenario('the last card is absent until it is scrolled into view', async () => {
      const before = await page.getByText(LAST_CARD_MARKER, { exact: true }).count();
      assert.equal(before, 0, 'the last card was mounted before it was ever scrolled to');
      await scrollToBottom(page);
      await page
        .getByText(LAST_CARD_MARKER, { exact: true })
        .waitFor({ state: 'visible', timeout: REVEAL_TIMEOUT_MS });
      return 'last card appeared only after scrolling';
    });

    await scenario('the first card is dropped from the DOM once scrolled far past', async () => {
      // Still at the bottom from the previous scenario.
      const first = await page.getByText(FIRST_CARD_NAME, { exact: true }).count();
      assert.equal(first, 0, 'the first card is still mounted at the bottom of a 1000-item grid');
      return `${FIRST_CARD_NAME} unmounted`;
    });

    await scenario('the window stays bounded after scrolling to the bottom', async () => {
      const count = await cardCount(page);
      assert.ok(
        count < MAX_CARDS_IN_DOM,
        `window grew unbounded while scrolling: ${count} cards in the DOM`,
      );
      return `${count} cards in the DOM at the bottom`;
    });

    await scenario('a scrolled-in card carries no entrance fade (stagger neutralized)', async () => {
      // A per-index opacity stagger would leave a freshly-mounted high-index card
      // faded; the last card must be fully opaque the moment it mounts.
      const opacity = await page
        .getByText(LAST_CARD_MARKER, { exact: true })
        .evaluate((el) => getComputedStyle(el.closest('button') as HTMLElement).opacity);
      assert.equal(opacity, '1', `scrolled-in card is not fully opaque: opacity ${opacity}`);
      return 'scrolled-in card is fully opaque';
    });

    await scenario('a scrolled-in card is keyboard-focusable and operable', async () => {
      const marker = page.getByText(LAST_CARD_MARKER, { exact: true }).locator('xpath=ancestor::button');
      await marker.focus();
      const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-pressed'));
      assert.ok(focused !== null && focused !== undefined, 'focus did not land on a card button');
      await page.keyboard.press('Enter');
      await marker.waitFor();
      const pressed = await marker.getAttribute('aria-pressed');
      assert.equal(pressed, 'true', 'Enter on a focused card did not select it');
      return 'card focused and activated via keyboard';
    });
  } finally {
    await page.close();
  }
}

/**
 * The responsive grid must keep multiple columns at desktop widths and collapse to
 * one only at the narrow end — never a forced single column — and never overflow
 * horizontally. Each width is a fresh page so first paint is measured, not a
 * resized-from-wide state.
 */
async function responsive(browser: Browser, url: string): Promise<void> {
  const widths = [320, 768, 1024, 1440];
  const columns: Record<number, number> = {};
  for (const width of widths) {
    const page = await openHarness(browser, url, width);
    try {
      await scenario(`no horizontal overflow at ${width}px`, async () => {
        const overflow = await hasHorizontalOverflow(page);
        assert.equal(overflow, false, `grid overflows horizontally at ${width}px`);
        return 'no sideways scroll';
      });
      columns[width] = await topRowColumns(page);
    } finally {
      await page.close();
    }
  }

  await scenario('layout is responsive multi-column, single column only when narrow', async () => {
    log(`columns by width: ${JSON.stringify(columns)}`);
    assert.equal(columns[320], 1, `expected a single column at 320px, got ${columns[320]}`);
    assert.ok((columns[768] ?? 0) >= 2, `expected >=2 columns at 768px, got ${columns[768]}`);
    assert.ok((columns[1024] ?? 0) >= 3, `expected >=3 columns at 1024px, got ${columns[1024]}`);
    assert.ok((columns[1440] ?? 0) >= 4, `expected >=4 columns at 1440px, got ${columns[1440]}`);
    assert.ok(
      (columns[320] ?? 0) < (columns[768] ?? 0) &&
        (columns[768] ?? 0) < (columns[1024] ?? 0) &&
        (columns[1024] ?? 0) < (columns[1440] ?? 0),
      `column count is not monotonic with width: ${JSON.stringify(columns)}`,
    );
    return JSON.stringify(columns);
  });

  await scenario('an on-screen card is in the natural keyboard tab order', async () => {
    const page = await openHarness(browser, url, 1440);
    try {
      await page.locator('#before').focus();
      await page.keyboard.press('Tab');
      const pressed = await page.evaluate(() => document.activeElement?.getAttribute('aria-pressed'));
      assert.ok(
        pressed !== null && pressed !== undefined,
        'Tab from the preceding control did not reach a card',
      );
      return 'Tab reached the first card';
    } finally {
      await page.close();
    }
  });
}

async function main(): Promise<void> {
  const server = await createServer({
    configFile: false,
    root: path.join(here, 'gallery-harness'),
    // The harness imports the app's real sources, which live above the Vite root.
    // HMR off: an unrelated edit under packages/web/src mid-run would hot-swap the
    // tree and remount the grid, a phantom failure unrelated to windowing.
    server: { fs: { allow: [repoRoot] }, host: '127.0.0.1', port: 5200, hmr: false },
    plugins: [react()],
    logLevel: 'error',
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error('vite dev server did not report a local URL');
  log(`harness at ${url}`);

  const browser = await chromium.launch();
  log('chromium launched');
  try {
    await run(browser, url);
    log('windowing scenarios done');
    await responsive(browser, url);
    log('responsive scenarios done');
  } finally {
    await browser.close();
    await server.close();
  }

  for (const result of results) {
    process.stdout.write(`${result.ok ? '  ok' : 'FAIL'}  ${result.name}\n        ${result.detail}\n`);
  }
  const failed = results.filter((r) => !r.ok).length;
  process.stdout.write(`\n${results.length - failed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

await main();
