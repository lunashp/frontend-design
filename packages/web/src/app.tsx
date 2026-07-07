import { useEffect, useMemo, useState } from 'react';
import { useScan } from './features/scan/useScan.js';
import { ScanForm } from './features/scan/ScanForm.js';
import { Filters } from './features/gallery/Filters.js';
import { CollectionSummary } from './features/gallery/CollectionSummary.js';
import { GalleryGrid } from './features/gallery/GalleryGrid.js';
import { Inspector } from './features/inspector/Inspector.js';
import { applyFilters, DEFAULT_FILTERS, type FilterState } from './lib/filter.js';
import styles from './app.module.css';

export function App() {
  const scan = useScan();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [autoScanned, setAutoScanned] = useState(false);

  // Auto-scan the host's default project once, for an immediate first view.
  useEffect(() => {
    if (!autoScanned && scan.status === 'idle' && scan.defaultProject) {
      setAutoScanned(true);
      scan.scan();
    }
  }, [autoScanned, scan]);

  const result = scan.result;
  const filtered = useMemo(
    () => (result ? applyFilters(result.components, filters) : []),
    [result, filters],
  );
  const selected = result?.components.find((c) => c.descriptor.id === selectedId) ?? null;

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.mark} aria-hidden>
            ⌘
          </span>
          <div className={styles.brandText}>
            <span className={styles.brandName}>Component Explorer</span>
            <span className={styles.brandTag}>read-only design harvester</span>
          </div>
        </div>
        {result && (
          <div className={styles.projectChip} title={result.projectRoot}>
            <span className={styles.frameworkDot} />
            <span className={styles.frameworkName}>{result.framework}</span>
            <span className={styles.projectPath}>
              {result.projectRoot.split('/').slice(-1)[0]}
            </span>
          </div>
        )}
      </header>

      <aside className={styles.sidebar}>
        <ScanForm controller={scan} />
        {result && <Filters filters={filters} onChange={setFilters} />}
      </aside>

      <main className={styles.main}>
        {!result && scan.status !== 'error' ? (
          <div className={styles.hero}>
            <span className="eyebrow">Point it at a real codebase</span>
            <h1 className={styles.heroTitle}>
              Every component in a project,
              <br />
              catalogued and classified.
            </h1>
            <p className={styles.heroBody}>
              Component Explorer reads a React&nbsp;+&nbsp;TypeScript project — strictly read-only —
              and sorts its UI into an atomic taxonomy. Open one to inspect its props and how much
              app context it needs to render in isolation.
            </p>
            {scan.status === 'scanning' && <p className={styles.heroScanning}>Scanning…</p>}
          </div>
        ) : result ? (
          <div className={styles.catalogue}>
            <CollectionSummary components={result.components} shown={filtered.length} />
            {result.warnings.length > 0 && (
              <p className={styles.warnings}>
                {result.warnings.length} component
                {result.warnings.length === 1 ? '' : 's'} could not be fully analyzed.
              </p>
            )}
            <GalleryGrid
              components={filtered}
              projectRoot={result.projectRoot}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>
        ) : (
          <div className={styles.hero}>
            <span className="eyebrow">Scan failed</span>
            <h1 className={styles.heroTitle}>Couldn't read that project.</h1>
            <p className={styles.heroBody}>{scan.error}</p>
          </div>
        )}
      </main>

      <div className={styles.inspector}>
        <Inspector
          component={selected}
          projectRoot={result?.projectRoot ?? ''}
          onClose={() => setSelectedId(null)}
        />
      </div>
    </div>
  );
}
