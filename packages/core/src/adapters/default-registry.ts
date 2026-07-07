/** The default adapter registry: React now; Vue etc. register here later. */

import { AdapterRegistry } from './registry.js';
import { reactAdapter } from './react/react-adapter.js';

export function createDefaultRegistry(): AdapterRegistry {
  return new AdapterRegistry().register(reactAdapter);
}
