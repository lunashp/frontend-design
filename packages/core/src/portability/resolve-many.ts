/**
 * resolveMany — the multi-component sibling of resolvePortability. Extracts a SET
 * of components into ONE self-contained folder with a single shared token
 * namespace, so a harvested kit assembles cleanly instead of colliding.
 *
 * Why one graph, not N bundles concatenated: a file shared by two components (a
 * common Button imported by both a Card and a Toolbar) must appear ONCE at a
 * stable path, and a value used in two different stylesheets must get ONE token
 * name. Both fall out of resolving the union as a single graph — one
 * commonBaseDir over every included file, and one tokenization of the merged set.
 */

import type { Project } from 'ts-morph';
import * as path from 'node:path';
import type { LoadedProject } from '../types/project.js';
import type { ComponentDescriptor } from '../types/component.js';
import type { FileMap } from '../types/portable-bundle.js';
import type { DepConflict, KitComponent, PortableKit } from '../types/portable-kit.js';
import { createReadOnlyFs } from '../util/fs-readonly.js';
import { buildImportGraph, type ImportGraph } from '../graph/import-graph.js';
import { stubPath, stubSource, stubbedCapabilityLost, stubbedPackageOf } from '../sandbox/next-stubs.js';
import { tokenizeBundle, TOKENS_CSS_PATH } from '../tokenize/tokenization-transform.js';
import {
  applyEdits,
  bundlePathOf,
  commonBaseDir,
  computeEdits,
  findDanglingImports,
  resolveExternalDeps,
} from './portable-common.js';

/** One entry's resolved import graph, kept alongside the descriptor it came from. */
interface EntryGraph {
  readonly descriptor: ComponentDescriptor;
  readonly graph: ImportGraph;
}

/**
 * Merge per-entry install lists into one, recording every package that two or
 * more components require at DIFFERENT ranges rather than silently picking one.
 * The picked range for a conflicted package is the lexicographically smallest, so
 * the merged map is deterministic; the conflict list preserves the full truth.
 */
function mergeExternalDeps(
  perEntry: readonly { readonly componentId: string; readonly deps: Record<string, string> }[],
): { externalDeps: Record<string, string>; depConflicts: DepConflict[] } {
  const requirements = new Map<string, { componentId: string; range: string }[]>();
  for (const { componentId, deps } of perEntry) {
    for (const [name, range] of Object.entries(deps)) {
      const list = requirements.get(name) ?? [];
      list.push({ componentId, range });
      requirements.set(name, list);
    }
  }

  const externalDeps: Record<string, string> = {};
  const depConflicts: DepConflict[] = [];
  for (const name of [...requirements.keys()].sort()) {
    const reqs = requirements.get(name) as { componentId: string; range: string }[];
    const distinct = [...new Set(reqs.map((r) => r.range))].sort();
    externalDeps[name] = distinct[0] as string;
    if (distinct.length > 1) {
      depConflicts.push({
        package: name,
        requirements: [...reqs].sort((a, b) => a.componentId.localeCompare(b.componentId)),
      });
    }
  }
  return { externalDeps, depConflicts };
}

export function resolveMany(
  project: Project,
  entries: readonly ComponentDescriptor[],
  loaded: LoadedProject,
): PortableKit {
  const rofs = createReadOnlyFs(loaded.rootPath);

  // Whether ANY entry uses MUI / next-intl decides theme + messages bundling.
  // Both are single per project (loaded.themeRef / loaded.messagesFile), so a kit
  // is never ambiguous about which theme to bundle — it is the app's one theme.
  const firstPasses = entries.map((d) => buildImportGraph(project, d.filePath, loaded));
  const usesMui = firstPasses.some((g) =>
    [...g.externals].some((d) => d === '@mui/material' || d.startsWith('@mui/')),
  );
  const usesIntl = firstPasses.some((g) => g.externals.has('next-intl'));
  const themeRoot = usesMui && loaded.themeRef ? loaded.themeRef.file : null;
  const messagesFile = usesIntl && loaded.messagesFile ? loaded.messagesFile : null;

  // Per-entry graphs (theme as an extra root when relevant). Kept per entry —
  // not merged into one walk — because each entry's OWN externals are what makes
  // a conflicting dependency range detectable: a package imported directly by
  // one entry and pulled in as a peer by another differs only per entry.
  const entryGraphs: EntryGraph[] = entries.map((descriptor, i) => ({
    descriptor,
    graph: themeRoot
      ? buildImportGraph(project, descriptor.filePath, loaded, [themeRoot])
      : (firstPasses[i] as ImportGraph),
  }));

  // Union of every included file, so shared files dedupe and one base is chosen.
  const localFilesUnion = new Set<string>();
  const styleFilesUnion = new Set<string>();
  const externalsUnion = new Set<string>();
  const assetsUnion = new Set<string>();
  const graphWarnings = new Set<string>();
  for (const { graph } of entryGraphs) {
    for (const f of graph.localFiles) localFilesUnion.add(f);
    for (const f of graph.styleFiles) styleFilesUnion.add(f);
    for (const e of graph.externals) externalsUnion.add(e);
    for (const a of graph.assets) assetsUnion.add(a);
    for (const w of graph.warnings) graphWarnings.add(w);
  }

  const included = new Set<string>([...localFilesUnion, ...styleFilesUnion]);
  if (messagesFile) included.add(messagesFile);
  const base = commonBaseDir([...included]);

  const files: Record<string, string> = {};
  const warnings: string[] = [...graphWarnings];
  const stubbedSpecs = new Set<string>();
  const unstubbableSpecs = new Set<string>();

  for (const abs of localFilesUnion) {
    const sf = project.getSourceFile(abs);
    if (!sf) continue;
    const { edits, stubbed, unstubbable } = computeEdits(sf, abs, base, included, loaded);
    for (const s of stubbed) stubbedSpecs.add(s);
    for (const s of unstubbable) unstubbableSpecs.add(s);
    files[bundlePathOf(abs, base)] = applyEdits(sf.getFullText(), edits);
  }

  for (const spec of stubbedSpecs) {
    files[stubPath(spec)] = stubSource(spec);
  }
  const stubbedModules = [...stubbedSpecs].sort().map((spec) => ({
    specifier: spec,
    replacedWith: stubPath(spec),
    lost: stubbedCapabilityLost(spec),
  }));
  if (unstubbableSpecs.size > 0) {
    warnings.push(
      `Uses server-only Next.js modules that cannot be stubbed: ${[...unstubbableSpecs].join(', ')}.`,
    );
  }

  const unstubbablePackages = new Set([...unstubbableSpecs].map(stubbedPackageOf));
  const droppedPackages = new Set(
    [...stubbedSpecs].map(stubbedPackageOf).filter((p) => !unstubbablePackages.has(p)),
  );

  for (const abs of styleFilesUnion) {
    try {
      files[bundlePathOf(abs, base)] = rofs.readFileSync(abs);
    } catch {
      warnings.push(`Could not read style file: ${abs}`);
    }
  }

  // Deps resolved PER ENTRY against the SAME dropped-packages set, then merged —
  // so a range difference is a real requirement difference, never an artefact.
  const { externalDeps, depConflicts } = mergeExternalDeps(
    entryGraphs.map(({ descriptor, graph }) => ({
      componentId: descriptor.id,
      deps: resolveExternalDeps(graph.externals, droppedPackages, loaded, rofs),
    })),
  );

  for (const asset of assetsUnion) {
    warnings.push(`Asset not inlined (P2): ${path.basename(asset)}`);
  }

  let previewTheme: { path: string; exportName: string } | undefined;
  if (themeRoot && localFilesUnion.has(themeRoot) && loaded.themeRef) {
    previewTheme = { path: bundlePathOf(themeRoot, base), exportName: loaded.themeRef.exportName };
  }
  let previewMessages: string | undefined;
  if (messagesFile) {
    try {
      files[bundlePathOf(messagesFile, base)] = rofs.readFileSync(messagesFile);
      previewMessages = bundlePathOf(messagesFile, base);
    } catch {
      warnings.push(`Could not read messages file: ${messagesFile}`);
    }
  }
  const previewProviders = loaded.contextProviders
    .filter((p) => localFilesUnion.has(p.file))
    .map((p) => ({ path: bundlePathOf(p.file, base), exportName: p.exportName }));

  const dangling = findDanglingImports(files);
  if (dangling.length > 0) {
    const shown = dangling.slice(0, 3);
    const elided = dangling.length - shown.length;
    warnings.push(
      `${dangling.length} unresolved local import(s): ${shown.join(', ')}` +
        (elided > 0 ? ` (+${elided} more; see danglingImports for the full list)` : ''),
    );
  }

  // ONE tokenization of the merged file set: the shared token namespace. A value
  // used in two components' stylesheets gets a single name referenced by both,
  // instead of two `--color-1`s that collide when the set is assembled by hand.
  const tok = tokenizeBundle(files as FileMap);
  const filesWithTokens: Record<string, string> = { ...tok.files, [TOKENS_CSS_PATH]: tok.tokensCss };

  const components: KitComponent[] = entries.map((d) => ({
    id: d.id,
    name: d.name,
    entryPath: bundlePathOf(d.filePath, base),
  }));
  const entryPaths: Record<string, string> = {};
  for (const c of components) entryPaths[c.id] = c.entryPath;

  return {
    files: filesWithTokens as FileMap,
    entryPaths,
    components,
    externalDeps,
    depConflicts,
    tokensCssPath: TOKENS_CSS_PATH,
    tokensCss: tok.tokensCss,
    tokenModel: tok.tokenModel,
    stubbedModules,
    danglingImports: dangling,
    warnings,
    previewTheme,
    previewMessages,
    previewProviders,
  };
}
