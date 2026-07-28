import { useCallback, useState } from 'react';
import type { ComponentSummary } from '../../api/types.js';
import { buildCatalogHtml, catalogFileNameForRoot } from './build-catalog.js';
import { captureThumbnails } from './capture-thumbnails.js';
import { downloadHtml } from './download-html.js';
import styles from './ExportCatalogButton.module.css';

/**
 * Header affordance that exports the CURRENT gallery view as a self-contained
 * `.html` catalog a teammate can open with no tool — for a design-system audit,
 * onboarding, or review. Everything happens client-side from the scan result the
 * app already holds: no host route, no live render, no network. The HTML build
 * itself is a pure, unit-tested function (build-catalog.ts); this component owns
 * only the click-to-download wiring, the one part the no-jsdom tests can't cover.
 *
 * WHY the shown set, not all: exporting exactly what is on screen (after the
 * filters/search) is the least surprising — "share what I'm looking at". The
 * full scanned design count still rides along in the header as "N of M" context.
 *
 * Thumbnails are captured (as inline data URIs) before the HTML is built, so the
 * shared file SHOWS each component instead of a monogram. That is a network step,
 * so the click is async with a progress label; a component without a thumbnail
 * (code-only) just keeps its monogram, and a capture is never fatal.
 */
export function ExportCatalogButton({
  components,
  projectRoot,
  framework,
  totalComponents,
}: {
  /** The current filtered/shown components — exactly what the gallery displays. */
  components: readonly ComponentSummary[];
  projectRoot: string;
  framework: string;
  /** Full scanned design set, for the header's "showing N of M" line. */
  totalComponents: number;
}) {
  // null = idle; a number = capturing, that many thumbnails done so far.
  const [captured, setCaptured] = useState<number | null>(null);
  const busy = captured !== null;

  const onClick = useCallback(async () => {
    if (busy) return;
    setCaptured(0);
    try {
      const ids = components.map((c) => c.descriptor.id);
      const thumbnails = await captureThumbnails(projectRoot, ids, (done) => setCaptured(done));
      const now = new Date();
      const html = buildCatalogHtml({
        projectRoot,
        framework,
        components,
        totalComponents,
        generatedAt: now,
        thumbnails,
      });
      downloadHtml(catalogFileNameForRoot(projectRoot, now), html);
    } finally {
      setCaptured(null);
    }
  }, [busy, components, projectRoot, framework, totalComponents]);

  const empty = components.length === 0;
  const label = empty
    ? 'Export catalog — nothing in view to export'
    : `Export ${components.length} component${components.length === 1 ? '' : 's'} as a shareable catalog`;

  return (
    <button
      type="button"
      className={styles.button}
      onClick={onClick}
      disabled={empty || busy}
      aria-label={label}
      title={label}
      aria-busy={busy}
    >
      <span className={styles.icon} aria-hidden>
        ↥
      </span>
      {busy ? `Capturing… ${captured}/${components.length}` : 'Export'}
    </button>
  );
}
