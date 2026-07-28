import { describe, it, expect } from 'vitest';
import type { ComponentDoc } from 'react-docgen-typescript';
import { extractProps, PropExtractionError } from '../../src/adapters/react/extract-props.js';
import type { ComponentDescriptor } from '../../src/types/component.js';
import { inMemoryHandle } from './in-memory-handle.js';

const FILE = '/proj/src/Two.tsx';

function descriptor(name: string): ComponentDescriptor {
  return {
    id: `id-${name}`,
    name,
    filePath: FILE,
    exportName: name,
    isDefaultExport: false,
    loc: { file: FILE, line: 1, column: 1 },
  };
}

function doc(displayName: string, props: Record<string, unknown> = {}): ComponentDoc {
  return { displayName, filePath: FILE, description: '', props, methods: [] } as ComponentDoc;
}

const SOURCE = { [FILE]: 'export const A = () => <i/>;\nexport const B = () => <b/>;\n' };

describe('extractProps — program reuse', () => {
  it('parses with the session program instead of building a fresh one per component', () => {
    const { handle, calls } = inMemoryHandle(SOURCE, { docs: { [FILE]: [doc('A')] } });

    extractProps(descriptor('A'), handle);

    // `parse()` calls ts.createProgram every time — ~99% of a scan's wall clock.
    expect(calls.parse).toEqual([]);
    expect(calls.withProvider).toEqual([FILE]);
    // The provider was actually invoked, i.e. our program is the one used.
    expect(calls.programs).toBe(1);
  });

  it('reuses the same program across every component in a scan', () => {
    const { handle, calls } = inMemoryHandle(SOURCE, {
      docs: { [FILE]: [doc('A'), doc('B')] },
    });

    extractProps(descriptor('A'), handle);
    extractProps(descriptor('B'), handle);

    expect(calls.parse).toEqual([]);
    expect(calls.withProvider).toHaveLength(2);
  });
});

describe('extractProps — failed extraction is reported, not silently empty', () => {
  it('throws when several components are documented and none matches the descriptor', () => {
    const { handle } = inMemoryHandle(SOURCE, { docs: { [FILE]: [doc('A'), doc('B')] } });

    // Previously returned `{ props: [] }`, which the Details tab renders as a
    // confident "no props" for a component that may well have several.
    expect(() => extractProps(descriptor('C'), handle)).toThrow(PropExtractionError);
    expect(() => extractProps(descriptor('C'), handle)).toThrow(/none is named "C"/);
  });

  it('throws when the parser itself fails', () => {
    const { handle } = inMemoryHandle(SOURCE);
    handle.docgen().parseWithProgramProvider = () => {
      throw new Error('checker exploded');
    };

    expect(() => extractProps(descriptor('A'), handle)).toThrow(/checker exploded/);
  });

  it('still reports genuinely propless components as an empty model, not a failure', () => {
    // No docs at all is normal for shapes docgen does not model (styled
    // factories, some HOC-wrapped exports) — it must stay distinguishable
    // from an extraction that failed.
    const { handle } = inMemoryHandle(SOURCE, { docs: { [FILE]: [] } });
    expect(extractProps(descriptor('A'), handle).props).toEqual([]);
  });

  it('falls back to the only documented component when the name differs', () => {
    const { handle } = inMemoryHandle(SOURCE, { docs: { [FILE]: [doc('Renamed')] } });
    expect(extractProps(descriptor('A'), handle).props).toEqual([]);
  });
});
