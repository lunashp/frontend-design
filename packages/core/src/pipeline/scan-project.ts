/** Convenience wrapper: one-shot scan of a project into a serializable ScanResult. */

import type { ProjectRef } from '../types/project.js';
import type { ScanResult } from '../types/artifact.js';
import { EngineSession, type EngineSessionOptions } from './session.js';

export async function scanProject(
  ref: ProjectRef,
  options: EngineSessionOptions = {},
): Promise<ScanResult> {
  const session = await EngineSession.create(ref, options);
  return session.scan();
}
