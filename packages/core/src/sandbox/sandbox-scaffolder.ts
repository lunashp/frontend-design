/**
 * Assembles a serializable SandpackSpec from a component's portable bundle +
 * generated entry. Emits NO Sandpack import — just the spec (files, deps,
 * template, renderability). The web app maps this to <SandpackProvider> props.
 */

import type { Classification } from '../types/component.js';
import type { PortableBundle } from '../types/portable-bundle.js';
import type { PropModel } from '../types/prop-model.js';
import type { Renderability, SandpackSpec, SandpackTemplate } from '../types/sandpack-spec.js';

/** Packages that cannot execute in the browser sandbox. */
const UNSANDBOXABLE = [/^next(\/|$)/, /^react-dom\/server/, /^node:/, /^(fs|path|crypto|os)$/];

/** Dep version specifiers Sandpack's CDN installer cannot resolve. */
const UNRESOLVABLE_VERSION = /^(workspace:|catalog:|link:|file:|portal:|git\+|github:|https?:)/;

const ENTRY_PATH = '/index.tsx';

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
}

function unfilledRequiredProps(input: ScaffoldInput): string[] {
  return input.propModel.props
    .filter((p) => p.required && !(p.name in input.sampleProps))
    .map((p) => p.name);
}

function computeRenderability(input: ScaffoldInput): {
  renderability: Renderability;
  notes: string[];
} {
  const deps = Object.entries(input.bundle.externalDeps);
  const notes: string[] = [];

  const blockedName = deps.filter(([name]) => UNSANDBOXABLE.some((re) => re.test(name)));
  const blockedVersion = deps.filter(([, version]) => UNRESOLVABLE_VERSION.test(version));

  if (input.bundle.incomplete) {
    notes.push('Some local files could not be resolved, so the bundle is incomplete.');
    return { renderability: 'code-only', notes };
  }
  if (blockedName.length > 0) {
    notes.push(`Depends on packages that can't run in the sandbox: ${blockedName.map(([n]) => n).join(', ')}.`);
    return { renderability: 'code-only', notes };
  }
  if (blockedVersion.length > 0) {
    notes.push(
      `Depends on packages with non-installable versions (e.g. workspace/local): ${blockedVersion.map(([n]) => n).join(', ')}.`,
    );
    return { renderability: 'code-only', notes };
  }

  const missing = unfilledRequiredProps(input);
  const contextScore = input.classification.contextDependencyScore;

  if (missing.length > 0) {
    notes.push(`Required prop(s) couldn't be auto-filled: ${missing.join(', ')} — may error.`);
    return { renderability: 'stubbed', notes };
  }
  if (contextScore === 0) {
    return { renderability: 'full', notes };
  }

  notes.push(`Needs app context (score ${contextScore}). Rendered without providers — it may look off or error.`);
  return { renderability: 'stubbed', notes };
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
    notes: [...notes, ...input.bundle.warnings],
  };
}
