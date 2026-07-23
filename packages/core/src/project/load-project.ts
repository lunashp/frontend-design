/**
 * ProjectLoader — reads a target project (read-only): tsconfig aliases,
 * package.json, framework detection, source dirs, and allocates the tool-owned
 * workspace. Produces a LoadedProject the rest of the engine builds on.
 */

import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type { LoadedProject, ProjectRef } from '../types/project.js';
import { ProjectLoadError } from '../util/errors.js';
import { createWorkspace } from '../util/workspace.js';
import { readTsAliases } from './resolve-paths.js';
import { detectFramework, findSrcDirs, findTsconfig, readPackageInfo } from './project-facts.js';
import { detectThemeRef, detectMessagesFile, detectContextProviders } from './detect-theme.js';

export interface LoadProjectOptions {
  /** Base dir that holds per-project workspaces (default `<cwd>/.workspace`). */
  readonly workspaceRoot?: string;
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
  const framework = detectFramework(pkg).framework;
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
    themeRef: detectThemeRef(rootPath, srcDirs),
    messagesFile: detectMessagesFile(rootPath),
    contextProviders: detectContextProviders(rootPath, srcDirs),
  };
}
