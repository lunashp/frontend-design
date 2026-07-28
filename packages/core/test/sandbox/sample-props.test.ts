import { describe, it, expect } from 'vitest';
import { generateSampleProps } from '../../src/sandbox/sample-props.js';
import type { ComponentDescriptor } from '../../src/types/component.js';
import type { PropControl, PropModel } from '../../src/types/prop-model.js';

const DESC = {
  id: 'x',
  name: 'Widget',
  filePath: '/p/Widget.tsx',
  exportName: 'Widget',
  isDefaultExport: false,
  loc: { file: '/p/Widget.tsx', line: 1, column: 1 },
} satisfies ComponentDescriptor;

function prop(over: Partial<PropControl> & Pick<PropControl, 'name' | 'kind'>): PropControl {
  return { tsType: 'unknown', required: false, ...over };
}

function gen(props: PropControl[]): Record<string, unknown> {
  return generateSampleProps({ props } satisfies PropModel, DESC);
}

describe('generateSampleProps', () => {
  it('fills node/children props with the component name', () => {
    expect(gen([prop({ name: 'children', kind: 'node', required: true })])).toEqual({
      children: 'Widget',
    });
  });

  it('picks the first option for enums (even optional)', () => {
    expect(
      gen([prop({ name: 'size', kind: 'enum', options: ['sm', 'md', 'lg'] })]).size,
    ).toBe('sm');
  });

  it('parses boolean defaults, else false', () => {
    expect(gen([prop({ name: 'open', kind: 'boolean', required: true, defaultValue: 'true' })]).open).toBe(true);
    expect(gen([prop({ name: 'flag', kind: 'boolean', required: true })]).flag).toBe(false);
  });

  it('uses number defaults, else 1', () => {
    expect(gen([prop({ name: 'count', kind: 'number', required: true, defaultValue: '3' })]).count).toBe(3);
    expect(gen([prop({ name: 'n', kind: 'number', required: true })]).n).toBe(1);
  });

  it('fills color props with default or a fallback', () => {
    expect(gen([prop({ name: 'color', kind: 'color', defaultValue: '#abc' })]).color).toBe('#abc');
    expect(gen([prop({ name: 'bg', kind: 'color' })]).bg).toBe('#6366f1');
  });

  it('humanizes required string props and skips optional ones', () => {
    const out = gen([
      prop({ name: 'fullName', kind: 'string', required: true }),
      prop({ name: 'subtitle', kind: 'string' }),
    ]);
    expect(out.fullName).toBe('Full Name');
    expect('subtitle' in out).toBe(false);
  });

  it('skips function props (JSON cannot carry them; undefined is safe at render)', () => {
    const out = gen([
      prop({ name: 'onClick', kind: 'unknown', tsType: '() => void', required: true }),
      prop({ name: 'onSelect', kind: 'unknown', tsType: '(id: string) => void', required: true }),
    ]);
    expect(Object.keys(out)).toHaveLength(0);
  });

  it('fills a required array prop with [] so .map/.length do not throw', () => {
    const out = gen([
      prop({ name: 'items', kind: 'unknown', tsType: 'Item[]', required: true }),
      prop({ name: 'rows', kind: 'unknown', tsType: 'Array<Row>', required: true }),
      prop({ name: 'cols', kind: 'unknown', tsType: 'ReadonlyArray<Col>', required: true }),
    ]);
    expect(out.items).toEqual([]);
    expect(out.rows).toEqual([]);
    expect(out.cols).toEqual([]);
  });

  it('fills a required object/opaque prop with {} so shallow access is undefined, not a throw', () => {
    const out = gen([
      prop({ name: 'data', kind: 'unknown', tsType: 'DateGroup', required: true }),
      prop({ name: 'map', kind: 'unknown', tsType: 'Record<string, Foo[]>', required: true }),
    ]);
    expect(out.data).toEqual({});
    expect(out.map).toEqual({});
  });

  it('fills an OPTIONAL array with [] (safe) but leaves an optional object unset', () => {
    // An empty array can never fabricate misleading content and it stops the
    // common `undefined.map()` throw for a prop the component maps regardless of
    // the `?`. An optional object keeps its real default (a synthetic {} would
    // just move the throw one property deeper).
    const out = gen([
      prop({ name: 'extra', kind: 'unknown', tsType: 'Foo[]', required: false }),
      prop({ name: 'meta', kind: 'unknown', tsType: 'Meta', required: false }),
    ]);
    expect(out.extra).toEqual([]);
    expect('meta' in out).toBe(false);
  });

  it('fills a required OR optional Date-typed prop with a real Date', () => {
    // `{}` here throws on the first date method (`date.getDate is not a function`).
    const out = gen([
      prop({ name: 'day', kind: 'unknown', tsType: 'Date', required: true }),
      prop({ name: 'when', kind: 'unknown', tsType: 'Date | undefined', required: false }),
    ]);
    expect(out.day).toBeInstanceOf(Date);
    expect(out.when).toBeInstanceOf(Date);
    // A word-boundary match: `DateRange` / `MyDate` are NOT dates.
    const notDate = gen([prop({ name: 'range', kind: 'unknown', tsType: 'DateRange', required: true })]);
    expect(notDate.range).toEqual({});
  });

  it('leaves function-typed props to the entry builder (JSON can not carry a function)', () => {
    // The entry builder injects a __fnStub for these; generateSampleProps must
    // NOT put an undefined/`{}` in their place (that would shadow the stub).
    const out = gen([
      prop({ name: 'onChange', kind: 'unknown', tsType: '(v: string) => void', required: true }),
      prop({ name: 'renderRow', kind: 'unknown', tsType: '(row: Row) => ReactNode', required: false }),
    ]);
    expect('onChange' in out).toBe(false);
    expect('renderRow' in out).toBe(false);
  });

  it('does NOT read a Date/array mentioned in a function SIGNATURE as a data prop', () => {
    // `(d: Date) => boolean` must be a stubbed function, not a Date value — else
    // the component calls a Date and throws "isInRange is not a function".
    const out = gen([
      prop({ name: 'isInRange', kind: 'unknown', tsType: '(date: Date) => boolean', required: true }),
      prop({ name: 'toList', kind: 'unknown', tsType: '(x: string) => Item[]', required: true }),
    ]);
    expect('isInRange' in out).toBe(false); // → __fnStub in the entry
    expect('toList' in out).toBe(false);
  });

  it('skips a render-prop typed `node` (it is called, not rendered)', () => {
    // `renderTags: (t) => ReactNode` is classified `node` by its RETURN type but
    // is a function. Filling it with a string throws "renderTags is not a function".
    const out = gen([
      prop({ name: 'renderTags', kind: 'node', tsType: '(tags: Tag[]) => ReactNode', required: false }),
    ]);
    expect('renderTags' in out).toBe(false); // → __fnStub in the entry
  });

  it('fills a union array (`Foo[] | undefined`) with []', () => {
    const out = gen([prop({ name: 'items', kind: 'unknown', tsType: 'Foo[] | undefined', required: false })]);
    expect(out.items).toEqual([]);
  });

  // Regression: `string | React.ComponentType` (icon-style props) were filled
  // with {}, and a component that did React.createElement(prop) threw
  // "Element type is invalid: got object". A string picks the safe branch.
  it('uses a string for a required union that accepts string (not {})', () => {
    const out = gen([
      prop({
        name: 'iconSrc',
        kind: 'unknown',
        tsType: 'string | React.ComponentType<{ sx?: object }>',
        required: true,
      }),
    ]);
    expect(typeof out.iconSrc).toBe('string');
  });

  // Regression: MUI's `avatar`/`icon`/`deleteIcon` are `ReactElement`, classified
  // `node`. They were filled with the text placeholder, tripping PropTypes.element
  // ("Invalid prop `avatar` of type `string` ... expected a single ReactElement").
  it('omits an element-only node prop (ReactElement) — a string is not a valid element', () => {
    const out = gen([
      prop({ name: 'avatar', kind: 'node', tsType: 'ReactElement' }),
      prop({ name: 'icon', kind: 'node', tsType: 'ReactElement<unknown, string>' }),
      prop({ name: 'deleteIcon', kind: 'node', tsType: 'ReactElement' }),
    ]);
    expect(Object.keys(out)).toHaveLength(0);
  });

  // A content slot names ITSELF, not the component. Filling every node prop with
  // `descriptor.name` made a button render its own name once per slot.
  it('names a non-children content slot after the slot, not the component', () => {
    const out = gen([
      prop({ name: 'label', kind: 'node', tsType: 'ReactNode' }),
      prop({ name: 'helperText', kind: 'node', tsType: 'ReactNode' }),
      prop({ name: 'children', kind: 'node', tsType: 'ReactNode' }),
    ]);
    // Title-cased by the same `humanize` that already names string props.
    expect(out).toEqual({ label: 'Label', helperText: 'Helper Text', children: 'Widget' });
  });

  it('fills a node prop whose union accepts string, but not a pure-element union', () => {
    expect(gen([prop({ name: 'title', kind: 'node', tsType: 'string | ReactElement' })]).title).toBe(
      'Title',
    );
    expect('end' in gen([prop({ name: 'end', kind: 'node', tsType: 'ReactElement | false' })])).toBe(
      false,
    );
  });

  // Regression: `startIcon`/`endIcon`/`loadingIndicator` are `ReactNode`, so they
  // ACCEPT a string and were filled with one — a word of text crammed into a 20×20
  // icon box, overlapping the label. An adornment slot is a picture slot: leaving
  // it empty shows the component's real shape; text in it never can.
  it('leaves icon and adornment slots empty even when they accept a string', () => {
    const out = gen([
      prop({ name: 'startIcon', kind: 'node', tsType: 'ReactNode' }),
      prop({ name: 'endIcon', kind: 'node', tsType: 'ReactNode' }),
      prop({ name: 'loadingIndicator', kind: 'node', tsType: 'ReactNode' }),
      prop({ name: 'startAdornment', kind: 'node', tsType: 'ReactNode' }),
      prop({ name: 'clearIcon', kind: 'node', tsType: 'ReactNode' }),
      prop({ name: 'children', kind: 'node', tsType: 'ReactNode' }),
    ]);
    expect(out).toEqual({ children: 'Widget' });
  });

  it('never repeats the component name across several node slots', () => {
    const out = gen([
      prop({ name: 'children', kind: 'node', tsType: 'ReactNode' }),
      prop({ name: 'endIcon', kind: 'node', tsType: 'ReactNode' }),
      prop({ name: 'startIcon', kind: 'node', tsType: 'ReactNode' }),
      prop({ name: 'label', kind: 'node', tsType: 'ReactNode' }),
    ]);
    const named = Object.values(out).filter((v) => v === 'Widget');
    expect(named).toHaveLength(1);
  });

  // A modal/dialog/drawer gated on `open` renders NOTHING when it is false, so a
  // preview of one was an empty frame. The gate opens unless the author declared
  // a default of their own.
  it('opens a visibility-gate boolean that has no declared default', () => {
    for (const name of ['open', 'isOpen', 'opened', 'visible', 'isVisible', 'show', 'shown', 'expanded']) {
      expect(gen([prop({ name, kind: 'boolean', required: true })])[name]).toBe(true);
    }
  });

  it('respects an explicit default on a visibility-gate boolean', () => {
    expect(gen([prop({ name: 'open', kind: 'boolean', required: true, defaultValue: 'false' })]).open).toBe(false);
  });

  it('leaves a non-gate boolean false (a gate name is required, not any boolean)', () => {
    for (const name of ['disabled', 'loading', 'checked', 'fullWidth', 'showBorder']) {
      expect(gen([prop({ name, kind: 'boolean', required: true })])[name]).toBe(false);
    }
  });

  it('leaves a required component-type prop unset ({} would render as an invalid element)', () => {
    const out = gen([
      prop({ name: 'Icon', kind: 'unknown', tsType: 'React.ComponentType<{ sx?: object }>', required: true }),
      prop({ name: 'As', kind: 'unknown', tsType: 'ElementType', required: true }),
    ]);
    expect('Icon' in out).toBe(false);
    expect('As' in out).toBe(false);
  });

  it('still fills a real data object with {} (Record with a string key is not a string prop)', () => {
    const out = gen([
      prop({ name: 'map', kind: 'unknown', tsType: 'Record<string, Foo[]>', required: true }),
    ]);
    expect(out.map).toEqual({});
  });
});
