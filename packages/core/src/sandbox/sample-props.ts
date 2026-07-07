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
    if (prop.kind === 'unknown') continue; // functions and opaque props

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
