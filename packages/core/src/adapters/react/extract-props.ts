/**
 * Extracts a component's PropModel via react-docgen-typescript, then maps each
 * prop to a display-friendly control kind for the customization panel.
 */

import type { ComponentDoc, PropItem } from 'react-docgen-typescript';
import type { ComponentDescriptor } from '../../types/component.js';
import type { ControlKind, PropControl, PropModel } from '../../types/prop-model.js';
import type { ReactProgramHandle } from './ts-program.js';

const EMPTY: PropModel = { props: [] };

function stripQuotes(raw: string): string {
  return raw.replace(/^['"]|['"]$/g, '');
}

function enumOptions(prop: PropItem): string[] | undefined {
  const value = prop.type.value;
  if (!Array.isArray(value)) return undefined;
  const opts = value
    .map((v) => (typeof v.value === 'string' ? stripQuotes(v.value) : String(v.value)))
    .filter((v) => v !== 'undefined' && v !== 'null');
  return opts.length > 0 ? opts : undefined;
}

function mapKind(prop: PropItem, options: string[] | undefined): ControlKind {
  const typeName = prop.type.name;
  const raw = prop.type.raw ?? typeName;

  if (options) return 'enum';
  if (typeName === 'boolean') return 'boolean';
  if (typeName === 'number') return 'number';
  if (/ReactNode|ReactElement|JSX\.Element|ReactChild/.test(raw)) return 'node';
  if (/=>/.test(raw) || /^\s*\(/.test(raw)) return 'unknown'; // function props
  if (typeName === 'string') {
    return /colou?r|background|\bbg\b|fill|stroke/i.test(prop.name) ? 'color' : 'string';
  }
  return 'unknown';
}

function toControl(prop: PropItem): PropControl {
  const options = enumOptions(prop);
  const kind = mapKind(prop, options);
  const rawType = prop.type.raw ?? prop.type.name;
  const tsType =
    rawType === 'enum' && options ? options.map((o) => `'${o}'`).join(' | ') : rawType;

  return {
    name: prop.name,
    tsType,
    kind,
    ...(options ? { options } : {}),
    ...(prop.defaultValue?.value != null
      ? { defaultValue: String(prop.defaultValue.value) }
      : {}),
    required: prop.required,
    ...(prop.description ? { description: prop.description } : {}),
  };
}

export function extractProps(
  descriptor: ComponentDescriptor,
  handle: ReactProgramHandle,
): PropModel {
  let docs: ComponentDoc[];
  try {
    docs = handle.docgen().parse(descriptor.filePath);
  } catch {
    return EMPTY;
  }
  if (docs.length === 0) return EMPTY;

  const doc =
    docs.find((d) => d.displayName === descriptor.name) ??
    (docs.length === 1 ? docs[0] : undefined);
  if (!doc) return EMPTY;

  const props = Object.values(doc.props)
    .map(toControl)
    .sort((a, b) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name));

  return { props };
}
