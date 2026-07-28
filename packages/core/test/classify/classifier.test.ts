import { describe, it, expect } from 'vitest';
import { classify } from '../../src/classify/classifier.js';
import type { ClassificationSignals, ComponentDescriptor } from '../../src/types/component.js';

function desc(name: string): ComponentDescriptor {
  return {
    id: name,
    name,
    filePath: `/${name}.tsx`,
    exportName: name,
    isDefaultExport: false,
    loc: { file: `/${name}.tsx`, line: 1, column: 1 },
  };
}

function signals(over: Partial<ClassificationSignals> = {}): ClassificationSignals {
  return {
    childComponentCount: 0,
    jsxDepth: 1,
    hookNames: [],
    usesRouter: false,
    usesStore: false,
    usesDataFetching: false,
    contextConsumers: [],
    isClientComponent: true,
    propCount: 0,
    ...over,
  };
}

describe('classify', () => {
  it('classifies a leaf presentational atom with zero context score', () => {
    const c = classify(desc('Button'), signals({ childComponentCount: 0, propCount: 3 }));
    expect(c.atomicLevel).toBe('atom');
    expect(c.kind).toBe('presentational');
    expect(c.contextDependencyScore).toBe(0);
    expect(c.confidence).toBeGreaterThan(0.6);
  });

  it('classifies a small composition as a presentational molecule', () => {
    const c = classify(desc('Card'), signals({ childComponentCount: 2 }));
    expect(c.atomicLevel).toBe('molecule');
    expect(c.kind).toBe('presentational');
  });

  it('classifies a data-driven component as an organism container', () => {
    const c = classify(
      desc('UserList'),
      signals({ childComponentCount: 5, usesDataFetching: true }),
    );
    expect(c.atomicLevel).toBe('organism');
    expect(c.kind).toBe('container');
    expect(c.contextDependencyScore).toBeGreaterThanOrEqual(3);
  });

  it('detects layout components by name', () => {
    expect(classify(desc('Stack'), signals({ childComponentCount: 1 })).kind).toBe('layout');
  });

  it('treats app-state context consumers as containers with a nonzero score', () => {
    const c = classify(desc('Panel'), signals({ contextConsumers: ['useAuth'] }));
    expect(c.kind).toBe('container');
    expect(c.contextDependencyScore).toBe(1.5);
  });

  // Re-weighted: `useTheme` used to score 1.5 and force kind=container here,
  // which on a real target demoted 98 files to `stubbed` on that signal alone.
  // A theme is a styling concern with a default (or a provider the preview
  // stubs), so it must not make a presentational atom look context-bound.
  it.each(['useTheme', 'useColorMode', 'useStyledTheme', 'ThemeContext'])(
    'does not treat the styling context %s as app context',
    (consumer) => {
      const c = classify(desc('Panel'), signals({ contextConsumers: [consumer] }));
      expect(c.kind).toBe('presentational');
      expect(c.contextDependencyScore).toBe(0);
    },
  );

  it('still scores the app context when a component reads both', () => {
    const c = classify(desc('Panel'), signals({ contextConsumers: ['useTheme', 'useAuth'] }));
    expect(c.kind).toBe('container');
    expect(c.contextDependencyScore).toBe(1.5);
  });

  it('keeps store usage a container signal regardless of the theme', () => {
    const c = classify(
      desc('Panel'),
      signals({ usesStore: true, contextConsumers: ['useTheme'] }),
    );
    expect(c.kind).toBe('container');
    expect(c.contextDependencyScore).toBe(3);
  });

  it('detects pages by name when they compose children', () => {
    expect(classify(desc('SettingsPage'), signals({ childComponentCount: 4 })).atomicLevel).toBe(
      'page',
    );
  });
});
