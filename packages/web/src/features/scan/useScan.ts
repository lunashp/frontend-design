import { useCallback, useEffect, useState } from 'react';
import { connectProgress, getHealth, scanProject } from '../../api/client.js';
import type { ProgressEvent, ScanResult } from '../../api/types.js';

export type ScanStatus = 'idle' | 'scanning' | 'ready' | 'error';

export interface ScanController {
  status: ScanStatus;
  result: ScanResult | null;
  error: string | null;
  progress: ProgressEvent | null;
  defaultProject: string | null;
  scan: (path?: string) => void;
}

export function useScan(): ScanController {
  const [status, setStatus] = useState<ScanStatus>('idle');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [defaultProject, setDefaultProject] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getHealth()
      .then((h) => active && setDefaultProject(h.defaultProject))
      .catch(() => {});
    const unsub = connectProgress((e) => active && setProgress(e));
    return () => {
      active = false;
      unsub();
    };
  }, []);

  const scan = useCallback((path?: string) => {
    setStatus('scanning');
    setError(null);
    setProgress(null);
    scanProject(path)
      .then((r) => {
        setResult(r);
        setStatus('ready');
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Scan failed');
        setStatus('error');
      });
  }, []);

  return { status, result, error, progress, defaultProject, scan };
}
