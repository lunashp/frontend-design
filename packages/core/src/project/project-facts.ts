/**
 * Cheap, side-effect-free reads of a target project's shape: its package.json,
 * its tsconfig location, its source directories, and which framework it declares.
 *
 * Extracted from load-project.ts so the preflight route can reuse the exact same
 * derivations without also allocating a workspace or running a scan — the two
 * consumers must agree on "what framework is this / where is its source", and a
 * second private copy in preflight would be the first thing to drift.
 */

import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { Framework, PackageInfo } from '../types/project.js';
import { ProjectLoadError } from '../util/errors.js';
import { readTsSrcDirs } from './resolve-paths.js';

/** Fallback source directories, in priority order, when tsconfig names none. */
export const SRC_CANDIDATES = ['src', 'app', 'components', 'lib', 'pages'] as const;

/**
 * A framework verdict WITH how much to trust it and why. A direct `react`
 * dependency is near-certain; `next` alone only implies React, so it must not be
 * reported with the same confidence — the preflight card shows both numbers so
 * the user commits to a scan knowing which case they are in.
 */
export interface FrameworkDetection {
  readonly framework: Framework;
  /** 0..1. 0 means "no framework declared", not "unknown but probably fine". */
  readonly confidence: number;
  readonly reason: string;
}

export function readPackageInfo(rootPath: string): PackageInfo {
  const pkgPath = path.join(rootPath, 'package.json');
  if (!existsSync(pkgPath)) {
    return { name: null, dependencies: {}, devDependencies: {} };
  }
  try {
    const raw = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
    return {
      name: typeof raw.name === 'string' ? raw.name : null,
      dependencies: (raw.dependencies as Record<string, string>) ?? {},
      devDependencies: (raw.devDependencies as Record<string, string>) ?? {},
    };
  } catch (cause) {
    throw new ProjectLoadError(`Invalid package.json at ${pkgPath}`, cause);
  }
}

export function detectFramework(pkg: PackageInfo): FrameworkDetection {
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  if (all['react']) {
    return {
      framework: 'react',
      confidence: 0.99,
      reason: all['next']
        ? 'react and next are declared dependencies'
        : 'react is a declared dependency',
    };
  }
  if (all['next']) {
    return {
      framework: 'react',
      confidence: 0.85,
      reason: 'next is declared, which implies React (react is not a direct dependency)',
    };
  }
  if (all['vue']) {
    return { framework: 'vue', confidence: 0.99, reason: 'vue is a declared dependency' };
  }
  if (all['nuxt']) {
    return {
      framework: 'vue',
      confidence: 0.85,
      reason: 'nuxt is declared, which implies Vue (vue is not a direct dependency)',
    };
  }
  return {
    framework: 'unknown',
    confidence: 0,
    reason: 'no react, next, vue, or nuxt dependency was declared',
  };
}

export function findTsconfig(rootPath: string): string | null {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const candidate = path.join(rootPath, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function findSrcDirs(rootPath: string, tsconfigPath: string | null): string[] {
  const declared = readTsSrcDirs(tsconfigPath);
  if (declared.length > 0) return declared;
  const dirs = SRC_CANDIDATES.map((d) => path.join(rootPath, d)).filter((d) => existsSync(d));
  return dirs.length > 0 ? dirs : [rootPath];
}
