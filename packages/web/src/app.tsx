import { useCallback, useEffect, useMemo, useState } from 'react';
import { useScan } from './features/scan/useScan.js';
import { usePreflight } from './features/scan/usePreflight.js';
import { preflightView } from './features/scan/preflight-view.js';
import { PreflightCard } from './features/scan/PreflightCard.js';
import { ScanForm } from './features/scan/ScanForm.js';
import { Filters } from './features/gallery/Filters.js';
import { CollectionSummary } from './features/gallery/CollectionSummary.js';
import { ScanIssues } from './features/gallery/ScanIssues.js';
import { GalleryGrid } from './features/gallery/GalleryGrid.js';
import { Inspector, type Tab } from './features/inspector/Inspector.js';
import { applyFilters, DEFAULT_FILTERS, type FilterState } from './lib/filter.js';
import {
  getCustomization,
  setCustomization,
  type CustomizationMap,
  type CustomizationState,
} from './lib/customize.js';
import styles from './app.module.css';

/** Mirrors the `max-width: 1180px` breakpoint in app.module.css, below which
 *  the inspector column is gone and it becomes a modal slide-over instead. */
const COMPACT_QUERY = '(max-width: 1180px)';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export function App() {
  const scan = useScan();
  const { preflight, load: loadPreflight } = usePreflight();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [autoScanned, setAutoScanned] = useState(false);
  // Inspector state lives here, above the panes that edit it: those unmount on
  // every tab switch and every card selection, and used to take the work with
  // them. The tab is sticky too — reopening on Customize is the point.
  const [tab, setTab] = useState<Tab>('Details');
  const [customizations, setCustomizations] = useState<CustomizationMap>(() => new Map());
  const compact = useMediaQuery(COMPACT_QUERY);

  // Auto-scan the host's default project once, for an immediate first view — and
  // load its preflight profile alongside so the user sees WHAT is being scanned
  // (framework, srcDirs, install state) while the multi-minute scan runs, instead
  // of committing blind.
  useEffect(() => {
    if (!autoScanned && scan.status === 'idle' && scan.defaultProject) {
      setAutoScanned(true);
      loadPreflight(scan.defaultProject);
      scan.scan();
    }
  }, [autoScanned, scan, loadPreflight]);

  const result = scan.result;
  // Keep the profile aligned with whatever project actually got scanned — covers a
  // path typed into ScanForm, not just the default. A primitive-keyed effect so it
  // fires once per new root, never loops.
  const scannedRoot = result?.projectRoot ?? null;
  const profileRoot = preflight?.rootPath ?? null;
  useEffect(() => {
    if (scannedRoot && scannedRoot !== profileRoot) loadPreflight(scannedRoot);
  }, [scannedRoot, profileRoot, loadPreflight]);

  // Re-target the scan at a workspace member the user picked from the diagnosis.
  const scanMember = useCallback(
    (path: string) => {
      loadPreflight(path);
      scan.scan(path, { force: true });
    },
    [scan, loadPreflight],
  );

  const preflightCard = preflight
    ? preflightView(preflight, {
        status: scan.status,
        // The raw scanned count, not the filtered view: "no components found" is a
        // fact about the scan, and a filter hiding them all is not that.
        componentCount: result?.components.length ?? 0,
        error: scan.error,
      })
    : null;
  const filtered = useMemo(
    () => (result ? applyFilters(result.components, filters) : []),
    [result, filters],
  );
  const selected = result?.components.find((c) => c.descriptor.id === selectedId) ?? null;

  // Stable identity: the slide-over's focus trap keys its effect off this.
  const closeInspector = useCallback(() => setSelectedId(null), []);
  const onCustomizationChange = useCallback(
    (state: CustomizationState) =>
      setCustomizations((map) => (selectedId ? setCustomization(map, selectedId, state) : map)),
    [selectedId],
  );

  const inspector = (
    <Inspector
      component={selected}
      projectRoot={result?.projectRoot ?? ''}
      tab={tab}
      onTabChange={setTab}
      customization={getCustomization(customizations, selectedId)}
      onCustomizationChange={onCustomizationChange}
      overlay={compact}
      onClose={closeInspector}
    />
  );

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
          preflightCard ? (
            // Once the profile resolves it replaces the marketing hero: the user
            // now sees the concrete scan target, not a pitch, while scanning runs.
            <div className={styles.catalogue}>
              <PreflightCard view={preflightCard} onScanMember={scanMember} />
              {scan.status === 'scanning' && <p className={styles.heroScanning}>Scanning…</p>}
            </div>
          ) : (
            <div className={styles.hero}>
              <span className="eyebrow">Point it at a real codebase</span>
              <h1 className={styles.heroTitle}>
                Every component in a project,
                <br />
                catalogued and classified.
              </h1>
              <p className={styles.heroBody}>
                Component Explorer reads a React&nbsp;+&nbsp;TypeScript project — strictly read-only
                — and sorts its UI into an atomic taxonomy. Open one to inspect its props and how
                much app context it needs to render in isolation.
              </p>
              {scan.status === 'scanning' && <p className={styles.heroScanning}>Scanning…</p>}
            </div>
          )
        ) : result ? (
          <div className={styles.catalogue}>
            {/* A slim banner on the happy path; it expands to the diagnosis rows
                (empty gallery, missing node_modules) only when there's cause. */}
            {preflightCard && (
              <PreflightCard view={preflightCard} variant="banner" onScanMember={scanMember} />
            )}
            <CollectionSummary components={result.components} shown={filtered.length} />
            {/* Failures are named, not counted: `warnings.length` was never a
                component count in the first place, and a bare number can't be
                acted on. Scan-level findings come in typed and separate, so the
                panel never has to tell them apart from failure prose by text. */}
            <ScanIssues
              failures={result.failures}
              heuristicWarnings={result.heuristicWarnings}
              projectRoot={result.projectRoot}
              analyzed={result.components.length}
            />
            <GalleryGrid
              components={filtered}
              projectRoot={result.projectRoot}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>
        ) : preflightCard ? (
          // The old failure screen was a dead end — a bare message and nowhere to
          // go. The profile card now carries the diagnosis (the error, plus any
          // "workspace root, pick a member" route out) with full context.
          <div className={styles.catalogue}>
            <PreflightCard view={preflightCard} onScanMember={scanMember} />
          </div>
        ) : (
          <div className={styles.hero}>
            <span className="eyebrow">Scan failed</span>
            <h1 className={styles.heroTitle}>Couldn't read that project.</h1>
            <p className={styles.heroBody}>{scan.error}</p>
          </div>
        )}
      </main>

      {/* Narrow viewports have no room for a docked column, so the inspector
          becomes a modal slide-over instead of vanishing while selection
          silently kept working. */}
      {compact ? (
        selected && (
          <>
            {/* Escape and the panel's own close button are the keyboard paths;
                the scrim is the pointer one, so it stays out of the a11y tree. */}
            <div className={styles.scrim} onClick={closeInspector} aria-hidden />
            <div className={styles.slideOver}>{inspector}</div>
          </>
        )
      ) : (
        <div className={styles.inspector}>{inspector}</div>
      )}
    </div>
  );
}
