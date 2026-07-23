import { describe, it, expect } from 'vitest';
import { scaffoldSandbox, type ScaffoldInput } from '../../src/sandbox/sandbox-scaffolder.js';
import type { ProviderStubResult } from '../../src/types/adapter.js';
import type { PortableBundle } from '../../src/types/portable-bundle.js';

function bundle(over: Partial<PortableBundle> = {}): PortableBundle {
  return {
    files: { '/src/X.tsx': 'export const X = () => null;' },
    entryPath: '/src/X.tsx',
    externalDeps: {},
    assets: [],
    warnings: [],
    stubbedModules: [],
    danglingImports: [],
    ...over,
  };
}

function input(over: Partial<ScaffoldInput> = {}): ScaffoldInput {
  return {
    classification: {
      atomicLevel: 'atom',
      kind: 'presentational',
      role: 'other',
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

const NO_PROVIDERS: ProviderStubResult = {
  providersFile: '',
  wrapperJsxOpen: '',
  wrapperJsxClose: '',
  imports: '',
  dependencies: {},
  unresolved: [],
};

const WRAPPED: ProviderStubResult = {
  ...NO_PROVIDERS,
  providersFile: 'function Providers() {}',
  wrapperJsxOpen: '<Providers>',
  wrapperJsxClose: '</Providers>',
};

const CONTEXTUAL = {
  atomicLevel: 'molecule',
  kind: 'container',
  role: 'other',
  contextDependencyScore: 3,
  confidence: 0.8,
} as const;

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
    expect(scaffoldSandbox(input({ classification: CONTEXTUAL })).renderability).toBe('stubbed');
  });

  it('always includes the reserved entry file', () => {
    const spec = scaffoldSandbox(input());
    expect(spec.files['/index.tsx']).toBeDefined();
    expect(spec.entryPath).toBe('/index.tsx');
  });
});

describe('scaffoldSandbox reason accumulation', () => {
  // Reporting only the first cause hides the rest from whoever has to fix it.
  it('reports every degrading cause, not just the first', () => {
    const spec = scaffoldSandbox(
      input({
        classification: CONTEXTUAL,
        bundle: bundle({
          incomplete: true,
          danglingImports: ['/src/X.tsx → ./missing'],
          externalDeps: { next: '^15.0.0', '@app/ui': 'workspace:*' },
        }),
        propModel: { props: [{ name: 'data', tsType: 'Data', kind: 'unknown', required: true }] },
      }),
    );
    const notes = spec.notes.join(' | ');

    expect(spec.renderability).toBe('code-only');
    expect(notes).toMatch(/incomplete/);
    expect(notes).toMatch(/can't run in the sandbox/);
    expect(notes).toMatch(/non-installable/);
    expect(notes).toMatch(/data/);
    expect(notes).toMatch(/Needs app context/);
  });

  it('names the number of unresolved imports in the incomplete note', () => {
    const spec = scaffoldSandbox(
      input({
        bundle: bundle({
          incomplete: true,
          danglingImports: ['/src/X.tsx → ./a', '/src/X.tsx → ./b'],
        }),
      }),
    );
    expect(spec.notes.join(' ')).toMatch(/2 local import\(s\) could not be resolved/);
  });
});

describe('scaffoldSandbox provider reporting', () => {
  // The old note said "Rendered without providers" for EVERY context-bound
  // component, including ones wrapped in the app's real ThemeProvider.
  it('never claims a context component was rendered without providers when it was not', () => {
    const spec = scaffoldSandbox(
      input({
        classification: CONTEXTUAL,
        providers: WRAPPED,
        bundle: bundle({ previewTheme: { path: '/src/theme.ts', exportName: 'theme' } }),
      }),
    );
    expect(spec.notes.join(' ')).not.toMatch(/without providers/);
  });

  it('is full when the app’s own theme/messages/providers actually supply the context', () => {
    const spec = scaffoldSandbox(
      input({
        classification: CONTEXTUAL,
        providers: WRAPPED,
        bundle: bundle({
          previewTheme: { path: '/src/theme.ts', exportName: 'theme' },
          previewMessages: '/src/messages.json',
          previewProviders: [{ path: '/src/Panel.tsx', exportName: 'PanelProvider' }],
        }),
      }),
    );
    expect(spec.renderability).toBe('full');
    const notes = spec.notes.join(' ');
    expect(notes).toMatch(/supplies it for real/);
    expect(notes).toMatch(/own theme/);
    expect(notes).toMatch(/i18n messages/);
    expect(notes).toMatch(/1 of the app's own context provider/);
  });

  it('stays stubbed when the stubber left context unresolved, and names it', () => {
    const spec = scaffoldSandbox(
      input({
        classification: CONTEXTUAL,
        providers: { ...WRAPPED, unresolved: ['AuthContext'] },
        bundle: bundle({ previewTheme: { path: '/src/theme.ts', exportName: 'theme' } }),
      }),
    );
    expect(spec.renderability).toBe('stubbed');
    expect(spec.notes.join(' ')).toMatch(/unresolved: AuthContext/);
  });

  it('says "rendered bare" only when the stubber reported no wrapper at all', () => {
    const spec = scaffoldSandbox(
      input({ classification: CONTEXTUAL, providers: NO_PROVIDERS }),
    );
    expect(spec.renderability).toBe('stubbed');
    expect(spec.notes.join(' ')).toMatch(/no provider could be generated — rendered bare/);
  });

  it('falls back to placeholder-context wording when no ProviderStubResult is passed', () => {
    const spec = scaffoldSandbox(input({ classification: CONTEXTUAL }));
    expect(spec.renderability).toBe('stubbed');
    const notes = spec.notes.join(' ');
    expect(notes).toMatch(/only placeholder context/);
    // Nothing is known about the wrapper, so nothing may be asserted about it.
    expect(notes).not.toMatch(/rendered bare/);
  });
});

describe('scaffoldSandbox stub disclosure', () => {
  it('surfaces every stubbed module and what it costs', () => {
    const spec = scaffoldSandbox(
      input({
        bundle: bundle({
          stubbedModules: [
            {
              specifier: 'next/link',
              replacedWith: '/src/__next-stubs__/next-link.tsx',
              lost: 'Client-side navigation: renders a plain <a>.',
            },
          ],
        }),
      }),
    );
    const notes = spec.notes.join(' ');
    expect(notes).toMatch(/next\/link → local stub/);
    expect(notes).toMatch(/Client-side navigation/);
    // Disclosure is not a defect: the component renders BECAUSE of the swap.
    expect(spec.renderability).toBe('full');
  });
});
