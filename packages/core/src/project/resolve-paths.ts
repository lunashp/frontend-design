/**
 * Parse a target project's tsconfig for path aliases + baseUrl. Uses the
 * TypeScript API so `extends` chains and comments are handled correctly.
 */

import { statSync } from 'node:fs';
import ts from 'typescript';
import * as path from 'node:path';
import type { PathAliases } from '../types/project.js';

const EMPTY: PathAliases = { baseUrl: null, paths: {} };

/**
 * `parseJsonConfigFileContent` walks the whole project to expand `include` into
 * `fileNames`. We only ever read `options` and `raw`, so stub `readDirectory`
 * out: same result, without globbing a large target project twice per load.
 */
const NO_GLOB_HOST: ts.ParseConfigHost = {
  useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
  readDirectory: () => [],
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
};

function parseTsconfig(tsconfigPath: string): ts.ParsedCommandLine | null {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error || !configFile.config) return null;
  return ts.parseJsonConfigFileContent(
    configFile.config,
    NO_GLOB_HOST,
    path.dirname(tsconfigPath),
  );
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Absolute source directories named by tsconfig `include`, e.g.
 * `shared/**\/*.tsx` → `<root>/shared`. A project's own tsconfig is the only
 * reliable statement of where its source lives — a fixed list of directory
 * names silently misses design systems kept in `shared/`, `widgets/`, etc.
 *
 * An entry contributes nothing when its first segment is a glob (`**\/*.ts`),
 * a file (`next-env.d.ts`), a dot-dir (`.next/types`), or is not a directory
 * on disk. Returns [] when the tsconfig names no concrete directory, leaving
 * the caller to fall back.
 */
export function readTsSrcDirs(tsconfigPath: string | null): string[] {
  if (!tsconfigPath) return [];
  const parsed = parseTsconfig(tsconfigPath);
  const include: unknown = parsed?.raw?.include;
  if (!Array.isArray(include)) return [];

  const base = path.dirname(tsconfigPath);
  const dirs = new Set<string>();
  for (const pattern of include) {
    if (typeof pattern !== 'string') continue;
    const head = pattern.split('/')[0];
    if (!head || head.startsWith('.') || head.includes('*') || head.includes('?')) continue;
    if (head === 'node_modules') continue;
    const abs = path.resolve(base, head);
    if (isDirectory(abs)) dirs.add(abs);
  }
  return [...dirs];
}

export function readTsAliases(tsconfigPath: string | null): PathAliases {
  if (!tsconfigPath) return EMPTY;

  const parsed = parseTsconfig(tsconfigPath);
  if (!parsed) return EMPTY;

  const opts = parsed.options;
  const paths: Record<string, readonly string[]> = {};
  for (const [key, value] of Object.entries(opts.paths ?? {})) {
    if (Array.isArray(value)) paths[key] = [...value];
  }

  return {
    baseUrl: opts.baseUrl ?? (Object.keys(paths).length > 0 ? path.dirname(tsconfigPath) : null),
    paths,
  };
}

/**
 * Resolve an import specifier against tsconfig aliases to candidate absolute
 * paths (without extensions). Returns [] when no alias matches.
 */
export function resolveAlias(specifier: string, aliases: PathAliases): string[] {
  if (!aliases.baseUrl) return [];
  const candidates: string[] = [];
  for (const [pattern, targets] of Object.entries(aliases.paths)) {
    const starIdx = pattern.indexOf('*');
    if (starIdx === -1) {
      if (pattern === specifier) {
        for (const t of targets) candidates.push(path.resolve(aliases.baseUrl, t));
      }
      continue;
    }
    const prefix = pattern.slice(0, starIdx);
    const suffix = pattern.slice(starIdx + 1);
    if (specifier.startsWith(prefix) && specifier.endsWith(suffix)) {
      const middle = specifier.slice(prefix.length, specifier.length - suffix.length);
      for (const t of targets) {
        candidates.push(path.resolve(aliases.baseUrl, t.replace('*', middle)));
      }
    }
  }
  return candidates;
}
