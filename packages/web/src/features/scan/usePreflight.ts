import { useCallback, useState } from 'react';
import { getPreflight } from '../../api/client.js';
import type { ProjectPreflight } from '../../api/types.js';

export interface PreflightController {
  preflight: ProjectPreflight | null;
  loading: boolean;
  /** Fetch the profile for `path` (or the host's default project when omitted). */
  load: (path?: string) => void;
}

/**
 * Loads the cheap pre-scan profile. Kept separate from useScan so the profile
 * can render the moment it resolves — well before a multi-minute scan finishes —
 * and so a preflight failure never disturbs the scan's own state machine. A
 * failed fetch simply clears the profile rather than surfacing an error: the
 * scan path already owns error reporting.
 */
export function usePreflight(): PreflightController {
  const [preflight, setPreflight] = useState<ProjectPreflight | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback((path?: string) => {
    setLoading(true);
    getPreflight(path)
      .then(setPreflight)
      .catch(() => setPreflight(null))
      .finally(() => setLoading(false));
  }, []);

  return { preflight, loading, load };
}
