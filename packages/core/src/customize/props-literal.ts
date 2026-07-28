/**
 * Reading and rewriting the sandbox entry's `const props = { … };` literal.
 *
 * The literal LOOKS like JSON but is not. `build-entry` emits a bare identifier
 * for every required function prop (`"onSelect": __fnStub`), and sample props
 * nest objects and arrays that a lazy `\{[\s\S]*?\}` regex cuts in half. Either
 * makes `JSON.parse` throw, and a caller that falls back to an empty object
 * silently drops every prop the user did NOT just edit. So instead: locate the
 * literal by scanning balanced braces, mask each non-JSON chunk (bare
 * identifiers, single/backtick-quoted strings) behind a placeholder string,
 * parse that, and unmask on the way out so the chunk is re-emitted verbatim.
 *
 * Pure string logic — no DOM, no framework. Shared by the engine's
 * `patchEntryProps` and, through it, by the host's preview bundler.
 */

const PROPS_DECL = /const\s+props\s*=\s*\{/;

/** JSON's three bare words — they parse as-is and must not be masked. */
const JSON_KEYWORDS = new Set(['true', 'false', 'null']);

/** Placeholder stem; widened until it cannot collide with the real content. */
const RAW_STEM = '__ceRaw';

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[\w$.]/;

/** The `const props = { … }` literal located inside an entry file. */
export interface PropsLiteralMatch {
  /** Index of the literal's opening `{` within the entry. */
  readonly start: number;
  /** Index just past the literal's closing `}`. */
  readonly end: number;
  /** The literal text, braces included. */
  readonly literal: string;
}

/** Index just past the closing quote of the string opening at `open`. */
function endOfString(src: string, open: number): number {
  const quote = src.charAt(open);
  for (let i = open + 1; i < src.length; i += 1) {
    const ch = src.charAt(i);
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === quote) return i + 1;
  }
  return src.length; // unterminated — treat the rest as part of the string
}

/**
 * Locate the entry's props literal by brace matching (string-aware), so nested
 * objects and arrays survive. Returns null when there is no such declaration or
 * its braces never balance — callers must then leave the entry alone rather
 * than splice in a half-literal.
 */
export function findPropsLiteral(entry: string): PropsLiteralMatch | null {
  const decl = PROPS_DECL.exec(entry);
  if (!decl) return null;
  const start = entry.indexOf('{', decl.index);
  let depth = 0;
  for (let i = start; i < entry.length; i += 1) {
    const ch = entry.charAt(i);
    if (ch === '"' || ch === "'" || ch === '`') {
      i = endOfString(entry, i) - 1;
      continue;
    }
    if (ch === '{' || ch === '[') {
      depth += 1;
    } else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) return { start, end: i + 1, literal: entry.slice(start, i + 1) };
    }
  }
  return null;
}

interface MaskedLiteral {
  readonly json: string;
  readonly raws: readonly string[];
}

/** Replace every non-JSON chunk with a `"<prefix>N__"` placeholder string. */
function maskNonJson(literal: string, prefix: string): MaskedLiteral {
  const raws: string[] = [];
  const placeholder = (raw: string): string => {
    const token = JSON.stringify(`${prefix}${raws.length}__`);
    raws.push(raw);
    return token;
  };
  let out = '';
  for (let i = 0; i < literal.length; i += 1) {
    const ch = literal.charAt(i);
    if (ch === '"') {
      const end = endOfString(literal, i);
      out += literal.slice(i, end);
      i = end - 1;
      continue;
    }
    if (ch === "'" || ch === '`') {
      const end = endOfString(literal, i);
      out += placeholder(literal.slice(i, end));
      i = end - 1;
      continue;
    }
    if (!IDENT_START.test(ch)) {
      out += ch;
      continue;
    }
    let j = i + 1;
    while (j < literal.length && IDENT_PART.test(literal.charAt(j))) j += 1;
    const word = literal.slice(i, j);
    i = j - 1;
    if (JSON_KEYWORDS.has(word)) {
      out += word;
      continue;
    }
    // An unquoted KEY becomes a real JSON key, not a placeholder: otherwise an
    // override of the same name would merge alongside it instead of over it.
    let k = j;
    while (k < literal.length && /\s/.test(literal.charAt(k))) k += 1;
    out += literal.charAt(k) === ':' ? JSON.stringify(word) : placeholder(word);
  }
  return { json: out, raws };
}

/** Put the masked chunks back, unquoted, exactly as they were written. */
function unmask(json: string, raws: readonly string[], prefix: string): string {
  if (raws.length === 0) return json;
  return json.replace(new RegExp(`"${prefix}(\\d+)__"`, 'g'), (full, index: string) => {
    return raws[Number(index)] ?? full;
  });
}

/**
 * Merge `propValues` into a props literal and re-emit it. Returns null when the
 * literal cannot be understood even with its non-JSON chunks masked — the
 * caller must report that rather than silently producing `{}`.
 */
export function mergeIntoPropsLiteral(
  literal: string,
  propValues: Readonly<Record<string, unknown>>,
): string | null {
  const overridesJson = JSON.stringify(propValues);
  let prefix = RAW_STEM;
  while (literal.includes(prefix) || overridesJson.includes(prefix)) prefix += '_';

  const masked = maskNonJson(literal, prefix);
  let base: unknown;
  try {
    base = JSON.parse(masked.json);
  } catch {
    return null;
  }
  if (base === null || typeof base !== 'object' || Array.isArray(base)) return null;

  const merged = { ...(base as Record<string, unknown>), ...propValues };
  return unmask(JSON.stringify(merged, null, 2), masked.raws, prefix);
}
