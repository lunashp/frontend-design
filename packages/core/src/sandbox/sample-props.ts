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

// An array type, including union forms (`Foo[] | undefined`, `readonly Foo[] | null`).
// `\[\]` followed by end-or-union — NOT `[])` inside a callback param, and
// FUNCTION_TYPE is tested first anyway so a `(x) => Foo[]` never reaches this.
const ARRAY_TYPE = /(\[\]\s*(\||$))|(^(readonly\s+)?Array<)|(^ReadonlyArray<)/;
const FUNCTION_TYPE = /=>|\bFunction\b/;
// A `Date`-typed prop, as a whole word so `DateRange` / `MyDate` don't match.
// Given `{}` it throws on the first date method (`date.getDate is not a function`).
const DATE_TYPE = /\bDate\b/;
/**
 * A fixed sample Date, so a component that calls date methods renders instead of
 * throwing. Serialized to a real `new Date(...)` by the entry builder (JSON would
 * flatten it to a string). Fixed rather than `new Date()` so previews and their
 * cached thumbnails are deterministic.
 */
export const SAMPLE_DATE = new Date('2025-01-15T12:00:00.000Z');

/** Sentinel: this prop should be left unset (keep its real default). */
const SKIP = Symbol('skip');
// `string` as a whole union member (`string`, `string | X`, `X | string`) —
// NOT `string` buried inside `Record<string, …>` or `{ k: string }`.
const STRING_MEMBER = /(^|\|)\s*string\s*(\||$)/;
// A prop that accepts arbitrary content INCLUDING a string: `ReactNode` or
// `ReactChild`. A text placeholder is valid. (A pure `ReactElement` — MUI's
// `avatar`/`icon` — is deliberately NOT here: it rejects a string.)
const NODE_ACCEPTS_STRING = /ReactNode|ReactChild/;
// A React component/element type. JSON can't carry one, and rendering a {}
// stub as an element throws "Element type is invalid: got object".
const COMPONENT_TYPE = /\b(ComponentType|ElementType|FunctionComponent|ComponentClass|ReactElement|SvgIconComponent)\b|\bFC\b|\bJSX\.Element\b/;

/**
 * A value for a prop the control model classified as `unknown` (an object,
 * array, function, Date, or component), or `SKIP` to leave it unset. The
 * component dereferences or renders these while it mounts, so an undefined data
 * prop throws and the preview blanks.
 *
 * The SAFE-for-any-prop fills go first and apply whether the prop is required or
 * optional — a value that only ever prevents a crash and never fabricates
 * misleading content:
 * - arrays → `[]` so `.map`/`.length`/spread are safe (an empty list renders
 *   nothing). This covers OPTIONAL arrays too: a component that maps a prop it
 *   assumes is passed throws on `undefined.map()` even when the type says `?`.
 * - `Date` → a fixed sample date, so `date.getDate()` and friends work.
 * - functions → `SKIP` here: JSON can't carry a function, so the ENTRY builder
 *   injects a stub for them instead (build-entry.ts). Handled there, not here.
 *
 * The remaining fills are for REQUIRED props only — an optional object/string
 * keeps its real default rather than being masked by a synthetic `{}`:
 * - a union that accepts `string` → a string. Safe for text, an `<img src>`, an
 *   href, and it picks the string branch of an icon-style `string | ComponentType`
 *   (which as `{}` blows up on `React.createElement`).
 * - a component/element type → `SKIP` (no JSON form; a `{}` renders as an invalid
 *   element — unset at least fails a truthiness guard cleanly).
 * - everything else (real data objects) → `{}` so a shallow read is `undefined`.
 *   Deeply-nested access (`d.user.name`, `d.count.toLocaleString()`) can still
 *   throw — that shape can't be invented without the real data.
 */
/**
 * Resolves a nested sample value for an object prop by name, from its actual
 * TypeScript type (see synthesize-props.ts). Optional: absent (e.g. the MCP path,
 * which has no ts-morph project handy), a required object simply gets `{}`.
 */
export type ObjectSampleResolver = (propName: string) => unknown | undefined;

function valueForUnknown(prop: PropControl, resolveObject?: ObjectSampleResolver): unknown | typeof SKIP {
  const tsType = prop.tsType.trim();
  // FUNCTION FIRST: a function signature can mention `Date` or `[]` in its
  // params/return (`(d: Date) => boolean`, `(x) => Foo[]`), which would else be
  // read as a Date/array prop and fed a Date/[] the component then CALLS. Skipped
  // here so the entry builder stubs it as a real callable instead.
  if (FUNCTION_TYPE.test(tsType)) return SKIP;
  if (ARRAY_TYPE.test(tsType)) return [];
  if (DATE_TYPE.test(tsType)) return SAMPLE_DATE;
  if (!prop.required) return SKIP;
  if (STRING_MEMBER.test(tsType)) return humanize(prop.name);
  if (COMPONENT_TYPE.test(tsType)) return SKIP;
  // A required data object. `{}` stops a shallow read but a NESTED access
  // (`row.items.map()`, `d.count.toLocaleString()`) still throws — so synthesize
  // the object's real shape from its type when we can, and fall back to `{}`.
  const synthesized = resolveObject?.(prop.name);
  return synthesized !== undefined ? synthesized : {};
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
  resolveObject?: ObjectSampleResolver,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const prop of propModel.props) {
    if (prop.kind === 'unknown') {
      // Safe fills (arrays, Date) apply to optionals too — a component often
      // maps/dereferences a prop it assumes is passed regardless of the `?`.
      // Objects/strings stay required-only. Functions are stubbed by the entry
      // builder (JSON can't carry them), so they SKIP here.
      const value = valueForUnknown(prop, resolveObject);
      if (value !== SKIP) out[prop.name] = value;
      continue;
    }

    if (prop.kind === 'node') {
      // A RENDER PROP — a function that RETURNS a node (`renderTags: (t) => ReactNode`)
      // — is classified `node` by its return type but is called, not rendered.
      // Filling it with a string makes the component throw "x is not a function";
      // skip it here so the entry builder stubs it as a real callable.
      if (FUNCTION_TYPE.test(prop.tsType)) continue;
      // The text placeholder is valid only where a STRING is accepted: `children`,
      // a `ReactNode`/`ReactChild` content prop, or a union with a bare `string`
      // branch. An element-only prop (`avatar`/`icon`: `ReactElement`) rejects it —
      // a string trips MUI's PropTypes.element ("expected a single ReactElement") —
      // so omit it and let the component render without.
      const acceptsString =
        prop.name === 'children' ||
        NODE_ACCEPTS_STRING.test(prop.tsType) ||
        STRING_MEMBER.test(prop.tsType);
      if (acceptsString) out[prop.name] = descriptor.name;
      continue;
    }

    // Fill enums and colors always (shows variety); other optionals keep their
    // own defaults unless required.
    if (!prop.required && prop.kind !== 'enum' && prop.kind !== 'color') {
      continue;
    }

    const value = valueForPropKind(prop, descriptor);
    if (value !== undefined) out[prop.name] = value;
  }

  return out;
}
