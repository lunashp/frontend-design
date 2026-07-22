/**
 * The universal contract between the engine and every consumer (web app, MCP).
 * Versioned from day one — change deliberately.
 */

import type { ComponentDescriptor, Classification, ClassificationSignals } from './component.js';
import type { PropModel } from './prop-model.js';
import type { PortableBundle } from './portable-bundle.js';
import type { TokenModel } from './token-model.js';
import type { SandpackSpec } from './sandpack-spec.js';

/**
 * v2: `ComponentSummary.signals`, `ScanResult.failures`, and
 * `PortableBundle.stubbedModules` / `.danglingImports` added.
 */
export const ARTIFACT_VERSION = 2 as const;
export type ArtifactVersion = typeof ARTIFACT_VERSION;

/**
 * Lightweight per-component record for the gallery LIST (P1). Cheap to compute
 * for every component in a project.
 */
export interface ComponentSummary {
  readonly descriptor: ComponentDescriptor;
  readonly classification: Classification;
  /**
   * The raw signals the classification was derived from. Carried so a consumer
   * can show *why* a component was classified the way it was — and disagree —
   * instead of only seeing the verdict.
   */
  readonly signals: ClassificationSignals;
  readonly propModel: PropModel;
}

/**
 * The full artifact for a SINGLE opened component (P2–P4). Built on demand:
 * P2 adds `sandpack`, P3 adds `bundle`, P4 adds `tokenModel`.
 */
export interface ComponentArtifact extends ComponentSummary {
  readonly artifactVersion: ArtifactVersion;
  readonly bundle: PortableBundle;
  readonly tokenModel: TokenModel;
  readonly sandpack: SandpackSpec;
}

/**
 * A component discovered but not analysable. Named rather than only counted, so
 * a caller can point at the file instead of parsing a prose warning back apart.
 */
export interface ScanFailure {
  /** Descriptor id of the component that failed, i.e. `filePath#exportName`. */
  readonly componentId: string;
  readonly name: string;
  /** Absolute path in the target project (read-only reference). */
  readonly filePath: string;
  /** Why the analysis failed. */
  readonly message: string;
}

/** Result of a whole-project scan (P1). */
export interface ScanResult {
  readonly artifactVersion: ArtifactVersion;
  readonly projectRoot: string;
  readonly framework: string;
  readonly components: readonly ComponentSummary[];
  /** Structured per-component analysis failures. */
  readonly failures: readonly ScanFailure[];
  /** Human-readable notes, including a prose form of every `failures` entry. */
  readonly warnings: readonly string[];
}
