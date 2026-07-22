import { useEffect, useRef } from 'react';
import type { ComponentSummary } from '../../api/types.js';
import { useArtifact } from '../../api/useArtifact.js';
import { KIND_LABEL, RANKS } from '../../lib/taxonomy.js';
import { editorLinks, formatLocation, relativePath } from '../../lib/editor-links.js';
import type { CustomizationState } from '../../lib/customize.js';
import { CopyButton } from '../../components/ui/CopyButton.js';
import { RankChip } from '../gallery/RankChip.js';
import { ContextMeter } from '../gallery/ContextMeter.js';
import { PreviewPane } from '../preview/PreviewPane.js';
import { PortablePane } from '../portable/PortablePane.js';
import { CustomizePane } from '../customize/CustomizePane.js';
import { PropTable } from './PropTable.js';
import styles from './Inspector.module.css';

export const TABS = ['Details', 'Preview', 'Portable', 'Customize'] as const;
export type Tab = (typeof TABS)[number];
const ENABLED_TABS: ReadonlySet<Tab> = new Set<Tab>([
  'Details',
  'Preview',
  'Portable',
  'Customize',
]);

/** Tabbable descendants, for the slide-over's focus trap. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

function DetailsBody({
  component,
  projectRoot,
}: {
  component: ComponentSummary;
  projectRoot: string;
}) {
  const { descriptor, classification, propModel } = component;
  const { loc } = descriptor;
  const relPath = relativePath(projectRoot, descriptor.filePath);

  return (
    <>
      <dl className={styles.meta}>
        <div>
          <dt>Source</dt>
          <dd className={styles.mono}>
            {relPath}
            <span className={styles.line}>:{loc.line}</span>
          </dd>
        </div>
        <div>
          <dt>Export</dt>
          <dd className={styles.mono}>
            {descriptor.isDefaultExport ? 'export default' : `export { ${descriptor.exportName} }`}
          </dd>
        </div>
        <div>
          <dt>Rank</dt>
          <dd>{RANKS[classification.atomicLevel].blurb}</dd>
        </div>
      </dl>

      {/* Custom schemes fail silently when no editor is registered for them, so
          the copy button is the fallback, not a convenience. */}
      <div className={styles.openIn}>
        <span className={styles.openLabel}>Open in</span>
        {editorLinks(loc).map((link) => (
          <a key={link.id} className={styles.editorLink} href={link.url}>
            {link.label}
          </a>
        ))}
        <CopyButton
          text={formatLocation(loc)}
          label="Copy path"
          className={styles.copyPath}
        />
      </div>

      <div className={styles.meterBlock}>
        <ContextMeter score={classification.contextDependencyScore} />
      </div>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>
          Props
          <span className={styles.sectionCount}>{propModel.props.length}</span>
        </h3>
        <PropTable props={propModel.props} />
      </section>
    </>
  );
}

export function Inspector({
  component,
  projectRoot,
  tab,
  onTabChange,
  customization,
  onCustomizationChange,
  overlay = false,
  onClose,
}: {
  component: ComponentSummary | null;
  projectRoot: string;
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  customization: CustomizationState;
  onCustomizationChange: (state: CustomizationState) => void;
  /** Rendered as a modal slide-over rather than a docked column (narrow viewports). */
  overlay?: boolean;
  onClose: () => void;
}) {
  const id = component?.descriptor.id ?? null;
  const panelRef = useRef<HTMLElement>(null);

  // Modal behaviour, only while it *is* a modal: move focus in, keep Tab inside
  // the panel, close on Escape, and hand focus back to the card that opened it.
  useEffect(() => {
    if (!overlay || !id) return;
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
      const stops = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null,
      );
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!first || !last) {
        // Nothing focusable inside: keep focus on the panel rather than letting
        // Tab escape to the gallery behind the scrim.
        event.preventDefault();
        panel.focus();
        return;
      }
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (opener?.isConnected) opener.focus();
    };
  }, [overlay, id, onClose]);

  // Build the full artifact once for whichever tab needs it.
  const needsArtifact = tab === 'Preview' || tab === 'Portable' || tab === 'Customize';
  const artifactState = useArtifact(projectRoot, needsArtifact ? id : null);

  if (!component) {
    return (
      <aside className={styles.panel} aria-label="Inspector">
        <div className={styles.placeholder}>
          <span className={styles.placeholderMark} aria-hidden />
          <p className={styles.placeholderTitle}>Select a component</p>
          <p className={styles.placeholderBody}>
            Inspect its props and classification, then render it live in an isolated sandbox.
            Portable code and re-theming arrive in the next phases.
          </p>
        </div>
      </aside>
    );
  }

  const { descriptor, classification } = component;

  return (
    <aside
      ref={panelRef}
      className={styles.panel}
      aria-label={`Inspector: ${descriptor.name}`}
      role={overlay ? 'dialog' : undefined}
      aria-modal={overlay || undefined}
      tabIndex={overlay ? -1 : undefined}
    >
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h2 className={styles.name}>{descriptor.name}</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className={styles.tags}>
          <RankChip level={classification.atomicLevel} />
          <span className={styles.kind}>{KIND_LABEL[classification.kind]}</span>
        </div>
      </header>

      <nav className={styles.tabs} aria-label="Inspector views">
        {TABS.map((t) => {
          const enabled = ENABLED_TABS.has(t);
          return (
            <button
              key={t}
              type="button"
              className={styles.tab}
              data-active={t === tab}
              disabled={!enabled}
              onClick={() => enabled && onTabChange(t)}
              title={enabled ? undefined : 'Arrives in a later phase'}
            >
              {t}
            </button>
          );
        })}
      </nav>

      <div className={styles.body}>
        {tab === 'Details' && <DetailsBody component={component} projectRoot={projectRoot} />}
        {needsArtifact &&
          (artifactState.status === 'loading' || artifactState.status === 'idle' ? (
            <div className={styles.loading}>Extracting component & preparing the sandbox…</div>
          ) : artifactState.status === 'error' || !artifactState.artifact ? (
            <div className={styles.loadError}>{artifactState.error ?? 'Failed to build artifact.'}</div>
          ) : tab === 'Preview' ? (
            <PreviewPane artifact={artifactState.artifact} projectRoot={projectRoot} />
          ) : tab === 'Portable' ? (
            <PortablePane artifact={artifactState.artifact} projectRoot={projectRoot} />
          ) : (
            <CustomizePane
              key={artifactState.artifact.descriptor.id}
              artifact={artifactState.artifact}
              projectRoot={projectRoot}
              state={customization}
              onChange={onCustomizationChange}
            />
          ))}
      </div>
    </aside>
  );
}
