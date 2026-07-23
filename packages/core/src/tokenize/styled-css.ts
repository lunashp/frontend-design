/**
 * Tokenize the CSS embedded in styled-components / emotion tagged-template
 * literals (`styled.div\`…\``, `styled(X)\`…\``, `css\`…\``).
 *
 * WHY this is a separate pass from CSS tokenization: the stylesheet path reads
 * `.css` files with postcss, but styled/emotion projects keep every colour and
 * length inside a JS template literal, so their token panel comes up EMPTY.
 * This pass makes those values visible AND re-themeable — but only where a
 * rewrite is provably safe.
 *
 * THE SAFETY INVARIANT (non-negotiable): a token is minted with write-back ONLY
 * when the declaration's value lies WHOLLY inside a single static quasi — never
 * touching a `${…}` interpolation. styled-components and emotion both evaluate
 * `var()` at runtime, so rewriting a static literal to `var(--token, <literal>)`
 * re-themes live while keeping the original as a fallback. A value that touches
 * an interpolation is dynamic (it depends on props at render time); it is
 * skipped rather than shown as a dead slider, and its interpolation is left
 * byte-for-byte intact.
 *
 * HOW offsets stay honest: each template is flattened to a CSS string where every
 * interpolation becomes a neutral placeholder, so postcss parses the static
 * structure. Every declaration value's offset range in that flattened string is
 * mapped back to the ORIGINAL source; a value whose range overlaps a placeholder
 * (or spans two quasis) fails the "wholly static" test and is skipped. After
 * rewriting, the file is re-parsed — if a rewrite would break the .tsx syntax,
 * every rewrite for that file is dropped rather than shipping broken code.
 */

import postcss from 'postcss';
import type { Declaration, Rule } from 'postcss';
import { Node, Project } from 'ts-morph';
import type { TaggedTemplateExpression } from 'ts-morph';
import ts from 'typescript';
import { isStyledFactory } from '../adapters/react/node-utils.js';
import type { FileMap } from '../types/portable-bundle.js';
import type { TokenCategory, TokenUsage } from '../types/token-model.js';
import { categoryFor, normalizeStandardValue } from './categorize.js';
import { containsVar } from './value-shape.js';

/**
 * Reuse-or-create a standard token in the bundle's shared namespace and record a
 * usage; returns the token's `var()` name. The styled pass shares this with the
 * CSS pass so a value equal to a stylesheet token gets the SAME name.
 */
export type StandardTokenMinter = (
  category: TokenCategory,
  normalized: string,
  rawValue: string,
  usage: TokenUsage,
) => string;

export interface StyledTokenizeResult {
  /** Only the .tsx/.ts files that were actually rewritten (caller merges these). */
  readonly files: Record<string, string>;
  /** Declarations tokenized with working write-back. */
  readonly rewritten: number;
  /** Themeable-category declarations skipped because their value is dynamic. */
  readonly skipped: number;
}

const TS_EXTENSION = /\.(tsx|ts|jsx|js|mjs|cjs)$/;

/** A `css\`…\`` (emotion) tag, the styled-CSS sibling of `isStyledFactory`. */
function isEmotionCssTag(node: TaggedTemplateExpression): boolean {
  return node.getTag().getText() === 'css';
}

function isStyledCssTemplate(node: TaggedTemplateExpression): boolean {
  return isStyledFactory(node) || isEmotionCssTag(node);
}

/** A static run of the template and where its first char sits in the source file. */
interface StaticSpan {
  /** Offset of this span's start within the flattened CSS string. */
  readonly cssStart: number;
  /** Offset just past this span's end within the flattened CSS string. */
  readonly cssEnd: number;
  /** Source-file offset of this span's first character. */
  readonly srcStart: number;
}

/** One planned literal rewrite: replace `[srcStart, srcEnd)` with a var() ref. */
interface RewritePlan {
  readonly srcStart: number;
  readonly srcEnd: number;
  readonly category: TokenCategory;
  readonly normalized: string;
  /** The exact original source text of the value (the var() fallback). */
  readonly original: string;
  readonly property: string;
  readonly selector: string;
  readonly line: number;
}

/**
 * Flatten a tagged template into a CSS string plus the static spans that map
 * back to the source. Each interpolation becomes a placeholder ident so postcss
 * still parses; the placeholder occupies NO static span, so any declaration
 * value overlapping it fails the wholly-static test.
 */
function flattenTemplate(node: TaggedTemplateExpression): {
  css: string;
  spans: readonly StaticSpan[];
} {
  const template = node.getTemplate();
  const parts: string[] = [];
  const spans: StaticSpan[] = [];
  let cssLen = 0;
  let placeholder = 0;

  const pushStatic = (content: string, srcStart: number): void => {
    spans.push({ cssStart: cssLen, cssEnd: cssLen + content.length, srcStart });
    parts.push(content);
    cssLen += content.length;
  };
  const pushPlaceholder = (): void => {
    // A CSS-ident placeholder parses in value/selector/property position. Its
    // exact text is irrelevant — nothing is ever mapped back out of it.
    const text = `__ce_interp_${placeholder++}__`;
    parts.push(text);
    cssLen += text.length;
  };

  if (Node.isNoSubstitutionTemplateLiteral(template)) {
    // `\`CONTENT\`` — strip the two backticks; content starts one char in.
    const raw = template.getText();
    pushStatic(raw.slice(1, -1), template.getStart() + 1);
    return { css: parts.join(''), spans };
  }

  if (Node.isTemplateExpression(template)) {
    // head text is `\`…${`; content is between the backtick and the `${`.
    const head = template.getHead();
    const headText = head.getText();
    pushStatic(headText.slice(1, -2), head.getStart() + 1);
    for (const span of template.getTemplateSpans()) {
      pushPlaceholder();
      const lit = span.getLiteral();
      const litText = lit.getText();
      // middle is `}…${` (strip `}` and `${`); tail is `}…\`` (strip `}` and backtick).
      const content = Node.isTemplateMiddle(lit) ? litText.slice(1, -2) : litText.slice(1, -1);
      pushStatic(content, lit.getStart() + 1);
    }
    return { css: parts.join(''), spans };
  }

  return { css: '', spans: [] };
}

/** Map a flattened-CSS value range back to source, if it is wholly static. */
function mapToSource(
  spans: readonly StaticSpan[],
  cssStart: number,
  cssEnd: number,
): number | null {
  for (const span of spans) {
    if (cssStart >= span.cssStart && cssEnd <= span.cssEnd) {
      return span.srcStart + (cssStart - span.cssStart);
    }
  }
  return null;
}

/** Flattened-CSS offset of a declaration's VALUE (postcss reconstruction). */
function valueRange(decl: Declaration): { start: number; end: number } | null {
  const start = decl.source?.start?.offset;
  if (start === undefined) return null;
  const between = decl.raws.between ?? ':';
  const rawValue = decl.raws.value?.raw ?? decl.value;
  const valueStart = start + decl.prop.length + between.length;
  return { start: valueStart, end: valueStart + rawValue.length };
}

function selectorOf(decl: Declaration): string {
  const parent = decl.parent as Rule | undefined;
  return parent && 'selector' in parent ? parent.selector : '';
}

/** 1-based line number of a source offset. */
function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

// `parseDiagnostics` is populated by the parser but not on the public SourceFile
// type; this exposes it without reaching for `any`.
interface ParsedSourceFile {
  readonly parseDiagnostics?: readonly ts.Diagnostic[];
}

/** True when the .tsx/.ts text has no syntactic parse errors. */
function parsesCleanly(path: string, text: string): boolean {
  const kind = /\.(tsx|jsx)$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind) as ts.SourceFile &
    ParsedSourceFile;
  return (sf.parseDiagnostics ?? []).length === 0;
}

/** Collect the safe rewrites for one file's styled/emotion templates. */
function planFile(text: string, tagged: readonly TaggedTemplateExpression[]): RewritePlan[] {
  const plans: RewritePlan[] = [];
  for (const node of tagged) {
    const { css, spans } = flattenTemplate(node);
    let root: postcss.Root;
    try {
      root = postcss.parse(css);
    } catch {
      continue; // exotic/unparseable static CSS — tokenize nothing from it
    }
    root.walkDecls((decl) => {
      const rawValue = decl.value.trim();
      // An aliasing value is a reference, not a literal (mirrors the CSS path).
      if (containsVar(rawValue)) return;
      const category = categoryFor(decl.prop);
      if (category === 'other') return;
      const range = valueRange(decl);
      if (!range) return;
      const srcStart = mapToSource(spans, range.start, range.end);
      // A value that touches an interpolation (or spans two quasis) is dynamic —
      // it is counted as skipped by the caller, never rewritten.
      if (srcStart === null) return;
      const normalized = normalizeStandardValue(category, rawValue);
      if (!normalized) return;
      const srcEnd = srcStart + (range.end - range.start);
      plans.push({
        srcStart,
        srcEnd,
        category,
        normalized,
        original: text.slice(srcStart, srcEnd),
        property: decl.prop,
        selector: selectorOf(decl),
        line: lineAt(text, srcStart),
      });
    });
  }
  // Ascending by source position: deterministic token numbering, and stable
  // descending application below.
  return plans.sort((a, b) => a.srcStart - b.srcStart);
}

/** Count themeable-category declarations whose value is dynamic (interpolated). */
function countSkipped(tagged: readonly TaggedTemplateExpression[]): number {
  let skipped = 0;
  for (const node of tagged) {
    const { css, spans } = flattenTemplate(node);
    let root: postcss.Root;
    try {
      root = postcss.parse(css);
    } catch {
      continue;
    }
    root.walkDecls((decl) => {
      if (containsVar(decl.value.trim())) return;
      if (categoryFor(decl.prop) === 'other') return;
      const range = valueRange(decl);
      if (!range) return;
      if (mapToSource(spans, range.start, range.end) === null) skipped++;
    });
  }
  return skipped;
}

/** Apply the planned rewrites to the file text, then verify it still parses. */
function applyPlans(
  path: string,
  text: string,
  plans: readonly RewritePlan[],
  mint: StandardTokenMinter,
): string | null {
  // Verify with a synthetic name FIRST so a corrupting rewrite is caught before
  // any token is minted — that keeps tokens.css free of dead entries.
  let verify = text;
  for (let i = plans.length - 1; i >= 0; i--) {
    const p = plans[i] as RewritePlan;
    verify = verify.slice(0, p.srcStart) + `var(--ce-verify, ${p.original})` + verify.slice(p.srcEnd);
  }
  if (!parsesCleanly(path, verify)) return null;

  // Mint ascending (stable numbering), then splice descending (offsets hold).
  const names = plans.map((p) =>
    mint(p.category, p.normalized, p.original, {
      file: path,
      line: p.line,
      property: p.property,
      selector: p.selector,
    }),
  );
  let out = text;
  for (let i = plans.length - 1; i >= 0; i--) {
    const p = plans[i] as RewritePlan;
    out = out.slice(0, p.srcStart) + `var(${names[i]}, ${p.original})` + out.slice(p.srcEnd);
  }
  return out;
}

export function tokenizeStyledTemplates(
  files: FileMap,
  mint: StandardTokenMinter,
): StyledTokenizeResult {
  const project = new Project({ useInMemoryFileSystem: true });
  const outFiles: Record<string, string> = {};
  let rewritten = 0;
  let skipped = 0;

  for (const [path, content] of Object.entries(files)) {
    if (!TS_EXTENSION.test(path)) continue;
    let sf: ReturnType<Project['createSourceFile']>;
    try {
      sf = project.createSourceFile(path, content, { overwrite: true });
    } catch {
      continue; // unparseable source — leave it exactly as it was
    }
    const tagged: TaggedTemplateExpression[] = [];
    sf.forEachDescendant((n) => {
      if (Node.isTaggedTemplateExpression(n) && isStyledCssTemplate(n)) tagged.push(n);
    });
    if (tagged.length === 0) continue;

    skipped += countSkipped(tagged);
    const plans = planFile(content, tagged);
    if (plans.length === 0) continue;
    const next = applyPlans(path, content, plans, mint);
    if (next === null) continue; // rewrite would break the file — drop it
    outFiles[path] = next;
    rewritten += plans.length;
  }

  return { files: outFiles, rewritten, skipped };
}
