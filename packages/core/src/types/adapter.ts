/**
 * The pluggable per-framework seam. React is one implementation; Vue etc. slot
 * in later without touching core. Core references ONLY this interface.
 */

import type { Framework, LoadedProject, ProjectRef } from './project.js';
import type {
  ClassificationSignals,
  ComponentDescriptor,
} from './component.js';
import type { PropModel } from './prop-model.js';
import type { PortableBundle } from './portable-bundle.js';
import type { StyleStrategyId } from './style.js';
import type { SandpackTemplate } from './sandpack-spec.js';

export interface DetectResult {
  readonly matches: boolean;
  readonly confidence: number;
}

/**
 * An opaque, adapter-created handle over the loaded project (the React impl
 * wraps a ts-morph `Project`). Core passes it back to the adapter untouched.
 */
export interface FrameworkProgram {
  readonly framework: Framework;
  readonly project: LoadedProject;
  /** Adapter-private handle; never inspected by core. */
  readonly handle: unknown;
}

/** Real theme/messages bundled into a preview for a faithful render. */
export interface PreviewContext {
  /** The app's real theme: bundle-relative path + export name. */
  readonly theme?: { readonly path: string; readonly exportName: string };
  /** Bundle-relative path of a real i18n message catalogue (JSON). */
  readonly messagesPath?: string;
}

/** Generated context providers that wrap the mounted component in the sandbox. */
export interface ProviderStubResult {
  /** Full source of a `Providers` component file (or empty if none needed). */
  readonly providersFile: string;
  /** e.g. `<Providers>` / `</Providers>` — wraps the component in the entry. */
  readonly wrapperJsxOpen: string;
  readonly wrapperJsxClose: string;
  /** Import lines the entry file needs for the providers. */
  readonly imports: string;
  /** Extra sandbox deps the providers require: name -> version. */
  readonly dependencies: Readonly<Record<string, string>>;
  /** Context the stubber could not satisfy (downgrades renderability). */
  readonly unresolved: readonly string[];
}

export interface BuildEntryInput {
  readonly descriptor: ComponentDescriptor;
  readonly bundle: PortableBundle;
  readonly sampleProps: Readonly<Record<string, unknown>>;
  readonly providers: ProviderStubResult;
  /** Path of the token stylesheet to import, e.g. `/tokens.css`. */
  readonly tokenCssPath: string;
}

export interface FrameworkAdapter {
  readonly id: Framework;

  // Detection & program setup
  detect(project: ProjectRef): DetectResult;
  createProgram(project: LoadedProject): FrameworkProgram;

  // Discovery & metadata
  discoverComponents(program: FrameworkProgram): readonly ComponentDescriptor[];
  extractProps(descriptor: ComponentDescriptor, program: FrameworkProgram): PropModel;
  extractSignals(
    descriptor: ComponentDescriptor,
    program: FrameworkProgram,
  ): ClassificationSignals;

  // Styling strategies possible for this framework
  styleStrategies(): readonly StyleStrategyId[];

  // Sandbox generation
  sandpackTemplate(): SandpackTemplate;
  buildEntry(input: BuildEntryInput): string;
  generateProviderStubs(
    descriptor: ComponentDescriptor,
    program: FrameworkProgram,
    /** The bundle's external deps, so stubs match what the sandbox installs. */
    deps: Readonly<Record<string, string>>,
    /** Real theme/messages bundled in for a faithful preview, if available. */
    preview?: PreviewContext,
  ): ProviderStubResult;
}
