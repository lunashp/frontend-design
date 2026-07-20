import { useMemo } from 'react';
import styles from './SandboxView.module.css';

/**
 * Renders the component in an iframe served by @ce/host, which bundles it
 * locally against the target's own node_modules — no external CDN. The iframe is
 * sandboxed to an opaque origin (allow-scripts only) so the bundled target code
 * can't reach the host API or the parent page.
 */
export function LocalPreview({ projectRoot, id }: { projectRoot: string; id: string }) {
  const src = useMemo(
    () => `/api/preview?path=${encodeURIComponent(projectRoot)}&id=${encodeURIComponent(id)}`,
    [projectRoot, id],
  );
  return (
    <div className={styles.stage}>
      <iframe
        className={styles.preview}
        src={src}
        title="Component preview"
        sandbox="allow-scripts"
        style={{ width: '100%', height: '100%', border: '0' }}
      />
    </div>
  );
}
