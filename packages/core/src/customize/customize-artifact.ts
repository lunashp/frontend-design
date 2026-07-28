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
import { emitDesignRule, isDesignKey } from './design-overrides.js';
import { findPropsLiteral, mergeIntoPropsLiteral } from './props-literal.js';

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
  /** Design overrides that named a real design field (state prefixes allowed). */
  readonly appliedDesignOverrides: Record<string, string>;
  /** Design keys that name no known field — reported instead of echoed back. */
  readonly unknownDesignFields: string[];
  /** Non-fatal problems hit while customizing; never silently swallowed. */
  readonly warnings: string[];
}

/** A patched entry plus whatever the patch could not do cleanly. */
export interface PropPatchResult {
  readonly entry: string;
  readonly warnings: readonly string[];
}

/**
 * Merge prop values into the entry's `const props = { … }` literal.
 *
 * The literal is not JSON — `build-entry` emits `"onSelect": __fnStub` for
 * required function props, and sample props nest objects — so it is located by
 * brace matching and parsed with those chunks masked (see `props-literal`).
 * When even that fails the base props are preserved with a runtime spread
 * rather than dropped, and the reason is reported in `warnings`.
 */
export function patchEntryProps(
  entry: string,
  propValues: Readonly<Record<string, unknown>>,
): PropPatchResult {
  if (Object.keys(propValues).length === 0) return { entry, warnings: [] };

  const match = findPropsLiteral(entry);
  if (match === null) {
    return {
      entry,
      warnings: ['Entry has no balanced `const props = { … }` literal; prop edits were not applied.'],
    };
  }

  const splice = (literal: string): string =>
    entry.slice(0, match.start) + literal + entry.slice(match.end);

  const merged = mergeIntoPropsLiteral(match.literal, propValues);
  if (merged === null) {
    // Unparseable even masked: spread-merge at runtime so the sample props
    // survive (later keys win) instead of being replaced by the edits alone.
    return {
      entry: splice(`{ ...(${match.literal}), ...(${JSON.stringify(propValues)}) }`),
      warnings: ["Could not parse the entry's props literal; merged the edits with a runtime spread."],
    };
  }
  return { entry: splice(merged), warnings: [] };
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

/** Build the customized spec, keeping the patch's warnings for the caller. */
function buildCustomizedSpec(
  artifact: ComponentArtifact,
  state: CustomizationState,
): { spec: SandpackSpec; warnings: readonly string[] } {
  const base = artifact.sandpack;
  const tokens = artifact.tokenModel.tokens;
  const source = base.files[base.entryPath] ?? base.files['/index.tsx'] ?? '';
  const patched = patchEntryProps(source, state.propValues);
  const entry = injectTokenOverrides(patched.entry, tokens, state.tokenOverrides);
  return {
    spec: {
      ...base,
      files: {
        ...base.files,
        '/tokens.css': emitTokensCss(tokens, state.tokenOverrides),
        '/index.tsx': entry,
      },
    },
    warnings: patched.warnings,
  };
}

/** Produce a Sandpack spec reflecting the current customization state. */
export function customizeSpec(
  artifact: ComponentArtifact,
  state: CustomizationState,
): SandpackSpec {
  return buildCustomizedSpec(artifact, state).spec;
}

/**
 * Apply a full customization (tokens + props + design) to a built artifact and
 * return the copy-ready CSS artifacts plus a customized sandbox spec. Overrides
 * that cannot be applied are reported rather than silently ignored: token ids
 * matching no token on this component come back in `unknownTokenIds`, design
 * keys naming no known field in `unknownDesignFields`, and anything that went
 * wrong patching the entry in `warnings`.
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

  const designOverrides: Record<string, string> = {};
  const unknownDesignFields: string[] = [];
  for (const [key, value] of Object.entries(state.designOverrides ?? {})) {
    if (isDesignKey(key)) designOverrides[key] = value;
    else unknownDesignFields.push(key);
  }

  const appliedState: CustomizationState = {
    tokenOverrides: applied,
    propValues: state.propValues,
    designOverrides,
  };
  const { spec, warnings } = buildCustomizedSpec(artifact, appliedState);

  return {
    id: artifact.descriptor.id,
    name: artifact.descriptor.name,
    tokensCss: emitTokensCss(tokens, applied),
    designCss: emitDesignRule(artifact.descriptor.name, designOverrides),
    spec,
    appliedTokenOverrides: applied,
    unknownTokenIds,
    appliedPropValues: { ...state.propValues },
    appliedDesignOverrides: { ...designOverrides },
    unknownDesignFields,
    warnings: [...warnings],
  };
}
