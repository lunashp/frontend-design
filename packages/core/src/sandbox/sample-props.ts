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
// `string` as a whole union member (`string`, `string | X`, `X | string`) —
// NOT `string` buried inside `Record<string, …>` or `{ k: string }`.
const STRING_MEMBER = /(^|\|)\s*string\s*(\||$)/;
// A React component/element type. JSON can't carry one, and rendering a {}
// stub as an element throws "Element type is invalid: got object".
const COMPONENT_TYPE = /\b(ComponentType|ElementType|FunctionComponent|ComponentClass|ReactElement|SvgIconComponent)\b|\bFC\b|\bJSX\.Element\b/;

/**
 * A value for a required prop the control model classified as `unknown` (an
 * object, array, function, or component). The component will dereference or
 * render it, so leaving a data prop `undefined` throws and the preview blanks.
 *
 * Order matters:
 * - functions → `undefined` (JSON can't carry one; an unset handler is harmless
 *   at render — it only fires on interaction).
 * - arrays → `[]` so `.map`/`.length` are safe.
 * - a union that accepts `string` → a string. Safe for anything the component
 *   renders (text, an `<img src>`, an href) and, crucially, picks the string
 *   branch of icon-style props typed `string | ComponentType` — which as `{}`
 *   blow up on `React.createElement(prop)`.
 * - a component/element type → `undefined`. It can't be represented in JSON, and
 *   a `{}` stub renders as an invalid element; unset at least fails a truthiness
 *   guard cleanly instead of throwing an object-as-element error.
 * - everything else (real data objects) → `{}` so a shallow read is `undefined`.
 *   Deeply-nested access (`d.user.name`) can still throw — that shape can't be
 *   invented without the real data.
 */
function valueForRequiredUnknown(prop: PropControl): unknown {
  const tsType = prop.tsType;
  if (FUNCTION_TYPE.test(tsType)) return undefined;
  if (ARRAY_TYPE.test(tsType.trim())) return [];
  if (STRING_MEMBER.test(tsType)) return humanize(prop.name);
  if (COMPONENT_TYPE.test(tsType)) return undefined;
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
        const value = valueForRequiredUnknown(prop);
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
