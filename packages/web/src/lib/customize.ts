/**
 * Client-side live customization: apply token overrides + prop values to a
 * component's Sandpack spec by regenerating only /tokens.css (the :root block)
 * and the entry's props object. Mirrors the engine's re-themeable emit — token
 * overrides never touch component source, so the copied code stays re-themeable.
 */

import type { ComponentArtifact, SandpackSpec, Token } from '../api/types.js';

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

/** Merge prop values into the entry's `const props = { … }` literal. */
export function patchEntryProps(entry: string, propValues: Record<string, unknown>): string {
  if (Object.keys(propValues).length === 0) return entry;
  return entry.replace(/const props = (\{[\s\S]*?\});/, (_full, json: string) => {
    let base: Record<string, unknown> = {};
    try {
      base = JSON.parse(json) as Record<string, unknown>;
    } catch {
      /* keep base empty on parse failure */
    }
    const merged = { ...base, ...propValues };
    return `const props = ${JSON.stringify(merged, null, 2)};`;
  });
}

/**
 * Inject overridden token values as inline `:root` custom properties in the
 * entry. Inline styles beat the tokens.css stylesheet, and — crucially — an
 * entry (JS) change always triggers a Sandpack recompile, so the live preview
 * reflects edits reliably (a CSS-module HMR update does not).
 */
export function injectTokenOverrides(
  entry: string,
  tokens: readonly Token[],
  overrides: Record<string, string>,
): string {
  const byName: Record<string, string> = {};
  for (const [id, value] of Object.entries(overrides)) {
    const token = tokens.find((t) => t.id === id);
    if (token) byName[token.name] = value;
  }
  if (Object.keys(byName).length === 0) return entry;
  const snippet = `\nconst __ceTokens = ${JSON.stringify(byName)};\nObject.entries(__ceTokens).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));\n`;
  return entry.replace('const root = createRoot', `${snippet}const root = createRoot`);
}

/** Produce a Sandpack spec reflecting the current customization state. */
export function customizeSpec(
  artifact: ComponentArtifact,
  state: CustomizationState,
): SandpackSpec {
  const base = artifact.sandpack;
  const tokens = artifact.tokenModel.tokens;
  let entry = base.files[base.entryPath] ?? base.files['/index.tsx'] ?? '';
  entry = patchEntryProps(entry, state.propValues);
  entry = injectTokenOverrides(entry, tokens, state.tokenOverrides);
  return {
    ...base,
    files: {
      ...base.files,
      '/tokens.css': emitRootCss(tokens, state.tokenOverrides),
      '/index.tsx': entry,
    },
  };
}
