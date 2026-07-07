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

function entryFor(d: ComponentDescriptor): string {
  const input: BuildEntryInput = {
    descriptor: d,
    bundle: { files: {}, entryPath: '/src/Card.tsx', externalDeps: {}, assets: [], warnings: [] },
    sampleProps: { title: 'Hello' },
    providers: NO_PROVIDERS,
    tokenCssPath: '/tokens.css',
  };
  return buildReactEntry(input);
}

describe('buildReactEntry', () => {
  it('binds a named export by its EXPORT name, not the display name', () => {
    const entry = entryFor(descriptor({ name: 'Inner', exportName: 'Card' }));
    expect(entry).toContain("import { Card as __Component } from './src/Card';");
    expect(entry).not.toContain('{ Inner }');
    expect(entry).toContain('<__Component {...props} />');
  });

  it('imports a default export directly', () => {
    const entry = entryFor(descriptor({ name: 'Card', exportName: 'default', isDefaultExport: true }));
    expect(entry).toContain("import __Component from './src/Card';");
    expect(entry).toContain('<__Component {...props} />');
  });

  it('imports the token stylesheet and serializes sample props', () => {
    const entry = entryFor(descriptor({}));
    expect(entry).toContain("import '/tokens.css';");
    expect(entry).toContain('"title": "Hello"');
    expect(entry).toContain('createRoot');
  });
});
