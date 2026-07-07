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

  it('skips function/unknown props even when required', () => {
    const out = gen([
      prop({ name: 'onClick', kind: 'unknown', required: true }),
      prop({ name: 'data', kind: 'unknown', required: true }),
    ]);
    expect(Object.keys(out)).toHaveLength(0);
  });
});
