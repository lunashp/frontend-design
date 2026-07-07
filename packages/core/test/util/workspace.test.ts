import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createWorkspace } from '../../src/util/workspace.js';
import { ReadOnlyViolationError } from '../../src/util/errors.js';

const ROOT = path.join(os.tmpdir(), 'ce-ws-test');
const PROJECT = '/Users/example/target-project';

afterEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

describe('createWorkspace', () => {
  it('creates a per-project subdir under the workspace root', async () => {
    const ws = await createWorkspace({ workspaceRoot: ROOT, projectRoot: PROJECT });
    expect(ws.dir.startsWith(path.resolve(ROOT))).toBe(true);
    await expect(fs.stat(ws.dir)).resolves.toBeDefined();
  });

  it('writes and reads files within the workspace', async () => {
    const ws = await createWorkspace({ workspaceRoot: ROOT, projectRoot: PROJECT });
    await ws.writeFile('nested/a.txt', 'hello');
    expect(await ws.readFile('nested/a.txt')).toBe('hello');
    expect(await ws.exists('nested/a.txt')).toBe(true);
    expect(await ws.exists('missing.txt')).toBe(false);
  });

  it('refuses writes that escape the workspace', async () => {
    const ws = await createWorkspace({ workspaceRoot: ROOT, projectRoot: PROJECT });
    await expect(ws.writeFile('../escape.txt', 'x')).rejects.toBeInstanceOf(
      ReadOnlyViolationError,
    );
    expect(() => ws.path('../../etc/passwd')).toThrow(ReadOnlyViolationError);
  });

  it('is stable for the same project root', async () => {
    const a = await createWorkspace({ workspaceRoot: ROOT, projectRoot: PROJECT });
    const b = await createWorkspace({ workspaceRoot: ROOT, projectRoot: PROJECT });
    expect(a.dir).toBe(b.dir);
  });

  it('cleans up only its own subtree', async () => {
    const ws = await createWorkspace({ workspaceRoot: ROOT, projectRoot: PROJECT });
    await ws.writeFile('a.txt', 'x');
    await ws.cleanup();
    expect(await ws.exists('a.txt')).toBe(false);
  });
});
