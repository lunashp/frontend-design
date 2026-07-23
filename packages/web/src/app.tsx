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
import { directoryFacets } from './lib/source-area.js';
import {
  getCustomization,
  setCustomization,
  type CustomizationMap,
  type CustomizationState,
} from './lib/customize.js';
import {
  type Basket,
  EMPTY_BASKET,
  removeFromBasket,
  toggleInBasket,
} from './features/kit/basket.js';
import { BasketContext, type BasketControls } from './features/kit/basket-context.js';
import { KitButton } from './features/kit/KitButton.js';
import { KitPane } from './features/kit/KitPane.js';
import { CompareButton } from './features/compare/CompareButton.js';
import { ComparePane, type CompareItem } from './features/compare/ComparePane.js';
import { ExportCatalogButton } from './features/catalog/ExportCatalogButton.js';
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
  // The kit basket: which components to harvest together. Component ids are
  // project-specific (hashes of file+export), so a new scan target invalidates
  // them — the basket is cleared when the scanned root changes, below.
  const [basket, setBasket] = useState<Basket>(EMPTY_BASKET);
  const [kitOpen, setKitOpen] = useState(false);
  // Compare reuses the SAME basket set (it IS "the components I'm weighing"), so
  // there is no second selection to track — only which overlay is open.
  const [compareOpen, setCompareOpen] = useState(false);
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
    () => (result ? applyFilters(result.components, filters, result.projectRoot) : []),
    [result, filters],
  );
  // The project's own directories, offered as a precise "show me shared/ui" facet.
  const facets = useMemo(
    () => (result ? directoryFacets(result.components, result.projectRoot) : []),
    [result],
  );
  const selected = result?.components.find((c) => c.descriptor.id === selectedId) ?? null;

  // Stable identity: the slide-over's focus trap keys its effect off this.
  const closeInspector = useCallback(() => setSelectedId(null), []);
  const onCustomizationChange = useCallback(
    (state: CustomizationState) =>
      setCustomizations((map) => (selectedId ? setCustomization(map, selectedId, state) : map)),
    [selectedId],
  );

  const toggleBasket = useCallback((id: string) => setBasket((b) => toggleInBasket(b, id)), []);
  const removeFromKit = useCallback((id: string) => setBasket((b) => removeFromBasket(b, id)), []);
  const closeKit = useCallback(() => setKitOpen(false), []);
  const closeCompare = useCallback(() => setCompareOpen(false), []);
  // A fresh scan target invalidates every id in the basket, so drop them and shut
  // the drawer rather than carry ids the new project has never heard of into a
  // POST /api/kit that would 404.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scannedRoot is the change SIGNAL that must re-run this reset, not a value the body reads.
  useEffect(() => {
    setBasket(EMPTY_BASKET);
    setKitOpen(false);
    setCompareOpen(false);
  }, [scannedRoot]);
  // The basket controls the gallery cards read via context — memoized so only a
  // real basket change re-renders the mounted cards.
  const basketControls: BasketControls = useMemo(
    () => ({ has: (id) => basket.has(id), toggle: toggleBasket, count: basket.size }),
    [basket, toggleBasket],
  );
  const basketIds = useMemo(() => [...basket], [basket]);
  // The basket selection with names resolved from the scan, in insertion order —
  // Compare needs names for its column headers and its "trim to 3" guidance
  // without paying to build an artifact just to read a name.
  const compareItems = useMemo<CompareItem[]>(() => {
    const names = new Map(
      result?.components.map((c) => [c.descriptor.id, c.descriptor.name]) ?? [],
    );
    return basketIds.map((id) => ({ id, name: names.get(id) ?? id }));
  }, [basketIds, result]);

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
    <BasketContext.Provider value={basketControls}>
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
            // A small right-aligned group. app.module.css is not owned by this
            // lane, so the flex grouping is inline rather than a new header class.
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <div className={styles.projectChip} title={result.projectRoot}>
                <span className={styles.frameworkDot} />
                <span className={styles.frameworkName}>{result.framework}</span>
                <span className={styles.projectPath}>
                  {result.projectRoot.split('/').slice(-1)[0]}
                </span>
              </div>
              {/* Exports the CURRENT gallery view (the filtered set) as a
                  self-contained .html catalog — client-side, no host needed. */}
              <ExportCatalogButton
                components={filtered}
                projectRoot={result.projectRoot}
                framework={result.framework}
                totalComponents={result.components.length}
              />
              <CompareButton count={basket.size} onClick={() => setCompareOpen(true)} />
              <KitButton count={basket.size} onClick={() => setKitOpen(true)} />
            </div>
          )}
        </header>

      <aside className={styles.sidebar}>
        <ScanForm controller={scan} />
        {result && <Filters filters={filters} onChange={setFilters} facets={facets} />}
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

        {kitOpen && result && (
          <KitPane
            projectRoot={result.projectRoot}
            ids={basketIds}
            onClose={closeKit}
            onRemove={removeFromKit}
          />
        )}

        {compareOpen && result && (
          <ComparePane
            projectRoot={result.projectRoot}
            items={compareItems}
            onClose={closeCompare}
            onRemove={removeFromKit}
          />
        )}
      </div>
    </BasketContext.Provider>
  );
}
