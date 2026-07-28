/**
 * The gallery view ⇄ the query string.
 *
 * WHY: filters, the open component and the inspector tab lived only in React
 * state, so a reload — or a stray Back — dropped the user at an unfiltered
 * gallery with nothing selected, throwing away a scan that costs minutes on a
 * real project. Encoding the view in the URL makes the address bar remember it.
 *
 * NOT SHAREABLE, and deliberately not presented as such. The scan target is an
 * ABSOLUTE path on this machine, so a URL from this app means nothing on another
 * one; the project path is therefore not encoded here at all, and there is no
 * "copy link" affordance anywhere. What this buys is reload-persistence and
 * back/forward inside one session — nothing more.
 *
 * Pure by construction — no `window`, no `history`, no React — so every branch
 * of the round trip is unit-testable (packages/web/test/url-state.test.ts).
 *
 * The encoding is a PERSISTED FORMAT: a URL outlives the code that wrote it, so
 * param names and codes are append-only in spirit. Renaming one silently breaks
 * every URL a user already has open in a tab.
 */

import type { AtomicLevel, ComponentKind, ComponentRole } from '../api/types.js';
import type { Tab } from '../features/inspector/Inspector.js';
import { DEFAULT_FILTERS, type FilterState, type SortOrder } from './filter.js';

export interface UrlState {
  readonly filters: FilterState;
  /** The component whose inspector is open, if any. */
  readonly selectedId: string | null;
  /** Which inspector tab it is open on. */
  readonly tab: Tab;
}

/** Mirrors app.tsx's initial state — the view a bare URL (no query) means. */
export const DEFAULT_URL_STATE: UrlState = {
  filters: DEFAULT_FILTERS,
  selectedId: null,
  tab: 'Details',
};

/*
 * One character per value, so a multi-select is a single short param (`r=ao`)
 * instead of a repeated key or a %2C-riddled list. Each table is a full `Record`
 * on purpose: adding a rank/kind/role/tab to the app without deciding its code
 * then fails typecheck here, rather than dropping silently out of every URL.
 */
const RANK_CODE: Record<AtomicLevel, string> = {
  atom: 'a',
  molecule: 'm',
  organism: 'o',
  page: 'p',
};

const KIND_CODE: Record<ComponentKind, string> = {
  presentational: 'p',
  container: 'c',
  layout: 'l',
};

const ROLE_CODE: Record<ComponentRole, string> = {
  'form-control': 'f',
  'data-display': 'd',
  navigation: 'n',
  feedback: 'b',
  action: 'a',
  layout: 'l',
  other: 'o',
};

const SORT_CODE: Record<SortOrder, string> = {
  reliability: 'r',
  mostUsed: 'u',
};

/** `o` is pOrtable — `p` was already taken by Preview. */
const TAB_CODE: Record<Tab, string> = {
  Details: 'd',
  Preview: 'p',
  Variants: 'v',
  Portable: 'o',
  Customize: 'c',
};

/**
 * A sane ceiling on the context-cap param. Real scores sit around 0–10; anything
 * beyond this is a hand-edited or stale URL, and accepting it verbatim would let
 * `cx=99999999` masquerade as a filter. Out-of-range → no cap.
 */
const MAX_CONTEXT_CAP = 20;

/** `cx` string → an integer cap in [0, MAX_CONTEXT_CAP], or null for anything
 *  missing, non-integer, negative, or out of range. Total, never throws. */
function decodeContextCap(raw: string | null): number | null {
  if (raw === null || raw === '') return null;
  // Number('') is 0 and Number('1.5') is 1.5, so parse strictly: only a run of
  // digits is a cap. This rejects '', 'abc', '-1', '1.5', 'NaN' in one test.
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > MAX_CONTEXT_CAP) return null;
  return n;
}

function invert<T extends string>(codes: Record<T, string>): ReadonlyMap<string, T> {
  const entries = Object.entries(codes) as [T, string][];
  return new Map(entries.map(([value, code]) => [code, value]));
}

const RANK_BY_CODE = invert(RANK_CODE);
const KIND_BY_CODE = invert(KIND_CODE);
const ROLE_BY_CODE = invert(ROLE_CODE);
const SORT_BY_CODE = invert(SORT_CODE);
const TAB_BY_CODE = invert(TAB_CODE);

function encodeSet<T extends string>(values: readonly T[], codes: Record<T, string>): string {
  return values.map((value) => codes[value] ?? '').join('');
}

/**
 * Chars → values, dropping anything unrecognised or repeated. A URL is hand
 * editable and may predate a renamed facet, so garbage has to degrade to "that
 * facet is off", never to a throw or to a filter nobody asked for.
 */
function decodeSet<T extends string>(raw: string | null, byCode: ReadonlyMap<string, T>): T[] {
  if (!raw) return [];
  const values: T[] = [];
  for (const char of raw) {
    const value = byCode.get(char);
    if (value !== undefined && !values.includes(value)) values.push(value);
  }
  return values;
}

/**
 * `/` and `,` are legal in a query string (RFC 3986 `query = *( pchar / "/" / "?" )`)
 * but URLSearchParams escapes them anyway, which turns a directory facet into
 * `dir=src%2Ffeatures%2Fui`. Putting the slashes back keeps the URL readable and
 * short; URLSearchParams parses them back identically.
 */
function readable(search: string): string {
  return search.replace(/%2F/g, '/');
}

/**
 * The view as a query string WITHOUT the leading `?` — empty for the default
 * view, so an untouched gallery has a clean URL. Every axis at its default is
 * omitted, and params are written in a fixed order so the same state always
 * produces byte-identical output (the caller compares strings to decide whether
 * the URL needs rewriting at all).
 */
export function encodeUrlState(state: UrlState): string {
  const params = new URLSearchParams();
  const f = state.filters;

  if (f.query) params.set('q', f.query);
  if (f.ranks.length) params.set('r', encodeSet(f.ranks, RANK_CODE));
  if (f.kinds.length) params.set('k', encodeSet(f.kinds, KIND_CODE));
  if (f.roles.length) params.set('ro', encodeSet(f.roles, ROLE_CODE));
  if (f.dir) params.set('dir', f.dir);
  // `0` is a real cap (isolated-only), so test against null, not falsiness.
  if (f.maxContext !== null) params.set('cx', String(f.maxContext));
  if (f.sort !== DEFAULT_FILTERS.sort) params.set('s', SORT_CODE[f.sort]);
  if (f.presentationalOnly) params.set('p', '1');
  // `designOnly` defaults to ON, so the URL records the opt-OUT: `all=1` reads
  // as "show me everything", which is exactly what turning the switch off means.
  if (!f.designOnly) params.set('all', '1');
  if (state.selectedId) params.set('c', state.selectedId);
  if (state.tab !== DEFAULT_URL_STATE.tab) params.set('t', TAB_CODE[state.tab]);

  return readable(params.toString());
}

/**
 * A `location.search` (with or without its `?`) back into a complete view.
 *
 * Defensive by contract: anything missing, unknown or malformed falls back to
 * the default for that axis. It never throws — the alternative is a blank app
 * for a user whose only crime was editing their own address bar.
 */
export function decodeUrlState(search: string): UrlState {
  const params = new URLSearchParams(search);
  const sort = SORT_BY_CODE.get(params.get('s') ?? '');
  const tab = TAB_BY_CODE.get(params.get('t') ?? '');
  const dir = params.get('dir');
  const selectedId = params.get('c');

  return {
    filters: {
      query: params.get('q') ?? DEFAULT_FILTERS.query,
      ranks: decodeSet(params.get('r'), RANK_BY_CODE),
      kinds: decodeSet(params.get('k'), KIND_BY_CODE),
      roles: decodeSet(params.get('ro'), ROLE_BY_CODE),
      // Only an exact '1' is true: a flag that reads `p=0` or `p=false` must not
      // switch a filter ON just by being present.
      presentationalOnly: params.get('p') === '1',
      sort: sort ?? DEFAULT_FILTERS.sort,
      designOnly: params.get('all') !== '1',
      dir: dir ? dir : DEFAULT_FILTERS.dir,
      maxContext: decodeContextCap(params.get('cx')),
    },
    selectedId: selectedId ? selectedId : DEFAULT_URL_STATE.selectedId,
    tab: tab ?? DEFAULT_URL_STATE.tab,
  };
}
