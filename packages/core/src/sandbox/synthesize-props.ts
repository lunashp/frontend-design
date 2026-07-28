/**
 * Type-driven synthesis of a required OBJECT prop's shape, so a component that
 * reads NESTED data off it renders instead of throwing.
 *
 * `generateSampleProps` fills a required object prop with `{}`. That stops a
 * shallow read but a table row doing `row.items.map()` or `row.count.toLocaleString()`
 * still throws — `{}` just moves the throw one property deeper. This resolves the
 * prop's actual TypeScript type and recursively builds a value that matches its
 * shape with SAFE defaults: arrays → `[]`, numbers → `0`, strings → `''`, booleans
 * → `false`, `Date` → a real Date, nested objects → recurse. Nothing is invented
 * beyond "an empty value of the right shape", so it never fabricates misleading
 * content — it only prevents the crash.
 *
 * Guardrails: a depth cap and a per-object property cap bound the work, and a
 * cycle guard (by type text) stops a self-referential type (`type Node = { next: Node }`)
 * from recursing forever. Anything it can't resolve safely falls back to `{}`.
 *
 * Runs at buildArtifact time (lazy, one component), where the ts-morph project is
 * already in hand — so the scan payload is never bloated with synthesized data.
 */

import { Node, type Project, type Symbol as TsSymbol, type Type } from 'ts-morph';

/** Reuse the sandbox's fixed sample Date so previews stay deterministic. */
import { SAMPLE_DATE } from './sample-props.js';

const MAX_DEPTH = 4;
const MAX_PROPS_PER_OBJECT = 40;

/** A value could not be synthesized safely — the caller falls back to `{}`. */
const UNRESOLVED = Symbol('unresolved');

/** Find the exported declaration for a discovered component (name or alias). */
function declarationNamed(
  exported: ReadonlyMap<string, readonly Node[]>,
  name: string,
): Node | undefined {
  for (const declarations of exported.values()) {
    for (const declaration of declarations) {
      if (
        (Node.isVariableDeclaration(declaration) ||
          Node.isFunctionDeclaration(declaration) ||
          Node.isClassDeclaration(declaration)) &&
        declaration.getName() === name
      ) {
        return declaration;
      }
    }
  }
  return undefined;
}

/** How many rows a top-level list prop gets. Two is enough to show a component's
 *  rhythm — the rule between rows, the alternating fill, the alignment — and few
 *  enough that nobody mistakes it for data. */
const SAMPLE_ROWS = 2;
/**
 * Members that must DIFFER between sample rows. A list keyed on `row.id` renders
 * two children with the same key otherwise, which React warns about and which can
 * make the second row vanish — turning a fix for empty tables into a new defect.
 */
const ROW_IDENTITY = /^(id|_id|key|uuid|slug|value|name)$/i;
/** A React value — an element, a node, or a component type. Not synthesizable. */
const REACT_VALUE_TYPE =
  /\b(ReactElement|ReactNode|ReactChild|ComponentType|ElementType|FunctionComponent|ComponentClass|JSX\.Element)\b/;

/** Repeat one synthesized element into rows, varying whatever identifies a row. */
function rowsFrom(element: unknown, count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => {
    if (element === null || typeof element !== 'object' || Array.isArray(element)) return element;
    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(element as Record<string, unknown>)) {
      row[k] = ROW_IDENTITY.test(k) && typeof v === 'string' ? `${k}-${i + 1}` : v;
    }
    return row;
  });
}

/**
 * Recursively synthesize a safe value matching `type`'s shape.
 *
 * `top` marks the prop's own type. A top-level list gets sample ROWS; a list
 * NESTED inside one of those rows stays `[]` — bounding both the payload and the
 * chance of inventing a structure the component did not ask for.
 */
function synthesize(
  type: Type,
  at: Node,
  depth: number,
  seen: Set<string>,
  top = false,
): unknown | typeof UNRESOLVED {
  const t = type.getNonNullableType();

  if (t.isBoolean() || t.isBooleanLiteral()) return false;
  if (t.isNumber() || t.isNumberLiteral()) return 0;
  if (t.isString()) return '';
  if (t.isStringLiteral()) return t.getLiteralValue?.() ?? '';
  if (t.isArray()) {
    // An empty array is safe for `.map`/`.length`/spread — and shows nothing.
    if (!top || depth <= 0) return [];
    const element = t.getArrayElementType();
    if (!element) return [];
    const sample = synthesize(element, at, depth - 1, seen);
    return sample === UNRESOLVED ? [] : rowsFrom(sample, SAMPLE_ROWS);
  }
  if (t.getSymbol()?.getName() === 'Date') return SAMPLE_DATE;
  // A function member can't be represented in the serialized props object; leave
  // it out (an unset nested callback is only a problem if invoked, which is rare).
  if (t.getCallSignatures().length > 0) return UNRESOLVED;

  // A TUPLE is iterable and an object at the same time; `{}` satisfies neither
  // `const [a, b] = pair` nor a spread, and a chart destructuring a `[x, y]` row
  // threw "object is not iterable".
  if (t.isTuple()) {
    const members = t.getTupleElements().map((m) => synthesize(m, at, depth - 1, seen));
    return members.some((m) => m === UNRESOLVED) ? [] : members;
  }
  // A React element or component member cannot be synthesized: `{}` rendered as
  // an element throws "Element type is invalid". Omit it — the row still carries
  // its data members, and an absent slot renders nothing.
  //
  // Matched on the type's own NAME, never its text: an object literal that merely
  // HAS a `icon?: ReactNode` member contains those words too, and testing the text
  // discarded the whole data object — the same mistake the control classifier
  // used to make one layer up.
  const typeName = t.getAliasSymbol()?.getName() ?? t.getSymbol()?.getName() ?? '';
  if (REACT_VALUE_TYPE.test(typeName)) return UNRESOLVED;

  if (t.isUnion()) {
    for (const member of t.getUnionTypes()) {
      const v = synthesize(member, at, depth, seen);
      if (v !== UNRESOLVED) return v;
    }
    return UNRESOLVED;
  }

  if (t.isObject() && depth > 0) {
    const key = t.getText();
    if (seen.has(key)) return {}; // cycle — stop, shallow object is enough
    seen.add(key);
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const propSym of t.getProperties() as TsSymbol[]) {
      if (count >= MAX_PROPS_PER_OBJECT) break;
      let propType: Type;
      try {
        propType = propSym.getTypeAtLocation(at);
      } catch {
        continue;
      }
      const v = synthesize(propType, at, depth - 1, seen);
      if (v !== UNRESOLVED) {
        out[propSym.getName()] = v;
        count += 1;
      }
    }
    seen.delete(key);
    return out;
  }

  return UNRESOLVED;
}

/**
 * Build a resolver that synthesizes a nested sample value for a prop by NAME, or
 * returns undefined when it can't (unresolvable component, or a shape it won't
 * synthesize). A no-op resolver (always undefined) is returned when the props
 * type can't be reached at all, so the caller degrades to `{}` exactly as before.
 */
export function buildObjectSampleResolver(
  tsProject: Project,
  filePath: string,
  exportName: string,
  displayName: string,
): (propName: string) => unknown | undefined {
  const NONE = () => undefined;

  const sourceFile = tsProject.getSourceFile(filePath);
  if (!sourceFile) return NONE;

  let exported: ReadonlyMap<string, readonly Node[]>;
  try {
    exported = sourceFile.getExportedDeclarations();
  } catch {
    return NONE;
  }

  const declaration = exported.get(exportName)?.[0] ?? declarationNamed(exported, displayName);
  if (!declaration) return NONE;

  let typesByName: Map<string, Type>;
  try {
    const signature = declaration.getType().getCallSignatures()[0];
    if (!signature) return NONE;
    const propsParam = signature.getParameters()[0];
    if (!propsParam) return NONE;
    typesByName = new Map();
    for (const symbol of propsParam.getTypeAtLocation(declaration).getProperties()) {
      typesByName.set(symbol.getName(), symbol.getTypeAtLocation(declaration));
    }
  } catch {
    return NONE;
  }

  return (propName: string): unknown | undefined => {
    const type = typesByName.get(propName);
    if (!type) return undefined;
    try {
      const value = synthesize(type, declaration, MAX_DEPTH, new Set(), true);
      return value === UNRESOLVED ? undefined : value;
    } catch {
      return undefined;
    }
  };
}
