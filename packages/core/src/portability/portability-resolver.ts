/**
 * Turns a component into a self-contained PortableBundle: a mirrored subtree of
 * its local files (imports rewritten to bundle-relative paths) plus the external
 * npm deps the destination must install. External imports are left untouched.
 */

import type { Project, SourceFile } from 'ts-morph';
import * as path from 'node:path';
import type { LoadedProject } from '../types/project.js';
import type { ComponentDescriptor } from '../types/component.js';
import type { PortableBundle, FileMap } from '../types/portable-bundle.js';
import { toBundlePath } from '../util/paths.js';
import { createReadOnlyFs } from '../util/fs-readonly.js';
import { buildImportGraph } from '../graph/import-graph.js';
import { classifySpecifier, resolveLocalSpecifier, STYLE_EXT, ASSET_EXT } from '../graph/resolve-module.js';

const TEMPLATE_PROVIDED = new Set(['react', 'react-dom']);
const TS_EXT = /\.(tsx?|jsx?|mjs|cjs)$/;

/**
 * All extracted files are mirrored under this prefix so a component named
 * `index.tsx` (a very common folder-per-component convention) can never collide
 * with the sandbox's reserved `/index.tsx` entry or `/tokens.css`.
 */
const BUNDLE_ROOT = '/src';

const RESOLVE_EXTS = ['', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.css', '.scss', '.sass', '.less'];
const SPECIFIER_RE = /(?:from|import)\s*['"]([^'"]+)['"]/g;

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function commonBaseDir(files: readonly string[]): string {
  if (files.length === 0) return path.sep;
  const dirs = files.map((f) => path.dirname(f).split(path.sep));
  let common = dirs[0] as string[];
  for (const parts of dirs.slice(1)) {
    let i = 0;
    while (i < common.length && i < parts.length && common[i] === parts[i]) i += 1;
    common = common.slice(0, i);
  }
  return common.join(path.sep) || path.sep;
}

function bundlePathOf(abs: string, base: string): string {
  return `${BUNDLE_ROOT}${toBundlePath(path.relative(base, abs))}`;
}

/**
 * Verify every relative import in the emitted files resolves to a file that is
 * actually in the bundle. Catches dropped modules (mixed JS/TS, budget
 * truncation, unresolved aliases) so the sandbox can downgrade to code-only
 * instead of rendering a broken bundle.
 */
function findDanglingImports(files: Record<string, string>): string[] {
  const keys = new Set(Object.keys(files));
  const dangling: string[] = [];
  const resolves = (fromFile: string, spec: string): boolean => {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
    return RESOLVE_EXTS.some(
      (ext) => keys.has(base + ext) || keys.has(path.posix.join(base, `index${ext}`)),
    );
  };
  for (const [file, code] of Object.entries(files)) {
    if (!TS_EXT.test(file)) continue;
    SPECIFIER_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SPECIFIER_RE.exec(code)) !== null) {
      const spec = match[1] as string;
      if (!spec.startsWith('.')) continue; // external/bare — resolved by Sandpack
      if (!resolves(file, spec)) dangling.push(`${file} → ${spec}`);
    }
  }
  return dangling;
}

function relativeSpecifier(fromBundle: string, toBundle: string): string {
  let rel = path.relative(path.posix.dirname(fromBundle), toBundle).split(path.sep).join('/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  if (TS_EXT.test(rel)) rel = rel.replace(TS_EXT, '');
  return rel;
}

function applyEdits(text: string, edits: Edit[]): string {
  let out = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}

function resolveTarget(
  spec: string,
  fromFile: string,
  sf: SourceFile,
  loaded: LoadedProject,
): string | null {
  if (STYLE_EXT.test(spec) || ASSET_EXT.test(spec)) {
    return resolveLocalSpecifier(spec, fromFile, loaded);
  }
  const declSf = sf
    .getImportDeclarations()
    .find((d) => d.getModuleSpecifierValue() === spec)
    ?.getModuleSpecifierSourceFile();
  return declSf?.getFilePath() ?? resolveLocalSpecifier(spec, fromFile, loaded);
}

function computeEdits(
  sf: SourceFile,
  fileAbs: string,
  base: string,
  included: ReadonlySet<string>,
  loaded: LoadedProject,
): Edit[] {
  const edits: Edit[] = [];
  const fromBundle = bundlePathOf(fileAbs, base);

  const decls = [...sf.getImportDeclarations(), ...sf.getExportDeclarations()];
  for (const decl of decls) {
    const specNode = decl.getModuleSpecifier();
    const spec = decl.getModuleSpecifierValue?.();
    if (!specNode || !spec) continue;
    if (classifySpecifier(spec, loaded) === 'external') continue;

    const targetAbs = resolveTarget(spec, fileAbs, sf, loaded);
    if (!targetAbs || !included.has(targetAbs)) continue; // external boundary — leave as-is

    const newSpec = relativeSpecifier(fromBundle, bundlePathOf(targetAbs, base));
    edits.push({ start: specNode.getStart(), end: specNode.getEnd(), text: `'${newSpec}'` });
  }
  return edits;
}

export function resolvePortability(
  project: Project,
  entry: ComponentDescriptor,
  loaded: LoadedProject,
): PortableBundle {
  const graph = buildImportGraph(project, entry.filePath, loaded);
  const included = new Set<string>([...graph.localFiles, ...graph.styleFiles]);
  const base = commonBaseDir([...included]);
  const rofs = createReadOnlyFs(loaded.rootPath);

  const files: Record<string, string> = {};
  const warnings = [...graph.warnings];

  for (const abs of graph.localFiles) {
    const sf = project.getSourceFile(abs);
    if (!sf) continue;
    const edits = computeEdits(sf, abs, base, included, loaded);
    files[bundlePathOf(abs, base)] = applyEdits(sf.getFullText(), edits);
  }

  for (const abs of graph.styleFiles) {
    try {
      files[bundlePathOf(abs, base)] = rofs.readFileSync(abs);
    } catch {
      warnings.push(`Could not read style file: ${abs}`);
    }
  }

  const externalDeps: Record<string, string> = {};
  for (const name of graph.externals) {
    if (TEMPLATE_PROVIDED.has(name)) continue;
    externalDeps[name] =
      loaded.pkg.dependencies[name] ?? loaded.pkg.devDependencies[name] ?? 'latest';
  }

  for (const asset of graph.assets) {
    warnings.push(`Asset not inlined (P2): ${path.basename(asset)}`);
  }

  const dangling = findDanglingImports(files);
  if (dangling.length > 0) {
    warnings.push(`${dangling.length} unresolved local import(s): ${dangling.slice(0, 3).join(', ')}`);
  }

  return {
    files: files as FileMap,
    entryPath: bundlePathOf(entry.filePath, base),
    externalDeps,
    assets: [],
    warnings,
    incomplete: dangling.length > 0,
  };
}
