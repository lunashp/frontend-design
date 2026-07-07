/** Small path helpers shared by the read-only + workspace guards. */

import * as path from 'node:path';
import { createHash } from 'node:crypto';

/** True when `child` is `parent` itself or nested inside it. */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Stable short hash for a path (deterministic — no Date/random). */
export function shortHash(input: string, length = 12): string {
  return createHash('sha1').update(input).digest('hex').slice(0, length);
}

/** Normalize a bundle path to always start with a single leading slash. */
export function toBundlePath(p: string): string {
  const normalized = p.replace(/\\/g, '/').replace(/^\.?\/*/, '');
  return `/${normalized}`;
}
