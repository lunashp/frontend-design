import { useEffect, useRef } from 'react';
import type { ComponentSummary } from '../../api/types.js';
import { useArtifact } from '../../api/useArtifact.js';
import { KIND_LABEL, RANKS, roleLabel } from '../../lib/taxonomy.js';
import { editorLinks, formatLocation, relativePath } from '../../lib/editor-links.js';
import { explainContextScore } from '../../lib/context-score.js';
import type { CustomizationState } from '../../lib/customize.js';
import { CopyButton } from '../../components/ui/CopyButton.js';
import { RankChip } from '../gallery/RankChip.js';
import { ContextMeter } from '../gallery/ContextMeter.js';
import { PreviewPane } from '../preview/PreviewPane.js';
import { PortablePane } from '../portable/PortablePane.js';
import { CustomizePane } from '../customize/CustomizePane.js';
import { VariantsMatrix } from '../variants/VariantsMatrix.js';
import { PropTable } from './PropTable.js';
import { AccessibilitySection } from './AccessibilitySection.js';
import { WhereUsed } from './WhereUsed.js';
import styles from './Inspector.module.css';

// Variants sits with Preview — both are live renders — before the copy/re-theme
// tabs. Adding it here is all app.tsx needs: it only holds the active `Tab`.
export const TABS = ['Details', 'Preview', 'Variants', 'Portable', 'Customize'] as const;
export type Tab = (typeof TABS)[number];
const ENABLED_TABS: ReadonlySet<Tab> = new Set<Tab>([
  'Details',
  'Preview',
  'Variants',
  'Portable',
  'Customize',
]);

/** Tabbable descendants, for the slide-over's focus trap. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

/** Tab order under `root`: focusable descendants that are actually rendered. */
function tabStops(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null,
  );
}

/**
 * Messages posted by the preview iframe's keyboard bridge (see
 * `PREVIEW_KEYBOARD_BRIDGE` in @ce/host). The preview is sandboxed to an opaque
 * origin, so its key events never reach this document and these stand in for
 * them.
 */
interface BridgeMessage {
  readonly type: 'ce:escape' | 'ce:tab-out' | 'ce:preview-ready';
  readonly shiftKey?: boolean;
}

function bridgeMessage(data: unknown): BridgeMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const { type, shiftKey } = data as { type?: unknown; shiftKey?: unknown };
  if (type !== 'ce:escape' && type !== 'ce:tab-out' && type !== 'ce:preview-ready') return null;
  return { type, shiftKey: shiftKey === true };
}

/**
 * Our half of the bridge's handshake. Until a frame receives this it leaves Tab
 * to the browser, so sending it is what arms the Escape/Tab forwarding — and
 * never sending it is what keeps a preview from becoming a keyboard trap.
 */
const EMBEDDER_READY = { type: 'ce:embedder-ready' } as const;

function armFrame(frame: HTMLIFrameElement): void {
  // '*' is not a shortcut: the preview is sandboxed to an opaque origin, which
  // no explicit targetOrigin can name. The payload is a constant with nothing
  // in it, addressed to a Window we created ourselves.
  frame.contentWindow?.postMessage(EMBEDDER_READY, '*');
}

/**
 * Place focus where Tab would have put it. The bridge has already called
 * `preventDefault()` inside the frame, so the browser will not move focus for
 * us: doing nothing here is exactly the keyboard trap this pair exists to avoid.
 *
 * Overlay IS a modal, so the cycle stays inside the panel. Docked is not a
 * modal — nothing is behind a scrim and there is nothing to keep focus away
 * from — so the answer there is simply the next stop in the whole document,
 * which is what the browser would have done on its own.
 */
function focusPastFrame(
  panel: HTMLElement,
  frame: HTMLIFrameElement,
  shiftKey: boolean,
  overlay: boolean,
): void {
  const stops = tabStops(overlay ? panel : document);
  const at = stops.indexOf(frame);
  // Wrapping at the far edge is deliberate: the browser would move on to its
  // own chrome, which a page cannot do, and wrapping still gets the user out of
  // the frame — the property that actually matters.
  const step = at + (shiftKey ? -1 : 1);
  const target = at === -1 ? undefined : stops[(step + stops.length) % stops.length];
  // No other stop to go to (frame hidden, detached mid-key, or the only one
  // there is): blur is the honest fallback — focus lands on <body>, still out.
  if (target && target !== frame) target.focus();
  else frame.blur();
}

function DetailsBody({
  component,
  projectRoot,
}: {
  component: ComponentSummary;
  projectRoot: string;
}) {
  const { descriptor, classification, signals, propModel } = component;
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

      {/* The Details tab is where "why is this a 6.5?" gets asked, so the score
          is shown decomposed into the signals that produced it. */}
      <div className={styles.meterBlock}>
        <ContextMeter
          score={classification.contextDependencyScore}
          contributions={explainContextScore(signals)}
        />
      </div>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>
          Props
          <span className={styles.sectionCount}>{propModel.props.length}</span>
        </h3>
        <PropTable props={propModel.props} />
      </section>

      {/* Blast radius before copying: who imports it (free, off the summary) and
          what it drags in (deps + stubbed/unresolved imports, from the lazily
          built artifact). */}
      <WhereUsed component={component} projectRoot={projectRoot} />

      {/* Advisory a11y read on the rendered preview, fetched lazily only now that
          a component is open — never per gallery card (the audit is heavier than
          a thumbnail). */}
      <AccessibilitySection projectRoot={projectRoot} id={descriptor.id} />
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
      const stops = tabStops(panel);
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

  // The Preview tab's iframe is cross-origin (sandbox without
  // allow-same-origin), so the trap's `onKeyDown` above never sees a key pressed
  // inside it — Escape did nothing and Tab left the trap. Its bridge posts those
  // keys instead; this is the receiving half.
  //
  // It is NOT overlay-only, and that is the whole point. It used to sit inside
  // the modal effect above, behind `if (!overlay || !id) return`, while the
  // bridge intercepted Tab in every preview — so on every viewport wider than
  // the compact breakpoint (the DEFAULT desktop layout, inspector docked) the
  // key was swallowed and nobody moved focus: a WCAG 2.1.2 keyboard trap with
  // no way out but the mouse. Whenever a component is selected there may be a
  // preview to answer, so whenever a component is selected we listen.
  useEffect(() => {
    if (!id) return;

    const onMessage = (event: MessageEvent) => {
      const panel = panelRef.current;
      const data: unknown = event.data;
      const message = bridgeMessage(data);
      if (!panel || !message) return;

      // Identity, not origin: an opaque-origin frame reports `event.origin` as
      // the literal "null" that EVERY sandboxed frame reports, so it proves
      // nothing. The source Window can't be forged — only the frame we embedded
      // can be `event.source` — so that is the gate, scoped to this panel's own
      // iframes rather than any frame on the page.
      const frame = [...panel.querySelectorAll('iframe')].find(
        (el) => el.contentWindow !== null && el.contentWindow === event.source,
      );
      if (!frame) return;

      if (message.type === 'ce:preview-ready') {
        armFrame(frame);
        return;
      }
      if (message.type === 'ce:escape') {
        // Escape dismisses a modal, and docked there is no modal to dismiss:
        // the gallery behind it is not covered by a scrim and was reachable all
        // along. Doing nothing matches Escape everywhere else in a non-modal
        // document, and closing would silently throw away the open tab and any
        // customization in progress. Deliberate, not an oversight.
        if (overlay) onClose();
        return;
      }
      focusPastFrame(panel, frame, message.shiftKey === true, overlay);
    };

    window.addEventListener('message', onMessage);
    // Re-arm frames that are already loaded. This effect re-registers when the
    // layout crosses the compact breakpoint, and a frame that announced itself
    // before that would otherwise be left holding keys nobody receives.
    const panel = panelRef.current;
    if (panel) for (const frame of panel.querySelectorAll('iframe')) armFrame(frame);

    return () => window.removeEventListener('message', onMessage);
  }, [overlay, id, onClose]);

  // Build the full artifact once for whichever tab needs it.
  const needsArtifact =
    tab === 'Preview' || tab === 'Variants' || tab === 'Portable' || tab === 'Customize';
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
          {roleLabel(classification.role) && (
            <span className={styles.role}>{roleLabel(classification.role)}</span>
          )}
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
          ) : tab === 'Variants' ? (
            <VariantsMatrix artifact={artifactState.artifact} projectRoot={projectRoot} />
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
