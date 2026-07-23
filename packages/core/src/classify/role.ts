/**
 * PRIMARY ROLE — what a component is FOR, from a small enum. A conservative,
 * reversible facet (sibling of atomic level and kind): a WRONG role is worse than
 * none, so every check demands a high-confidence signal and anything unsure falls
 * through to `other`. Same philosophy as the directory-area facet (source-area.ts).
 *
 * Three evidence sources, combined in a documented precedence:
 *   - NAME     — the author's own label (Button, Modal, DataTable, Navbar…),
 *                matched on WHOLE PascalCase words so "Format…" never reads as a
 *                "Form" and "Table" never reads as a "Tab".
 *   - ARIA/DOM — the elements it actually renders (nav/table/dialog/input…), read
 *                from the JSX by the react adapter (signals.domTags / .ariaRoles).
 *   - PROPS    — the prop contract (value+onChange, open+onClose, onClick…).
 *
 * PRECEDENCE (first decisive match wins), ordered so a CONTAINER's noisy
 * descendants never outrank the component's own identity. domTags are DESCENDANT
 * element names, so an <input> inside a Modal leaks in; deciding overlay- and
 * nav-shaped components FIRST (by their own name/aria/prop identity) keeps those
 * leaked descendants from misfiling them:
 *   1. feedback   — overlay semantics dominate: a Modal is a Modal no matter what
 *                   inputs/buttons sit inside it.
 *   2. navigation — a Navbar full of links is navigation, not a pile of actions.
 *   3. form-control
 *   4. data-display
 *   5. action     — onClick is everywhere, so this is intentionally LAST among the
 *                   interactive roles and its weak DOM-only signal (<button>/<a>)
 *                   is trusted only on a leaf, never inside a composition.
 *   6. layout     — structural wrappers, reusing the kind heuristic's name set.
 *   7. other      — nothing decisive.
 */

import type { ClassificationSignals, ComponentRole } from '../types/component.js';

export type { ComponentRole };

/**
 * Split a component name into lowercase WHOLE words on camel/Pascal boundaries.
 * Whole-word matching is what keeps the name signal conservative: "FormattedText"
 * → [formatted, text] (never a "form"), "DataTable" → [data, table] (never a
 * "tab"), "IconButton" → [icon, button].
 */
function nameWords(name: string): Set<string> {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camel boundary: fooBar → foo Bar
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2'); // acronym boundary: HTTPServer → HTTP Server
  return new Set(
    spaced
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((w) => w.toLowerCase()),
  );
}

// Name word-sets. Kept tight — every entry is a word that, standing alone in a
// component name, decisively signals the role.
const FEEDBACK_WORDS = new Set([
  'modal', 'dialog', 'toast', 'snackbar', 'tooltip', 'popover', 'popper',
  'alert', 'notification', 'banner', 'drawer', 'sheet', 'flash',
]);
const NAV_WORDS = new Set([
  'nav', 'navbar', 'navigation', 'menu', 'menubar', 'tabs', 'tab',
  'breadcrumb', 'breadcrumbs', 'pagination', 'pager', 'sidebar', 'stepper',
]);
const FORM_WORDS = new Set([
  'input', 'textfield', 'textinput', 'textarea', 'field', 'select', 'combobox',
  'autocomplete', 'checkbox', 'radio', 'switch', 'toggle', 'slider', 'picker',
  'datepicker', 'timepicker', 'colorpicker', 'form', 'rating', 'upload',
]);
// `grid` lives here (task: Table/List/Grid/Card → data-display), even though the
// kind heuristic treats a Grid as a layout — role and kind are different axes and
// are allowed to disagree.
const DATA_WORDS = new Set([
  'table', 'datatable', 'datagrid', 'grid', 'list', 'listbox', 'card', 'tile',
  'tree', 'timeline', 'feed', 'chart', 'graph', 'gauge', 'sparkline',
]);
const ACTION_WORDS = new Set(['button', 'btn', 'fab']);
// The kind heuristic's own layout set minus `grid` (claimed by data-display above).
const LAYOUT_WORDS = new Set([
  'layout', 'stack', 'container', 'row', 'col', 'column', 'flex', 'spacer',
  'section', 'wrapper', 'box', 'center',
]);

// DOM element sets. STRONG tags (table/nav/dialog/dl) name a component's purpose
// even as a descendant; WEAK tags (input/button/a) leak from children and are
// gated by precedence or leaf-ness before they are trusted.
const FORM_DOM = new Set(['input', 'select', 'textarea']);
const DATA_DOM = new Set(['table', 'thead', 'tbody', 'tr', 'th', 'td', 'dl', 'dt', 'dd']);
const NAV_DOM = new Set(['nav', 'menu']);
const FEEDBACK_DOM = new Set(['dialog']);
const ACTION_DOM = new Set(['button', 'a']);

// ARIA `role="…"` value sets.
const FEEDBACK_ARIA = new Set(['dialog', 'alertdialog', 'alert', 'status', 'tooltip', 'log']);
const NAV_ARIA = new Set(['navigation', 'menu', 'menubar', 'tablist']);
const FORM_ARIA = new Set([
  'textbox', 'checkbox', 'radio', 'switch', 'combobox', 'slider', 'spinbutton', 'searchbox',
]);
const DATA_ARIA = new Set(['table', 'grid', 'list', 'listbox', 'row', 'cell', 'gridcell']);
const ACTION_ARIA = new Set(['button', 'link']);

/**
 * Above this prop count, a bare `onClick` is treated as INCIDENTAL, not the
 * component's purpose. Measured on a real MUI target: an SVG icon typed
 * `SVGAttributes<SVGElement>` expands (via react-docgen) to dozens of inherited
 * DOM handlers including `onClick`, so an icon rendering only `<svg>` would
 * otherwise read as an action. A deliberate click contract is a handful of props;
 * a large attribute-spread contract is not — and a genuine large-contract button
 * is still caught by its NAME or its rendered `<button>`, not by this signal.
 */
const FOCUSED_CONTRACT_MAX = 6;

function overlaps(values: readonly string[], set: ReadonlySet<string>): boolean {
  return values.some((v) => set.has(v.toLowerCase()));
}

function hasAll(props: ReadonlySet<string>, ...names: string[]): boolean {
  return names.every((n) => props.has(n));
}

/**
 * Infer the single primary role. `propNames` is the component's prop contract
 * (from the PropModel); `signals.domTags` / `signals.ariaRoles` are what it
 * renders. See the file header for the precedence rationale.
 */
export function componentRole(
  name: string,
  signals: ClassificationSignals,
  propNames: readonly string[],
): ComponentRole {
  const words = nameWords(name);
  const dom = signals.domTags ?? [];
  const aria = signals.ariaRoles ?? [];
  const props = new Set(propNames.map((p) => p.toLowerCase()));
  const hasWord = (set: ReadonlySet<string>): boolean => {
    for (const w of words) if (set.has(w)) return true;
    return false;
  };

  // 1. feedback / overlay — decided first so a Modal's inner controls can't win.
  if (
    hasWord(FEEDBACK_WORDS) ||
    overlaps(aria, FEEDBACK_ARIA) ||
    overlaps(dom, FEEDBACK_DOM) ||
    hasAll(props, 'open', 'onclose') ||
    hasAll(props, 'isopen', 'onclose') ||
    props.has('anchorel')
  ) {
    return 'feedback';
  }

  // 2. navigation — before action, so a nav bar of links stays navigation.
  if (hasWord(NAV_WORDS) || overlaps(aria, NAV_ARIA) || overlaps(dom, NAV_DOM)) {
    return 'navigation';
  }

  // 3. form-control — a controlled value contract, an ARIA control role, a form
  //    name, or a rendered <input>/<select>/<textarea> (the overlay/nav that
  //    would have leaked such a descendant is already resolved above).
  if (
    hasWord(FORM_WORDS) ||
    overlaps(aria, FORM_ARIA) ||
    overlaps(dom, FORM_DOM) ||
    hasAll(props, 'value', 'onchange') ||
    hasAll(props, 'checked', 'onchange')
  ) {
    return 'form-control';
  }

  // 4. data-display — tables, lists, cards, charts.
  if (hasWord(DATA_WORDS) || overlaps(aria, DATA_ARIA) || overlaps(dom, DATA_DOM)) {
    return 'data-display';
  }

  // 5. action — name/aria are decisive; the prop and DOM signals are weak
  //    (onClick and <button> are ubiquitous) so they only count with no value
  //    contract and, for DOM, on a leaf that renders nothing but the control.
  const leafAction = signals.childComponentCount === 0 && overlaps(dom, ACTION_DOM);
  const clickAction =
    props.has('onclick') && !props.has('value') && props.size <= FOCUSED_CONTRACT_MAX;
  if (hasWord(ACTION_WORDS) || overlaps(aria, ACTION_ARIA) || leafAction || clickAction) {
    return 'action';
  }

  // 6. layout — structural shells, last so any content role above wins first.
  if (hasWord(LAYOUT_WORDS)) return 'layout';

  // 7. nothing decisive — honestly uncommitted.
  return 'other';
}
