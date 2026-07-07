/**
 * Import-specifier classification + resolution (relative / alias / external) and
 * filesystem resolution for non-TS assets (CSS, images) that ts-morph won't
 * resolve. Read-only: only existence checks + path math, never writes.
 */

import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type { LoadedProject } from '../types/project.js';
import { resolveAlias } from '../project/resolve-paths.js';
import { isInside } from '../util/paths.js';

export type SpecifierKind = 'relative' | 'alias' | 'external';

export const STYLE_EXT = /\.(css|scss|sass|less)$/;
export const ASSET_EXT = /\.(svg|png|jpe?g|gif|webp|avif|json)$/;
const TS_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

export function classifySpecifier(spec: string, loaded: LoadedProject): SpecifierKind {
  if (spec.startsWith('.') || spec.startsWith('/')) return 'relative';
  if (resolveAlias(spec, loaded.pathAliases).length > 0) return 'alias';
  return 'external';
}

/** Package name from a specifier: `@scope/pkg/sub` -> `@scope/pkg`, `pkg/sub` -> `pkg`. */
export function packageName(spec: string): string {
  const parts = spec.split('/');
  if (spec.startsWith('@')) return parts.slice(0, 2).join('/');
  return parts[0] ?? spec;
}

function tryExtensions(base: string): string | null {
  if (existsSync(base) && !base.endsWith('/')) {
    // Exact file (e.g. a .css with explicit extension).
    if (path.extname(base)) return base;
  }
  for (const ext of TS_EXTS) {
    if (existsSync(base + ext)) return base + ext;
  }
  for (const ext of TS_EXTS) {
    const idx = path.join(base, `index${ext}`);
    if (existsSync(idx)) return idx;
  }
  if (path.extname(base) && existsSync(base)) return base;
  return null;
}

/**
 * Resolve a relative or alias specifier to an absolute file inside the project.
 * Handles both TS modules and explicit-extension assets/styles.
 */
export function resolveLocalSpecifier(
  spec: string,
  fromFile: string,
  loaded: LoadedProject,
): string | null {
  const kind = classifySpecifier(spec, loaded);
  const bases: string[] = [];

  if (kind === 'relative') {
    bases.push(path.resolve(path.dirname(fromFile), spec));
  } else if (kind === 'alias') {
    bases.push(...resolveAlias(spec, loaded.pathAliases));
  } else {
    return null;
  }

  for (const base of bases) {
    // Explicit-extension asset/style: resolve directly.
    if (STYLE_EXT.test(base) || ASSET_EXT.test(base)) {
      if (existsSync(base)) return base;
      continue;
    }
    const resolved = tryExtensions(base);
    if (resolved) return resolved;
  }
  return null;
}

export function isInProjectSrc(absPath: string, loaded: LoadedProject): boolean {
  if (absPath.includes('/node_modules/')) return false;
  return loaded.srcDirs.some((dir) => isInside(dir, absPath)) || isInside(loaded.rootPath, absPath);
}
