import { useEffect, useRef, useState } from 'react';
import { getArtifact } from '../../api/client.js';
import {
  artifactCacheKey,
  getCachedArtifact,
  setCachedArtifact,
} from '../../api/useArtifact.js';
import type { ComponentArtifact } from '../../api/types.js';

export type ArtifactsStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ArtifactsState {
  status: ArtifactsStatus;
  /** Aligned to the input id order; populated only when status is 'ready'. */
  artifacts: readonly ComponentArtifact[];
  error: string | null;
}

/** Stable change-signal over the exact id list (order matters — it is column order). */
function keyOf(projectRoot: string, ids: readonly string[]): string {
  return `${projectRoot}::${ids.join(',')}`;
}

/**
 * Load several component artifacts at once for the Compare view, reusing the SAME
 * process-lifetime cache the inspector's `useArtifact` fills. This adds no engine
 * endpoint: it fetches only the ids not already built, in parallel, and reads the
 * rest straight from cache — so comparing components the user already inspected is
 * instant, and a fresh set costs one parallel round of the existing /api/artifact.
 *
 * Mirrors `useArtifact`'s abandon-on-change contract: if the id list changes while
 * a fetch is in flight, the stale result is dropped rather than rendered.
 */
export function useArtifacts(projectRoot: string, ids: readonly string[]): ArtifactsState {
  const key = keyOf(projectRoot, ids);
  const [state, setState] = useState<ArtifactsState>({
    status: 'idle',
    artifacts: [],
    error: null,
  });

  // The effect keys off the string signal, not the array identity; a ref carries
  // the current ids in without widening the dependency list.
  const idsRef = useRef(ids);
  idsRef.current = ids;

  // `key` is the change SIGNAL over the (projectRoot, id-list) pair — the effect
  // reads the ids through the ref and looks up per-id cache keys, never the outer
  // `key` string, so Biome sees it as unused. It must stay in the deps to re-run
  // when the selection changes; without it the effect would ignore a new id set.
  // biome-ignore lint/correctness/useExhaustiveDependencies: key is the re-run signal, not a value the body reads.
  useEffect(() => {
    const current = idsRef.current;
    if (!projectRoot || current.length === 0) {
      setState({ status: 'idle', artifacts: [], error: null });
      return;
    }

    const cached = current.map((id) => getCachedArtifact(artifactCacheKey(projectRoot, id)));
    if (cached.every((a): a is ComponentArtifact => a !== undefined)) {
      // Every artifact already built — resolve without touching the host.
      setState({ status: 'ready', artifacts: cached, error: null });
      return;
    }

    let active = true;
    setState({ status: 'loading', artifacts: [], error: null });

    Promise.all(
      current.map(async (id) => {
        const cacheKey = artifactCacheKey(projectRoot, id);
        const hit = getCachedArtifact(cacheKey);
        if (hit) return hit;
        const built = await getArtifact(projectRoot, id);
        setCachedArtifact(cacheKey, built);
        return built;
      }),
    )
      .then((artifacts) => {
        if (active) setState({ status: 'ready', artifacts, error: null });
      })
      .catch(
        (e: unknown) =>
          active &&
          setState({
            status: 'error',
            artifacts: [],
            error: e instanceof Error ? e.message : 'Failed to build components',
          }),
      );

    return () => {
      active = false;
    };
  }, [projectRoot, key]);

  return state;
}
