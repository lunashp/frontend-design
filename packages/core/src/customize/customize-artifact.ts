/**
 * High-level customization over a built ComponentArtifact — the engine's
 * `customizeArtifact`, promised by the public surface since day one. Applies
 * token overrides (re-themeable `:root`), prop values (mounted instance), and
 * universal design overrides (a copyable CSS rule), and returns a customized
 * SandpackSpec plus the copy-ready CSS artifacts.
 *
 * Token overrides never touch component source — they only regenerate
 * `/tokens.css` — so ported code stays re-themeable. All logic is pure string
 * transformation; the web app keeps its own browser-side mirror (the bundle
 * never imports @ce/core), so keep the two in sync.
 */

import type { ComponentArtifact } from '../types/artifact.js';
import type { CustomizationState } from '../types/customization.js';
import type { SandpackSpec } from '../types/sandpack-spec.js';
import type { Token } from '../types/token-model.js';
import { emitTokensCss } from '../tokenize/tokenization-transform.js';
import { emitDesignRule } from './design-overrides.js';

/** The result of customizing a component: copy-ready CSS + a customized sandbox. */
export interface CustomizedComponent {
  readonly id: string;
  readonly name: string;
  /** Re-themed `:root { … }` block (tokens.css) with overrides applied. */
  readonly tokensCss: string;
  /** Copyable `.Name { … }` design-override rule (empty when no design overrides). */
  readonly designCss: string;
  /** Sandbox spec reflecting the customization (patched entry + re-themed tokens.css). */
  readonly spec: SandpackSpec;
  /** Token overrides that matched a token on this component (keyed by token id). */
  readonly appliedTokenOverrides: Record<string, string>;
  /** Override ids that did not match any token on this component. */
  readonly unknownTokenIds: string[];
  readonly appliedPropValues: Record<string, unknown>;
  readonly appliedDesignOverrides: Record<string, string>;
}

/** Merge prop values into the entry's `const props = { … }` literal. */
export function patchEntryProps(
  entry: string,
  propValues: Readonly<Record<string, unknown>>,
): string {
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
 * entry (JS) change always triggers a sandbox recompile, so a live preview
 * reflects edits reliably (a CSS-module HMR update does not).
 */
export function injectTokenOverrides(
  entry: string,
  tokens: readonly Token[],
  overrides: Readonly<Record<string, string>>,
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
      '/tokens.css': emitTokensCss(tokens, state.tokenOverrides),
      '/index.tsx': entry,
    },
  };
}

/**
 * Apply a full customization (tokens + props + design) to a built artifact and
 * return the copy-ready CSS artifacts plus a customized sandbox spec. Token
 * override ids that don't match a token on this component are reported back in
 * `unknownTokenIds` rather than silently ignored.
 */
export function customizeArtifact(
  artifact: ComponentArtifact,
  state: CustomizationState,
): CustomizedComponent {
  const tokens = artifact.tokenModel.tokens;
  const ids = new Set(tokens.map((t) => t.id));
  const applied: Record<string, string> = {};
  const unknownTokenIds: string[] = [];
  for (const [id, value] of Object.entries(state.tokenOverrides)) {
    if (ids.has(id)) applied[id] = value;
    else unknownTokenIds.push(id);
  }
  const designOverrides: Readonly<Record<string, string>> = state.designOverrides ?? {};

  const appliedState: CustomizationState = {
    tokenOverrides: applied,
    propValues: state.propValues,
    designOverrides,
  };

  return {
    id: artifact.descriptor.id,
    name: artifact.descriptor.name,
    tokensCss: emitTokensCss(tokens, applied),
    designCss: emitDesignRule(artifact.descriptor.name, designOverrides),
    spec: customizeSpec(artifact, appliedState),
    appliedTokenOverrides: applied,
    unknownTokenIds,
    appliedPropValues: { ...state.propValues },
    appliedDesignOverrides: { ...designOverrides },
  };
}
