/**
 * A serializable description of how to render a component in an isolated
 * sandbox. The engine emits this; the web app maps it to Sandpack props.
 * The engine NEVER imports Sandpack itself.
 */

import type { FileMap } from './portable-bundle.js';

export type SandpackTemplate = 'react-ts' | 'vue-ts';

/**
 * - `full`: renders with (near) zero stubs.
 * - `stubbed`: renders but needed app context was faked; may look off.
 * - `code-only`: cannot render live (e.g. un-CDN-able deps); show code + deps only.
 */
export type Renderability = 'full' | 'stubbed' | 'code-only';

export interface SandpackSpec {
  readonly files: FileMap;
  /** Entry file, usually `/index.tsx`. */
  readonly entryPath: string;
  readonly template: SandpackTemplate;
  /** External deps to load in the sandbox: name -> version range. */
  readonly dependencies: Readonly<Record<string, string>>;
  readonly renderability: Renderability;
  /** Notes explaining stubbing/limitations, surfaced in the UI. */
  readonly notes: readonly string[];
}
