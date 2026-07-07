/**
 * Walks a component's local import subtree with ts-morph. Classifies each edge
 * (local TS / local style / external npm / asset) and stops at the node_modules
 * boundary. A node budget prevents a barrel or organism from dragging in an
 * unbounded subtree.
 */

import type { Project, SourceFile } from 'ts-morph';
import type { LoadedProject } from '../types/project.js';
import {
  classifySpecifier,
  isInProjectSrc,
  packageName,
  resolveLocalSpecifier,
  STYLE_EXT,
  ASSET_EXT,
} from './resolve-module.js';

const MAX_LOCAL_FILES = 60;

export interface ImportGraph {
  readonly entryFile: string;
  readonly localFiles: ReadonlySet<string>;
  readonly styleFiles: ReadonlySet<string>;
  readonly externals: ReadonlySet<string>;
  readonly assets: ReadonlySet<string>;
  readonly warnings: readonly string[];
}

interface SpecRef {
  readonly spec: string;
  targetSourceFile(): SourceFile | undefined;
}

function specRefs(sf: SourceFile): SpecRef[] {
  const refs: SpecRef[] = [];
  for (const imp of sf.getImportDeclarations()) {
    refs.push({ spec: imp.getModuleSpecifierValue(), targetSourceFile: () => imp.getModuleSpecifierSourceFile() });
  }
  for (const exp of sf.getExportDeclarations()) {
    const spec = exp.getModuleSpecifierValue();
    if (spec) {
      refs.push({ spec, targetSourceFile: () => exp.getModuleSpecifierSourceFile() });
    }
  }
  return refs;
}

export function buildImportGraph(
  project: Project,
  entryFile: string,
  loaded: LoadedProject,
): ImportGraph {
  const localFiles = new Set<string>();
  const styleFiles = new Set<string>();
  const externals = new Set<string>();
  const assets = new Set<string>();
  const warnings: string[] = [];

  const visited = new Set<string>();
  const queue: string[] = [entryFile];

  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (visited.has(file)) continue;
    visited.add(file);

    const sf = project.getSourceFile(file);
    if (!sf) {
      warnings.push(`Could not load ${file}`);
      continue;
    }
    localFiles.add(file);

    if (localFiles.size > MAX_LOCAL_FILES) {
      warnings.push(`Subtree exceeded ${MAX_LOCAL_FILES} files; stopped to keep the bundle portable`);
      break;
    }

    for (const ref of specRefs(sf)) {
      const kind = classifySpecifier(ref.spec, loaded);

      if (kind === 'external') {
        externals.add(packageName(ref.spec));
        continue;
      }

      // Styles / assets: ts-morph won't resolve these — resolve on disk.
      if (STYLE_EXT.test(ref.spec) || ASSET_EXT.test(ref.spec)) {
        const abs = resolveLocalSpecifier(ref.spec, file, loaded);
        if (!abs) {
          warnings.push(`Unresolved asset: ${ref.spec}`);
        } else if (STYLE_EXT.test(abs)) {
          styleFiles.add(abs);
        } else {
          assets.add(abs);
        }
        continue;
      }

      // TS/JS module: prefer ts-morph's resolver (handles tsconfig paths).
      const target = ref.targetSourceFile();
      const abs = target?.getFilePath() ?? resolveLocalSpecifier(ref.spec, file, loaded);

      if (!abs) {
        // Alias/relative that didn't resolve to a known file — leave as external boundary.
        externals.add(packageName(ref.spec));
        warnings.push(`Left unresolved import as external boundary: ${ref.spec}`);
        continue;
      }

      if (abs.endsWith('.d.ts')) continue;
      if (isInProjectSrc(abs, loaded)) {
        queue.push(abs);
      } else {
        externals.add(packageName(ref.spec));
      }
    }
  }

  return { entryFile, localFiles, styleFiles, externals, assets, warnings };
}
