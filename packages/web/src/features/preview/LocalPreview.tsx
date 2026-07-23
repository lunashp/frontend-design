import { useEffect, useMemo, useRef } from 'react';
import { previewDesignMessage } from '../../lib/customize.js';
import type { PreviewBacking } from './backing.js';
import styles from './SandboxView.module.css';

/**
 * Renders the component in an iframe served by @ce/host, which bundles it
 * locally against the target's own node_modules — no external CDN. The iframe is
 * sandboxed to an opaque origin (allow-scripts only) so the bundled target code
 * can't reach the host API or the parent page.
 *
 * For Customize: `tokenOverrides` (CSS var name → value) and `designOverrides`
 * (universal design fields, resting and per interactive state) are posted to the
 * iframe and applied live with no rebundle; `propOverrides` change the mounted
 * props and so are encoded in the src (the host rebuilds the bundle for them).
 */
export function LocalPreview({
  projectRoot,
  id,
  tokenOverrides,
  designOverrides,
  propOverrides,
  backing,
}: {
  projectRoot: string;
  id: string;
  tokenOverrides?: Readonly<Record<string, string>>;
  designOverrides?: Readonly<Record<string, string>>;
  propOverrides?: Readonly<Record<string, unknown>>;
  /**
   * Stage backing behind the iframe. Optional so existing callers (Customize)
   * keep the neutral checkerboard; omitting it renders no `data-backing`, which
   * the CSS treats as the default checker.
   */
  backing?: PreviewBacking;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const src = useMemo(() => {
    const params = new URLSearchParams({ path: projectRoot, id });
    if (propOverrides && Object.keys(propOverrides).length > 0) {
      params.set('props', JSON.stringify(propOverrides));
    }
    return `/api/preview?${params.toString()}`;
  }, [projectRoot, id, propOverrides]);

  // Serialized so the effect re-posts on a value change rather than on every
  // parent render, which is all a fresh object identity would mean.
  const tokensJson = useMemo(() => JSON.stringify(tokenOverrides ?? {}), [tokenOverrides]);
  const designJson = useMemo(() => JSON.stringify(designOverrides ?? {}), [designOverrides]);

  // Post token + design overrides on every change and once the iframe (re)loads.
  // `src` is listed on purpose so the effect re-runs when the iframe navigates and
  // re-posts overrides against the fresh document; an extra dep only re-runs, it
  // never stales a value.
  // biome-ignore lint/correctness/useExhaustiveDependencies: src is intentional — re-run the effect when the iframe navigates.
  useEffect(() => {
    const post = () => {
      const w = iframeRef.current?.contentWindow;
      if (!w) return;
      w.postMessage({ type: 'ce:tokens', tokens: JSON.parse(tokensJson) as Record<string, string> }, '*');
      w.postMessage(
        previewDesignMessage(JSON.parse(designJson) as Record<string, string>),
        '*',
      );
    };
    post();
    const el = iframeRef.current;
    el?.addEventListener('load', post);
    return () => el?.removeEventListener('load', post);
  }, [tokensJson, designJson, src]);

  return (
    <div className={styles.stage} data-backing={backing}>
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
