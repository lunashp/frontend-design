/**
 * On-disk JSON cache for accessibility audits, under the engine's own workspace
 * dir — the JSON sibling of thumbnail-cache.ts (the target project is never
 * touched). Disk, not memory, so a page reload or a re-scan of unchanged source
 * returns instantly without re-launching Chromium and re-running axe.
 *
 * Only completed (available:true) reports are ever cached. An "unavailable"
 * outcome is transient — the browser may come back — so caching it would poison
 * every later request with a stale failure. The route simply never writes those.
 *
 * The path is resolved through the same containment guard the thumbnail cache
 * uses: every key is asserted inside the audits dir, so a crafted key cannot
 * escape the scratch area.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { isInside } from '@ce/core';
import type { A11yReport } from './a11y.js';

/** Subdir of a project's workspace where rendered audits live. */
const A11Y_SUBDIR = 'a11y';

function resolveGuarded(workspaceDir: string, key: string): string {
  const dir = path.join(workspaceDir, A11Y_SUBDIR);
  const file = path.join(dir, key + '.json');
  // Defence in depth: keys are hash-derived (safe by construction), but assert
  // containment anyway so a future caller passing a raw id cannot traverse out.
  if (!isInside(dir, file)) {
    throw new Error('a11y key escapes cache dir: ' + key);
  }
  return file;
}

/** Return the cached report, or `null` on a miss (or any read/parse error). */
export async function readCachedAudit(
  workspaceDir: string,
  key: string,
): Promise<A11yReport | null> {
  try {
    const raw = await fs.readFile(resolveGuarded(workspaceDir, key), 'utf8');
    // The file is our own last write; a parse failure means a truncated/garbled
    // write, which is the same as a miss to the caller: audit fresh.
    return JSON.parse(raw) as A11yReport;
  } catch {
    return null;
  }
}

/**
 * Persist the report for later hits. A write failure is swallowed: a full disk
 * must degrade to "audit every time", never to a 500 that breaks the inspector.
 */
export async function writeCachedAudit(
  workspaceDir: string,
  key: string,
  report: A11yReport,
): Promise<void> {
  const file = resolveGuarded(workspaceDir, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(report));
}
