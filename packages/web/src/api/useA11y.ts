import { useEffect, useState } from 'react';
import { getA11y } from './client.js';
import type { A11yResponse } from './types.js';

type Status = 'idle' | 'loading' | 'ready' | 'error';

export interface A11yState {
  status: Status;
  response: A11yResponse | null;
  error: string | null;
}

/**
 * Process-lifetime memo of accessibility audits, keyed by project + id.
 *
 * The audit is HEAVIER than a thumbnail — it renders the component in a headless
 * browser and runs axe — so it is fetched lazily, only when a component is opened
 * in the inspector (the Details tab's Accessibility section), NEVER per gallery
 * card. A module-level cache makes a re-open instant and survives Details<->other
 * tab bounces without re-auditing. Keyed on the exact (projectRoot, id), so a
 * different project or component never reads a stale audit.
 *
 * A mutable Map is deliberate: this is a cache, not application state. The host
 * has its own on-disk cache too; this one just spares the round-trip.
 */
const a11yCache = new Map<string, A11yResponse>();

export function a11yCacheKey(projectRoot: string, id: string): string {
  return `${projectRoot}::${id}`;
}

export function getCachedA11y(key: string): A11yResponse | undefined {
  return a11yCache.get(key);
}

export function setCachedA11y(key: string, response: A11yResponse): void {
  a11yCache.set(key, response);
}

/** Test seam: reset the memo so cache behaviour can be asserted in isolation. */
export function clearA11yCache(): void {
  a11yCache.clear();
}

/**
 * Lazily fetch a component's accessibility audit. Called from the Details tab's
 * Accessibility section, so a component that is never opened is never audited. A
 * cache hit resolves synchronously so re-opening never re-audits.
 */
export function useA11y(projectRoot: string, id: string | null): A11yState {
  const [state, setState] = useState<A11yState>({ status: 'idle', response: null, error: null });

  useEffect(() => {
    if (!id || !projectRoot) {
      setState({ status: 'idle', response: null, error: null });
      return;
    }

    const key = a11yCacheKey(projectRoot, id);
    const cached = getCachedA11y(key);
    if (cached) {
      setState({ status: 'ready', response: cached, error: null });
      return;
    }

    let active = true;
    setState({ status: 'loading', response: null, error: null });
    getA11y(projectRoot, id)
      .then((r) => {
        setCachedA11y(key, r);
        if (active) setState({ status: 'ready', response: r, error: null });
      })
      .catch(
        (e: unknown) =>
          active &&
          setState({
            status: 'error',
            response: null,
            error: e instanceof Error ? e.message : 'Failed to run the accessibility audit',
          }),
      );
    return () => {
      active = false;
    };
  }, [projectRoot, id]);

  return state;
}
