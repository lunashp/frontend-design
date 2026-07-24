/**
 * Client-side customization state, and the payloads the preview iframe is fed.
 *
 * Applying the state to code is the engine's job, not ours: the live path is
 * LocalPreview -> host `/api/preview` -> @ce/core. This module only holds the
 * edits and turns them into the messages the preview understands.
 */

import type { Token } from '../api/types.js';
import { emitDesignStyleSheet } from './design-overrides.js';

export interface CustomizationState {
  tokenOverrides: Record<string, string>;
  propValues: Record<string, unknown>;
  /** Universal design overrides (size/colour/spacing/…) applied to the
   *  component's root element in the preview — independent of any tokens.
   *  Optional so callers that predate it (and tests) stay valid. */
  designOverrides?: Record<string, string>;
}

export const EMPTY_CUSTOMIZATION: CustomizationState = {
  tokenOverrides: {},
  propValues: {},
  designOverrides: {},
};

/**
 * Every component's customization, keyed by component id. The state lives above
 * the pane that edits it: the pane unmounts on every tab switch and every card
 * selection, and holding minutes of theming work inside it meant one stray
 * click erased the lot.
 */
export type CustomizationMap = ReadonlyMap<string, CustomizationState>;

export function getCustomization(map: CustomizationMap, id: string | null): CustomizationState {
  return (id === null ? undefined : map.get(id)) ?? EMPTY_CUSTOMIZATION;
}

export function setCustomization(
  map: CustomizationMap,
  id: string,
  state: CustomizationState,
): CustomizationMap {
  return new Map(map).set(id, state);
}

/**
 * Seed token overrides onto a state — the mechanism behind "starting presets".
 *
 * The engine's `tokenModel.themes` presets are keyed by token id, exactly like
 * `tokenOverrides`, so applying a scheme (e.g. the mined `dark` colorScheme) is
 * a plain merge: the incoming preset wins on shared ids, and any design/prop
 * edits already in progress are left untouched. Immutable.
 */
export function mergeTokenOverrides(
  state: CustomizationState,
  overrides: Readonly<Record<string, string>>,
): CustomizationState {
  return { ...state, tokenOverrides: { ...state.tokenOverrides, ...overrides } };
}

/** Has anything actually been edited? Drives the Reset button's enabled state. */
export function isCustomized(state: CustomizationState): boolean {
  return (
    Object.keys(state.tokenOverrides).length > 0 ||
    Object.keys(state.propValues).length > 0 ||
    Object.keys(state.designOverrides ?? {}).length > 0
  );
}

/**
 * Most-used tokens first. A token used in twelve declarations is the one worth
 * re-theming; one used once is noise near the bottom of a long list.
 */
export function sortTokensByUsage(tokens: readonly Token[]): Token[] {
  return tokens
    .slice()
    .sort((a, b) => b.usages.length - a.usages.length || a.name.localeCompare(b.name));
}

/** Regenerate the `:root { … }` block with overrides applied. */
export function emitRootCss(tokens: readonly Token[], overrides: Record<string, string>): string {
  if (tokens.length === 0) return ':root {\n}\n';
  const lines = tokens.map((t) => `  ${t.name}: ${overrides[t.id] ?? t.value};`);
  return `:root {\n${lines.join('\n')}\n}\n`;
}

/** The engine always writes this synthesized stylesheet into the bundle (mirrors
 *  core's TOKENS_CSS_PATH), so it is never one of the component's OWN stylesheets
 *  and must be excluded when deciding why a component exposes no tokens. */
const TOKENS_CSS_PATH = '/tokens.css';
const SOURCE_STYLE_EXT = /\.(?:css|scss|sass|less)$/i;
const TS_SOURCE_EXT = /\.(?:tsx?|jsx?)$/i;
/** styled-components / emotion usage — an import of either, or a `styled.foo` /
 *  `` styled(X)` `` / `` css` `` tagged template in the source. */
const CSS_IN_JS = /styled-components|@emotion|\bstyled[.(`]|\bcss`/;

/**
 * Why the token panel is empty, in the component's own terms. The panel is
 * hidden when a component exposes no re-themeable tokens; without a reason that
 * empty area reads as a bug rather than a fact about the component. The cases are
 * honestly distinct and derived from the bundle, not guessed:
 *  - it ships a stylesheet that declares no CSS custom properties;
 *  - it uses CSS-in-JS (styled-components/emotion) — the engine tokenizes the
 *    STATIC parts of those templates, so an empty panel means the styling was
 *    dynamic or in a shape the tokenizer can't read, NOT that there is nothing
 *    there. Said plainly so the user doesn't assume the component is bare;
 *  - it ships no stylesheet at all (inline styles / none).
 * Either way the Design controls still restyle it.
 */
export function emptyTokensReason(bundleFiles: Readonly<Record<string, string>>): string {
  const paths = Object.keys(bundleFiles);
  const hasSourceStylesheet = paths.some(
    (path) => path !== TOKENS_CSS_PATH && SOURCE_STYLE_EXT.test(path),
  );
  if (hasSourceStylesheet) {
    return 'This component’s stylesheet declares no CSS custom properties, so there are no tokens to re-theme here. Use the Design controls above — they restyle any component.';
  }
  const usesCssInJs = paths.some(
    (path) => TS_SOURCE_EXT.test(path) && CSS_IN_JS.test(bundleFiles[path] ?? ''),
  );
  if (usesCssInJs) {
    return 'This component styles itself with CSS-in-JS (styled-components/emotion). Tokens are pulled from the static parts of those styles; an empty list here means the styling is dynamic or in a shape the extractor can’t read, not that the component has none. Use the Design controls above — they restyle any component.';
  }
  return 'This component ships no stylesheet — its styles are inline or none, so there are no CSS custom properties to extract as tokens. Use the Design controls above — they restyle any component.';
}

/** The design-override payload the preview iframe applies (see @ce/host). */
export interface PreviewDesignMessage {
  readonly type: 'ce:design';
  readonly sheet: string;
}

/**
 * Design overrides as a whole stylesheet.
 *
 * The host also accepts a legacy `css` field, but it splices that into
 * `#root > * { … }` — a single resting rule, so a `hover:*` override sent that
 * way repaints the resting state instead of the hover one. Only a full sheet
 * can express `:hover` / `:focus-visible` / `:active`, so that is all we send.
 * An empty sheet is meaningful: it clears the override layer.
 */
export function previewDesignMessage(
  overrides: Readonly<Record<string, string>> = {},
): PreviewDesignMessage {
  return { type: 'ce:design', sheet: emitDesignStyleSheet(overrides) };
}
