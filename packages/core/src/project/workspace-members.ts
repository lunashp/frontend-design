/**
 * Discover the React-declaring member packages of a monorepo root.
 *
 * Pointing the tool at a workspace root whose own package.json declares no React
 * is a dead end today: the scan finds nothing and the user is left guessing which
 * member to aim at. This reads the workspace globs (npm/yarn `workspaces` or a
 * pnpm-workspace.yaml), expands them one directory level, and returns the members
 * that actually declare react/next — the concrete list the preflight card offers
 * as scan targets. Read-only: it never writes and never runs the target.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';

export interface WorkspaceMember {
  readonly name: string | null;
  /** Absolute directory of the member package — a ready-to-scan target. */
  readonly dir: string;
}

export interface WorkspaceScan {
  /** True when any workspace config (package.json workspaces / pnpm-workspace) exists. */
  readonly isWorkspaceRoot: boolean;
  /** Members declaring react or next, in discovery order. */
  readonly reactMembers: readonly WorkspaceMember[];
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function listSubdirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

/** A single glob segment like `app-*` → an anchored RegExp over a basename. */
function segmentToRegExp(segment: string): RegExp {
  const escaped = segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/**
 * Expand one workspace glob to existing member directories. A `*` or `**`
 * segment matches every immediate subdirectory; `**` is treated as one level
 * because descending arbitrarily deep would wander into build output and away
 * from the flat `packages/*` layout monorepos actually use.
 */
function expandGlob(rootPath: string, pattern: string): string[] {
  if (pattern.startsWith('!')) return []; // negations are not scan targets
  const segments = pattern.split('/').filter((s) => s.length > 0);
  let current = [rootPath];
  for (const segment of segments) {
    const next: string[] = [];
    if (segment === '*' || segment === '**') {
      for (const dir of current) next.push(...listSubdirs(dir));
    } else if (segment.includes('*')) {
      const re = segmentToRegExp(segment);
      for (const dir of current) {
        for (const child of listSubdirs(dir)) {
          if (re.test(path.basename(child))) next.push(child);
        }
      }
    } else {
      for (const dir of current) {
        const candidate = path.join(dir, segment);
        if (isDirectory(candidate)) next.push(candidate);
      }
    }
    current = next;
  }
  return current;
}

function readWorkspaceGlobs(rootPath: string): string[] {
  const pkgPath = path.join(rootPath, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const raw = JSON.parse(readFileSync(pkgPath, 'utf8')) as { workspaces?: unknown };
      const ws = raw.workspaces;
      if (Array.isArray(ws)) return ws.filter((s): s is string => typeof s === 'string');
      if (ws && typeof ws === 'object' && Array.isArray((ws as { packages?: unknown }).packages)) {
        return (ws as { packages: unknown[] }).packages.filter(
          (s): s is string => typeof s === 'string',
        );
      }
    } catch {
      /* fall through to pnpm-workspace.yaml */
    }
  }
  return readPnpmWorkspaceGlobs(rootPath);
}

/**
 * A dependency-free read of pnpm-workspace.yaml's `packages:` list. The engine
 * carries no YAML parser, and the file's shape here is a flat list of quoted
 * globs — so we collect `- 'glob'` items under the `packages:` key and stop at
 * the next top-level key. Anything more exotic simply yields no members, which
 * degrades to "not a workspace root", never a crash.
 */
function readPnpmWorkspaceGlobs(rootPath: string): string[] {
  const file = path.join(rootPath, 'pnpm-workspace.yaml');
  if (!existsSync(file)) return [];
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const globs: string[] = [];
  let inPackages = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const item = /^\s*-\s*['"]?([^'"#]+?)['"]?\s*$/.exec(line);
    if (item?.[1]) {
      globs.push(item[1].trim());
      continue;
    }
    // A non-indented, non-list line begins the next top-level key: stop.
    if (line.length > 0 && !/^\s/.test(line)) break;
  }
  return globs;
}

function memberDeclaresReact(dir: string): { declares: boolean; name: string | null } {
  const pkgPath = path.join(dir, 'package.json');
  if (!existsSync(pkgPath)) return { declares: false, name: null };
  try {
    const raw = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      name?: unknown;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...raw.dependencies, ...raw.devDependencies };
    return {
      declares: Boolean(all['react'] || all['next']),
      name: typeof raw.name === 'string' ? raw.name : null,
    };
  } catch {
    return { declares: false, name: null };
  }
}

export function scanWorkspaceMembers(rootPath: string): WorkspaceScan {
  const globs = readWorkspaceGlobs(rootPath);
  if (globs.length === 0) return { isWorkspaceRoot: false, reactMembers: [] };

  const seen = new Set<string>();
  const reactMembers: WorkspaceMember[] = [];
  for (const glob of globs) {
    for (const dir of expandGlob(rootPath, glob)) {
      if (seen.has(dir)) continue;
      seen.add(dir);
      const { declares, name } = memberDeclaresReact(dir);
      if (declares) reactMembers.push({ name, dir });
    }
  }
  return { isWorkspaceRoot: true, reactMembers };
}
