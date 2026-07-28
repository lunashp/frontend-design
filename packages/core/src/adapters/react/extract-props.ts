/**
 * Extracts a component's PropModel via react-docgen-typescript, then maps each
 * prop to a display-friendly control kind for the customization panel.
 */

import { Node } from 'ts-morph';
import type { ComponentDoc, PropItem } from 'react-docgen-typescript';
import type { ComponentDescriptor } from '../../types/component.js';
import type {
  ControlKind,
  PropControl,
  PropModel,
  PropOrigin,
} from '../../types/prop-model.js';
import { isDomNoiseProp } from './dom-props.js';
import type { ReactProgramHandle } from './ts-program.js';

const EMPTY: PropModel = { props: [], ownPropCount: 0 };

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

/**
 * A COLLECTION or an OBJECT LITERAL at the top level — `Array<{…}>`, `Foo[]`,
 * `{ id: string; icon?: ReactNode }`.
 *
 * These carry data, even when one of their members happens to be a ReactNode.
 * The node test below matches the words "ReactNode" ANYWHERE in the type text, so
 * without this guard `Array<{ label: string; icon?: ReactNode }>` was classified
 * `node` and filled with a string — and the component's `options.map(…)` threw.
 */
function isCollectionOrObjectLiteral(raw: string): boolean {
  const t = raw.trim();
  return (
    t.startsWith('{') ||
    /^(readonly\s+)?(Array|ReadonlyArray)\s*</.test(t) ||
    /\[\]\s*(\||$)/.test(t)
  );
}

function mapKind(prop: PropItem, options: string[] | undefined): ControlKind {
  const typeName = prop.type.name;
  const raw = prop.type.raw ?? typeName;

  if (options) return 'enum';
  if (typeName === 'boolean') return 'boolean';
  if (typeName === 'number') return 'number';
  if (!isCollectionOrObjectLiteral(raw) && /ReactNode|ReactElement|JSX\.Element|ReactChild/.test(raw)) {
    return 'node';
  }
  if (/=>/.test(raw) || /^\s*\(/.test(raw)) return 'unknown'; // function props
  if (typeName === 'string') {
    return /colou?r|background|\bbg\b|fill|stroke/i.test(prop.name) ? 'color' : 'string';
  }
  return 'unknown';
}

function toControl(prop: PropItem, origin: PropOriginInfo): PropControl {
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
    origin: origin.origin,
    ...(origin.packageName ? { originPackage: origin.packageName } : {}),
  };
}

// ---------------------------------------------------------------------------
// Own vs inherited
//
// react-docgen's own `PropItem.parent` cannot answer this. Measured against the
// real target (admin-frontend, MUI 7): `parent` is undefined for 0/63 props of
// CustomAvatar, 0/64 of CustomChip and 0/82 of CustomTextField — `declarations`
// is empty too. docgen's `getParentType` only reports a parent when the prop's
// declaration sits directly inside an interface/type-alias node, and MUI's
// props arrive through mapped + intersection types (`OverrideProps`,
// `DistributiveOmit`) whose members never do. Hence also why ts-program.ts's
// `propFilter: prop => !prop.parent || !/node_modules/.test(prop.parent.fileName)`
// silently filters nothing.
//
// The TypeScript checker still knows: asking the props type's symbols for
// `getDeclarations()` yields real file paths for 13023 of 13024 props across
// the whole target. So the split is resolved from ts-morph and joined onto
// docgen's prop list BY NAME (measured: 0 of 556 docgen props on a 44-component
// sample failed to join).
// ---------------------------------------------------------------------------

interface PropOriginInfo {
  readonly origin: PropOrigin;
  readonly packageName?: string;
}

const UNKNOWN_ORIGIN: PropOriginInfo = { origin: 'unknown' };

const NODE_MODULES = '/node_modules/';

function isInstalledPackage(file: string): boolean {
  return file.includes(NODE_MODULES);
}

/**
 * `own` = declared in source the author can edit; `inherited` = declared only
 * inside an installed package. node_modules is the line because it is exactly
 * "code you installed" vs "code you wrote" — a project's own types often live
 * in a sibling module (`src/types/theme.ts`), which is still its own API, so a
 * same-file-only rule would misreport those as inherited.
 *
 * A prop with declarations on BOTH sides is `own`: that is a wrapper narrowing
 * a library prop (CustomAvatar restricts MUI's `color` to its ThemeColor
 * union), which is the wrapper's own API surface.
 */
export function originOfDeclarationFiles(files: readonly string[]): PropOrigin {
  if (files.length === 0) return 'unknown';
  return files.some((f) => !isInstalledPackage(f)) ? 'own' : 'inherited';
}

/**
 * The installed package that declares an inherited prop, or undefined when the
 * prop is not inherited. Reads from the LAST `node_modules/` segment: pnpm
 * installs to `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/…`, so the
 * first segment would name every single dependency ".pnpm".
 */
export function inheritedPackageName(files: readonly string[]): string | undefined {
  if (originOfDeclarationFiles(files) !== 'inherited') return undefined;
  const first = files[0];
  if (first === undefined) return undefined;
  const at = first.lastIndexOf(NODE_MODULES);
  const rest = first.slice(at + NODE_MODULES.length);
  const [scopeOrName, second] = rest.split('/');
  if (!scopeOrName) return undefined;
  // Scoped packages (`@mui/material`) span two segments.
  return scopeOrName.startsWith('@') && second ? `${scopeOrName}/${second}` : scopeOrName;
}

/** The exported declaration whose own identifier is `name`, whatever it is exported as. */
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

/**
 * Origin per prop name for a component, or null when the props type could not
 * be resolved at all — null and "resolved to nothing" must stay distinct, so
 * that an unresolvable component reports `ownPropCount: null` (not determined)
 * rather than a confident `0`.
 */
function resolvePropOrigins(
  descriptor: ComponentDescriptor,
  handle: ReactProgramHandle,
): ReadonlyMap<string, PropOriginInfo> | null {
  const sourceFile = handle.tsProject.getSourceFile(descriptor.filePath);
  if (!sourceFile) return null;

  let exported: ReadonlyMap<string, readonly Node[]>;
  try {
    exported = sourceFile.getExportedDeclarations();
  } catch {
    return null; // malformed file — the scan must not fail over a display facet
  }

  // `exportName` is the name the component was DISCOVERED under, which may be a
  // barrel's alias rather than an export of its own file: discovery walks every
  // file's exports and resolves re-exports back to the original declaration, so
  // a descriptor can pair `filePath` = origin file with `exportName` = the alias.
  // The origin file may only export `default`. Without the name fallback,
  // NavCollapseIcons in the real target — a plain arrow component — resolved to
  // nothing and reported all 51 of its props unclassified.
  const declaration =
    exported.get(descriptor.exportName)?.[0] ?? declarationNamed(exported, descriptor.name);
  if (!declaration) return null;

  try {
    // Component types are callable in every shape we discover — plain function,
    // arrow, `forwardRef`/`memo` exotic, styled factory — so parameter 0 of the
    // call signature is the props type regardless of how it was built.
    const signature = declaration.getType().getCallSignatures()[0];
    if (!signature) return null;
    const propsParam = signature.getParameters()[0];
    if (!propsParam) return new Map(); // takes no props: resolved, and empty

    const out = new Map<string, PropOriginInfo>();
    for (const symbol of propsParam.getTypeAtLocation(declaration).getProperties()) {
      const files = symbol.getDeclarations().map((d) => d.getSourceFile().getFilePath() as string);
      const origin = originOfDeclarationFiles(files);
      const packageName = inheritedPackageName(files);
      out.set(symbol.getName(), packageName ? { origin, packageName } : { origin });
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Put back a `children` that react-docgen dropped.
 *
 * react-docgen-typescript omits `children` when it carries no JSDoc description.
 * That silently removes the single most important CONTENT prop: the preview then
 * has nothing to put inside the component and renders an empty box. Measured on
 * the real target, 68 components declare `children` and 52 of them (76%) lost it
 * this way — a large share of the previews that showed a frame with no words.
 *
 * The TypeScript checker knows better, and `resolvePropOrigins` has already asked
 * it for every property of the props type. So when the checker saw `children` and
 * docgen did not, re-add it: as a `node`, which is what `children` always is.
 */
function withDeclaredChildren(
  props: readonly PropControl[],
  origins: ReadonlyMap<string, PropOriginInfo> | null,
): PropControl[] {
  const out = [...props];
  const declared = origins?.get('children');
  if (!declared || out.some((p) => p.name === 'children')) return out;
  out.push({
    name: 'children',
    tsType: 'ReactNode',
    kind: 'node',
    // Optional is the safe report: a wrong "required" badge would be a claim
    // about the component's API, and filling a node prop does not depend on it.
    required: false,
    origin: declared.origin,
    ...(declared.packageName ? { originPackage: declared.packageName } : {}),
  });
  return out;
}

/**
 * Prop extraction was attempted and did not produce an answer. Thrown rather
 * than returning an empty PropModel: `{ props: [] }` is indistinguishable from
 * a component that genuinely takes no props, so the Details tab would state
 * "no props" as fact. `EngineSession.scan()` catches this and records a
 * ScanFailure, which names the file instead of quietly lying about it.
 */
export class PropExtractionError extends Error {
  constructor(descriptor: ComponentDescriptor, reason: string) {
    super(`Props for "${descriptor.name}" could not be extracted: ${reason}`);
    this.name = 'PropExtractionError';
  }
}

export function extractProps(
  descriptor: ComponentDescriptor,
  handle: ReactProgramHandle,
): PropModel {
  let docs: ComponentDoc[];
  try {
    // `parse()` would build a fresh ts.Program per component. Reuse the
    // session's one program instead — that rebuild is ~all of a scan's cost.
    docs = handle
      .docgen()
      .parseWithProgramProvider(descriptor.filePath, () => handle.tsProgram());
  } catch (err) {
    throw new PropExtractionError(descriptor, (err as Error).message);
  }
  // No docs at all is a normal outcome for shapes docgen does not model at all
  // (styled-components, some HOC-wrapped exports) — not a failed extraction.
  if (docs.length === 0) return EMPTY;

  const doc =
    docs.find((d) => d.displayName === descriptor.name) ??
    (docs.length === 1 ? docs[0] : undefined);
  if (!doc) {
    throw new PropExtractionError(
      descriptor,
      `${docs.length} components are documented in ${descriptor.filePath} ` +
        `(${docs.map((d) => d.displayName).join(', ')}) and none is named "${descriptor.name}"`,
    );
  }

  const origins = resolvePropOrigins(descriptor, handle);
  const props = withDeclaredChildren(
    Object.values(doc.props)
    // Drop React's inherited DOM/ARIA attribute surface (a MUI wrapper reports
    // ~290 props; its real ones are a handful) so the model is the component's
    // own API — and the sandbox never fills an inherited icon/element prop.
      .filter((prop) => !isDomNoiseProp(prop.name))
      .map((prop) => toControl(prop, origins?.get(prop.name) ?? UNKNOWN_ORIGIN)),
    origins,
  ).sort((a, b) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name));

  return { props, ownPropCount: countOwn(props, origins !== null) };
}

/**
 * `null` (not determined) rather than `0` whenever nothing could be classified
 * but props exist: "0 own props" is a claim about the component, and the card
 * leads with that number — stating it on no evidence is the one outcome worse
 * than showing the inflated total.
 */
function countOwn(props: readonly PropControl[], resolved: boolean): number | null {
  if (props.length === 0) return 0;
  if (!resolved) return null;
  const own = props.filter((p) => p.origin === 'own').length;
  if (own === 0 && props.every((p) => p.origin === 'unknown')) return null;
  return own;
}
