/**
 * ProjectLoader — reads a target project (read-only): tsconfig aliases,
 * package.json, framework detection, source dirs, and allocates the tool-owned
 * workspace. Produces a LoadedProject the rest of the engine builds on.
 */

import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { Framework, LoadedProject, PackageInfo, ProjectRef } from '../types/project.js';
import { ProjectLoadError } from '../util/errors.js';
import { createWorkspace } from '../util/workspace.js';
import { readTsAliases, readTsSrcDirs } from './resolve-paths.js';

/** Fallback source directories, in priority order, when tsconfig names none. */
const SRC_CANDIDATES = ['src', 'app', 'components', 'lib', 'pages'];

export interface LoadProjectOptions {
  /** Base dir that holds per-project workspaces (default `<cwd>/.workspace`). */
  readonly workspaceRoot?: string;
}

function readPackageInfo(rootPath: string): PackageInfo {
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

function detectFramework(pkg: PackageInfo): Framework {
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  if (all['react'] || all['next']) return 'react';
  if (all['vue'] || all['nuxt']) return 'vue';
  return 'unknown';
}

function findTsconfig(rootPath: string): string | null {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const candidate = path.join(rootPath, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function findSrcDirs(rootPath: string, tsconfigPath: string | null): string[] {
  const declared = readTsSrcDirs(tsconfigPath);
  if (declared.length > 0) return declared;
  const dirs = SRC_CANDIDATES.map((d) => path.join(rootPath, d)).filter((d) => existsSync(d));
  return dirs.length > 0 ? dirs : [rootPath];
}

export async function loadProject(
  ref: ProjectRef,
  options: LoadProjectOptions = {},
): Promise<LoadedProject> {
  const rootPath = path.resolve(ref.rootPath);
  if (!existsSync(rootPath)) {
    throw new ProjectLoadError(`Project path does not exist: ${rootPath}`);
  }

  const pkg = readPackageInfo(rootPath);
  const tsconfigPath = findTsconfig(rootPath);
  const pathAliases = readTsAliases(tsconfigPath);
  const framework = detectFramework(pkg);
  const srcDirs = findSrcDirs(rootPath, tsconfigPath);

  const workspaceRoot = options.workspaceRoot ?? path.join(process.cwd(), '.workspace');
  const workspace = await createWorkspace({ workspaceRoot, projectRoot: rootPath });

  return {
    rootPath,
    srcDirs,
    tsconfigPath,
    pathAliases,
    pkg,
    framework,
    workspaceDir: workspace.dir,
  };
}
