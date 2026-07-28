/**
 * A wrapper around a library component (MUI's `<Chip>`, `<Avatar>`, …) inherits
 * that library's whole prop surface, so the model reports 63–82 props for a
 * component that declares two. These tests pin the OWN/INHERITED split.
 *
 * WHY it is computed from ts-morph and not from react-docgen: docgen's
 * `PropItem.parent` is EMPTY for every prop of a real MUI wrapper (measured:
 * 0/63 on CustomAvatar, 0/64 CustomChip, 0/82 CustomTextField, and
 * `declarations` is empty too). docgen's `getParentType` only accepts a prop
 * whose declaration's immediate parent is an interface/type-alias node, which
 * the mapped+intersection types MUI generates never are. The TS checker itself
 * still knows: `symbol.getDeclarations()` returns real declarations with real
 * file paths for 13023 of 13024 props across the whole target project.
 */

import { describe, it, expect } from 'vitest';
import {
  extractProps,
  originOfDeclarationFiles,
  inheritedPackageName,
} from '../../src/adapters/react/extract-props.js';
import type { ComponentDoc } from 'react-docgen-typescript';
import type { ComponentDescriptor } from '../../src/types/component.js';
import { inMemoryHandle } from './in-memory-handle.js';

const NM = '/proj/node_modules';

describe('originOfDeclarationFiles', () => {
  it('is unknown when the checker gave us no declaration at all', () => {
    // Honest fallback: never counted as "own" — a synthesized symbol is not
    // evidence the component declares the prop.
    expect(originOfDeclarationFiles([])).toBe('unknown');
  });

  it('is inherited when every declaration lives in an installed package', () => {
    expect(originOfDeclarationFiles([`${NM}/@mui/material/Chip/Chip.d.ts`])).toBe('inherited');
    expect(
      originOfDeclarationFiles([
        `${NM}/@mui/material/Chip/Chip.d.ts`,
        `${NM}/@mui/material/styles/index.d.ts`,
      ]),
    ).toBe('inherited');
  });

  it('is own when the declaration is source the author can edit', () => {
    expect(originOfDeclarationFiles(['/proj/src/mui/Chip.tsx'])).toBe('own');
    // Declared in a sibling module of the same project — still the project's API.
    expect(originOfDeclarationFiles(['/proj/src/types/theme.ts'])).toBe('own');
  });

  it('is own when a library prop is REDECLARED locally', () => {
    // CustomAvatar narrows MUI's `color` to its own ThemeColor union: the prop
    // resolves to declarations in BOTH @types/react and Avatar.tsx. The local
    // redeclaration is exactly the wrapper's own API surface, so it wins.
    expect(
      originOfDeclarationFiles([`${NM}/@types/react/index.d.ts`, '/proj/src/mui/Avatar.tsx']),
    ).toBe('own');
  });
});

describe('inheritedPackageName', () => {
  it('names the installed package a prop came from', () => {
    expect(inheritedPackageName([`${NM}/@mui/material/Chip/Chip.d.ts`])).toBe('@mui/material');
    expect(inheritedPackageName([`${NM}/react-select/dist/index.d.ts`])).toBe('react-select');
    expect(inheritedPackageName([`${NM}/@types/react/index.d.ts`])).toBe('@types/react');
  });

  it('reads through a pnpm store path to the real package name', () => {
    // pnpm installs to `.pnpm/<pkg>@<ver>/node_modules/<pkg>` — taking the FIRST
    // `node_modules/` segment would yield ".pnpm", naming every dependency alike.
    expect(
      inheritedPackageName([
        `${NM}/.pnpm/@mui+material@7.0.0_react@19/node_modules/@mui/material/Chip/Chip.d.ts`,
      ]),
    ).toBe('@mui/material');
  });

  it('has no package name for own or unknown props', () => {
    expect(inheritedPackageName(['/proj/src/mui/Chip.tsx'])).toBeUndefined();
    expect(inheritedPackageName([])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Integration: real ts-morph type resolution over a virtual filesystem, with a
// virtual node_modules package standing in for MUI.
// ---------------------------------------------------------------------------

const LIB = `${NM}/@fake/ui/index.d.ts`;
const WRAPPER = '/proj/src/Wrapper.tsx';

const FILES: Readonly<Record<string, string>> = {
  [LIB]: `
    export interface FakeChipProps {
      label?: string;
      colour?: 'a' | 'b';
      onDelete?: () => void;
      sx?: object;
    }
    export declare const FakeChip: (props: FakeChipProps) => JSX.Element;
  `,
  [WRAPPER]: `
    import { FakeChip } from '@fake/ui';
    import type { FakeChipProps } from '@fake/ui';

    export type WrapperProps = FakeChipProps & {
      round?: boolean;
      density?: 'tight' | 'loose';
    };

    export const Wrapper = (props: WrapperProps) => <FakeChip {...props} />;
  `,
};

function descriptor(name: string, filePath = WRAPPER): ComponentDescriptor {
  return {
    id: `id-${name}`,
    name,
    filePath,
    exportName: name,
    isDefaultExport: false,
    loc: { file: filePath, line: 1, column: 1 },
  };
}

/** docgen's view: it reports the union of own + inherited, with no `parent`. */
function docFor(names: readonly string[]): ComponentDoc {
  const props: Record<string, unknown> = {};
  for (const name of names) {
    props[name] = {
      name,
      required: false,
      type: { name: 'string' },
      description: '',
      defaultValue: null,
      // deliberately no `parent` — this is what a real MUI wrapper produces
    };
  }
  return { displayName: 'Wrapper', filePath: WRAPPER, description: '', props, methods: [] } as ComponentDoc;
}

const DOCGEN_NAMES = ['label', 'colour', 'onDelete', 'sx', 'round', 'density'];

describe('extractProps — own vs inherited', () => {
  it('marks props declared by the wrapper as own and the library surface as inherited', () => {
    const { handle } = inMemoryHandle(FILES, { docs: { [WRAPPER]: [docFor(DOCGEN_NAMES)] } });

    const model = extractProps(descriptor('Wrapper'), handle);
    const origin = Object.fromEntries(model.props.map((p) => [p.name, p.origin]));

    expect(origin).toEqual({
      round: 'own',
      density: 'own',
      label: 'inherited',
      colour: 'inherited',
      onDelete: 'inherited',
      sx: 'inherited',
    });
  });

  it('reports ownPropCount as the number the card should lead with', () => {
    const { handle } = inMemoryHandle(FILES, { docs: { [WRAPPER]: [docFor(DOCGEN_NAMES)] } });

    const model = extractProps(descriptor('Wrapper'), handle);

    expect(model.props).toHaveLength(6);
    expect(model.ownPropCount).toBe(2);
  });

  it('names the package an inherited prop came from', () => {
    const { handle } = inMemoryHandle(FILES, { docs: { [WRAPPER]: [docFor(DOCGEN_NAMES)] } });

    const model = extractProps(descriptor('Wrapper'), handle);
    const label = model.props.find((p) => p.name === 'label');

    expect(label?.originPackage).toBe('@fake/ui');
    expect(model.props.find((p) => p.name === 'round')?.originPackage).toBeUndefined();
  });

  it('labels a prop the checker cannot place as unknown rather than own', () => {
    // docgen reported a prop that is not on the resolved props type. Counting it
    // as own would inflate exactly the number this feature exists to make honest.
    const { handle } = inMemoryHandle(FILES, {
      docs: { [WRAPPER]: [docFor([...DOCGEN_NAMES, 'ghost'])] },
    });

    const model = extractProps(descriptor('Wrapper'), handle);

    expect(model.props.find((p) => p.name === 'ghost')?.origin).toBe('unknown');
    expect(model.ownPropCount).toBe(2);
  });

  it('reports ownPropCount as null when the props type could not be resolved at all', () => {
    // No exported declaration named `Missing` — so there is no props type to
    // classify against. `0` would be a claim; null says "not determined" and the
    // card falls back to the plain total.
    const { handle } = inMemoryHandle(FILES, {
      docs: { [WRAPPER]: [docFor(DOCGEN_NAMES)] },
    });

    const model = extractProps(descriptor('Missing'), handle);

    expect(model.ownPropCount).toBeNull();
    expect(model.props.every((p) => p.origin === 'unknown')).toBe(true);
  });

  it('reports ownPropCount 0 (not null) for a component that adds nothing to the library', () => {
    // CustomTextField in the real target: `forwardRef((props: TextFieldProps) …)`
    // — 82 props, none of them its own. "0 own" is a true and useful statement.
    const passthrough = '/proj/src/Passthrough.tsx';
    const files = {
      ...FILES,
      [passthrough]: `
        import { FakeChip } from '@fake/ui';
        import type { FakeChipProps } from '@fake/ui';
        export const Passthrough = (props: FakeChipProps) => <FakeChip {...props} />;
      `,
    };
    const doc = { ...docFor(['label', 'colour', 'sx']), displayName: 'Passthrough', filePath: passthrough };
    const { handle } = inMemoryHandle(files, { docs: { [passthrough]: [doc as ComponentDoc] } });

    const model = extractProps(descriptor('Passthrough', passthrough), handle);

    expect(model.ownPropCount).toBe(0);
    expect(model.props.every((p) => p.origin === 'inherited')).toBe(true);
  });

  it('resolves a component whose descriptor name is a RE-EXPORT alias', () => {
    // Discovery walks every file's exports and resolves re-exports back to the
    // original declaration, so a descriptor can carry `filePath` = origin file
    // but `exportName` = the name a barrel re-exported it under. The origin file
    // itself only exports `default`. Looking up `exportName` there finds nothing.
    // Measured on the real target: this is why NavCollapseIcons — a plain arrow
    // component with an ordinary props type — reported all 51 props unknown.
    const inner = '/proj/src/Inner.tsx';
    const files = {
      ...FILES,
      [inner]: `
        import { FakeChip } from '@fake/ui';
        import type { FakeChipProps } from '@fake/ui';
        type InnerProps = FakeChipProps & { pinned?: boolean };
        const Inner = (props: InnerProps) => <FakeChip {...props} />;
        export default Inner;
      `,
      '/proj/src/barrel.ts': `export { default as Inner } from './Inner';`,
    };
    const doc = { ...docFor(['label', 'sx', 'pinned']), displayName: 'Inner', filePath: inner };
    const { handle } = inMemoryHandle(files, { docs: { [inner]: [doc as ComponentDoc] } });

    // exportName is the barrel's alias, not an export of Inner.tsx.
    const model = extractProps(descriptor('Inner', inner), handle);

    expect(model.ownPropCount).toBe(1);
    expect(model.props.find((p) => p.name === 'pinned')?.origin).toBe('own');
    expect(model.props.find((p) => p.name === 'label')?.origin).toBe('inherited');
  });

  it('keeps a propless component at ownPropCount 0', () => {
    const bare = '/proj/src/Bare.tsx';
    const files = { ...FILES, [bare]: 'export const Bare = () => <i/>;' };
    const { handle } = inMemoryHandle(files, { docs: { [bare]: [] } });

    const model = extractProps(descriptor('Bare', bare), handle);

    expect(model.props).toEqual([]);
    expect(model.ownPropCount).toBe(0);
  });
});
