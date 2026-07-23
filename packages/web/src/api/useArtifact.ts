import { useEffect, useState } from 'react';
import { getArtifact } from './client.js';
import type { ComponentArtifact } from './types.js';

type Status = 'idle' | 'loading' | 'ready' | 'error';

export interface ArtifactState {
  status: Status;
  artifact: ComponentArtifact | null;
  error: string | null;
}

/**
 * Process-lifetime memo of built artifacts, keyed by project + id.
 *
 * Building an artifact is a full engine bundle+scaffold on the host. The
 * inspector only asks for it while a preview/portable/customize tab is open, so
 * every Details <-> Preview bounce previously dropped the artifact (id set to
 * null) and refetched from scratch on return — a visible multi-second rebuild
 * for code that never changed. A module-level cache makes a re-open instant.
 *
 * A mutable Map is deliberate here: this is a cache, not application state. It
 * lives outside React so it survives unmount and is shared across every hook
 * instance. Entries are keyed on the exact (projectRoot, id) that produced them,
 * so a different project or component never reads a stale build.
 */
const artifactCache = new Map<string, ComponentArtifact>();

export function artifactCacheKey(projectRoot: string, id: string): string {
  return `${projectRoot}::${id}`;
}

export function getCachedArtifact(key: string): ComponentArtifact | undefined {
  return artifactCache.get(key);
}

export function setCachedArtifact(key: string, artifact: ComponentArtifact): void {
  artifactCache.set(key, artifact);
}

/** Test seam: reset the memo so cache behaviour can be asserted in isolation. */
export function clearArtifactCache(): void {
  artifactCache.clear();
}

/**
 * Lazily builds a component's full artifact (bundle + sandbox spec) on demand.
 * Fetched once at the inspector level and shared by the Preview and Portable tabs.
 * A cache hit resolves synchronously so re-opening a component never re-bundles.
 */
export function useArtifact(projectRoot: string, id: string | null): ArtifactState {
  const [state, setState] = useState<ArtifactState>({
    status: 'idle',
    artifact: null,
    error: null,
  });

  useEffect(() => {
    if (!id || !projectRoot) {
      setState({ status: 'idle', artifact: null, error: null });
      return;
    }

    const key = artifactCacheKey(projectRoot, id);
    const cached = getCachedArtifact(key);
    if (cached) {
      // No rebuild on a re-open: the same build the host already produced.
      setState({ status: 'ready', artifact: cached, error: null });
      return;
    }

    let active = true;
    setState({ status: 'loading', artifact: null, error: null });
    getArtifact(projectRoot, id)
      .then((a) => {
        setCachedArtifact(key, a);
        if (active) setState({ status: 'ready', artifact: a, error: null });
      })
      .catch(
        (e: unknown) =>
          active &&
          setState({
            status: 'error',
            artifact: null,
            error: e instanceof Error ? e.message : 'Failed to build artifact',
          }),
      );
    return () => {
      active = false;
    };
  }, [projectRoot, id]);

  return state;
}
