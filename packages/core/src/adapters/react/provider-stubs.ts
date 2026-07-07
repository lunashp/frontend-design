/**
 * Generates context provider stubs (ThemeProvider, router, query client, …) that
 * wrap a component so it renders in isolation. P1 ships a no-op (no providers);
 * P2 fills this in based on the component's detected context consumers.
 */

import type { ProviderStubResult } from '../../types/adapter.js';
import type { ComponentDescriptor } from '../../types/component.js';
import type { ReactProgramHandle } from './ts-program.js';

const NONE: ProviderStubResult = {
  providersFile: '',
  wrapperJsxOpen: '',
  wrapperJsxClose: '',
  imports: '',
  dependencies: {},
  unresolved: [],
};

export function generateReactProviderStubs(
  _descriptor: ComponentDescriptor,
  _handle: ReactProgramHandle,
): ProviderStubResult {
  return NONE;
}
