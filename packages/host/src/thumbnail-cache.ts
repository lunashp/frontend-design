/**
 * On-disk PNG cache for component thumbnails, under the engine's own workspace
 * dir (the same tool-owned scratch area every engine write already goes to — the
 * target project is never touched). Disk, not memory, so a page reload or a
 * re-scan of unchanged source returns instantly without re-launching Chromium.
 *
 * The workspace's guarded `writeFile` is string-only (utf8), and a PNG is
 * binary, so we resolve the path through the same containment guard and then do
 * the binary read/write with `fs` directly. The guard is what keeps this honest:
 * every path is asserted inside the thumbnails dir, so a crafted key cannot
 * escape the scratch area.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { isInside } from '@ce/core';

/** Subdir of a project's workspace where rendered thumbnails live. */
const THUMB_SUBDIR = 'thumbnails';

function resolveGuarded(workspaceDir: string, key: string): string {
  const dir = path.join(workspaceDir, THUMB_SUBDIR);
  const file = path.join(dir, `${key}.png`);
  // Defence in depth: keys are hash-derived (safe by construction), but assert
  // containment anyway so a future caller passing a raw id cannot traverse out.
  if (!isInside(dir, file)) {
    throw new Error(`thumbnail key escapes cache dir: ${key}`);
  }
  return file;
}

/** Return the cached PNG bytes, or `null` on a miss (or any read error). */
export async function readCachedThumbnail(
  workspaceDir: string,
  key: string,
): Promise<Buffer | null> {
  try {
    return await fs.readFile(resolveGuarded(workspaceDir, key));
  } catch {
    // A miss and an unreadable file are the same to the caller: render fresh.
    return null;
  }
}

/**
 * Persist the PNG for later hits. A write failure is swallowed (logged by the
 * caller): a full disk must degrade to "render every time", never to a 500 that
 * breaks the gallery.
 */
export async function writeCachedThumbnail(
  workspaceDir: string,
  key: string,
  png: Buffer,
): Promise<void> {
  const file = resolveGuarded(workspaceDir, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, png);
}
