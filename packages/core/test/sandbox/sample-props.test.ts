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

  it('does not fill OPTIONAL complex props (keep the component near its real defaults)', () => {
    const out = gen([
      prop({ name: 'extra', kind: 'unknown', tsType: 'Foo[]', required: false }),
      prop({ name: 'meta', kind: 'unknown', tsType: 'Meta', required: false }),
    ]);
    expect(Object.keys(out)).toHaveLength(0);
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

  it('still fills a ReactNode content prop (accepts a string) with the text placeholder', () => {
    const out = gen([
      prop({ name: 'label', kind: 'node', tsType: 'ReactNode' }),
      prop({ name: 'children', kind: 'node', tsType: 'ReactNode' }),
    ]);
    expect(out).toEqual({ label: 'Widget', children: 'Widget' });
  });

  it('fills a node prop whose union accepts string, but not a pure-element union', () => {
    expect(gen([prop({ name: 'title', kind: 'node', tsType: 'string | ReactElement' })]).title).toBe(
      'Widget',
    );
    expect('end' in gen([prop({ name: 'end', kind: 'node', tsType: 'ReactElement | false' })])).toBe(
      false,
    );
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
