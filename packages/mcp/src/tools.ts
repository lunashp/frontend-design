/**
 * Pure, engine-free helpers that shape engine outputs into the JSON an agent
 * consumes. No SDK, no engine calls — ScanResult / ComponentArtifact in, plain
 * serializable objects out — so the tool logic is unit-testable without spinning
 * up ts-morph. The server module (server.ts) wires these to MCP tools.
 *
 * Two rules govern every payload here:
 * - HONESTY: never hand an agent something it cannot verify. Anything the engine
 *   already decided (renderability, stubbed modules, source-app files, unknown
 *   override keys) is reported, and nothing is truncated without a flag saying so.
 * - BUDGET: a large target has 1000+ components. Lists are paged and advisory
 *   string lists are capped, because the first tool call must not consume the
 *   agent's whole context window.
 */

import {
  customizeArtifact,
  DESIGN_FIELDS,
  emitDesignBlocks,
  EngineError,
  generateSampleProps,
  TOKENS_CSS_PATH,
  type AtomicLevel,
  type ComponentArtifact,
  type ComponentDescriptor,
  type ComponentKind,
  type ComponentSummary,
  type CustomizationState,
  type DesignBlock,
  type PortableBundle,
  type PropControl,
  type PropModel,
  type ScanResult,
} from '@ce/core';

/** Rows returned when a call omits `limit`; a whole large project would not fit an agent's context. */
export const DEFAULT_LIST_LIMIT = 50;

/** Cap on the advisory string lists (scan warnings/failures) carried on the wire. */
const MAX_NOTES = 20;

/** The design-override field ids `customize_component` accepts — the engine's own list, not a copy. */
export const DESIGN_FIELD_IDS: readonly string[] = DESIGN_FIELDS;

/** Placeholder selector in the emitted design rule — the real root class is not knowable from outside. */
export const ROOT_CLASS_PLACEHOLDER = '.your-root-class';

/**
 * All fields optional and AND-combined. `nameIncludes` / `pathIncludes` /
 * `propIncludes` are kept SEPARATE rather than folded into one haystack so a
 * query like "buttons under src/ui" is expressible; a merged haystack can only
 * express "matches either".
 */
export interface ComponentFilter {
  readonly atomicLevel?: AtomicLevel;
  readonly kind?: ComponentKind;
  readonly nameIncludes?: string;
  readonly pathIncludes?: string;
  readonly propIncludes?: string;
  readonly maxContextDependencyScore?: number;
}

export interface PageRequest {
  readonly offset?: number;
  readonly limit?: number;
}

export interface Page<T> {
  /** Items matching before paging. */
  readonly total: number;
  readonly offset: number;
  readonly returned: number;
  /** Offset to pass next; omitted once the window reaches the end. */
  readonly nextOffset?: number;
  /** True when items were left out — never truncate without disclosing it. */
  readonly truncated: boolean;
  readonly items: readonly T[];
}

/** Compact whole-project stats — the `scan_project` payload. */
export function toScanSummary(r: ScanResult) {
  const byAtomicLevel: Record<AtomicLevel, number> = { atom: 0, molecule: 0, organism: 0, page: 0 };
  const byKind: Record<ComponentKind, number> = { presentational: 0, container: 0, layout: 0 };
  for (const c of r.components) {
    byAtomicLevel[c.classification.atomicLevel] += 1;
    byKind[c.classification.kind] += 1;
  }
  return {
    projectRoot: r.projectRoot,
    framework: r.framework,
    artifactVersion: r.artifactVersion,
    componentCount: r.components.length,
    counts: { byAtomicLevel, byKind },
    // Structured failures name the file that could not be analysed; the prose
    // `warnings` say the same thing less usefully. Both are capped, and the cut
    // is disclosed rather than silent.
    failureCount: r.failures.length,
    failures: r.failures.slice(0, MAX_NOTES),
    failuresTruncated: r.failures.length > MAX_NOTES,
    warningCount: r.warnings.length,
    warnings: r.warnings.slice(0, MAX_NOTES),
    warningsTruncated: r.warnings.length > MAX_NOTES,
  };
}

/** Apply a filter (all fields optional, AND-combined). Paging is `paginate`'s job. */
export function filterComponents(
  components: readonly ComponentSummary[],
  filter: ComponentFilter,
): ComponentSummary[] {
  const name = filter.nameIncludes?.toLowerCase();
  const filePath = filter.pathIncludes?.toLowerCase();
  const prop = filter.propIncludes?.toLowerCase();
  return components.filter((c) => {
    if (filter.atomicLevel && c.classification.atomicLevel !== filter.atomicLevel) return false;
    if (filter.kind && c.classification.kind !== filter.kind) return false;
    if (name && !c.descriptor.name.toLowerCase().includes(name)) return false;
    if (filePath && !c.descriptor.filePath.toLowerCase().includes(filePath)) return false;
    if (prop && !c.propModel.props.some((p) => p.name.toLowerCase().includes(prop))) return false;
    if (
      filter.maxContextDependencyScore != null &&
      c.classification.contextDependencyScore > filter.maxContextDependencyScore
    ) {
      return false;
    }
    return true;
  });
}

/**
 * Offset/limit window over an already-filtered list. Deliberately NOT a cursor:
 * an agent narrows a query rather than paging 1000+ rows, and a cursor would buy
 * a stable-sort obligation plus skip/repeat bugs across duplicate-name ties.
 */
export function paginate<T>(items: readonly T[], page: PageRequest = {}): Page<T> {
  const total = items.length;
  const offset = Math.min(Math.max(Math.trunc(page.offset ?? 0), 0), total);
  const limit = Math.max(Math.trunc(page.limit ?? DEFAULT_LIST_LIMIT), 0);
  const window = items.slice(offset, offset + limit);
  const end = offset + window.length;
  return {
    total,
    offset,
    returned: window.length,
    nextOffset: end < total ? end : undefined,
    truncated: end < total || offset > 0,
    items: window,
  };
}

/**
 * The row-shaping seam. Only `'compact'` exists today; the parameter is here so
 * adding `'ids'` / `'full'` later is a new branch rather than a signature change
 * for every caller.
 */
export type ComponentView = 'compact';

export interface ComponentRow {
  readonly id: string;
  readonly name: string;
  readonly exportName: string;
  readonly filePath: string;
  readonly isDefaultExport: boolean;
  readonly atomicLevel: AtomicLevel;
  readonly kind: ComponentKind;
  readonly contextDependencyScore: number;
  readonly confidence: number;
  readonly propCount: number;
  /** Prop names, so a component can be picked by its API without a second call. */
  readonly propNames: readonly string[];
}

export function projectComponent(c: ComponentSummary, view: ComponentView = 'compact'): ComponentRow {
  // No tool exposes `view` yet, but this is a public helper over a union meant to
  // widen: fail loudly rather than silently returning a compact row for a view
  // that was asked for precisely because it should be different.
  if (view !== 'compact') throw new EngineError(`Unknown component view: ${String(view)}`, 'BAD_VIEW');
  return {
    id: c.descriptor.id,
    name: c.descriptor.name,
    exportName: c.descriptor.exportName,
    filePath: c.descriptor.filePath,
    isDefaultExport: c.descriptor.isDefaultExport,
    atomicLevel: c.classification.atomicLevel,
    kind: c.classification.kind,
    contextDependencyScore: c.classification.contextDependencyScore,
    confidence: c.classification.confidence,
    propCount: c.propModel.props.length,
    propNames: c.propModel.props.map((p) => p.name),
  };
}

/** One compact row per component — the `id` is the handle for the other tools. */
export function toComponentRows(
  components: readonly ComponentSummary[],
  view: ComponentView = 'compact',
): ComponentRow[] {
  return components.map((c) => projectComponent(c, view));
}

/** Filter + page + shape — the `list_components` payload. */
export function toComponentList(
  components: readonly ComponentSummary[],
  filter: ComponentFilter,
  page: PageRequest = {},
  view: ComponentView = 'compact',
) {
  const matched = filterComponents(components, filter);
  const p = paginate(matched, page);
  return {
    // Components in the project; `total` is how many survived the filter.
    scanned: components.length,
    total: p.total,
    offset: p.offset,
    returned: p.returned,
    nextOffset: p.nextOffset,
    truncated: p.truncated,
    components: toComponentRows(p.items, view),
  };
}

function toPropSpec(p: PropControl) {
  return {
    name: p.name,
    tsType: p.tsType,
    kind: p.kind,
    required: p.required,
    options: p.options ? [...p.options] : undefined,
    defaultValue: p.defaultValue,
    description: p.description,
  };
}

function withoutExt(p: string): string {
  return p.replace(/\.(tsx|ts|jsx|js)$/, '');
}

const FUNCTION_TYPE = /=>|\bFunction\b/;

/**
 * A paste-ready import + JSX call site using the same sample props the preview
 * mounts. The engine already builds an equivalent call site inside the sandbox
 * entry, but that file is a mount harness — this is the part worth copying.
 */
export function toUsageSnippet(
  descriptor: ComponentDescriptor,
  entryPath: string,
  propModel: PropModel,
  sampleProps: Readonly<Record<string, unknown>>,
): string {
  const specifier = `.${withoutExt(entryPath)}`;
  const tag = descriptor.isDefaultExport ? descriptor.name : descriptor.exportName;
  const importLine = descriptor.isDefaultExport
    ? `import ${tag} from '${specifier}';`
    : `import { ${tag} } from '${specifier}';`;

  const { children, ...rest } = sampleProps;
  const attrs = Object.entries(rest).map(([k, v]) =>
    typeof v === 'string' ? `${k}=${JSON.stringify(v)}` : `${k}={${JSON.stringify(v)}}`,
  );
  // JSON cannot carry a function, so a required handler the component CALLS
  // while rendering would otherwise be missing from the snippet entirely.
  for (const p of propModel.props) {
    if (p.required && FUNCTION_TYPE.test(p.tsType) && !(p.name in sampleProps)) {
      attrs.push(`${p.name}={() => {}}`);
    }
  }

  const attrBlock = attrs.length === 0 ? ' ' : `\n${attrs.map((a) => `  ${a}`).join('\n')}\n`;
  const element =
    children === undefined
      ? `<${tag}${attrBlock}/>`
      : `<${tag}${attrs.length === 0 ? '' : attrBlock}>\n  ${String(children)}\n</${tag}>`;
  return `${importLine}\n\n${element}\n`;
}

/**
 * Bundle files that came from the SOURCE app rather than from the component:
 * its theme, its i18n catalogue, its context providers. They sit unmarked in
 * `files` so the preview renders faithfully — copied blind into a destination
 * app, they import the source app's design decisions wholesale, which is exactly
 * the wrong outcome when the instruction was "match OUR theme".
 */
function sourceAppFiles(b: PortableBundle): string[] {
  const paths = new Set<string>();
  if (b.previewTheme) paths.add(b.previewTheme.path);
  if (b.previewMessages) paths.add(b.previewMessages);
  for (const p of b.previewProviders ?? []) paths.add(p.path);
  return [...paths];
}

/** The copy-ready portable bundle for one component — the `get_portable_code` payload. */
export function toPortableCode(a: ComponentArtifact) {
  const b = a.bundle;
  const sampleProps = generateSampleProps(a.propModel, a.descriptor);
  return {
    id: a.descriptor.id,
    name: a.descriptor.name,
    exportName: a.descriptor.exportName,
    isDefaultExport: a.descriptor.isDefaultExport,
    entryPath: b.entryPath,
    files: b.files,
    externalDeps: b.externalDeps,
    tokensCssPath: TOKENS_CSS_PATH,
    tokens: a.tokenModel.tokens.map((t) => ({
      id: t.id,
      name: t.name,
      value: t.value,
      category: t.category,
    })),
    // The prop contract. Without it `customize_component`'s propValues is a
    // guessing game with no feedback when the guess is wrong.
    props: a.propModel.props.map(toPropSpec),
    sampleProps,
    usage: toUsageSnippet(a.descriptor, b.entryPath, a.propModel, sampleProps),
    // The engine already decided whether this renders, without rendering it.
    renderability: a.sandpack.renderability,
    renderNotes: [...a.sandpack.notes],
    stubbedModules: b.stubbedModules.map((s) => ({ ...s })),
    danglingImports: [...b.danglingImports],
    sourceAppFiles: sourceAppFiles(b),
    previewTheme: b.previewTheme,
    previewMessages: b.previewMessages,
    previewProviders: b.previewProviders ? [...b.previewProviders] : [],
    warnings: [...b.warnings],
    incomplete: b.incomplete === true,
  };
}

function stripImportant(declaration: string): string {
  return declaration.replace(' !important', '');
}

/**
 * The engine models the resting state as `null`; on the wire it is spelled
 * `'rest'` so an agent reading the JSON never has to infer which block is which.
 */
export type DesignBlockState = 'rest' | 'hover' | 'focus' | 'active';

/** One emitted rule, self-describing: which state it paints and under which selector. */
export interface DesignRuleBlock {
  readonly state: DesignBlockState;
  readonly selector: string;
  readonly declarations: readonly string[];
}

/**
 * Shape the engine's blocks for the wire. The selector is an explicit
 * PLACEHOLDER: a component's real root class cannot be known from outside —
 * CSS-module names are hashed at build time and library components (MUI, …)
 * emit their own — so a `.Button { … }` rule would silently match nothing. The
 * engine's own `emitDesignRule` does emit `.Name`, which is why this stays here
 * rather than delegating to it.
 */
function toDesignRuleBlocks(blocks: readonly DesignBlock[]): DesignRuleBlock[] {
  return blocks.map((b) => ({
    state: b.state ?? 'rest',
    selector: `${ROOT_CLASS_PLACEHOLDER}${b.selectorSuffix}`,
    declarations: b.declarations.map(stripImportant),
  }));
}

/** A copyable stylesheet: the resting rule first, then one rule per interactive state. */
function toDesignRule(name: string, blocks: readonly DesignRuleBlock[]): string {
  if (blocks.length === 0) return '';
  const rules = blocks.map(
    (b) => `${b.selector} {\n${b.declarations.map((d) => `  ${d};`).join('\n')}\n}`,
  );
  return (
    `/* Design overrides for ${name}. Apply to the component's ROOT element.\n` +
    `   ${ROOT_CLASS_PLACEHOLDER} is a PLACEHOLDER — the real root class is not\n` +
    `   knowable from outside (CSS-module hashes, library-generated classes).\n` +
    `   Replace it, or apply designDeclarations inline via style={{ … }}. */\n` +
    `${rules.join('\n\n')}\n`
  );
}

/** Customized output (tokens + props + design) — the `customize_component` payload. */
export function toCustomized(a: ComponentArtifact, state: CustomizationState) {
  const c = customizeArtifact(a, state);
  const knownPropNames = a.propModel.props.map((p) => p.name);
  const known = new Set(knownPropNames);
  // Emit from the VALIDATED map the engine already partitioned, so a bogus key
  // cannot reach the emitter, and via blocks so `hover:` / `focus:` / `active:`
  // overrides become their own rules instead of vanishing.
  const blocks = toDesignRuleBlocks(emitDesignBlocks(c.appliedDesignOverrides));
  const resting = blocks.find((b) => b.state === 'rest');
  return {
    id: c.id,
    name: c.name,
    tokensCssPath: TOKENS_CSS_PATH,
    tokensCss: c.tokensCss,
    // Resting-state declarations, for pasting into a `style={{ … }}`. Anything
    // state-dependent is only expressible as a rule, so it lives in designBlocks.
    designDeclarations: resting?.declarations ?? [],
    designBlocks: blocks,
    designCss: toDesignRule(c.name, blocks),
    // The PORTABLE files with the re-themed stylesheet swapped in — NOT the
    // sandbox spec's files, which are a mount harness (createRoot, an error
    // boundary, prop stubs) that must never land in a destination repo.
    entryPath: a.bundle.entryPath,
    files: { ...a.bundle.files, [TOKENS_CSS_PATH]: c.tokensCss },
    externalDeps: a.bundle.externalDeps,
    appliedTokenOverrides: c.appliedTokenOverrides,
    unknownTokenIds: c.unknownTokenIds,
    appliedPropValues: c.appliedPropValues,
    // Same disclosure as unknownTokenIds, for the other two override channels.
    unknownPropNames: Object.keys(state.propValues).filter((n) => !known.has(n)),
    knownPropNames,
    appliedDesignOverrides: c.appliedDesignOverrides,
    // The engine already partitioned these (it strips the state prefix before
    // checking the field); recomputing here would call every `hover:*` key bogus.
    unknownDesignFields: c.unknownDesignFields,
  };
}

// A type alias (not an interface) so it stays assignable to the SDK's
// CallToolResult, whose index signature an interface would not satisfy.
export type ToolError = {
  content: { type: 'text'; text: string }[];
  isError: true;
};

/** Map any thrown error to an MCP tool error, never leaking to stdout. */
export function toToolError(err: unknown): ToolError {
  const code = err instanceof EngineError ? err.code : 'MCP_ERROR';
  const message = err instanceof Error ? err.message : 'Unexpected error';
  return { content: [{ type: 'text', text: `[${code}] ${message}` }], isError: true };
}
