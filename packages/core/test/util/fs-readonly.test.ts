import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createReadOnlyFs } from '../../src/util/fs-readonly.js';
import { ReadOnlyViolationError } from '../../src/util/errors.js';

const ROOT = path.join(os.tmpdir(), 'ce-ro-test');

beforeAll(async () => {
  await fs.mkdir(path.join(ROOT, 'src'), { recursive: true });
  await fs.writeFile(path.join(ROOT, 'src', 'Button.tsx'), 'export const Button = () => null;');
});

afterAll(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

describe('createReadOnlyFs', () => {
  it('reads files inside the root', async () => {
    const rofs = createReadOnlyFs(ROOT);
    const content = await rofs.readFile(path.join(ROOT, 'src', 'Button.tsx'));
    expect(content).toContain('Button');
    expect(rofs.readFileSync(path.join(ROOT, 'src', 'Button.tsx'))).toContain('Button');
  });

  it('lists directories and stats files inside the root', async () => {
    const rofs = createReadOnlyFs(ROOT);
    expect(await rofs.readdir(path.join(ROOT, 'src'))).toContain('Button.tsx');
    const stat = await rofs.stat(path.join(ROOT, 'src', 'Button.tsx'));
    expect(stat.isFile).toBe(true);
    expect(stat.isDirectory).toBe(false);
    expect(stat.size).toBeGreaterThan(0);
    expect(rofs.exists(path.join(ROOT, 'src'))).toBe(true);
  });

  it('exposes no write method', () => {
    const rofs = createReadOnlyFs(ROOT);
    expect((rofs as Record<string, unknown>).writeFile).toBeUndefined();
  });

  it('refuses reads outside the root', async () => {
    const rofs = createReadOnlyFs(ROOT);
    await expect(rofs.readFile('/etc/passwd')).rejects.toBeInstanceOf(
      ReadOnlyViolationError,
    );
    expect(() => rofs.readFileSync('/etc/hosts')).toThrow(ReadOnlyViolationError);
    expect(() => rofs.exists(path.join(ROOT, '..', 'other'))).toThrow(
      ReadOnlyViolationError,
    );
  });
});
