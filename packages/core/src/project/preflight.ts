/**
 * A "here is what I will scan" profile computed WITHOUT a full scan.
 *
 * Pointing the tool at a project is otherwise a blind, multi-minute commit: the
 * user cannot see the detected framework and how confident that guess is, which
 * source directories will actually be read, the tsconfig aliases, whether the
 * target is even installed (an un-installed target silently degrades the
 * preview), or — for a monorepo root — which member packages contain React.
 * preflightProject answers all of that from the same reads loadProject already
 * does, but stops short of scanning and never allocates a workspace. Read-only.
 */

import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type { PathAliases, ProjectRef } from '../types/project.js';
import { ProjectLoadError } from '../util/errors.js';
import { readTsAliases } from './resolve-paths.js';
import { detectFramework, findSrcDirs, findTsconfig, readPackageInfo } from './project-facts.js';
import { scanWorkspaceMembers, type WorkspaceMember } from './workspace-members.js';

export type PreflightMember = WorkspaceMember;

export interface ProjectPreflight {
  readonly rootPath: string;
  readonly packageName: string | null;
  readonly framework: 'react' | 'vue' | 'unknown';
  /** 0..1 trust in the framework verdict; 0 means none was declared. */
  readonly frameworkConfidence: number;
  readonly frameworkReason: string;
  /** Absolute directories the scan would read, resolved exactly as the scan will. */
  readonly srcDirs: readonly string[];
  readonly pathAliases: PathAliases;
  /** Whether the target's dependencies are installed; false degrades previews. */
  readonly nodeModulesPresent: boolean;
  /** Whether a workspace config (npm/yarn/pnpm) was found at the root. */
  readonly isWorkspaceRoot: boolean;
  /** For a workspace root, the member packages that declare React. */
  readonly reactMembers: readonly PreflightMember[];
}

export function preflightProject(ref: ProjectRef): ProjectPreflight {
  const rootPath = path.resolve(ref.rootPath);
  if (!existsSync(rootPath)) {
    throw new ProjectLoadError(`Project path does not exist: ${rootPath}`);
  }

  const pkg = readPackageInfo(rootPath);
  const tsconfigPath = findTsconfig(rootPath);
  const detection = detectFramework(pkg);
  const workspace = scanWorkspaceMembers(rootPath);

  return {
    rootPath,
    packageName: pkg.name,
    framework: detection.framework,
    frameworkConfidence: detection.confidence,
    frameworkReason: detection.reason,
    srcDirs: findSrcDirs(rootPath, tsconfigPath),
    pathAliases: readTsAliases(tsconfigPath),
    nodeModulesPresent: existsSync(path.join(rootPath, 'node_modules')),
    isWorkspaceRoot: workspace.isWorkspaceRoot,
    reactMembers: workspace.reactMembers,
  };
}
