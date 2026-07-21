import { describe, it, expect } from 'vitest';
import { buildReactEntry } from '../../src/adapters/react/build-entry.js';
import type { BuildEntryInput } from '../../src/types/adapter.js';
import type { ComponentDescriptor } from '../../src/types/component.js';

const NO_PROVIDERS = {
  providersFile: '',
  wrapperJsxOpen: '',
  wrapperJsxClose: '',
  imports: '',
  dependencies: {},
  unresolved: [],
};

function descriptor(over: Partial<ComponentDescriptor>): ComponentDescriptor {
  return {
    id: 'x',
    name: 'Inner',
    filePath: '/p/Card.tsx',
    exportName: 'Card',
    isDefaultExport: false,
    loc: { file: '/p/Card.tsx', line: 1, column: 1 },
    ...over,
  };
}

function entryFor(d: ComponentDescriptor, propModel: BuildEntryInput['propModel'] = { props: [] }): string {
  const input: BuildEntryInput = {
    descriptor: d,
    bundle: { files: {}, entryPath: '/src/Card.tsx', externalDeps: {}, assets: [], warnings: [] },
    sampleProps: { title: 'Hello' },
    providers: NO_PROVIDERS,
    tokenCssPath: '/tokens.css',
    propModel,
  };
  return buildReactEntry(input);
}

describe('buildReactEntry', () => {
  it('resolves a named export by its EXPORT name (not the display name)', () => {
    const entry = entryFor(descriptor({ name: 'Inner', exportName: 'Card' }));
    expect(entry).toContain("import * as __ns from './src/Card';");
    expect(entry).toContain('"Card"');
    expect(entry).not.toContain('{ Inner }');
    expect(entry).toContain('<__Component {...props} />');
  });

  it('falls back to the default export when the named binding is absent', () => {
    // `export default <named const>` is reported under the name, not `default`.
    const entry = entryFor(descriptor({ name: 'Card', exportName: 'Card', isDefaultExport: false }));
    expect(entry).toMatch(/__ns as any\)\.default/);
    expect(entry).toContain('<__Component {...props} />');
  });

  it('imports the token stylesheet and serializes sample props', () => {
    const entry = entryFor(descriptor({}));
    expect(entry).toContain("import '/tokens.css';");
    expect(entry).toContain('"title": "Hello"');
    expect(entry).toContain('createRoot');
  });

  it('stubs a required function prop the component calls while rendering', () => {
    // e.g. `t: (key) => string` that NavMenuItem calls as t(labelKey) at render.
    const entry = entryFor(descriptor({}), {
      props: [{ name: 't', tsType: '(key: string) => string', kind: 'unknown', required: true }],
    });
    expect(entry).toMatch(/__fnStub/);
    expect(entry).toMatch(/"t": __fnStub/);
  });

  it('wraps the mount in an error boundary so a render throw shows a fallback, not a blank', () => {
    const entry = entryFor(descriptor({}));
    // A component that dereferences data it was not given throws at render;
    // without a boundary React unmounts the whole tree and the preview is blank.
    expect(entry).toMatch(/componentDidCatch|getDerivedStateFromError/);
    expect(entry).toMatch(/<__ErrorBoundary>/);
    expect(entry).toMatch(/<\/__ErrorBoundary>/);
  });
});
