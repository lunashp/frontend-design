/** Component kind heuristic: presentational vs container vs layout. */

import type { ClassificationSignals, ComponentKind } from '../types/component.js';
import { appContextConsumers } from './styling-context.js';

const LAYOUT_NAME = /(Layout|Grid|Stack|Container|Row|Col|Flex|Spacer|Section|Wrapper)$/;

export function componentKind(name: string, s: ClassificationSignals): ComponentKind {
  if (s.usesStore || s.usesDataFetching) return 'container';
  if (LAYOUT_NAME.test(name)) return 'layout';
  // Styling contexts (useTheme & co.) are deliberately not a container signal.
  if (s.usesRouter || appContextConsumers(s.contextConsumers).length > 0) return 'container';
  return 'presentational';
}
