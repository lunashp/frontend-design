/**
 * RENDER CENSUS — does every component in a real project actually show a design?
 *
 * The unit gate proves the engine's units. It cannot see the rendered outcome,
 * and that is where this tool's defects live: a census of a 1,133-component MUI
 * app found only 75% of components showing anything, with 1,090 unit tests green.
 * Four separate causes, none of them visible to a single assertion in the suite.
 *
 * So this is the exit condition for render work: run it against a real target and
 * read the table. It opens every component's REAL preview URL in headless
 * Chromium and judges the rendered DOM — never the engine's own verdict.
 *
 *   pnpm --filter @ce/host census -- --project /path/to/react-app
 *   pnpm --filter @ce/host census -- --project /path/to/app --min-ok 0.84
 *
 * Deliberately NOT in `pnpm test`: it needs a real project on disk and a browser,
 * neither of which a cloud VM has. `--min-ok` makes it a regression gate anywhere
 * a target IS available — it exits non-zero when the share of components that
 * paint something falls below the floor you pass.
 *
 * VERDICTS
 *   ok         painted content — text, a graphic, or a visible box
 *   fallback   the error boundary's "Needs app context" card
 *   empty      mounted and painted nothing at all (no #root content, no portal)
 *   shell      a box with no text and no graphic (an empty table, a divider)
 *   code-only  the host refuses to bundle it
 *   timeout    the preview never loaded
 *
 * Portals matter: a dialog, drawer or menu renders onto document.body, OUTSIDE
 * #root. Probing #root alone scores every overlay `empty` — the first version of
 * this census did exactly that and had to be corrected, so the probe below reads
 * the whole body.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';

interface Args {
  project: string;
  host: string;
  concurrency: number;
  minOk: number | null;
  out: string | null;
  limit: number | null;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    project: '',
    host: 'http://127.0.0.1:4317',
    concurrency: 6,
    minOk: null,
    out: null,
    limit: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--project' && next) args.project = path.resolve((i += 1, next));
    else if (a === '--host' && next) args.host = (i += 1, next);
    else if (a === '--concurrency' && next) args.concurrency = Number((i += 1, next));
    else if (a === '--min-ok' && next) args.minOk = Number((i += 1, next));
    else if (a === '--out' && next) args.out = path.resolve((i += 1, next));
    else if (a === '--limit' && next) args.limit = Number((i += 1, next));
  }
  return args;
}

interface Row {
  id: string;
  name: string;
  relPath: string;
  level: string;
  status: string;
  detail?: string;
  errors: string[];
}

/**
 * Passed to the page as a SOURCE STRING: tsx compiles a function argument with an
 * esbuild `__name` helper that does not exist in the browser, so a function probe
 * throws `__name is not defined`.
 */
const PROBE = `(() => {
  const root = document.getElementById('root');
  const unrenderable = document.querySelector('[data-ce-unrenderable]');
  // Overlays render through a PORTAL onto document.body, outside #root.
  const painted = Array.from(document.body.querySelectorAll('*')).filter(
    (el) => !['SCRIPT','STYLE','LINK','META','TITLE'].includes(el.tagName)
  );
  const portalNodes = Array.from(document.body.children).filter(
    (c) => c.id !== 'root' && !['SCRIPT','STYLE','LINK','META','TITLE'].includes(c.tagName)
  ).length;
  let maxArea = 0;
  for (const el of painted) {
    if (el.id === 'root') continue; // the harness wrapper is not painted content
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    maxArea = Math.max(maxArea, r.width * r.height);
  }
  const text = (document.body.innerText || '').trim();
  return {
    bodyText: text.slice(0, 300),
    hasRoot: !!root,
    unrenderable: !!unrenderable,
    unrenderableMessage: unrenderable ? ((unrenderable.querySelector('pre') || {}).textContent || '') : '',
    rootHtmlLength: root ? root.innerHTML.length : -1,
    portalNodes,
    maxArea,
    hasText: text.length > 0,
    hasGraphic: !!document.body.querySelector('img, svg, canvas, video, input, button, textarea, select'),
  };
})()`;

async function classify(page: Page, host: string, row: Omit<Row, 'status' | 'errors'>): Promise<Row> {
  const errors: string[] = [];
  const onError = (e: Error) => errors.push(`pageerror: ${e.message}`.slice(0, 240));
  const onConsole = (m: { type(): string; text(): string }) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`.slice(0, 240));
  };
  page.on('pageerror', onError);
  page.on('console', onConsole);
  try {
    await page.goto(`${host}/api/preview?id=${encodeURIComponent(row.id)}`, {
      waitUntil: 'load',
      timeout: 60_000,
    });
    await page.waitForTimeout(450); // let React mount and paint
    const p = (await page.evaluate(PROBE)) as {
      bodyText: string;
      hasRoot: boolean;
      unrenderable: boolean;
      unrenderableMessage: string;
      rootHtmlLength: number;
      portalNodes: number;
      maxArea: number;
      hasText: boolean;
      hasGraphic: boolean;
    };

    let status = 'ok';
    let detail: string | undefined;
    if (/Preview build failed/i.test(p.bodyText)) {
      status = 'build-fail';
      detail = p.bodyText.replace(/\s+/g, ' ').slice(0, 200);
    } else if (/can.t be bundled for an isolated preview/i.test(p.bodyText)) {
      status = 'code-only';
    } else if (p.unrenderable) {
      status = 'fallback';
      detail = p.unrenderableMessage.replace(/\s+/g, ' ').slice(0, 200);
    } else if (!p.hasRoot || (p.rootHtmlLength === 0 && p.portalNodes === 0)) {
      status = 'empty';
      detail = 'mounted and painted nothing';
    } else if (!p.hasText && !p.hasGraphic && p.maxArea < 100) {
      status = 'empty';
      detail = `nothing visible (largest box ${p.maxArea.toFixed(0)}px2)`;
    } else if (!p.hasText && !p.hasGraphic) {
      status = 'shell';
      detail = `a box with no text and no graphic (${p.maxArea.toFixed(0)}px2)`;
    }
    return { ...row, status, detail, errors };
  } catch (e) {
    return {
      ...row,
      status: 'timeout',
      detail: e instanceof Error ? e.message.slice(0, 200) : String(e),
      errors,
    };
  } finally {
    page.off('pageerror', onError);
    page.off('console', onConsole);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project) {
    console.error('usage: render-census --project <path-to-react-app> [--host URL] [--min-ok 0.8]');
    process.exit(2);
  }

  const scanRes = await fetch(`${args.host}/api/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: args.project }),
  });
  if (!scanRes.ok) {
    console.error(`scan failed (${scanRes.status}) — is the host running? ${args.host}`);
    process.exit(2);
  }
  const scan = (await scanRes.json()) as {
    projectRoot: string;
    components: Array<{
      descriptor: { id: string; name: string; filePath: string };
      classification: { atomicLevel: string };
    }>;
  };
  const root = scan.projectRoot;
  const targets = scan.components
    .map((c) => ({
      id: c.descriptor.id,
      name: c.descriptor.name,
      relPath: c.descriptor.filePath.startsWith(root)
        ? c.descriptor.filePath.slice(root.length + 1)
        : c.descriptor.filePath,
      level: c.classification.atomicLevel,
    }))
    .slice(0, args.limit ?? undefined);

  console.log(`[census] ${targets.length} components · ${args.host} · concurrency ${args.concurrency}`);
  const browser: Browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const pages = await Promise.all(
    Array.from({ length: args.concurrency }, () => ctx.newPage()),
  );

  const rows: Row[] = [];
  let next = 0;
  await Promise.all(
    pages.map(async (page) => {
      for (;;) {
        const i = next++;
        if (i >= targets.length) return;
        rows.push(await classify(page, args.host, targets[i]!));
        if (rows.length % 50 === 0) console.log(`[census] ${rows.length}/${targets.length}`);
      }
    }),
  );
  await browser.close();

  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const okShare = (counts.get('ok') ?? 0) / rows.length;

  console.log(`\n=== RENDER CENSUS · ${path.basename(root)} · ${rows.length} components ===`);
  for (const [status, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status.padEnd(11)} ${String(n).padStart(5)}  ${((n / rows.length) * 100).toFixed(1)}%`);
  }
  console.log(`  ${'errors'.padEnd(11)} ${String(rows.filter((r) => r.errors.length > 0).length).padStart(5)}  components with a runtime error`);

  // The causes, grouped — one repeated exception is one fix, not N.
  const causes = new Map<string, number>();
  for (const r of rows.filter((x) => x.status === 'fallback')) {
    const key = (r.detail ?? '').replace(/\d+/g, 'N').slice(0, 70);
    causes.set(key, (causes.get(key) ?? 0) + 1);
  }
  if (causes.size > 0) {
    console.log('\n  top fallback causes:');
    for (const [cause, n] of [...causes].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log(`    ${String(n).padStart(4)}  ${cause}`);
    }
  }

  if (args.out) {
    await fs.writeFile(args.out, JSON.stringify(rows, null, 1), 'utf8');
    console.log(`\n  report -> ${args.out}`);
  }

  if (args.minOk !== null && okShare < args.minOk) {
    console.error(
      `\n[census] FAIL: ${(okShare * 100).toFixed(1)}% show a design, floor is ${(args.minOk * 100).toFixed(1)}%`,
    );
    process.exit(1);
  }
  console.log(`\n[census] ${(okShare * 100).toFixed(1)}% of components show a design.`);
}

main().catch((e) => {
  console.error('[census] failed', e);
  process.exit(1);
});
