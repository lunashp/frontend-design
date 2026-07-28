import { describe, it, expect } from 'vitest';
import { sourceAppFiles, previewColourSource, copyableFiles } from '../src/lib/source-app.js';
import type { PortableBundle } from '../src/api/types.js';

function bundle(over: Partial<PortableBundle> = {}): PortableBundle {
  return {
    files: { '/Button.tsx': 'export const Button = () => null;', '/tokens.css': ':root{}' },
    entryPath: '/Button.tsx',
    externalDeps: {},
    assets: [],
    warnings: [],
    stubbedModules: [],
    danglingImports: [],
    ...over,
  };
}

describe('sourceAppFiles', () => {
  it('is empty when the bundle carries no source-app preview files', () => {
    expect(sourceAppFiles(bundle())).toEqual(new Set());
  });

  it('collects the theme, i18n catalogue, and every provider path', () => {
    const set = sourceAppFiles(
      bundle({
        previewTheme: { path: '/src/theme.ts', exportName: 'theme' },
        previewMessages: '/src/i18n/en.json',
        previewProviders: [
          { path: '/src/AppProviders.tsx', exportName: 'AppProviders' },
          { path: '/src/StoreProvider.tsx', exportName: 'StoreProvider' },
        ],
      }),
    );
    expect(set).toEqual(
      new Set(['/src/theme.ts', '/src/i18n/en.json', '/src/AppProviders.tsx', '/src/StoreProvider.tsx']),
    );
  });

  it('deduplicates a path that is both the theme and a provider', () => {
    const set = sourceAppFiles(
      bundle({
        previewTheme: { path: '/src/theme.ts', exportName: 'theme' },
        previewProviders: [{ path: '/src/theme.ts', exportName: 'ThemeProvider' }],
      }),
    );
    expect([...set]).toEqual(['/src/theme.ts']);
  });

  it('does NOT treat the component or its tokens.css as source-app files', () => {
    // The whole point of #1: the component's own files must stay copyable; only
    // the app's design system leaks in when previewTheme et al. are present.
    const set = sourceAppFiles(bundle({ previewTheme: { path: '/src/theme.ts', exportName: 't' } }));
    expect(set.has('/Button.tsx')).toBe(false);
    expect(set.has('/tokens.css')).toBe(false);
  });
});

describe('copyableFiles', () => {
  const files = {
    '/Button.tsx': 'component',
    '/tokens.css': ':root{}',
    '/src/theme.ts': 'app theme',
  };
  const sourceApp = new Set(['/src/theme.ts']);

  it('excludes source-app files by default so the component copies clean', () => {
    const out = copyableFiles(files, sourceApp, false);
    expect(out).toEqual({ '/Button.tsx': 'component', '/tokens.css': ':root{}' });
    expect('/src/theme.ts' in out).toBe(false);
  });

  it('includes source-app files when the engineer opts in', () => {
    expect(copyableFiles(files, sourceApp, true)).toEqual(files);
  });

  it('does not mutate the input map', () => {
    const snapshot = { ...files };
    copyableFiles(files, sourceApp, false);
    expect(files).toEqual(snapshot);
  });

  it('is a no-op filter when there are no source-app files', () => {
    expect(copyableFiles(files, new Set(), false)).toEqual(files);
  });
});

describe('previewColourSource', () => {
  it('reports a real theme when the bundle wraps the app theme', () => {
    const src = previewColourSource(bundle({ previewTheme: { path: '/theme.ts', exportName: 't' } }));
    expect(src.real).toBe(true);
    expect(src.caption.toLowerCase()).toContain('real theme');
  });

  it('reports a placeholder palette when no app theme is supplied', () => {
    const src = previewColourSource(bundle());
    expect(src.real).toBe(false);
    expect(src.caption.toLowerCase()).toContain('placeholder');
  });
});
