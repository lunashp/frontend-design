/**
 * Static, literal-only mining of a MUI-style `createTheme({...})` object literal
 * into `derived` design tokens + colorScheme presets.
 *
 * WHY static & literal-only: the target theme file is NEVER executed or imported
 * — that would run target code and break the read-only invariant. We read the
 * object literal via ts-morph and emit a token ONLY for a value written as a
 * literal (string / number / boolean / template-without-substitution). A value
 * that is a variable ref, spread, call, or template-with-substitution is
 * UNRESOLVED: it is counted and its dotted path disclosed, never guessed. A
 * fabricated token is worse than an absent one — see the honesty bar.
 *
 * Mined values are DISPLAY / reference tokens and the seed for the copyable
 * themed output; they are not claimed to live-edit a MUI preview (MUI reads its
 * theme object, not CSS vars). `source: 'derived'` marks them as such.
 */

import { Node, Project, SyntaxKind } from 'ts-morph';
import type { Expression, ObjectLiteralExpression, SourceFile, Node as TsNode } from 'ts-morph';
import type { ThemeRef } from '../types/project.js';
import type {
  ThemeMiningDisclosure,
  Token,
  TokenCategory,
  TokenUsage,
} from '../types/token-model.js';
import { isColor, isSingleLength, normalizeColor } from '../tokenize/color.js';
import { isFontStack } from '../tokenize/value-shape.js';
import { shortHash } from '../util/paths.js';

/** The design-relevant top-level sections we descend for base tokens. Anything
 * else (zIndex, transitions, components overrides, …) is out of scope and is
 * neither mined nor counted as unresolved — it is not a design token. */
const BASE_SECTIONS = new Set(['palette', 'typography', 'shape', 'spacing']);

/** Preference when synthesizing a canonical token set from colorSchemes. */
const PREFERRED_SCHEME = 'light';

export interface ThemeMiningResult {
  readonly tokens: readonly Token[];
  /** Named presets from colorSchemes: name -> (tokenId -> value). Undefined
   * unless there are at least two named schemes to switch between. */
  readonly themes?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly disclosure: ThemeMiningDisclosure;
}

/** A literal leaf gathered during the walk, before it becomes a Token. */
interface MinedLeaf {
  readonly path: string;
  readonly value: string;
  readonly raw: string;
  readonly line: number;
}

/** Read a node's literal text, or null when it is not a literal. */
function readLiteral(node: Expression): string | null {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  if (Node.isNumericLiteral(node)) return node.getText();
  const kind = node.getKind();
  if (kind === SyntaxKind.TrueKeyword) return 'true';
  if (kind === SyntaxKind.FalseKeyword) return 'false';
  // Negative numbers are `PrefixUnaryExpression(-, NumericLiteral)`.
  if (Node.isPrefixUnaryExpression(node)) {
    const operand = node.getOperand();
    if (node.getOperatorToken() === SyntaxKind.MinusToken && Node.isNumericLiteral(operand)) {
      return `-${operand.getText()}`;
    }
  }
  return null;
}

/** A property-assignment key with any surrounding quotes stripped. */
function propKey(name: string): string {
  return name.replace(/^['"]|['"]$/g, '');
}

/**
 * Walk an object literal, calling `onLeaf` for every literal value reached and
 * `onUnresolved` for every value that is not a literal (and not a nested object
 * to recurse into). `basePath` prefixes every emitted dotted path.
 */
function walkObject(
  basePath: string,
  obj: ObjectLiteralExpression,
  onLeaf: (leaf: MinedLeaf) => void,
  onUnresolved: (path: string) => void,
): void {
  for (const prop of obj.getProperties()) {
    if (Node.isPropertyAssignment(prop)) {
      const key = propKey(prop.getName());
      const path = basePath ? `${basePath}.${key}` : key;
      walkValue(path, prop.getInitializerOrThrow(), onLeaf, onUnresolved);
    } else if (Node.isShorthandPropertyAssignment(prop)) {
      // `{ primary }` — the value is an identifier we will not resolve.
      const key = propKey(prop.getName());
      onUnresolved(basePath ? `${basePath}.${key}` : key);
    } else if (Node.isSpreadAssignment(prop)) {
      onUnresolved(basePath ? `${basePath}.…spread` : '…spread');
    }
  }
}

function walkValue(
  path: string,
  node: Expression,
  onLeaf: (leaf: MinedLeaf) => void,
  onUnresolved: (path: string) => void,
): void {
  if (Node.isObjectLiteralExpression(node)) {
    walkObject(path, node, onLeaf, onUnresolved);
    return;
  }
  const literal = readLiteral(node);
  if (literal !== null) {
    onLeaf({ path, value: literal, raw: node.getText(), line: node.getStartLineNumber() });
    return;
  }
  onUnresolved(path);
}

/** Category for a mined value, by value shape first then path hint. */
function categorizeMined(path: string, value: string): TokenCategory {
  if (isColor(value)) return 'color';
  const p = path.toLowerCase();
  if (p.includes('radius')) return 'radius';
  if (p.includes('spacing')) return 'spacing';
  if (p.includes('fontsize')) return 'typography';
  if (isSingleLength(value)) return 'size';
  if (isFontStack(value)) return 'typography';
  return 'other';
}

/** Normalize a value to its stored form: canonical hex for colors, else verbatim. */
function normalizeValue(value: string): string {
  return isColor(value) ? (normalizeColor(value) ?? value) : value;
}

/** The `--kebab-case` CSS variable name for a dotted token path. */
function varNameFor(path: string): string {
  return `--${path.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
}

/** Locate the ObjectLiteral argument of `export const <name> = createTheme(<arg>)`. */
type ThemeArg =
  | { readonly kind: 'object'; readonly node: ObjectLiteralExpression }
  | { readonly kind: 'empty' }
  | { readonly kind: 'opaque'; readonly text: string }
  | { readonly kind: 'none' };

function locateThemeArg(init: TsNode | undefined): ThemeArg {
  if (!init || !Node.isCallExpression(init)) return { kind: 'none' };
  if (!/createTheme$/.test(init.getExpression().getText())) return { kind: 'none' };
  const first = init.getArguments()[0];
  if (!first) return { kind: 'empty' };
  if (Node.isObjectLiteralExpression(first)) return { kind: 'object', node: first };
  // `createTheme(baseOptions)` — the options are a ref/spread we cannot read.
  return { kind: 'opaque', text: first.getText() };
}

/**
 * Mine a located theme reference into derived tokens + presets. Returns null
 * only when the file is unreadable or the export is not a `createTheme` call —
 * a real but unmineable theme still returns a result with an honest disclosure.
 */
export function mineThemeTokens(themeRef: ThemeRef): ThemeMiningResult | null {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: false },
  });

  let sourceFile: SourceFile;
  try {
    sourceFile = project.addSourceFileAtPath(themeRef.file);
  } catch {
    return null; // file gone / unreadable — no mining, caller falls back
  }

  const decl = sourceFile.getVariableDeclaration(themeRef.exportName);
  if (!decl) return null;

  const arg = locateThemeArg(decl.getInitializer());
  if (arg.kind === 'none') return null;

  const emptyDisclosure = (unresolvedPaths: readonly string[]): ThemeMiningDisclosure => ({
    file: themeRef.file,
    exportName: themeRef.exportName,
    resolved: 0,
    unresolved: unresolvedPaths.length,
    unresolvedPaths,
  });

  if (arg.kind === 'empty') return { tokens: [], disclosure: emptyDisclosure([]) };
  if (arg.kind === 'opaque') return { tokens: [], disclosure: emptyDisclosure([arg.text]) };

  return mineObject(arg.node, themeRef);
}

function mineObject(root: ObjectLiteralExpression, themeRef: ThemeRef): ThemeMiningResult {
  const leavesByPath = new Map<string, MinedLeaf>();
  const unresolved: string[] = [];
  // Per-scheme normalized `path -> value`, e.g. schemes.dark = { 'palette.primary.main': '#90caf9' }.
  const schemes = new Map<string, Map<string, string>>();

  const recordLeaf = (leaf: MinedLeaf): void => {
    // First writer wins — a later duplicate path is a deliberate override the
    // static reader cannot order, so we keep the first (source order) value.
    if (!leavesByPath.has(leaf.path)) leavesByPath.set(leaf.path, leaf);
  };

  for (const prop of root.getProperties()) {
    if (Node.isSpreadAssignment(prop)) {
      unresolved.push('…spread');
      continue;
    }
    if (!Node.isPropertyAssignment(prop)) continue;
    const key = propKey(prop.getName());
    const value = prop.getInitializerOrThrow();

    if (key === 'colorSchemes') {
      mineColorSchemes(value, schemes, unresolved);
      continue;
    }
    if (BASE_SECTIONS.has(key)) {
      walkValue(key, value, recordLeaf, (p) => unresolved.push(p));
    }
    // Any other top-level key is out of scope — not a design token, not counted.
  }

  // MUI v6+ themes often carry NO base palette, only colorSchemes. Synthesize a
  // canonical token from the preferred scheme so there is something to theme.
  const preferred = schemes.get(PREFERRED_SCHEME) ?? [...schemes.values()][0];
  if (preferred) {
    for (const [path, value] of preferred) {
      if (!leavesByPath.has(path)) {
        leavesByPath.set(path, { path, value, raw: value, line: 0 });
      }
    }
  }

  const tokens = buildTokens(leavesByPath, themeRef);
  const themes = buildThemes(schemes, tokens);

  const disclosure: ThemeMiningDisclosure = {
    file: themeRef.file,
    exportName: themeRef.exportName,
    resolved: tokens.length,
    unresolved: unresolved.length,
    unresolvedPaths: unresolved,
  };

  return themes ? { tokens, themes, disclosure } : { tokens, disclosure };
}

function mineColorSchemes(
  node: Expression,
  schemes: Map<string, Map<string, string>>,
  unresolved: string[],
): void {
  if (!Node.isObjectLiteralExpression(node)) {
    unresolved.push('colorSchemes');
    return;
  }
  for (const prop of node.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue;
    const name = propKey(prop.getName());
    const value = prop.getInitializerOrThrow();
    if (!Node.isObjectLiteralExpression(value)) {
      unresolved.push(`colorSchemes.${name}`);
      continue;
    }
    const map = new Map<string, string>();
    // Walk with an empty base so paths align with the base sections
    // (`colorSchemes.dark.palette.primary.main` -> `palette.primary.main`).
    walkObject(
      '',
      value,
      (leaf) => map.set(leaf.path, normalizeValue(leaf.value)),
      (p) => unresolved.push(`colorSchemes.${name}.${p}`),
    );
    schemes.set(name, map);
  }
}

function buildTokens(leaves: Map<string, MinedLeaf>, themeRef: ThemeRef): Token[] {
  return [...leaves.values()].map((leaf) => {
    const category = categorizeMined(leaf.path, leaf.value);
    const usage: TokenUsage = {
      file: themeRef.file,
      line: leaf.line,
      property: leaf.path.split('.').pop() ?? leaf.path,
      selector: themeRef.exportName,
    };
    return {
      id: shortHash(`derived:${leaf.path}`),
      name: varNameFor(leaf.path),
      displayName: leaf.path,
      category,
      value: normalizeValue(leaf.value),
      fallback: leaf.raw,
      usages: [usage],
      source: 'derived' as const,
    };
  });
}

/** A themes preset map, keyed by token id, or undefined when < 2 schemes. */
function buildThemes(
  schemes: Map<string, Map<string, string>>,
  tokens: readonly Token[],
): Record<string, Record<string, string>> | undefined {
  if (schemes.size < 2) return undefined;
  const idByPath = new Map(tokens.map((t) => [t.displayName, t.id]));
  const built: Record<string, Record<string, string>> = {};
  for (const [name, map] of schemes) {
    const entry: Record<string, string> = {};
    for (const [path, value] of map) {
      const id = idByPath.get(path);
      if (id) entry[id] = value; // only paths with a canonical token can be re-themed
    }
    if (Object.keys(entry).length > 0) built[name] = entry;
  }
  return Object.keys(built).length >= 2 ? built : undefined;
}
