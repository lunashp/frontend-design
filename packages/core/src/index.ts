/**
 * @ce/core — framework-agnostic engine.
 *
 * Public surface: type contracts, the adapter registry, and the high-level
 * pipeline functions (scanProject, buildArtifact, customizeArtifact). The engine
 * NEVER imports Sandpack; it emits serializable artifacts consumed identically
 * by the web app and the MCP server.
 */

export const ENGINE_VERSION = '0.0.0';

export * from './types/index.js';

export { AdapterRegistry } from './adapters/registry.js';
export { createDefaultRegistry } from './adapters/default-registry.js';
export { reactAdapter } from './adapters/react/react-adapter.js';
export type {
  FrameworkAdapter,
  FrameworkProgram,
  DetectResult,
  ProviderStubResult,
  BuildEntryInput,
} from './adapters/framework-adapter.js';

// Pipeline
export { EngineSession, type EngineSessionOptions } from './pipeline/session.js';
export { scanProject } from './pipeline/scan-project.js';

// Project loading + classification
export { loadProject, type LoadProjectOptions } from './project/load-project.js';
export { classify } from './classify/classifier.js';
export { atomicLevel } from './classify/atomic-level.js';
export { componentKind } from './classify/kind.js';
export { contextDependencyScore } from './classify/context-score.js';

// Portability + sandbox (P2)
export { buildImportGraph, type ImportGraph } from './graph/import-graph.js';
export { resolvePortability } from './portability/portability-resolver.js';
export { generateSampleProps } from './sandbox/sample-props.js';
export { scaffoldSandbox, type ScaffoldInput } from './sandbox/sandbox-scaffolder.js';

// Tokenization + customization (P4)
export {
  tokenizeBundle,
  emitTokensCss,
  TOKENS_CSS_PATH,
  type TokenizeResult,
} from './tokenize/tokenization-transform.js';
export { categoryFor } from './tokenize/categorize.js';

export {
  customizeArtifact,
  customizeSpec,
  patchEntryProps,
  injectTokenOverrides,
  type CustomizedComponent,
} from './customize/customize-artifact.js';
// The design-override surface is state-aware (`hover:background`, …). Consumers
// import bare '@ce/core' and cannot deep-import, so the state-aware half
// (blocks, key parsing, the state tables) is exported alongside the flat
// resting-state emitters — otherwise every consumer re-derives it, badly.
export {
  emitDesignDeclarations,
  emitDesignBlocks,
  emitDesignCss,
  emitDesignStyleSheet,
  emitDesignRule,
  splitDesignOverrides,
  parseDesignKey,
  designStateKey,
  isDesignKey,
  DESIGN_GROUPS,
  DESIGN_FIELDS,
  DESIGN_STATES,
  DESIGN_STATE_SELECTORS,
  type DesignControlKind,
  type DesignOption,
  type DesignField,
  type DesignGroup,
  type DesignState,
  type DesignBlock,
} from './customize/design-overrides.js';

export {
  EngineError,
  ReadOnlyViolationError,
  ProjectLoadError,
  UnsupportedFrameworkError,
  ComponentNotFoundError,
} from './util/errors.js';

export {
  createLogger,
  NOOP_LOGGER,
  type Logger,
  type LogLevel,
  type ProgressEvent,
  type ProgressListener,
} from './util/logger.js';

export {
  createReadOnlyFs,
  type ReadOnlyFs,
  type FileStat,
} from './util/fs-readonly.js';

export {
  createWorkspace,
  type Workspace,
  type CreateWorkspaceOptions,
} from './util/workspace.js';

export { isInside, shortHash, toBundlePath } from './util/paths.js';
