import { useEffect, useState } from 'react';
import type { ScanController } from './useScan.js';
import styles from './ScanForm.module.css';

export function ScanForm({ controller }: { controller: ScanController }) {
  const { status, defaultProject, progress, error, scan } = controller;
  const [path, setPath] = useState('');

  useEffect(() => {
    if (defaultProject && !path) setPath(defaultProject);
  }, [defaultProject, path]);

  const scanning = status === 'scanning';

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        // Submitting is a deliberate act — always re-read the project from disk,
        // so "Re-scan" picks up edits the cached result predates.
        scan(path.trim() || undefined, { force: true });
      }}
    >
      <label className={styles.field}>
        <span className="eyebrow">Target project</span>
        <input
          className={styles.input}
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/absolute/path/to/react-project"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </label>

      <button type="submit" className={styles.scan} disabled={scanning}>
        {scanning ? 'Scanning…' : status === 'ready' ? 'Re-scan' : 'Scan project'}
      </button>

      {scanning && progress && (
        <div className={styles.progress}>
          <div className={styles.progressBar}>
            <span style={{ width: `${Math.round((progress.ratio ?? 0.15) * 100)}%` }} />
          </div>
          <span className={styles.progressText}>
            <span className={styles.phase}>{progress.phase}</span>
            {progress.message}
          </span>
        </div>
      )}

      {status === 'error' && error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
