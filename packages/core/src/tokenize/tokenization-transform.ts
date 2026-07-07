/**
 * Extracts color/size values from the bundle's CSS, replaces each with a
 * `var(--token, <literal-fallback>)` reference, and emits a `tokens.css` with the
 * `:root` defaults. The rewritten CSS keeps its literal fallback, so the ported
 * code renders even without the token file — and is re-themeable when it's present.
 *
 * CSS Modules / plain CSS are tokenized here; CSS-in-JS / inline styles are
 * carried as-is (customized via props instead).
 */

import postcss from 'postcss';
import type { Rule } from 'postcss';
import type { FileMap } from '../types/portable-bundle.js';
import type { Token, TokenCategory, TokenModel, TokenUsage } from '../types/token-model.js';
import { shortHash } from '../util/paths.js';
import { categoryFor, LENGTH_CATEGORIES } from './categorize.js';
import { isColor, isSingleLength, normalizeColor } from './color.js';

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

  for (const [path, content] of Object.entries(files)) {
    if (!isCssFile(path)) continue;
    let root: postcss.Root;
    try {
      root = postcss.parse(content);
    } catch {
      continue; // unparseable (e.g. exotic scss) — leave as-is
    }

    root.walkDecls((decl) => {
      const category = categoryFor(decl.prop);
      const rawValue = decl.value.trim();

      let normalized: string | null = null;
      if (category === 'color' && isColor(rawValue)) {
        normalized = normalizeColor(rawValue);
      } else if (LENGTH_CATEGORIES.has(category) && isSingleLength(rawValue)) {
        normalized = rawValue;
      }
      if (!normalized) return;

      const key = `${category}:${normalized}`;
      let token = tokens.get(key);
      if (!token) {
        counters[category] += 1;
        const name = `--${category}-${counters[category]}`;
        token = {
          id: shortHash(key),
          name,
          displayName: `${CATEGORY_LABEL[category]} ${counters[category]}`,
          category,
          value: normalized,
          fallback: rawValue,
          usages: [],
        };
        tokens.set(key, token);
      }
      token.usages.push({
        file: path,
        line: decl.source?.start?.line ?? 0,
        property: decl.prop,
        selector: selectorOf(decl),
      });
      decl.value = `var(${token.name}, ${rawValue})`;
    });

    outFiles[path] = root.toString();
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
