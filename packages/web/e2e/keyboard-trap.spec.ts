/**
 * WCAG 2.1.2 "No Keyboard Trap" regression test for the component preview.
 *
 * The preview's keyboard bridge calls `preventDefault()` on Tab at the edges of
 * the iframe's own tab order and asks the embedder to move focus instead. When
 * the sender did that unconditionally but the receiver only registered in the
 * modal (overlay) layout, every viewport wider than 1180px — the DEFAULT desktop
 * layout, with the inspector docked — swallowed Tab and stranded focus in the
 * frame with no keyboard way out. Reading the code did not catch it twice; only
 * a real browser did. So this drives real Chromium against the real Inspector
 * and the real PREVIEW_KEYBOARD_BRIDGE, in BOTH layouts and BOTH directions.
 *
 * It is deliberately not a vitest file and does not sit in a package's `test`
 * directory — the two things vitest's `include` globs collect. Per CLAUDE.md a
 * browser test must never join the `pnpm test` gate: the cloud VM may lack
 * Playwright's system libraries and would hang the loop. Run `pnpm test:browser`.
 */

import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import react from '@vitejs/plugin-react';
import { createServer, type Plugin, type ViteDevServer } from 'vite';
import { PREVIEW_KEYBOARD_BRIDGE } from '../../host/src/bundle-preview.js';
import { BACKINGS } from '../src/features/preview/backing.js';
import { FIXTURE_ARTIFACT, FIXTURE_NAME } from './fixture.js';

// The preview stage's backing toggle (#6) renders focusable buttons just before
// the iframe, so Shift+Tab out of the frame now lands on the last of them rather
// than on the tab strip. Assert membership here so the test documents that
// structural fact and still fails loudly if focus is lost to <body>.
const BACKING_LABELS = new Set(BACKINGS.map((b) => b.label));

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

/** How long focus may take to come back out of the frame before we call it trapped. */
const TAB_OUT_TIMEOUT_MS = 2000;

/** Cold Vite transform of the app's real sources is the slow part of the boot. */
const BOOT_TIMEOUT_MS = 30000;

const PREVIEW_FRAME = 'iframe[title="Component preview"]';

/** Progress + page diagnostics go to stderr; stdout carries only the report. */
function log(message: string): void {
  process.stderr.write(`[e2e] ${message}\n`);
}

/**
 * Stand-in for a bundled component: two tab stops so the test can sit on the
 * FIRST one (shift-tab edge), the LAST one (tab edge) and in between (where Tab
 * must keep working inside the preview). The bridge is the real shipped source.
 */
function previewDocument(): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>preview</title></head>
<body>
<button type="button" id="preview-first">preview-first</button>
<button type="button" id="preview-last">preview-last</button>
<script>
${PREVIEW_KEYBOARD_BRIDGE}
</script>
</body>
</html>`;
}

/** Serves the two endpoints the Inspector's Preview tab needs, and nothing else. */
function mockApi(): Plugin {
  return {
    name: 'ce-e2e-mock-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/artifact', (_req: IncomingMessage, res: ServerResponse) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(FIXTURE_ARTIFACT));
      });
      server.middlewares.use('/api/preview', (_req: IncomingMessage, res: ServerResponse) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(previewDocument());
      });
    },
  };
}

interface ActiveElement {
  readonly tag: string;
  readonly id: string;
  readonly label: string;
}

/** What the TOP document considers focused — an iframe while focus is inside it. */
function activeElement(page: Page): Promise<ActiveElement> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return { tag: 'none', id: '', label: '' };
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id,
      label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim(),
    };
  });
}

function describeActive(active: ActiveElement): string {
  return `${active.tag}${active.id ? `#${active.id}` : ''}${active.label ? ` "${active.label}"` : ''}`;
}

async function focusInPreview(page: Page, id: string): Promise<void> {
  await page.frameLocator(PREVIEW_FRAME).locator(`#${id}`).focus();
  const active = await activeElement(page);
  assert.equal(
    active.tag,
    'iframe',
    `expected focus to enter the preview, got ${describeActive(active)}`,
  );
}

/**
 * Press a key and wait for focus to leave the preview frame. A timeout here IS
 * the defect: `preventDefault()` fired inside the frame and nobody moved focus.
 */
async function pressAndLeaveFrame(page: Page, key: string): Promise<ActiveElement> {
  await page.keyboard.press(key);
  try {
    await page.waitForFunction(() => document.activeElement?.tagName.toLowerCase() !== 'iframe', {
      timeout: TAB_OUT_TIMEOUT_MS,
    });
  } catch {
    throw new Error(`KEYBOARD TRAP: focus never left the preview iframe after ${key}`);
  }
  return activeElement(page);
}

async function openHarness(browser: Browser, url: string, width: number): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  // A harness that fails to boot otherwise shows up only as an opaque selector
  // timeout, which is the least useful failure this test could produce.
  page.on('console', (m) => log(`console.${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => log(`pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(PREVIEW_FRAME, { timeout: BOOT_TIMEOUT_MS });
  await page
    .frameLocator(PREVIEW_FRAME)
    .locator('#preview-last')
    .waitFor({ timeout: BOOT_TIMEOUT_MS });
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
    results.push({
      name,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Docked (>1180px) is the DEFAULT desktop layout and has no modal: Tab out of
 * the preview must continue the DOCUMENT's tab order, exactly as the browser
 * would have done had the bridge not intercepted the key.
 */
async function dockedLayout(browser: Browser, url: string): Promise<void> {
  const page = await openHarness(browser, url, 1440);
  try {
    await scenario('docked: Tab at the end of the preview leaves the frame', async () => {
      await focusInPreview(page, 'preview-last');
      const active = await pressAndLeaveFrame(page, 'Tab');
      assert.equal(
        active.id,
        'after',
        `expected the next document tab stop, got ${describeActive(active)}`,
      );
      return describeActive(active);
    });

    await scenario('docked: Shift+Tab at the start of the preview leaves the frame', async () => {
      await focusInPreview(page, 'preview-first');
      const active = await pressAndLeaveFrame(page, 'Shift+Tab');
      assert.ok(
        active.tag === 'button' && BACKING_LABELS.has(active.label),
        `expected focus to land on the backing toggle just before the frame, got ${describeActive(active)}`,
      );
      return describeActive(active);
    });

    await scenario('docked: Tab still moves between stops inside the preview', async () => {
      await focusInPreview(page, 'preview-first');
      await page.keyboard.press('Tab');
      await page.waitForTimeout(250);
      const active = await activeElement(page);
      assert.equal(active.tag, 'iframe', `Tab escaped mid-preview: ${describeActive(active)}`);
      const inner = await page
        .frameLocator(PREVIEW_FRAME)
        .locator('#preview-last')
        .evaluate((el) => el === document.activeElement);
      assert.equal(inner, true, 'expected focus on the preview’s second stop');
      return 'stayed on #preview-last inside the frame';
    });

    await scenario('docked: Escape inside the preview leaves the panel open', async () => {
      await focusInPreview(page, 'preview-first');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      // Match the component's OWN panel label, not the `^="Inspector"` prefix:
      // the empty state renders aria-label="Inspector" too, so the prefix
      // selector counted 1 whether the panel had been dismissed or not.
      const panels = await page.locator(`aside[aria-label="Inspector: ${FIXTURE_NAME}"]`).count();
      assert.equal(panels, 1, 'docked inspector is not a modal; Escape must not dismiss it');
      const frames = await page.locator(PREVIEW_FRAME).count();
      assert.equal(frames, 1, 'the preview frame must survive Escape in the docked layout');
      return 'panel still open';
    });
  } finally {
    await page.close();
  }
}

/**
 * Overlay (<=1180px) IS a modal: Tab out of the preview must stay inside the
 * slide-over's focus trap, and Escape closes it. Both were already true — these
 * guard against the docked fix breaking them.
 */
async function overlayLayout(browser: Browser, url: string): Promise<void> {
  const page = await openHarness(browser, url, 900);
  try {
    await scenario('overlay: Tab at the end of the preview leaves the frame', async () => {
      await focusInPreview(page, 'preview-last');
      const active = await pressAndLeaveFrame(page, 'Tab');
      assert.equal(
        active.label,
        'Close',
        `expected the trap to cycle, got ${describeActive(active)}`,
      );
      return describeActive(active);
    });

    await scenario('overlay: Shift+Tab at the start of the preview leaves the frame', async () => {
      await focusInPreview(page, 'preview-first');
      const active = await pressAndLeaveFrame(page, 'Shift+Tab');
      // Still inside the slide-over trap — the backing toggle lives in the panel —
      // so focus left the frame without escaping to the page behind the modal.
      assert.ok(
        active.tag === 'button' && BACKING_LABELS.has(active.label),
        `expected focus to land on the backing toggle inside the modal, got ${describeActive(active)}`,
      );
      return describeActive(active);
    });

    await scenario('overlay: focus never escapes the modal to the page behind it', async () => {
      await focusInPreview(page, 'preview-last');
      const active = await pressAndLeaveFrame(page, 'Tab');
      assert.notEqual(active.id, 'after', 'focus landed behind the scrim');
      assert.notEqual(active.id, 'before', 'focus landed behind the scrim');
      return describeActive(active);
    });

    await scenario('overlay: Escape inside the preview closes the modal', async () => {
      await focusInPreview(page, 'preview-first');
      await page.keyboard.press('Escape');
      await page.waitForSelector(PREVIEW_FRAME, {
        state: 'detached',
        timeout: TAB_OUT_TIMEOUT_MS,
      });
      return 'modal dismissed';
    });
  } finally {
    await page.close();
  }
}

async function main(): Promise<void> {
  const server = await createServer({
    configFile: false,
    root: path.join(here, 'harness'),
    // The harness imports the app's real sources, which live above the Vite root.
    // HMR is off: an unrelated edit under packages/web/src mid-run hot-swaps the
    // tree, which remounts the preview iframe and drops focus to <body> — a
    // phantom failure that has nothing to do with the bridge.
    server: {
      fs: { allow: [repoRoot] },
      host: '127.0.0.1',
      port: 5199,
      hmr: false,
    },
    plugins: [mockApi(), react()],
    logLevel: 'error',
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error('vite dev server did not report a local URL');
  log(`harness at ${url}`);

  const browser = await chromium.launch();
  log('chromium launched');
  try {
    await dockedLayout(browser, url);
    log('docked layout done');
    await overlayLayout(browser, url);
    log('overlay layout done');
  } finally {
    await browser.close();
    await server.close();
  }

  for (const result of results) {
    process.stdout.write(
      `${result.ok ? '  ok' : 'FAIL'}  ${result.name}\n        ${result.detail}\n`,
    );
  }
  const failed = results.filter((r) => !r.ok).length;
  process.stdout.write(`\n${results.length - failed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

await main();
