import { useEffect, useRef, useState } from 'react';
import { getKit } from '../../api/client.js';
import type { PortableKit } from '../../api/types.js';

export type KitStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface KitState {
  status: KitStatus;
  kit: PortableKit | null;
  error: string | null;
}

/**
 * A kit is a function of the project and the SET of ids only — order does not
 * matter — so the cache key sorts the ids. Reusing the key across renders means
 * reordering the basket or reopening the drawer never rebuilds an identical kit.
 */
export function kitCacheKey(projectRoot: string, ids: readonly string[]): string {
  return `${projectRoot}::${[...ids].sort().join(',')}`;
}

const kitCache = new Map<string, PortableKit>();

/** Test seam: reset the process-lifetime kit memo. */
export function clearKitCache(): void {
  kitCache.clear();
}

/**
 * Builds the merged kit for a set of component ids on demand, memoized by
 * (project, id-set). Mirrors `useArtifact`: a cache hit resolves synchronously so
 * reopening the kit drawer is instant, and an in-flight request is abandoned if
 * the id-set changes underneath it.
 */
export function useKit(projectRoot: string, ids: readonly string[]): KitState {
  const key = kitCacheKey(projectRoot, ids);
  const [state, setState] = useState<KitState>({ status: 'idle', kit: null, error: null });

  // The effect keys off `key` (a string over the sorted id-set), not the `ids`
  // array whose identity changes every render; a ref carries the latest ids in
  // without widening the dependency list past the primitive that actually gates it.
  const idsRef = useRef(ids);
  idsRef.current = ids;

  useEffect(() => {
    if (!projectRoot || idsRef.current.length === 0) {
      setState({ status: 'idle', kit: null, error: null });
      return;
    }

    const cached = kitCache.get(key);
    if (cached) {
      setState({ status: 'ready', kit: cached, error: null });
      return;
    }

    let active = true;
    setState({ status: 'loading', kit: null, error: null });
    getKit(projectRoot, [...idsRef.current].sort())
      .then((k) => {
        kitCache.set(key, k);
        if (active) setState({ status: 'ready', kit: k, error: null });
      })
      .catch(
        (e: unknown) =>
          active &&
          setState({
            status: 'error',
            kit: null,
            error: e instanceof Error ? e.message : 'Failed to build kit',
          }),
      );
    return () => {
      active = false;
    };
  }, [projectRoot, key]);

  return state;
}
