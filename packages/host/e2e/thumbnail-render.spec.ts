/**
 * REAL browser render proof for component thumbnails. Deliberately NOT part of
 * `pnpm test` (CLAUDE.md: browser/E2E is excluded from the gate — Chromium may
 * be absent in the cloud VM). Run it locally, where Chromium is installed:
 *
 *   pnpm --filter @ce/host test:browser:thumbnail
 *
 * It proves, against a live headless Chromium:
 *   1. A renderable, self-contained component screenshots to a non-empty PNG
 *      (verified by the PNG magic header + byte length) — this exercises the
 *      SAME renderPreviewHtml bundle the live /api/preview route uses.
 *   2. The on-disk cache round-trips those bytes (a re-request is a cache hit).
 *   3. A code-only component is refused before any browser work.
 *   4. When the browser cannot launch, the renderer degrades to `null` (the
 *      route's 204 path) instead of throwing — the graceful-degradation invariant.
 */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SandpackSpec } from '@ce/core';
import { createThumbnailRenderer } from '../src/thumbnail-renderer.js';
import { readCachedThumbnail, writeCachedThumbnail } from '../src/thumbnail-cache.js';
import { shouldRenderThumbnail, thumbnailCacheKey } from '../src/thumbnail.js';

/** PNG signature: the first 8 bytes of every valid PNG. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A self-contained component (no node_modules): paints a visible box into #root. */
const VISIBLE_SPEC: SandpackSpec = {
  files: {
    '/index.js': `
      var d = document.createElement('div');
      d.style.cssText =
        'width:220px;height:88px;display:flex;align-items:center;justify-content:center;' +
        'border-radius:14px;background:linear-gradient(135deg,#6366f1,#a855f7);' +
        'color:#fff;font:600 22px system-ui,sans-serif';
      d.textContent = 'Thumbnail';
      document.getElementById('root').appendChild(d);
    `,
  },
  entryPath: '/index.js',
  template: 'react-ts',
  dependencies: {},
  renderability: 'full',
  notes: [],
};

function log(step: string, detail: string): void {
  process.stdout.write(`  [${step}] ${detail}\n`);
}

async function main(): Promise<void> {
  const renderer = createThumbnailRenderer();
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-thumb-proof-'));

  try {
    // (1) Real browser render → non-empty PNG.
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-thumb-target-'));
    const png = await renderer.render({ targetRoot: root, spec: VISIBLE_SPEC, width: 320 });
    assert.ok(png, 'expected a PNG buffer from a renderable component');
    assert.ok(png.length > 200, `expected a non-trivial PNG, got ${png.length} bytes`);
    assert.ok(png.subarray(0, 8).equals(PNG_MAGIC), 'expected a valid PNG magic header');
    log('render', `PNG ${png.length} bytes, magic header OK (${[...png.subarray(0, 4)].join(' ')})`);

    // (2) Disk cache round-trip → a re-request is a hit.
    const key = thumbnailCacheKey({ componentId: 'proof#Comp', spec: VISIBLE_SPEC, width: 320 });
    assert.equal(await readCachedThumbnail(workspaceDir, key), null, 'cache should start empty');
    await writeCachedThumbnail(workspaceDir, key, png);
    const cached = await readCachedThumbnail(workspaceDir, key);
    assert.ok(cached && cached.equals(png), 'cached bytes must round-trip exactly');
    log('cache', `miss then hit for key ${key} (${cached.length} bytes)`);

    // (3) Code-only is refused with no browser work.
    assert.equal(shouldRenderThumbnail('code-only'), false, 'code-only must not render');
    log('code-only', 'refused before any browser launch');

    await renderer.close();

    // (4) Browser-absent degrades to null, never throws.
    const brokenRenderer = createThumbnailRenderer(() =>
      Promise.reject(new Error('simulated: chromium not installed')),
    );
    const absent = await brokenRenderer.render({ targetRoot: root, spec: VISIBLE_SPEC });
    assert.equal(absent, null, 'a failed browser launch must degrade to null, not throw');
    log('degrade', 'browser-absent path returned null (route would answer 204)');
    await brokenRenderer.close();
    await fs.rm(root, { recursive: true, force: true });

    process.stdout.write('\nthumbnail render proof: PASS\n');
  } finally {
    await renderer.close();
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`thumbnail render proof: FAIL\n${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
