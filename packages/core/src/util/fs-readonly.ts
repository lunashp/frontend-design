/**
 * The ONLY sanctioned way the engine reads a target project. Exposes read
 * operations exclusively — there is no write method on this surface, and every
 * access is asserted to stay within the project root. This is the read-only
 * invariant made structural: the source repo cannot be mutated through here.
 *
 * (Third-party analyzers like ts-morph/dependency-cruiser read the filesystem
 * directly; they are read-only by nature — we must never call ts-morph `.save()`
 * against a target project.)
 */

import { promises as fs } from 'node:fs';
import { readFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import { isInside } from './paths.js';
import { ReadOnlyViolationError } from './errors.js';

export interface FileStat {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly size: number;
}

export interface ReadOnlyFs {
  readonly root: string;
  readFile(absPath: string): Promise<string>;
  readFileSync(absPath: string): string;
  readdir(absPath: string): Promise<readonly string[]>;
  stat(absPath: string): Promise<FileStat>;
  exists(absPath: string): boolean;
}

function assertInsideRoot(root: string, target: string): void {
  if (!isInside(root, target)) {
    throw new ReadOnlyViolationError(
      `read outside project root (${root}): ${target}`,
    );
  }
}

export function createReadOnlyFs(root: string): ReadOnlyFs {
  const resolvedRoot = path.resolve(root);
  return {
    root: resolvedRoot,
    async readFile(absPath) {
      assertInsideRoot(resolvedRoot, absPath);
      return fs.readFile(absPath, 'utf8');
    },
    readFileSync(absPath) {
      assertInsideRoot(resolvedRoot, absPath);
      return readFileSync(absPath, 'utf8');
    },
    async readdir(absPath) {
      assertInsideRoot(resolvedRoot, absPath);
      return fs.readdir(absPath);
    },
    async stat(absPath) {
      assertInsideRoot(resolvedRoot, absPath);
      const s = await fs.stat(absPath);
      return { isFile: s.isFile(), isDirectory: s.isDirectory(), size: s.size };
    },
    exists(absPath) {
      assertInsideRoot(resolvedRoot, absPath);
      return existsSync(absPath);
    },
  };
}
