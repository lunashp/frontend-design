/**
 * Registry of framework adapters, keyed by framework id. Core resolves the
 * right adapter for a project through this; adding a framework = registering
 * one more adapter.
 */

import type { FrameworkAdapter } from '../types/adapter.js';
import type { Framework, ProjectRef } from '../types/project.js';
import { UnsupportedFrameworkError } from '../util/errors.js';

export class AdapterRegistry {
  private readonly adapters = new Map<string, FrameworkAdapter>();

  register(adapter: FrameworkAdapter): this {
    this.adapters.set(adapter.id, adapter);
    return this;
  }

  has(id: Framework): boolean {
    return this.adapters.has(id);
  }

  get(id: Framework): FrameworkAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new UnsupportedFrameworkError(id);
    return adapter;
  }

  list(): readonly FrameworkAdapter[] {
    return [...this.adapters.values()];
  }

  /** Highest-confidence adapter whose `detect()` matches, or null. */
  detect(ref: ProjectRef): FrameworkAdapter | null {
    let best: { adapter: FrameworkAdapter; confidence: number } | null = null;
    for (const adapter of this.adapters.values()) {
      const result = adapter.detect(ref);
      if (result.matches && (!best || result.confidence > best.confidence)) {
        best = { adapter, confidence: result.confidence };
      }
    }
    return best?.adapter ?? null;
  }
}
