/** Component kind heuristic: presentational vs container vs layout. */

import type { ClassificationSignals, ComponentKind } from '../types/component.js';

const LAYOUT_NAME = /(Layout|Grid|Stack|Container|Row|Col|Flex|Spacer|Section|Wrapper)$/;

export function componentKind(name: string, s: ClassificationSignals): ComponentKind {
  if (s.usesStore || s.usesDataFetching) return 'container';
  if (LAYOUT_NAME.test(name)) return 'layout';
  if (s.usesRouter || s.contextConsumers.length > 0) return 'container';
  return 'presentational';
}
