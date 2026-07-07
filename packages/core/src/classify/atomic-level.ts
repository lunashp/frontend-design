/** Atomic-design level heuristic from a component's structural signals. */

import type { AtomicLevel, ClassificationSignals } from '../types/component.js';

const PAGE_NAME = /(?:Page|Screen|View)$/;

export function atomicLevel(name: string, s: ClassificationSignals): AtomicLevel {
  if (PAGE_NAME.test(name) && s.childComponentCount >= 1) return 'page';
  if (s.childComponentCount === 0) return 'atom';
  if (s.childComponentCount <= 3 && !s.usesDataFetching && !s.usesStore) return 'molecule';
  return 'organism';
}
