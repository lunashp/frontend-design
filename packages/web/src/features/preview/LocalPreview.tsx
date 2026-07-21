import { useEffect, useMemo, useRef } from 'react';
import styles from './SandboxView.module.css';

/**
 * Renders the component in an iframe served by @ce/host, which bundles it
 * locally against the target's own node_modules — no external CDN. The iframe is
 * sandboxed to an opaque origin (allow-scripts only) so the bundled target code
 * can't reach the host API or the parent page.
 *
 * For Customize: `tokenOverrides` (CSS var name → value) are posted to the iframe
 * and applied live with no rebundle; `propOverrides` change the mounted props and
 * so are encoded in the src (the host rebuilds the bundle for them).
 */
export function LocalPreview({
  projectRoot,
  id,
  tokenOverrides,
  propOverrides,
}: {
  projectRoot: string;
  id: string;
  tokenOverrides?: Readonly<Record<string, string>>;
  propOverrides?: Readonly<Record<string, unknown>>;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const src = useMemo(() => {
    const params = new URLSearchParams({ path: projectRoot, id });
    if (propOverrides && Object.keys(propOverrides).length > 0) {
      params.set('props', JSON.stringify(propOverrides));
    }
    return `/api/preview?${params.toString()}`;
  }, [projectRoot, id, propOverrides]);

  const tokensJson = useMemo(() => JSON.stringify(tokenOverrides ?? {}), [tokenOverrides]);

  // Post token overrides on every change and once the iframe (re)loads.
  useEffect(() => {
    const post = () => iframeRef.current?.contentWindow?.postMessage(
      { type: 'ce:tokens', tokens: JSON.parse(tokensJson) as Record<string, string> },
      '*',
    );
    post();
    const el = iframeRef.current;
    el?.addEventListener('load', post);
    return () => el?.removeEventListener('load', post);
  }, [tokensJson, src]);

  return (
    <div className={styles.stage}>
      <iframe
        ref={iframeRef}
        className={styles.preview}
        src={src}
        title="Component preview"
        sandbox="allow-scripts"
        style={{ width: '100%', height: '100%', border: '0' }}
      />
    </div>
  );
}
