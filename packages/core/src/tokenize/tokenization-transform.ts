/**
 * Extracts color/size/shadow values from the bundle's CSS, replaces each with a
 * `var(--token, <literal-fallback>)` reference, and emits a `tokens.css` with the
 * `:root` defaults. The rewritten CSS keeps its literal fallback, so the ported
 * code renders even without the token file — and is re-themeable when it's present.
 *
 * Author-defined custom properties in a top-level `:root` block are the most
 * design-system-like construct a stylesheet has, so they are adopted as tokens
 * under THEIR OWN name and hoisted into `tokens.css` (see ./custom-properties.ts
 * for why hoisting, not rewriting, is the only correct move).
 *
 * CSS Modules / plain CSS are tokenized here; CSS-in-JS / inline styles are
 * carried as-is (customized via props instead).
 */

import postcss from 'postcss';
import type { Rule } from 'postcss';
import type { FileMap } from '../types/portable-bundle.js';
import type { Token, TokenCategory, TokenModel, TokenUsage } from '../types/token-model.js';
import { shortHash } from '../util/paths.js';
import { categoryFor, categoryForCustomProperty, normalizeStandardValue } from './categorize.js';
import { normalizeColor } from './color.js';
import {
  applyBareVarFallbacks,
  displayNameForCustomProperty,
  isTopLevelRootDecl,
} from './custom-properties.js';
import { tokenizeStyledTemplates } from './styled-css.js';
import { collapseWhitespace, containsVar } from './value-shape.js';

export const TOKENS_CSS_PATH = '/tokens.css';

interface MutableToken {
  id: string;
  name: string;
  displayName: string;
  category: TokenCategory;
  value: string;
  fallback: string;
  usages: TokenUsage[];
}

export interface TokenizeResult {
  /** Bundle files with CSS values rewritten to `var(--token, fallback)`. */
  readonly files: FileMap;
  readonly tokenModel: TokenModel;
  /** `:root { … }` defaults, written to `/tokens.css`. */
  readonly tokensCss: string;
}

const CATEGORY_LABEL: Record<TokenCategory, string> = {
  color: 'Color',
  size: 'Size',
  spacing: 'Spacing',
  radius: 'Radius',
  typography: 'Font size',
  shadow: 'Shadow',
  other: 'Value',
};

function isCssFile(path: string): boolean {
  return /\.(css|scss|sass|less)$/.test(path);
}

function selectorOf(decl: postcss.Declaration): string {
  const parent = decl.parent as Rule | undefined;
  return parent && 'selector' in parent ? parent.selector : '';
}

export function tokenizeBundle(files: FileMap): TokenizeResult {
  const tokens = new Map<string, MutableToken>();
  const counters: Record<TokenCategory, number> = {
    color: 0,
    size: 0,
    spacing: 0,
    radius: 0,
    typography: 0,
    shadow: 0,
    other: 0,
  };
  const outFiles: Record<string, string> = { ...files };

  // Parse every stylesheet up front: a generated name (`--color-1`) must not
  // collide with an author-defined property of the same name, or `tokens.css`
  // would carry two conflicting declarations and the last one would silently win.
  const roots = new Map<string, postcss.Root>();
  const takenNames = new Set<string>();
  for (const [path, content] of Object.entries(files)) {
    if (!isCssFile(path)) continue;
    let root: postcss.Root;
    try {
      root = postcss.parse(content);
    } catch {
      continue; // unparseable (e.g. exotic scss) — leave as-is
    }
    roots.set(path, root);
    root.walkDecls((decl) => {
      if (decl.prop.startsWith('--')) takenNames.add(decl.prop);
    });
  }

  function generateName(category: TokenCategory): { name: string; ordinal: number } {
    let name: string;
    do {
      counters[category] += 1;
      name = `--${category}-${counters[category]}`;
    } while (takenNames.has(name));
    takenNames.add(name);
    return { name, ordinal: counters[category] };
  }

  // Reuse-or-create a standard token and record a usage. Shared by the CSS pass
  // and the styled/emotion pass so a value used on either surface collapses to
  // ONE token under one name — the whole point of a single bundle namespace.
  function mintStandard(
    category: TokenCategory,
    normalized: string,
    rawValue: string,
    usage: TokenUsage,
  ): string {
    const key = `${category}:${normalized}`;
    let token = tokens.get(key);
    if (!token) {
      const { name, ordinal } = generateName(category);
      token = {
        id: shortHash(key),
        name,
        displayName: `${CATEGORY_LABEL[category]} ${ordinal}`,
        category,
        value: normalized,
        fallback: rawValue,
        usages: [],
      };
      tokens.set(key, token);
    }
    token.usages.push(usage);
    return token.name;
  }

  /** Custom properties adopted as tokens: name -> literal, for var() fallbacks. */
  const hoisted = new Map<string, string>();

  for (const [path, root] of roots) {
    const emptiedRules = new Set<Rule>();
    root.walkDecls((decl) => {
      const rawValue = decl.value.trim();
      // An aliasing value (`var(--other)`) is a reference, not a literal:
      // tokenizing it would duplicate the alias or build a var() cycle.
      if (containsVar(rawValue)) return;
      const usage: TokenUsage = {
        file: path,
        line: decl.source?.start?.line ?? 0,
        property: decl.prop,
        selector: selectorOf(decl),
      };

      if (decl.prop.startsWith('--')) {
        if (!isTopLevelRootDecl(decl)) return;
        const category = categoryForCustomProperty(decl.prop, rawValue);
        if (category === 'other') return;
        const normalized =
          category === 'color'
            ? (normalizeColor(rawValue) ?? collapseWhitespace(rawValue))
            : collapseWhitespace(rawValue);

        const key = `custom:${decl.prop}`;
        const existing = tokens.get(key);
        // A second `:root` declaration of the same name with a DIFFERENT value is
        // a deliberate later override; hoisting it would change what renders.
        if (existing && existing.value !== normalized) return;
        const token = existing ?? {
          id: shortHash(key),
          name: decl.prop,
          displayName: displayNameForCustomProperty(decl.prop),
          category,
          value: normalized,
          fallback: rawValue,
          usages: [],
        };
        if (!existing) tokens.set(key, token);
        token.usages.push(usage);
        hoisted.set(decl.prop, normalized);

        // The declaration MOVES to tokens.css — it is never rewritten in place,
        // which is what keeps the token from pointing at itself.
        const rule = decl.parent as Rule | undefined;
        decl.remove();
        if (rule && rule.nodes.length === 0) emptiedRules.add(rule);
        return;
      }

      const category = categoryFor(decl.prop);
      const normalized = normalizeStandardValue(category, rawValue);
      if (!normalized) return;
      const name = mintStandard(category, normalized, rawValue, usage);
      decl.value = `var(${name}, ${rawValue})`;
    });

    for (const rule of emptiedRules) rule.remove();
    outFiles[path] = root.toString();
  }

  // Styled/emotion pass runs AFTER the CSS pass so a value already tokenized from
  // a stylesheet reuses that token; a value seen only in a styled template mints
  // a fresh name via the same generator. It rewrites its own bundle .tsx copies.
  const styled = tokenizeStyledTemplates(outFiles, mintStandard);
  for (const [path, content] of Object.entries(styled.files)) outFiles[path] = content;

  if (hoisted.size > 0) {
    for (const path of roots.keys()) {
      outFiles[path] = applyBareVarFallbacks(outFiles[path] as string, hoisted);
    }
  }

  const tokenList: Token[] = [...tokens.values()].map((t) => ({
    ...t,
    source: 'extracted' as const,
  }));

  return {
    files: outFiles as FileMap,
    tokenModel: { tokens: tokenList },
    tokensCss: emitTokensCss(tokenList),
  };
}

/** Emit a `:root` block from token values (optionally with overrides applied). */
export function emitTokensCss(
  tokens: readonly Token[],
  overrides: Readonly<Record<string, string>> = {},
): string {
  if (tokens.length === 0) return ':root {\n}\n';
  const lines = tokens.map((t) => `  ${t.name}: ${overrides[t.id] ?? t.value};`);
  return `:root {\n${lines.join('\n')}\n}\n`;
}
