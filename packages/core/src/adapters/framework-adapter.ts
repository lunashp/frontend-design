/**
 * Re-exports the pluggable framework seam. The interface itself lives in
 * `types/adapter.ts`; this module is the conventional import site for adapters
 * and keeps the load-bearing extensibility contract easy to find.
 */

export type {
  FrameworkAdapter,
  FrameworkProgram,
  DetectResult,
  ProviderStubResult,
  BuildEntryInput,
} from '../types/adapter.js';
