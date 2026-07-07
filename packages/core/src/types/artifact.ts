/**
 * The universal contract between the engine and every consumer (web app, MCP).
 * Versioned from day one — change deliberately.
 */

import type { ComponentDescriptor, Classification } from './component.js';
import type { PropModel } from './prop-model.js';
import type { PortableBundle } from './portable-bundle.js';
import type { TokenModel } from './token-model.js';
import type { SandpackSpec } from './sandpack-spec.js';

export const ARTIFACT_VERSION = 1 as const;
export type ArtifactVersion = typeof ARTIFACT_VERSION;

/**
 * Lightweight per-component record for the gallery LIST (P1). Cheap to compute
 * for every component in a project.
 */
export interface ComponentSummary {
  readonly descriptor: ComponentDescriptor;
  readonly classification: Classification;
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

/** Result of a whole-project scan (P1). */
export interface ScanResult {
  readonly artifactVersion: ArtifactVersion;
  readonly projectRoot: string;
  readonly framework: string;
  readonly components: readonly ComponentSummary[];
  readonly warnings: readonly string[];
}
