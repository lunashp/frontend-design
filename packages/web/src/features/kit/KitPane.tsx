import { useEffect, useMemo, useRef, useState } from 'react';
import { CopyButton } from '../../components/ui/CopyButton.js';
import { copyableFiles, sourceAppFiles } from '../../lib/source-app.js';
import { zipSync } from '../../lib/zip.js';
import { downloadBytes } from './download.js';
import { describeConflicts, formatInstallCommand, kitFilesDump } from './kit-format.js';
import { KitFileList } from './KitFileList.js';
import { useKit } from './useKit.js';
import styles from './KitPane.module.css';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';

/** Visible, focusable descendants in tab order — for the modal focus trap. */
function tabStops(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

function basename(p: string): string {
  return p.split('/').filter(Boolean).slice(-1)[0] ?? p;
}

const KIT_ZIP_NAME = 'component-kit.zip';

/**
 * The kit drawer: a faithful, honest view of the merged multi-component bundle —
 * one shared tokens.css, one merged install command with conflicts surfaced (not
 * hidden), the deduped stub/dangling disclosure, and a one-click zip of the
 * copy-ready files. A modal overlay with a focus trap and Escape-to-close,
 * mirroring the inspector slide-over's keyboard contract.
 */
export function KitPane({
  projectRoot,
  ids,
  onClose,
  onRemove,
}: {
  projectRoot: string;
  /** The basket's component ids. Empty renders the discovery hint, not a build. */
  ids: readonly string[];
  onClose: () => void;
  onRemove: (id: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [includeSourceApp, setIncludeSourceApp] = useState(false);
  // Fetched here, so a kit is built only while the drawer is open — not eagerly
  // on every basket toggle, which would re-scan + rebuild on the host each time.
  const { status, kit, error } = useKit(projectRoot, ids);
  const isEmpty = ids.length === 0;

  // Modal keyboard contract: focus the panel on open, trap Tab inside it, close
  // on Escape, and return focus to the opener on close — the same WCAG 2.1.2
  // handling the inspector slide-over uses, so the drawer is never a focus trap.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const stops = tabStops(panel);
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!first || !last) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const activeEl = document.activeElement;
      if (event.shiftKey && (activeEl === first || activeEl === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeEl === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (opener?.isConnected) opener.focus();
    };
  }, [onClose]);

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of kit?.components ?? []) map.set(c.id, c.name);
    return map;
  }, [kit]);

  const sourceApp = useMemo(() => (kit ? sourceAppFiles(kit) : new Set<string>()), [kit]);
  const entryPathSet = useMemo(
    () => new Set(Object.values(kit?.entryPaths ?? {})),
    [kit],
  );
  const copySet = useMemo(
    () => (kit ? copyableFiles(kit.files, sourceApp, includeSourceApp) : {}),
    [kit, sourceApp, includeSourceApp],
  );

  const installCommand = kit ? formatInstallCommand(kit.externalDeps) : null;
  const conflicts = kit ? describeConflicts(kit.depConflicts, (id) => nameById.get(id) ?? id) : [];
  const copyCount = Object.keys(copySet).length;

  return (
    <>
      <div className={styles.scrim} onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="kit-title"
        tabIndex={-1}
      >
        <div className={styles.head}>
          <div className={styles.title}>
            <span id="kit-title" className={styles.titleText}>
              Component kit
            </span>
            <span className={styles.titleSub}>
              {kit
                ? `${kit.components.length} component${kit.components.length === 1 ? '' : 's'}, one shared token set`
                : 'harvest a set into one folder'}
            </span>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close kit">
            ✕
          </button>
        </div>

        <div className={styles.body}>
          {isEmpty ? (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>Your kit is empty</p>
              <p>
                Add components from the gallery with the <strong>+</strong> on each card, then come
                back to download them together — one folder, one shared tokens.css, no name
                collisions.
              </p>
            </div>
          ) : status === 'error' ? (
            <p className={styles.error}>{error ?? 'Failed to build the kit.'}</p>
          ) : kit ? (
            <>
              <section className={styles.section}>
                <span className="eyebrow">In this kit</span>
                <div className={styles.components}>
                  {kit.components.map((c) => (
                    <span key={c.id} className={styles.componentChip}>
                      <span className={styles.componentName}>{c.name}</span>
                      <span className={styles.componentPath}>{basename(c.entryPath)}</span>
                      <button
                        type="button"
                        className={styles.chipRemove}
                        onClick={() => onRemove(c.id)}
                        aria-label={`Remove ${c.name} from kit`}
                        title="Remove from kit"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              </section>

              <section className={styles.section}>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.download}
                    onClick={() => downloadBytes(KIT_ZIP_NAME, zipSync(copySet))}
                  >
                    ↓ Download .zip ({copyCount} file{copyCount === 1 ? '' : 's'})
                  </button>
                  <CopyButton
                    text={kitFilesDump(copySet)}
                    label={`Copy all ${copyCount} file${copyCount === 1 ? '' : 's'}`}
                  />
                </div>
                {sourceApp.size > 0 && (
                  <label className={styles.sourceAppToggle}>
                    <input
                      type="checkbox"
                      checked={includeSourceApp}
                      onChange={(e) => setIncludeSourceApp(e.target.checked)}
                    />
                    Include the source app’s design system ({sourceApp.size} file
                    {sourceApp.size === 1 ? '' : 's'}) — off by default
                  </label>
                )}
              </section>

              <section className={styles.section}>
                <span className="eyebrow">Install in the destination project</span>
                {installCommand ? (
                  <div className={styles.deps}>
                    <code className={styles.command}>{installCommand}</code>
                    <CopyButton text={installCommand} label="Copy command" />
                  </div>
                ) : (
                  <div className={styles.selfContained}>
                    <span className={styles.selfDot} />
                    No external dependencies — the whole kit is self-contained.
                  </div>
                )}
                {conflicts.length > 0 && (
                  <ul className={styles.warnBlock} data-severe="true">
                    <li className={styles.warnLabel}>Version conflicts to reconcile</li>
                    {conflicts.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
              </section>

              <section className={styles.section}>
                <div className={styles.tokensBlock}>
                  <div className={styles.tokensHead}>
                    <span className={styles.tokensTitle}>{kit.tokensCssPath}</span>
                    <CopyButton text={kit.tokensCss} label="Copy" />
                  </div>
                  <pre className={styles.tokensCode}>
                    <code>{kit.tokensCss}</code>
                  </pre>
                </div>
              </section>

              <section className={styles.section}>
                <span className="eyebrow">Merged files</span>
                <KitFileList
                  files={kit.files}
                  entryPaths={entryPathSet}
                  tokensCssPath={kit.tokensCssPath}
                  sourceApp={sourceApp}
                />
              </section>

              {(kit.stubbedModules.length > 0 || kit.danglingImports.length > 0) && (
                <ul className={styles.warnBlock}>
                  <li className={styles.warnLabel}>What was faked or left unresolved</li>
                  {kit.stubbedModules.map((s) => (
                    <li key={s.specifier} className={styles.stub}>
                      <span className={styles.stubSpec}>{s.specifier}</span> → stubbed;{' '}
                      <span className={styles.stubLost}>{s.lost}</span>
                    </li>
                  ))}
                  {kit.danglingImports.map((d) => (
                    <li key={d} className={styles.stub}>
                      unresolved import: <span className={styles.stubSpec}>{d}</span>
                    </li>
                  ))}
                </ul>
              )}

              {kit.warnings.length > 0 && (
                <ul className={styles.warnBlock}>
                  <li className={styles.warnLabel}>Notes</li>
                  {kit.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            // idle (first frame) and loading both land here until the kit resolves.
            <p className={styles.loading}>Merging the set into one kit…</p>
          )}
        </div>
      </div>
    </>
  );
}
