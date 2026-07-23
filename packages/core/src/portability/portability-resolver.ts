/**
 * Turns a component into a self-contained PortableBundle: a mirrored subtree of
 * its local files (imports rewritten to bundle-relative paths) plus the external
 * npm deps the destination must install. External imports are left untouched.
 */

import { Node, SyntaxKind, type Project, type SourceFile } from 'ts-morph';
import * as path from 'node:path';
import type { LoadedProject } from '../types/project.js';
import type { ComponentDescriptor } from '../types/component.js';
import type { PortableBundle, FileMap } from '../types/portable-bundle.js';
import { toBundlePath } from '../util/paths.js';
import { createReadOnlyFs, type ReadOnlyFs } from '../util/fs-readonly.js';
import { buildImportGraph, isDeferredImportCall } from '../graph/import-graph.js';
import { groupByFile, traceNamedImports } from '../graph/barrel.js';
import {
  isStubbableModule,
  isUnstubbableNextModule,
  stubPath,
  stubSource,
  stubbedCapabilityLost,
  stubbedPackageOf,
} from '../sandbox/next-stubs.js';
import { classifySpecifier, resolveLocalSpecifier, STYLE_EXT, ASSET_EXT } from '../graph/resolve-module.js';

const TEMPLATE_PROVIDED = new Set(['react', 'react-dom']);
const TS_EXT = /\.(tsx?|jsx?|mjs|cjs)$/;

/** Types-only packages: needed to compile, never to run. */
const TYPES_PKG = /^@types\//;

const NEXT_SPECIFIER = /^next(\/|$)/;

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

function readInstalledPkg(
  rofs: ReadOnlyFs,
  root: string,
  name: string,
): Record<string, unknown> | null {
  const manifest = path.join(root, 'node_modules', ...name.split('/'), 'package.json');
  if (!rofs.exists(manifest)) return null;
  try {
    return JSON.parse(rofs.readFileSync(manifest)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Add the peer dependencies of the collected packages that the target actually
 * has installed. A component importing `@mui/material` never imports
 * `@emotion/styled`, but MUI's styled engine requires it at runtime — leave it
 * out and the sandbox cannot resolve the module, so nothing renders at all.
 *
 * Being installed is the test, not being a non-optional peer: MUI marks the
 * emotion peers `optional` (it has a pigment-css alternative), so honouring
 * `optional` would skip exactly the dep that is needed. If the target installed
 * a peer, the target uses it; if it did not, adding it would only break the
 * sandbox install. Walks transitively, since a peer can have peers of its own.
 */
function withInstalledPeers(
  direct: Readonly<Record<string, string>>,
  loaded: LoadedProject,
  rofs: ReadOnlyFs,
): Record<string, string> {
  const deps: Record<string, string> = { ...direct };
  const queue = Object.keys(deps);
  const visited = new Set(queue);

  while (queue.length > 0) {
    const name = queue.shift() as string;
    const manifest = readInstalledPkg(rofs, loaded.rootPath, name);
    const peers = (manifest?.peerDependencies ?? {}) as Record<string, string>;

    for (const peer of Object.keys(peers)) {
      if (visited.has(peer) || TEMPLATE_PROVIDED.has(peer) || TYPES_PKG.test(peer)) continue;
      // A peer that can't run in the sandbox (next) must never be added: the
      // package's own imports are stubbed, and adding the real dep would put the
      // component back on the code-only pile. Skipping it — not its parent — is
      // right: the parent (next-intl, @sentry/nextjs) may still work standalone.
      if (NEXT_SPECIFIER.test(peer)) continue;
      const peerManifest = readInstalledPkg(rofs, loaded.rootPath, peer);
      if (!peerManifest) continue;

      visited.add(peer);
      const installed = peerManifest.version;
      deps[peer] =
        loaded.pkg.dependencies[peer] ??
        loaded.pkg.devDependencies[peer] ??
        (typeof installed === 'string' ? `^${installed}` : 'latest');
      queue.push(peer);
    }
  }

  return deps;
}

/** Remove dropped (stubbed) packages a transitive peer walk may have re-added. */
function dropStubbed(
  deps: Record<string, string>,
  dropped: ReadonlySet<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, version] of Object.entries(deps)) {
    if (!dropped.has(name)) out[name] = version;
  }
  return out;
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
/**
 * Remove block and line comments so import-like text inside them (JSDoc usage
 * examples) isn't mistaken for a real import edge. Good enough for the dangling
 * heuristic — worst case a genuine dangling import goes unflagged and esbuild
 * reports it at build time instead.
 */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

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
    // Strip comments first: import examples in JSDoc (`* import x from '../y'`)
    // are documentation, not real edges, and would otherwise be flagged as
    // dangling and wrongly mark the whole bundle incomplete → code-only.
    const stripped = stripComments(code);
    // matchAll clones the global regex per call, so no stale lastIndex leaks
    // between files — the reason the old exec loop had to reset it by hand.
    for (const match of stripped.matchAll(SPECIFIER_RE)) {
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

interface EditResult {
  readonly edits: Edit[];
  /** `next/*` specifiers rewritten to a local stub. */
  readonly stubbed: Set<string>;
  /** `next/*` specifiers with no honest stub — `next` stays a real dep. */
  readonly unstubbable: Set<string>;
}

function computeEdits(
  sf: SourceFile,
  fileAbs: string,
  base: string,
  included: ReadonlySet<string>,
  loaded: LoadedProject,
): EditResult {
  const edits: Edit[] = [];
  const stubbed = new Set<string>();
  const unstubbable = new Set<string>();
  const fromBundle = bundlePathOf(fileAbs, base);

  // Point imports of sandbox-hostile modules (next/*, packages that hard-require
  // the Next runtime like @sentry/nextjs) at local stubs, so the real dependency
  // leaves the install list and the component renders instead of failing to load.
  for (const decl of [...sf.getImportDeclarations(), ...sf.getExportDeclarations()]) {
    const specNode = decl.getModuleSpecifier();
    const spec = decl.getModuleSpecifierValue?.();
    if (!specNode || !spec) continue;

    if (isUnstubbableNextModule(spec)) {
      unstubbable.add(spec);
      continue;
    }
    if (!isStubbableModule(spec)) continue;
    stubbed.add(spec);
    const rel = relativeSpecifier(fromBundle, stubPath(spec));
    edits.push({ start: specNode.getStart(), end: specNode.getEnd(), text: `'${rel}'` });
  }

  // Imports the graph tree-shook past a barrel must be re-pointed at the files
  // it actually pulled in, or they would resolve to a module the bundle omits.
  for (const imp of sf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue();
    if (classifySpecifier(spec, loaded) === 'external') continue;

    const traced = traceNamedImports(imp, loaded);
    if (!traced || !traced.every((t) => included.has(t.file))) continue;

    const prefix = imp.isTypeOnly() ? 'type ' : '';
    const text = [...groupByFile(traced)]
      .map(([file, bindings]) => {
        const rel = relativeSpecifier(fromBundle, bundlePathOf(file, base));
        return `import ${prefix}{ ${bindings.map((b) => b.binding).join(', ')} } from '${rel}';`;
      })
      .join('\n');
    edits.push({ start: imp.getStart(), end: imp.getEnd(), text });
  }

  const decls = [...sf.getImportDeclarations(), ...sf.getExportDeclarations()];
  for (const decl of decls) {
    const specNode = decl.getModuleSpecifier();
    const spec = decl.getModuleSpecifierValue?.();
    if (!specNode || !spec) continue;
    if (classifySpecifier(spec, loaded) === 'external') continue;

    // Already replaced wholesale by the tree-shaking pass above.
    if (edits.some((e) => e.start <= decl.getStart() && e.end >= decl.getEnd())) continue;

    const targetAbs = resolveTarget(spec, fileAbs, sf, loaded);
    if (!targetAbs || !included.has(targetAbs)) continue; // external boundary — leave as-is

    const newSpec = relativeSpecifier(fromBundle, bundlePathOf(targetAbs, base));
    edits.push({ start: specNode.getStart(), end: specNode.getEnd(), text: `'${newSpec}'` });
  }

  // Deferred `import('...')` / `require('...')` string args, rewritten like
  // static ones so they point at the bundled copy, not the target's layout.
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isDeferredImportCall(call)) continue;
    const arg = call.getArguments()[0];
    if (!arg || !Node.isStringLiteral(arg)) continue;
    const spec = arg.getLiteralValue();
    if (classifySpecifier(spec, loaded) === 'external') continue;
    const targetAbs = resolveTarget(spec, fileAbs, sf, loaded);
    if (!targetAbs || !included.has(targetAbs)) continue;
    const newSpec = relativeSpecifier(fromBundle, bundlePathOf(targetAbs, base));
    edits.push({ start: arg.getStart(), end: arg.getEnd(), text: `'${newSpec}'` });
  }
  return { edits, stubbed, unstubbable };
}

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

  const directDeps: Record<string, string> = {};
  for (const name of graph.externals) {
    if (TEMPLATE_PROVIDED.has(name)) continue;
    // Fully-stubbed packages (next, @sentry/nextjs, …) were swapped for local
    // stubs, so the real package — which the sandbox can't install — is dropped.
    if (droppedPackages.has(name)) continue;
    directDeps[name] =
      loaded.pkg.dependencies[name] ?? loaded.pkg.devDependencies[name] ?? 'latest';
  }
  const externalDeps = dropStubbed(withInstalledPeers(directDeps, loaded, rofs), droppedPackages);

  for (const asset of graph.assets) {
    warnings.push(`Asset not inlined (P2): ${path.basename(asset)}`);
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
