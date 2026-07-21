/**
 * Pure, engine-free helpers that shape engine outputs into the JSON an agent
 * consumes. No SDK, no engine calls — ScanResult / ComponentArtifact in, plain
 * serializable objects out — so the tool logic is unit-testable without spinning
 * up ts-morph. The server module (server.ts) wires these to MCP tools.
 */

import {
  customizeArtifact,
  EngineError,
  type AtomicLevel,
  type ComponentArtifact,
  type ComponentKind,
  type ComponentSummary,
  type CustomizationState,
  type ScanResult,
} from '@ce/core';

export interface ComponentFilter {
  readonly atomicLevel?: AtomicLevel;
  readonly kind?: ComponentKind;
  readonly nameIncludes?: string;
  readonly maxContextDependencyScore?: number;
  readonly limit?: number;
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
    warnings: [...r.warnings],
  };
}

/** Apply a filter (all fields optional, AND-combined) then cap with `limit`. */
export function filterComponents(
  components: readonly ComponentSummary[],
  filter: ComponentFilter,
): ComponentSummary[] {
  const needle = filter.nameIncludes?.toLowerCase();
  const matched = components.filter((c) => {
    if (filter.atomicLevel && c.classification.atomicLevel !== filter.atomicLevel) return false;
    if (filter.kind && c.classification.kind !== filter.kind) return false;
    if (needle && !c.descriptor.name.toLowerCase().includes(needle)) return false;
    if (
      filter.maxContextDependencyScore != null &&
      c.classification.contextDependencyScore > filter.maxContextDependencyScore
    ) {
      return false;
    }
    return true;
  });
  return filter.limit != null ? matched.slice(0, filter.limit) : matched;
}

/** One compact row per component — the `id` is the handle for the other tools. */
export function toComponentRows(components: readonly ComponentSummary[]) {
  return components.map((c) => ({
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
  }));
}

/** The copy-ready portable bundle for one component — the `get_portable_code` payload. */
export function toPortableCode(a: ComponentArtifact) {
  return {
    id: a.descriptor.id,
    name: a.descriptor.name,
    entryPath: a.bundle.entryPath,
    files: a.bundle.files,
    externalDeps: a.bundle.externalDeps,
    tokensCssPath: '/tokens.css',
    tokens: a.tokenModel.tokens.map((t) => ({
      id: t.id,
      name: t.name,
      value: t.value,
      category: t.category,
    })),
    warnings: [...a.bundle.warnings],
    incomplete: a.bundle.incomplete === true,
  };
}

/** Customized output (tokens + props + design) — the `customize_component` payload. */
export function toCustomized(a: ComponentArtifact, state: CustomizationState) {
  const c = customizeArtifact(a, state);
  return {
    id: c.id,
    name: c.name,
    tokensCssPath: '/tokens.css',
    tokensCss: c.tokensCss,
    designCss: c.designCss,
    files: c.spec.files,
    appliedTokenOverrides: c.appliedTokenOverrides,
    unknownTokenIds: c.unknownTokenIds,
    appliedPropValues: c.appliedPropValues,
    appliedDesignOverrides: c.appliedDesignOverrides,
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
