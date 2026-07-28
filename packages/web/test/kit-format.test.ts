import { describe, it, expect } from 'vitest';
import type { DepConflict } from '../src/api/types.js';
import {
  describeConflicts,
  formatInstallCommand,
  kitFilesDump,
} from '../src/features/kit/kit-format.js';

describe('formatInstallCommand', () => {
  it('is null when the kit is fully self-contained (no deps)', () => {
    expect(formatInstallCommand({})).toBeNull();
  });

  it('pins each package to its merged range, sorted for a deterministic command', () => {
    const command = formatInstallCommand({ react: '^19.0.0', clsx: '^2.0.0' });
    expect(command).toBe('npm install clsx@^2.0.0 react@^19.0.0');
  });

  it('omits the @range when a range is empty', () => {
    expect(formatInstallCommand({ 'some-pkg': '' })).toBe('npm install some-pkg');
  });
});

describe('describeConflicts', () => {
  const nameOf = (id: string): string =>
    ({ c1: 'Card', c2: 'Modal' })[id] ?? id;

  it('is empty when there are no conflicts', () => {
    expect(describeConflicts([], nameOf)).toEqual([]);
  });

  it('names each requiring component and its range for a conflicted package', () => {
    const conflicts: DepConflict[] = [
      {
        package: 'react',
        requirements: [
          { componentId: 'c1', range: '^18.2.0' },
          { componentId: 'c2', range: '^19.0.0' },
        ],
      },
    ];
    expect(describeConflicts(conflicts, nameOf)).toEqual([
      'react: Card wants ^18.2.0, Modal wants ^19.0.0',
    ]);
  });

  it('falls back to the raw id when the component name is unknown', () => {
    const conflicts: DepConflict[] = [
      { package: 'zod', requirements: [{ componentId: 'unknown-id', range: '^3' }] },
    ];
    expect(describeConflicts(conflicts, nameOf)).toEqual(['zod: unknown-id wants ^3']);
  });
});

describe('kitFilesDump', () => {
  it('joins every file under a path comment, in one copyable blob', () => {
    const dump = kitFilesDump({ '/a.tsx': 'A', '/b.tsx': 'B' });
    expect(dump).toBe('// /a.tsx\nA\n\n// /b.tsx\nB');
  });

  it('is empty for no files', () => {
    expect(kitFilesDump({})).toBe('');
  });
});
