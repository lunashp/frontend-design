/**
 * REAL browser + REAL axe-core proof for the accessibility audit. Deliberately
 * NOT part of `pnpm test` (CLAUDE.md: browser/E2E is excluded from the gate —
 * Chromium may be absent in the cloud VM). Run it locally, where Chromium is
 * installed:
 *
 *   pnpm --filter @ce/host test:browser:a11y
 *
 * It proves, against a live headless Chromium and the real axe engine:
 *   1. A component with genuine a11y defects (img with no alt, an unnamed button,
 *      low-contrast text) yields REAL axe violations — including a color-contrast
 *      finding that only a computed-style engine can produce, which a static JSX
 *      check never could.
 *   2. A clean component yields ZERO violations — proving the harness scoping
 *      (context '#root', WCAG-only rules) does not cry wolf on the preview shell.
 *   3. The on-disk JSON cache round-trips a report (a re-request is a cache hit).
 *   4. A code-only component is refused before any browser work.
 *   5. When the browser cannot launch, the auditor degrades to `null` (the route's
 *      "unavailable" path) instead of throwing — the graceful-degradation invariant.
 *
 * It reuses the SAME render pool the thumbnail renderer uses; no second browser.
 */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SandpackSpec } from '@ce/core';
import { createRenderPool } from '../src/render-pool.js';
import { createA11yAuditor } from '../src/a11y-audit.js';
import { a11yCacheKey, shouldAuditA11y, summarizeAxe } from '../src/a11y.js';
import { readCachedAudit, writeCachedAudit } from '../src/a11y-cache.js';

/** A 1x1 transparent GIF, so the <img> is a real element axe will flag for a missing alt. */
const PIXEL_GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

/** A self-contained component (no node_modules) with three genuine a11y defects. */
const DEFECTIVE_SPEC: SandpackSpec = {
  files: {
    '/index.js': `
      var root = document.getElementById('root');
      var img = document.createElement('img');
      img.src = '${PIXEL_GIF}';
      root.appendChild(img);                 // no alt -> image-alt (critical)
      var btn = document.createElement('button');
      root.appendChild(btn);                 // no text/label -> button-name (critical)
      var p = document.createElement('p');
      p.textContent = 'Low contrast body text that fails WCAG AA';
      p.style.color = '#cccccc';
      p.style.background = '#ffffff';
      p.style.fontSize = '14px';
      root.appendChild(p);                   // ~1.6:1 -> color-contrast (serious)
    `,
  },
  entryPath: '/index.js',
  template: 'react-ts',
  dependencies: {},
  renderability: 'full',
  notes: [],
};

/** A clean component: a named, high-contrast button — should raise ZERO WCAG violations. */
const CLEAN_SPEC: SandpackSpec = {
  files: {
    '/index.js': `
      var root = document.getElementById('root');
      var btn = document.createElement('button');
      btn.textContent = 'Save changes';
      btn.style.color = '#ffffff';
      btn.style.background = '#1a1a1a';
      root.appendChild(btn);
    `,
  },
  entryPath: '/index.js',
  template: 'react-ts',
  dependencies: {},
  renderability: 'full',
  notes: [],
};

function log(step: string, detail: string): void {
  process.stdout.write('  [' + step + '] ' + detail + '\n');
}

async function main(): Promise<void> {
  const pool = createRenderPool();
  const auditor = createA11yAuditor(pool.withPage);
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-a11y-proof-'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-a11y-target-'));

  try {
    // (1) Real axe run over a defective component → genuine violations.
    const raw = await auditor({ targetRoot: root, spec: DEFECTIVE_SPEC });
    assert.ok(raw, 'expected a violation list from a renderable component');
    const report = summarizeAxe(raw, { renderability: DEFECTIVE_SPEC.renderability });
    assert.ok(report.total > 0, 'expected axe to find real violations');
    const ruleIds = report.findings.map((f) => f.ruleId);
    assert.ok(ruleIds.includes('image-alt'), 'expected the missing-alt image to be flagged');
    assert.ok(
      ruleIds.includes('color-contrast'),
      'expected the low-contrast text to be flagged — this is the computed-style finding a static check cannot make',
    );
    assert.ok(report.summary.critical >= 1, 'expected at least one critical finding');
    log(
      'violations',
      report.total +
        ' found — ' +
        report.findings
          .map((f) => f.ruleId + '(' + f.impact + ' x' + f.nodeCount + ')')
          .join(', '),
    );
    log(
      'summary',
      'critical=' +
        report.summary.critical +
        ' serious=' +
        report.summary.serious +
        ' moderate=' +
        report.summary.moderate +
        ' minor=' +
        report.summary.minor,
    );

    // (2) A clean component → zero violations (harness scoping does not cry wolf).
    const cleanRaw = await auditor({ targetRoot: root, spec: CLEAN_SPEC });
    assert.ok(cleanRaw, 'expected a violation list (empty) from a clean component');
    const cleanReport = summarizeAxe(cleanRaw, { renderability: CLEAN_SPEC.renderability });
    assert.equal(
      cleanReport.total,
      0,
      'a named high-contrast button must be clean, got: ' + cleanReport.findings.map((f) => f.ruleId).join(', '),
    );
    log('clean', 'zero violations on a well-formed component');

    // (3) Disk cache round-trip → a re-request is a hit.
    const key = a11yCacheKey({ componentId: 'proof#Defective', spec: DEFECTIVE_SPEC });
    assert.equal(await readCachedAudit(workspaceDir, key), null, 'cache should start empty');
    await writeCachedAudit(workspaceDir, key, report);
    const cached = await readCachedAudit(workspaceDir, key);
    assert.ok(cached && cached.total === report.total, 'cached report must round-trip');
    log('cache', 'miss then hit for key ' + key + ' (total=' + (cached?.total ?? '?') + ')');

    // (4) Code-only is refused with no browser work.
    assert.equal(shouldAuditA11y('code-only'), false, 'code-only must not audit');
    log('code-only', 'refused before any browser launch');

    await pool.close();

    // (5) Browser-absent degrades to null, never throws.
    const brokenPool = createRenderPool(() =>
      Promise.reject(new Error('simulated: chromium not installed')),
    );
    const brokenAuditor = createA11yAuditor(brokenPool.withPage);
    const absent = await brokenAuditor({ targetRoot: root, spec: DEFECTIVE_SPEC });
    assert.equal(absent, null, 'a failed browser launch must degrade to null, not throw');
    log('degrade', 'browser-absent path returned null (route would answer unavailable)');
    await brokenPool.close();

    process.stdout.write('\na11y audit proof: PASS\n');
  } finally {
    await pool.close();
    await fs.rm(workspaceDir, { recursive: true, force: true });
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  process.stderr.write('a11y audit proof: FAIL\n' + (err instanceof Error ? err.stack : String(err)) + '\n');
  process.exitCode = 1;
});
