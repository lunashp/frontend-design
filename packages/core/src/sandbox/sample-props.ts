/**
 * Generates a plausible sample-props object to mount a component in the sandbox.
 * Rules favor a component that renders SOMETHING: children/nodes get readable
 * text, enums pick their first option, required props are always filled.
 */

import type { ComponentDescriptor } from '../types/component.js';
import type { PropControl, PropModel } from '../types/prop-model.js';

function humanize(name: string): string {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function parseBool(value: string | undefined): boolean {
  return value === 'true';
}

const ARRAY_TYPE = /(\[\]\s*$)|(^(readonly\s+)?Array<)|(^ReadonlyArray<)/;
const FUNCTION_TYPE = /=>|\bFunction\b/;

/**
 * A value for a required prop the control model classified as `unknown` (an
 * object, array, or function). The component will dereference it while
 * rendering, so leaving it `undefined` throws and the preview goes blank.
 *
 * Returns `undefined` for function types: JSON can't carry a function, and an
 * unset event handler is harmless at render (it fires on interaction, not mount).
 * Arrays get `[]` so `.map`/`.length` are safe; everything else gets `{}` so a
 * shallow read is merely `undefined`. Deeply-nested data (`d.user.name`) can
 * still throw — that shape can't be invented without the real data.
 */
function valueForRequiredUnknown(tsType: string): unknown {
  if (FUNCTION_TYPE.test(tsType)) return undefined;
  if (ARRAY_TYPE.test(tsType.trim())) return [];
  return {};
}

function valueForPropKind(prop: PropControl, descriptor: ComponentDescriptor): unknown {
  switch (prop.kind) {
    case 'node':
      return descriptor.name;
    case 'enum':
      return prop.options?.[0] ?? prop.defaultValue ?? '';
    case 'boolean':
      return parseBool(prop.defaultValue);
    case 'number':
      return prop.defaultValue != null ? Number(prop.defaultValue) : 1;
    case 'color':
      return prop.defaultValue ?? '#6366f1';
    case 'string':
      return prop.defaultValue ?? humanize(prop.name);
    default:
      return undefined;
  }
}

export function generateSampleProps(
  propModel: PropModel,
  descriptor: ComponentDescriptor,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const prop of propModel.props) {
    if (prop.kind === 'unknown') {
      // Fill only REQUIRED opaque props (objects/arrays); the component will
      // dereference them at render. Optionals keep their real defaults.
      if (prop.required) {
        const value = valueForRequiredUnknown(prop.tsType);
        if (value !== undefined) out[prop.name] = value;
      }
      continue;
    }

    const isChildren = prop.name === 'children' || prop.kind === 'node';
    // Fill children/nodes and enums always (shows variety); other optionals keep
    // their own defaults unless required.
    if (!isChildren && !prop.required && prop.kind !== 'enum' && prop.kind !== 'color') {
      continue;
    }

    const value = valueForPropKind(prop, descriptor);
    if (value !== undefined) out[prop.name] = value;
  }

  return out;
}
