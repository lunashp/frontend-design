/**
 * The tool-owned scratch area. ALL engine writes go here and nowhere else.
 * Every write resolves its path and asserts containment inside the workspace
 * dir; an attempt to escape throws ReadOnlyViolationError. This is the write
 * half of the read-only invariant.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { isInside, shortHash } from './paths.js';
import { ReadOnlyViolationError } from './errors.js';

export interface Workspace {
  /** Absolute workspace directory for this project. */
  readonly dir: string;
  /** Resolve a workspace-relative path to absolute (asserted inside `dir`). */
  path(rel: string): string;
  ensureDir(rel: string): Promise<void>;
  writeFile(rel: string, contents: string): Promise<void>;
  readFile(rel: string): Promise<string>;
  exists(rel: string): Promise<boolean>;
  /** Remove the whole workspace dir (only ever its own subtree). */
  cleanup(): Promise<void>;
}

function guardedResolve(dir: string, rel: string): string {
  const abs = path.resolve(dir, rel);
  if (!isInside(dir, abs)) {
    throw new ReadOnlyViolationError(`write escapes workspace (${dir}): ${abs}`);
  }
  return abs;
}

export interface CreateWorkspaceOptions {
  /** Base dir that holds per-project workspaces, e.g. `<repo>/.workspace`. */
  readonly workspaceRoot: string;
  /** The scanned project root — used to derive a stable per-project subdir. */
  readonly projectRoot: string;
}

export async function createWorkspace(
  options: CreateWorkspaceOptions,
): Promise<Workspace> {
  const dir = path.resolve(options.workspaceRoot, shortHash(options.projectRoot));
  await fs.mkdir(dir, { recursive: true });

  return {
    dir,
    path(rel) {
      return guardedResolve(dir, rel);
    },
    async ensureDir(rel) {
      await fs.mkdir(guardedResolve(dir, rel), { recursive: true });
    },
    async writeFile(rel, contents) {
      const abs = guardedResolve(dir, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, contents, 'utf8');
    },
    async readFile(rel) {
      return fs.readFile(guardedResolve(dir, rel), 'utf8');
    },
    async exists(rel) {
      try {
        await fs.access(guardedResolve(dir, rel));
        return true;
      } catch {
        return false;
      }
    },
    async cleanup() {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}
