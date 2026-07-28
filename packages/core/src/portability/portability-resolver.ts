/**
 * Turns a component into a self-contained PortableBundle: a mirrored subtree of
 * its local files (imports rewritten to bundle-relative paths) plus the external
 * npm deps the destination must install. External imports are left untouched.
 */

import type { Project } from 'ts-morph';
import type { LoadedProject } from '../types/project.js';
import type { ComponentDescriptor } from '../types/component.js';
import type { PortableBundle, FileMap } from '../types/portable-bundle.js';
import { createReadOnlyFs } from '../util/fs-readonly.js';
import { buildImportGraph } from '../graph/import-graph.js';
import { stubPath, stubSource, stubbedCapabilityLost, stubbedPackageOf } from '../sandbox/next-stubs.js';
import {
  applyEdits,
  bundlePathOf,
  commonBaseDir,
  computeEdits,
  findDanglingImports,
  resolveExternalDeps,
} from './portable-common.js';
import { assetModuleKey, inlineAssetFile } from './inline-asset.js';

export function resolvePortability(
  project: Project,
  entry: ComponentDescriptor,
  loaded: LoadedProject,
): PortableBundle {
  // Pass 1: learn the component's external deps so we know whether to also
  // bundle the app's real theme (MUI) and message catalogue (next-intl) for a
  // faithful preview instead of placeholder colors/labels.
  const firstPass = buildImportGraph(project, entry.filePath, loaded);
  const usesMui = [...firstPass.externals].some((d) => d === '@mui/material' || d.startsWith('@mui/'));
  const usesIntl = firstPass.externals.has('next-intl');

  const themeRoot = usesMui && loaded.themeRef ? loaded.themeRef.file : null;
  const messagesFile = usesIntl && loaded.messagesFile ? loaded.messagesFile : null;

  // Pass 2 with the theme as an extra root, so its subtree is bundled too.
  const graph = themeRoot
    ? buildImportGraph(project, entry.filePath, loaded, [themeRoot])
    : firstPass;

  const included = new Set<string>([...graph.localFiles, ...graph.styleFiles]);
  if (messagesFile) included.add(messagesFile);
  const base = commonBaseDir([...included]);
  const rofs = createReadOnlyFs(loaded.rootPath);

  const files: Record<string, string> = {};
  const warnings = [...graph.warnings];

  const stubbedSpecs = new Set<string>();
  const unstubbableSpecs = new Set<string>();

  for (const abs of graph.localFiles) {
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
  // Every substitution is disclosed with the capability it costs. Sorted so the
  // list is stable regardless of the order the graph happened to visit files.
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

  // A package is dropped from the install list only if every one of its imports
  // was stubbed — `next` stays if a server-only `next/*` import remained.
  const unstubbablePackages = new Set([...unstubbableSpecs].map(stubbedPackageOf));
  const droppedPackages = new Set(
    [...stubbedSpecs].map(stubbedPackageOf).filter((p) => !unstubbablePackages.has(p)),
  );

  for (const abs of graph.styleFiles) {
    try {
      files[bundlePathOf(abs, base)] = rofs.readFileSync(abs);
    } catch {
      warnings.push(`Could not read style file: ${abs}`);
    }
  }

  const externalDeps = resolveExternalDeps(graph.externals, droppedPackages, loaded, rofs);

  // Inline each imported asset as a self-contained data-URI module, so the
  // preview and the copied bundle both show the real image instead of a broken
  // one — and the import no longer dangles into a code-only downgrade.
  for (const asset of graph.assets) {
    const result = inlineAssetFile(asset, rofs);
    if ('source' in result) {
      files[assetModuleKey(bundlePathOf(asset, base))] = result.source;
    } else {
      warnings.push(`Asset not inlined — ${result.skip}`);
    }
  }

  // Bundle the real theme / messages so the provider can supply true values.
  let previewTheme: { path: string; exportName: string } | undefined;
  if (themeRoot && graph.localFiles.has(themeRoot) && loaded.themeRef) {
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

  // If the component's subtree already includes a self-contained context
  // provider's module (it consumes that context), wrap the preview in it so the
  // consuming hook finds its value. No extra bundling — the module is present.
  const previewProviders = loaded.contextProviders
    .filter((p) => graph.localFiles.has(p.file))
    .map((p) => ({ path: bundlePathOf(p.file, base), exportName: p.exportName }));

  // The prose warning stays short, but must never read as if it were the whole
  // story: the elision is stated, and `danglingImports` carries every entry.
  const dangling = findDanglingImports(files);
  if (dangling.length > 0) {
    const shown = dangling.slice(0, 3);
    const elided = dangling.length - shown.length;
    warnings.push(
      `${dangling.length} unresolved local import(s): ${shown.join(', ')}` +
        (elided > 0 ? ` (+${elided} more; see danglingImports for the full list)` : ''),
    );
  }

  return {
    files: files as FileMap,
    entryPath: bundlePathOf(entry.filePath, base),
    externalDeps,
    assets: [],
    warnings,
    stubbedModules,
    danglingImports: dangling,
    incomplete: dangling.length > 0,
    previewTheme,
    previewMessages,
    previewProviders,
  };
}
