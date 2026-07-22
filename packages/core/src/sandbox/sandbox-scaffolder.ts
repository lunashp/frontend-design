/**
 * Assembles a serializable SandpackSpec from a component's portable bundle +
 * generated entry. Emits NO Sandpack import — just the spec (files, deps,
 * template, renderability). The web app maps this to <SandpackProvider> props.
 */

import type { ProviderStubResult } from '../types/adapter.js';
import type { Classification } from '../types/component.js';
import type { PortableBundle } from '../types/portable-bundle.js';
import type { PropModel } from '../types/prop-model.js';
import type { Renderability, SandpackSpec, SandpackTemplate } from '../types/sandpack-spec.js';

/** Packages that cannot execute in the browser sandbox. */
const UNSANDBOXABLE = [/^next(\/|$)/, /^react-dom\/server/, /^node:/, /^(fs|path|crypto|os)$/];

/** Dep version specifiers Sandpack's CDN installer cannot resolve. */
const UNRESOLVABLE_VERSION = /^(workspace:|catalog:|link:|file:|portal:|git\+|github:|https?:)/;

const ENTRY_PATH = '/index.tsx';

/** Worst-wins ordering, so accumulated reasons settle on the honest verdict. */
const SEVERITY: Readonly<Record<Renderability, number>> = { full: 0, stubbed: 1, 'code-only': 2 };

export interface ScaffoldInput {
  readonly classification: Classification;
  readonly bundle: PortableBundle;
  readonly entry: string;
  readonly template: SandpackTemplate;
  readonly propModel: PropModel;
  /** Props actually supplied to the mounted instance. */
  readonly sampleProps: Readonly<Record<string, unknown>>;
  /** Extra deps required by provider stubs (P2: usually none). */
  readonly providerDeps?: Readonly<Record<string, string>>;
  /**
   * What the adapter's provider stubber actually produced. Optional only so a
   * caller can be added incrementally — pass it, or the notes fall back to what
   * the bundle alone can prove and lose the "no provider at all" distinction.
   */
  readonly providers?: ProviderStubResult;
}

function unfilledRequiredProps(input: ScaffoldInput): string[] {
  return input.propModel.props
    .filter((p) => p.required && !(p.name in input.sampleProps))
    .map((p) => p.name);
}

/**
 * The context the preview supplies from the app's OWN artifacts rather than a
 * placeholder. Each of these fields is bundled for the sole purpose of being
 * wrapped by the provider stubber, so their presence is proof of a real wrap —
 * no second copy of the stubber's package-detection table needed here.
 */
function realContextSupplied(bundle: PortableBundle): string[] {
  const supplied: string[] = [];
  if (bundle.previewTheme) supplied.push("the app's own theme");
  if (bundle.previewMessages) supplied.push("the app's own i18n messages");
  const own = bundle.previewProviders?.length ?? 0;
  if (own > 0) supplied.push(`${own} of the app's own context provider(s)`);
  return supplied;
}

/**
 * Collect EVERY reason the preview is degraded, not just the first one found: a
 * component can be both missing a required prop and short of app context, and
 * reporting one cause hides the other from whoever has to fix it.
 */
function computeRenderability(input: ScaffoldInput): {
  renderability: Renderability;
  notes: string[];
} {
  const deps = Object.entries(input.bundle.externalDeps);
  const notes: string[] = [];
  let renderability: Renderability = 'full';
  const downgrade = (to: Renderability): void => {
    if (SEVERITY[to] > SEVERITY[renderability]) renderability = to;
  };

  const blockedName = deps.filter(([name]) => UNSANDBOXABLE.some((re) => re.test(name)));
  const blockedVersion = deps.filter(([, version]) => UNRESOLVABLE_VERSION.test(version));

  if (input.bundle.incomplete) {
    const count = input.bundle.danglingImports.length;
    notes.push(
      `${count || 'Some'} local import(s) could not be resolved, so the bundle is incomplete.`,
    );
    downgrade('code-only');
  }
  if (blockedName.length > 0) {
    notes.push(`Depends on packages that can't run in the sandbox: ${blockedName.map(([n]) => n).join(', ')}.`);
    downgrade('code-only');
  }
  if (blockedVersion.length > 0) {
    notes.push(
      `Depends on packages with non-installable versions (e.g. workspace/local): ${blockedVersion.map(([n]) => n).join(', ')}.`,
    );
    downgrade('code-only');
  }

  const missing = unfilledRequiredProps(input);
  if (missing.length > 0) {
    notes.push(`Required prop(s) couldn't be auto-filled: ${missing.join(', ')} — may error.`);
    downgrade('stubbed');
  }

  const contextScore = input.classification.contextDependencyScore;
  if (contextScore > 0) {
    const supplied = realContextSupplied(input.bundle);
    const unresolved = input.providers?.unresolved ?? [];
    const noProviders = input.providers !== undefined && input.providers.wrapperJsxOpen === '';

    if (supplied.length > 0 && unresolved.length === 0) {
      // Real context, nothing left over: the render is faithful, so claiming it
      // is "stubbed" would understate it exactly as badly as the old note
      // overstated the absence of providers.
      notes.push(
        `Needs app context (score ${contextScore}), and the preview supplies it for real: ${supplied.join(', ')}.`,
      );
    } else if (noProviders) {
      notes.push(
        `Needs app context (score ${contextScore}) but no provider could be generated — rendered bare, so it may look off or error.`,
      );
      downgrade('stubbed');
    } else {
      const tail = unresolved.length > 0 ? ` Context left unresolved: ${unresolved.join(', ')}.` : '';
      const head =
        supplied.length > 0
          ? `Needs app context (score ${contextScore}); the preview supplies ${supplied.join(', ')}`
          : `Needs app context (score ${contextScore}); the preview supplies only placeholder context`;
      notes.push(`${head} — it may look off or error.${tail}`);
      downgrade('stubbed');
    }
  }

  return { renderability, notes };
}

/**
 * One line per module swapped for a stub. The component renders BECAUSE of these
 * swaps, so they are not failures — but the pasted code behaves differently from
 * the original, and that has to be said out loud rather than left to be found.
 */
function stubDisclosures(bundle: PortableBundle): string[] {
  return bundle.stubbedModules.map((s) => `${s.specifier} → local stub (${s.replacedWith}). ${s.lost}`);
}

export function scaffoldSandbox(input: ScaffoldInput): SandpackSpec {
  const { renderability, notes } = computeRenderability(input);
  // bundle.files already includes /tokens.css (emitted by tokenization).
  const files = {
    ...input.bundle.files,
    [ENTRY_PATH]: input.entry,
  };

  const dependencies: Record<string, string> = {
    ...input.bundle.externalDeps,
    ...(input.providerDeps ?? {}),
  };

  return {
    files,
    entryPath: ENTRY_PATH,
    template: input.template,
    dependencies,
    renderability,
    notes: [...notes, ...stubDisclosures(input.bundle), ...input.bundle.warnings],
  };
}
