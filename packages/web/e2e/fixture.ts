/**
 * The one component the keyboard-trap harness inspects. It is plain data (no
 * DOM, no Node) so the browser harness and the Node-side mock API can share it:
 * whatever `/api/artifact` returns has to be the same object the gallery would
 * have handed the Inspector, or the Preview tab never reaches its iframe.
 */

import type { ComponentArtifact, ComponentSummary } from '../src/api/types.js';

/**
 * Named separately so the spec can assert the panel's OWN label
 * (`Inspector: Button`). The empty-state panel is labelled plain `Inspector`, so
 * a `[aria-label^="Inspector"]` selector matches whether or not the panel was
 * dismissed — an assertion that can never fail.
 */
export const FIXTURE_NAME = 'Button';

export const FIXTURE_COMPONENT: ComponentSummary = {
  descriptor: {
    id: 'src/components/Button.tsx::Button',
    name: FIXTURE_NAME,
    filePath: '/fixture/src/components/Button.tsx',
    exportName: 'Button',
    isDefaultExport: false,
    loc: { file: '/fixture/src/components/Button.tsx', line: 1, column: 0 },
  },
  classification: {
    atomicLevel: 'atom',
    kind: 'presentational',
    contextDependencyScore: 0,
    confidence: 1,
  },
  signals: {
    childComponentCount: 0,
    jsxDepth: 1,
    hookNames: [],
    usesRouter: false,
    usesStore: false,
    usesDataFetching: false,
    contextConsumers: [],
    isClientComponent: false,
    propCount: 0,
  },
  propModel: { props: [] },
};

export const FIXTURE_ARTIFACT: ComponentArtifact = {
  ...FIXTURE_COMPONENT,
  artifactVersion: 1,
  bundle: {
    files: { '/Button.tsx': 'export function Button() { return null; }' },
    entryPath: '/Button.tsx',
    externalDeps: {},
    assets: [],
    warnings: [],
    stubbedModules: [],
    danglingImports: [],
  },
  tokenModel: { tokens: [] },
  sandpack: {
    files: { '/Button.tsx': 'export function Button() { return null; }' },
    entryPath: '/Button.tsx',
    template: 'react-ts',
    dependencies: {},
    // 'full' is the only value that makes PreviewPane render <LocalPreview>, and
    // the iframe it mounts is the whole point of this harness.
    renderability: 'full',
    notes: [],
  },
};
