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
 * Lazily builds a component's full artifact (bundle + sandbox spec) on demand.
 * Fetched once at the inspector level and shared by the Preview and Portable tabs.
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
    let active = true;
    setState({ status: 'loading', artifact: null, error: null });
    getArtifact(projectRoot, id)
      .then((a) => active && setState({ status: 'ready', artifact: a, error: null }))
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
