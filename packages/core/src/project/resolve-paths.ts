/**
 * Parse a target project's tsconfig for path aliases + baseUrl. Uses the
 * TypeScript API so `extends` chains and comments are handled correctly.
 */

import ts from 'typescript';
import * as path from 'node:path';
import type { PathAliases } from '../types/project.js';

const EMPTY: PathAliases = { baseUrl: null, paths: {} };

export function readTsAliases(tsconfigPath: string | null): PathAliases {
  if (!tsconfigPath) return EMPTY;

  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error || !configFile.config) return EMPTY;

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(tsconfigPath),
  );

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
