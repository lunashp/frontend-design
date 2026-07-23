import { useCallback } from 'react';
import type { ComponentSummary } from '../../api/types.js';
import { buildCatalogHtml, catalogFileNameForRoot } from './build-catalog.js';
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
  const onClick = useCallback(() => {
    const now = new Date();
    const html = buildCatalogHtml({
      projectRoot,
      framework,
      components,
      totalComponents,
      generatedAt: now,
    });
    downloadHtml(catalogFileNameForRoot(projectRoot, now), html);
  }, [components, projectRoot, framework, totalComponents]);

  const empty = components.length === 0;
  const label = empty
    ? 'Export catalog — nothing in view to export'
    : `Export ${components.length} component${components.length === 1 ? '' : 's'} as a shareable catalog`;

  return (
    <button
      type="button"
      className={styles.button}
      onClick={onClick}
      disabled={empty}
      aria-label={label}
      title={label}
    >
      <span className={styles.icon} aria-hidden>
        ↥
      </span>
      Export
    </button>
  );
}
