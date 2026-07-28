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
  DESIGN_GROUPS,
  emitDesignBlocks,
  EngineError,
  explainContextScore,
  generateSampleProps,
  parseDesignKey,
  TOKENS_CSS_PATH,
  type AtomicLevel,
  type ComponentArtifact,
  type ComponentDescriptor,
  type ComponentKind,
  type ComponentSummary,
  type ContextScoreContribution,
  type CustomizationState,
  type DesignBlock,
  type DesignField,
  type PortableKit,
  type PropControl,
  type PropModel,
  type ScanResult,
} from '@ce/core';

/** Rows returned when a call omits `limit`; a whole large project would not fit an agent's context. */
export const DEFAULT_LIST_LIMIT = 50;

/** Cap on the advisory string lists (scan warnings/failures) carried on the wire. */
const MAX_NOTES = 20;

/**
 * Cap on the `usages` carried per token row. A single token can be referenced
 * hundreds of times; without a cap one heavily-used token would dominate the
 * payload. The true total always rides on `usageCount`, and `usagesTruncated`
 * flags when the list was cut — nothing is dropped silently.
 */
export const MAX_TOKEN_USAGES = 10;

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
    // Deliberately NOT capped. These are scan-LEVEL findings, bounded by the
    // number of graded detectors (3) rather than by project size, so a cap
    // could only ever drop signal for no budget saving. They used to ride on
    // `warnings` as prose appended last, which meant a target with more than
    // MAX_NOTES failures pushed them off the wire entirely — the agent never
    // learned that a classification signal was under-reporting.
    heuristicWarnings: r.heuristicWarnings.map((h) => ({ ...h })),
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
  /**
   * Every term behind `contextDependencyScore`, from the engine's own explainer.
   * A bare `6.5` cannot be reasoned about — this shows it is e.g. routing +2,
   * store subscription +3, useAuth +1.5 — and it is the ONE definition of the
   * weights, so an eyeless agent never re-derives (and drifts) them. Empty for a
   * presentational atom, where the score is 0 and there is nothing to explain.
   */
  readonly scoreBreakdown: readonly ScoreTerm[];
  /** Hook names this component calls, so it can be found by the hook it uses. */
  readonly hooks: readonly string[];
  /** Context this component reads (app + styling) — the raw signal behind the score. */
  readonly contextConsumers: readonly string[];
  /**
   * Reverse-import-graph reuse signal: how many OTHER scanned files import this
   * component. The most-imported member of a duplicate-name cluster is usually
   * the canonical design component ("which Button is real"). Counts imports from
   * ANALYZED SOURCE ONLY — story/test/spec files are excluded from the scan, so a
   * component used only by Storybook stories reads 0. A rank/tie-break signal
   * only; never a reason to hide a component.
   */
  readonly usedByCount: number;
  /** A bounded sample of the importing files behind `usedByCount`. */
  readonly usedByFiles: readonly string[];
}

/** One term of a row's `scoreBreakdown`: what pushed the score up, and by how much. */
export interface ScoreTerm {
  readonly label: string;
  readonly weight: number;
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
    scoreBreakdown: explainContextScore(c.signals).map(
      (t: ContextScoreContribution): ScoreTerm => ({ label: t.label, weight: t.weight }),
    ),
    hooks: [...c.signals.hookNames],
    contextConsumers: [...c.signals.contextConsumers],
    usedByCount: c.usage?.usedByCount ?? 0,
    usedByFiles: c.usage ? [...c.usage.usedByFiles] : [],
  };
}

/** Imports from analyzed source; absent on hand-built summaries, so default to 0. */
function usedByCount(c: ComponentSummary): number {
  return c.usage?.usedByCount ?? 0;
}

/**
 * Row ordering for `list_components`. `default` keeps the engine's discovery
 * order (name-sorted); `mostUsed` leads with the most-imported component — the
 * canonical member of a duplicate-name cluster.
 */
export type ComponentOrder = 'default' | 'mostUsed';

/** Most-imported first; ties fall to the more isolable, then name — a stable order. */
function orderComponents(
  components: readonly ComponentSummary[],
  order: ComponentOrder,
): readonly ComponentSummary[] {
  if (order !== 'mostUsed') return components;
  return [...components].sort(
    (a, b) =>
      usedByCount(b) - usedByCount(a) ||
      a.classification.contextDependencyScore - b.classification.contextDependencyScore ||
      a.descriptor.name.localeCompare(b.descriptor.name),
  );
}

/** One compact row per component — the `id` is the handle for the other tools. */
export function toComponentRows(
  components: readonly ComponentSummary[],
  view: ComponentView = 'compact',
): ComponentRow[] {
  return components.map((c) => projectComponent(c, view));
}

/** Filter + order + page + shape — the `list_components` payload. */
export function toComponentList(
  components: readonly ComponentSummary[],
  filter: ComponentFilter,
  page: PageRequest = {},
  order: ComponentOrder = 'default',
  view: ComponentView = 'compact',
) {
  const matched = orderComponents(filterComponents(components, filter), order);
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
 * The preview-source fields a PortableBundle and a PortableKit share. Typed
 * structurally (not as PortableBundle) so `sourceAppFiles` serves both the
 * single-component and the kit payload without duplicating the walk.
 */
interface PreviewSource {
  readonly previewTheme?: { readonly path: string; readonly exportName: string };
  readonly previewMessages?: string;
  readonly previewProviders?: readonly { readonly path: string; readonly exportName: string }[];
}

/**
 * Bundle files that came from the SOURCE app rather than from the component:
 * its theme, its i18n catalogue, its context providers. They sit unmarked in
 * `files` so the preview renders faithfully — copied blind into a destination
 * app, they import the source app's design decisions wholesale, which is exactly
 * the wrong outcome when the instruction was "match OUR theme".
 */
function sourceAppFiles(b: PreviewSource): string[] {
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
    // Sort by usage count desc so the load-bearing tokens — the ones worth
    // re-theming first — lead the list; a bare unsorted {name,value,category}
    // list buried them and dropped WHERE each is used entirely. Spread first so
    // the sort never mutates the engine's array.
    tokens: [...a.tokenModel.tokens]
      .sort((x, y) => y.usages.length - x.usages.length)
      .map((t) => ({
        id: t.id,
        name: t.name,
        value: t.value,
        category: t.category,
        // 'extracted' | 'derived' | 'user' — a derived token was inferred, not
        // authored, so an agent can weight it differently.
        source: t.source,
        usageCount: t.usages.length,
        usages: t.usages.slice(0, MAX_TOKEN_USAGES).map((u) => ({
          file: u.file,
          line: u.line,
          property: u.property,
          selector: u.selector,
        })),
        usagesTruncated: t.usages.length > MAX_TOKEN_USAGES,
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

/**
 * The copy-ready multi-component kit — the `get_portable_kit` payload. This is
 * the reason the tool exists: calling get_portable_code N times and merging by
 * hand corrupts a set, because every single-component bundle restarts its token
 * counters at `--color-1`, so the same value gets clashing names and a shared
 * file (a common Button) is duplicated or path-collided. A kit is ONE folder over
 * a SINGLE token namespace — shared files appear once, shared values share one
 * token name — so the merge is the engine's, not the agent's.
 *
 * The honesty rule still holds: `depConflicts` are SURFACED (a package two
 * components want at different ranges is recorded, not silently collapsed —
 * externalDeps still carries one resolved range), and `sourceAppFiles` names the
 * bundle files that belong to the SOURCE app's theme/i18n/providers, not to any
 * component, so they are not copied blind into a destination with its own theme.
 */
/**
 * How many characters of merged file bodies one kit may carry.
 *
 * A kit's files are unbounded — every source file of every component in the set.
 * Measured against a real target, TWO components produced an 86KB payload (95% of
 * it file bodies) and the MCP client refused the whole result: the agent got
 * NOTHING from the very call the tool description tells it to prefer over N
 * single-component calls. A budget with a named remainder beats a refusal.
 */
export const MAX_KIT_FILE_BYTES = 40_000;

/**
 * Fit a kit's files into the budget, entries first, then the rest smallest-first
 * so the most files survive. What did not fit is NAMED — the caller can still
 * fetch it with `get_portable_code` for the owning component — because a set that
 * silently loses a file is a set that fails to compile in the destination repo
 * for a reason nobody can see.
 */
export function budgetKitFiles(
  files: Readonly<Record<string, string>>,
  entryPaths: readonly string[],
): { files: Record<string, string>; filesOmitted: string[]; filesTruncated: boolean } {
  const entries = entryPaths.filter((p) => p in files);
  const rest = Object.keys(files)
    .filter((p) => !entries.includes(p))
    .sort((a, b) => (files[a] as string).length - (files[b] as string).length);

  const out: Record<string, string> = {};
  const omitted: string[] = [];
  let spent = 0;
  // An entry IS the component. Losing it would leave a kit that names a component
  // it does not contain, so entries go in whatever they cost.
  for (const p of entries) {
    out[p] = files[p] as string;
    spent += (files[p] as string).length;
  }
  for (const p of rest) {
    const size = (files[p] as string).length;
    if (spent + size > MAX_KIT_FILE_BYTES) {
      omitted.push(p);
      continue;
    }
    out[p] = files[p] as string;
    spent += size;
  }
  return { files: out, filesOmitted: omitted.sort(), filesTruncated: omitted.length > 0 };
}

export function toPortableKit(kit: PortableKit) {
  const budgeted = budgetKitFiles(kit.files, Object.values(kit.entryPaths));
  return {
    componentCount: kit.components.length,
    // id + name + entry, in the caller's requested order — the handles a
    // destination repo needs to wire each component up.
    components: kit.components.map((c) => ({ id: c.id, name: c.name, entryPath: c.entryPath })),
    entryPaths: kit.entryPaths,
    files: budgeted.files,
    // Named, never silent: fetch these with `get_portable_code` for the component
    // that owns them, or take a smaller set.
    filesOmitted: budgeted.filesOmitted,
    filesTruncated: budgeted.filesTruncated,
    externalDeps: kit.externalDeps,
    // Packages required at DIFFERENT ranges across the set. Recorded rather than
    // hidden so the caller reconciles them; each entry names every requester.
    depConflicts: kit.depConflicts.map((c) => ({
      package: c.package,
      requirements: c.requirements.map((r) => ({ componentId: r.componentId, range: r.range })),
    })),
    tokensCssPath: kit.tokensCssPath,
    tokensCss: kit.tokensCss,
    // The shared namespace itself, compactly: id/name/value/category/source, no
    // usages. This is what proves the de-dup (one name per value across the whole
    // set) and gives an agent the ids to re-theme; usages are dropped to keep the
    // kit payload — which already carries every merged file — within budget.
    tokens: kit.tokenModel.tokens.map((t) => ({
      id: t.id,
      name: t.name,
      value: t.value,
      category: t.category,
      source: t.source,
    })),
    stubbedModules: kit.stubbedModules.map((s) => ({ ...s })),
    danglingImports: [...kit.danglingImports],
    warnings: [...kit.warnings],
    sourceAppFiles: sourceAppFiles(kit),
    previewTheme: kit.previewTheme,
    previewMessages: kit.previewMessages,
    previewProviders: kit.previewProviders ? [...kit.previewProviders] : [],
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

/** Field id -> its spec (range bounds / select options), flattened from DESIGN_GROUPS. */
const DESIGN_FIELD_BY_ID: ReadonlyMap<string, DesignField> = new Map(
  DESIGN_GROUPS.flatMap((g) => g.fields.map((f) => [f.id, f] as const)),
);

/**
 * Select fields whose contract ALSO admits a raw CSS value. Only `shadow`: its
 * documented form is "none|sm|md|lg|xl OR raw CSS", and the emitter passes a
 * non-preset value straight through as a box-shadow. Restricting it to the enum
 * would reject a real `0 1px 2px #000`.
 */
const RAW_VALUE_SELECT_FIELDS: ReadonlySet<string> = new Set(['shadow']);

/**
 * A design override whose VALUE failed validation against DESIGN_GROUPS. Key
 * validation (unknownDesignFields) alone let a bad value on a REAL field reach
 * the emitter — radius:"9999" painted a 9999px corner, scale:"NaN" emitted
 * `scale(NaN)`, shadow:"bogus" emitted `box-shadow: bogus`. `omitted` true means
 * the value was dropped (NaN / out-of-enum); false means it was corrected and
 * `corrected` is the value actually emitted. Bounded by the field count, so it
 * is never truncated.
 */
export interface InvalidDesignValue {
  /** The override key exactly as given (may carry a `hover:`/`focus:`/`active:` prefix). */
  readonly key: string;
  /** The resolved field id, with any state prefix stripped. */
  readonly field: string;
  readonly given: string;
  /** The value actually emitted; absent when the override was dropped. */
  readonly corrected?: string;
  readonly omitted: boolean;
  readonly reason: string;
}

/** Outcome of checking one value: a replacement string, or null to drop it. */
interface DesignValueCheck {
  /** The value to emit, or null to drop the override entirely. */
  readonly value: string | null;
  /** Set when the value was corrected or dropped; absent when it passed as-is. */
  readonly reason?: string;
}

/**
 * Clamp a range value into [min,max] and snap it to the field's step. A blank is
 * the "unset" sentinel (the emitter's `has()` treats '' as no override), so it
 * passes through untouched; a non-blank non-finite value (NaN, Infinity) is
 * dropped rather than emitted as `scale(NaN)`.
 */
function checkRangeValue(field: DesignField, raw: string): DesignValueCheck {
  if (raw.trim() === '') return { value: raw };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { value: null, reason: 'not a finite number' };

  const min = field.min ?? -Infinity;
  const max = field.max ?? Infinity;
  const step = field.step !== undefined && field.step > 0 ? field.step : 0;
  let v = n;
  const reasons: string[] = [];
  if (v < min) {
    v = min;
    reasons.push(`below min ${min}`);
  } else if (v > max) {
    v = max;
    reasons.push(`above max ${max}`);
  }
  if (step > 0) {
    const base = Number.isFinite(min) ? min : 0;
    const snapped = Math.round((v - base) / step) * step + base;
    if (snapped !== v) {
      v = snapped;
      reasons.push(`snapped to step ${step}`);
    }
  }
  // Unchanged numerically: keep the caller's original spelling, report nothing.
  if (v === n) return { value: raw };
  return { value: String(v), reason: reasons.join(', ') };
}

/**
 * Restrict a select value to its enum. `shadow` (the only raw-admitting select)
 * additionally accepts a real CSS box-shadow — recognised by whitespace or a
 * `(` a bare keyword like "bogus" never carries — so the escape hatch stays open
 * while garbage is still rejected.
 */
function checkSelectValue(field: DesignField, raw: string): DesignValueCheck {
  const options = field.options ?? [];
  if (options.some((o) => o.value === raw)) return { value: raw };
  if (RAW_VALUE_SELECT_FIELDS.has(field.id) && /[\s()]/.test(raw)) return { value: raw };
  const allowed = options.map((o) => o.value).filter((v) => v !== '').join('|');
  return { value: null, reason: `not one of ${allowed}` };
}

/**
 * Value-validate a design-override map against DESIGN_GROUPS BEFORE the engine's
 * key validation. Known fields get their value clamped (range) or enum-checked
 * (select); unknown keys and unconstrained controls (color/text) pass through
 * unchanged so `customizeArtifact` still reports the unknown keys and colours/
 * widths stay free-form. Returns the corrected map to emit from, plus a parallel
 * `invalid` list — the sibling of `unknownDesignFields`.
 */
function sanitizeDesignValues(overrides: Readonly<Record<string, string>>): {
  overrides: Record<string, string>;
  invalid: InvalidDesignValue[];
} {
  const out: Record<string, string> = {};
  const invalid: InvalidDesignValue[] = [];
  for (const [key, raw] of Object.entries(overrides)) {
    const { field } = parseDesignKey(key);
    const spec = DESIGN_FIELD_BY_ID.get(field);
    // Unknown field, or a control with no bounds to enforce: leave it for the
    // engine's key check / the emitter and move on.
    if (!spec || (spec.control !== 'range' && spec.control !== 'select')) {
      out[key] = raw;
      continue;
    }
    const check = spec.control === 'range' ? checkRangeValue(spec, raw) : checkSelectValue(spec, raw);
    if (check.value === null) {
      invalid.push({ key, field, given: raw, omitted: true, reason: check.reason ?? 'invalid value' });
      continue;
    }
    if (check.reason !== undefined) {
      invalid.push({ key, field, given: raw, corrected: check.value, omitted: false, reason: check.reason });
    }
    out[key] = check.value;
  }
  return { overrides: out, invalid };
}

/** Customized output (tokens + props + design) — the `customize_component` payload. */
export function toCustomized(a: ComponentArtifact, state: CustomizationState) {
  // Correct out-of-bounds/NaN/out-of-enum design VALUES before customizing, so
  // the emitted CSS carries the corrected value and every fix is disclosed.
  const { overrides: designOverrides, invalid: invalidDesignValues } = sanitizeDesignValues(
    state.designOverrides ?? {},
  );
  const c = customizeArtifact(a, { ...state, designOverrides });
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
    // Values that named a real field but failed its bounds — clamped or dropped,
    // each with the reason. The VALUE-level sibling of unknownDesignFields.
    invalidDesignValues,
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
