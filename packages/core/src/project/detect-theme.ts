/**
 * Best-effort detection of a target's real MUI theme and i18n message catalogue
 * so previews render with true brand colors and labels instead of placeholders.
 * Everything here is heuristic and returns null on any doubt — the caller falls
 * back to a defensive stub, so a miss never breaks a preview.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import type { ThemeRef } from '../types/project.js';

const THEME_EXPORT_RE = /export\s+const\s+([A-Za-z0-9_]+)\s*(?::[^=]+)?=\s*createTheme\b/g;

/** Walk a dir shallowly for `.ts`/`.tsx` files, skipping node_modules/dot-dirs. */
function walk(dir: string, depth: number, out: string[]): void {
  if (depth < 0) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const full = path.join(dir, name);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) walk(full, depth - 1, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
}

/**
 * Find `export const <name> = createTheme(...)`. Prefers a light theme (the app
 * default), then any. Returns the first match across the scanned source dirs.
 */
export function detectThemeRef(rootPath: string, srcDirs: readonly string[]): ThemeRef | null {
  const files: string[] = [];
  for (const dir of srcDirs) walk(dir, 5, files);

  const candidates: ThemeRef[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (!text.includes('createTheme')) continue;
    THEME_EXPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = THEME_EXPORT_RE.exec(text)) !== null) {
      candidates.push({ file, exportName: m[1] as string });
    }
  }
  if (candidates.length === 0) return null;
  return (
    candidates.find((c) => /light/i.test(c.exportName)) ??
    candidates.find((c) => !/dark|mobile|blog/i.test(c.exportName)) ??
    candidates[0] ??
    null
  );
}

const LOCALE_PREFERENCE = ['ko', 'en', 'en-US'];

/**
 * Find a next-intl message catalogue: a `messages/<locale>.json`. Prefers ko/en.
 * Returns null when the shape isn't a plain object (not a usable catalogue).
 */
export function detectMessagesFile(rootPath: string): string | null {
  const dir = path.join(rootPath, 'messages');
  if (!existsSync(dir)) return null;
  let entries: string[];
  try {
    entries = readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return null;
  }
  if (entries.length === 0) return null;

  const ordered = [
    ...LOCALE_PREFERENCE.map((l) => `${l}.json`).filter((n) => entries.includes(n)),
    ...entries,
  ];
  for (const name of ordered) {
    const file = path.join(dir, name);
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return file;
    } catch {
      /* skip unparseable */
    }
  }
  return null;
}
