import { describe, it, expect } from 'vitest';
import { scaffoldSandbox, type ScaffoldInput } from '../../src/sandbox/sandbox-scaffolder.js';
import type { PortableBundle } from '../../src/types/portable-bundle.js';

function bundle(over: Partial<PortableBundle> = {}): PortableBundle {
  return {
    files: { '/src/X.tsx': 'export const X = () => null;' },
    entryPath: '/src/X.tsx',
    externalDeps: {},
    assets: [],
    warnings: [],
    ...over,
  };
}

function input(over: Partial<ScaffoldInput> = {}): ScaffoldInput {
  return {
    classification: {
      atomicLevel: 'atom',
      kind: 'presentational',
      contextDependencyScore: 0,
      confidence: 0.8,
    },
    bundle: bundle(),
    entry: '// entry',
    template: 'react-ts',
    propModel: { props: [] },
    sampleProps: {},
    ...over,
  };
}

describe('scaffoldSandbox renderability', () => {
  it('is full for a zero-context atom with resolvable deps and all props filled', () => {
    expect(scaffoldSandbox(input()).renderability).toBe('full');
  });

  it('is code-only when a dependency uses a non-installable version protocol', () => {
    const spec = scaffoldSandbox(
      input({ bundle: bundle({ externalDeps: { '@app/ui': 'workspace:*' } }) }),
    );
    expect(spec.renderability).toBe('code-only');
    expect(spec.notes.join(' ')).toMatch(/non-installable|workspace/i);
  });

  it('is code-only when the bundle is incomplete (dangling imports)', () => {
    expect(scaffoldSandbox(input({ bundle: bundle({ incomplete: true }) })).renderability).toBe(
      'code-only',
    );
  });

  it('is code-only when a dependency cannot run in the sandbox', () => {
    expect(
      scaffoldSandbox(input({ bundle: bundle({ externalDeps: { next: '^15.0.0' } }) }))
        .renderability,
    ).toBe('code-only');
  });

  it('is stubbed when a required prop could not be auto-filled', () => {
    const spec = scaffoldSandbox(
      input({
        propModel: {
          props: [{ name: 'data', tsType: 'Data', kind: 'unknown', required: true }],
        },
      }),
    );
    expect(spec.renderability).toBe('stubbed');
    expect(spec.notes.join(' ')).toMatch(/data/);
  });

  it('is stubbed when the component needs app context', () => {
    expect(
      scaffoldSandbox(
        input({
          classification: {
            atomicLevel: 'molecule',
            kind: 'container',
            contextDependencyScore: 3,
            confidence: 0.8,
          },
        }),
      ).renderability,
    ).toBe('stubbed');
  });

  it('always includes the reserved entry file', () => {
    const spec = scaffoldSandbox(input());
    expect(spec.files['/index.tsx']).toBeDefined();
    expect(spec.entryPath).toBe('/index.tsx');
  });
});
