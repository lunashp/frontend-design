import type { ComponentSummary, PortableBundle } from '../../api/types.js';
import { type ArtifactState, useArtifact } from '../../api/useArtifact.js';
import { CopyButton } from '../../components/ui/CopyButton.js';
import { type UsedByView, mapUsedBy, mapUses } from './where-used.js';
import styles from './WhereUsed.module.css';

/**
 * The consistent caveat the whole app attaches to the reuse signal: the usage
 * index counts imports from the ANALYZED program, and stories/tests live outside
 * it — so a 0 here means "no analyzed importers", never "unused". Kept verbatim
 * with the gallery card and compare column so one number never tells two stories.
 */
const USAGE_CAVEAT = 'Imports from analyzed source; stories & tests excluded.';

/**
 * The Details tab's "what is this component's blast radius before I copy it"
 * panel. USED BY (who imports it) comes free off the summary and renders at once;
 * USES (what it depends on) needs the bundle, so the artifact is fetched lazily —
 * the same lazy-in-Details pattern as the a11y audit — and the summary streams in
 * without blocking the rest of Details. The build is memoized and shared with the
 * Preview/Portable/Customize tabs, so it is paid once.
 */
export function WhereUsed({
  component,
  projectRoot,
}: {
  component: ComponentSummary;
  projectRoot: string;
}) {
  const usedBy = mapUsedBy(component.usage, projectRoot);
  const artifact = useArtifact(projectRoot, component.descriptor.id);

  return (
    <section className={styles.section} aria-labelledby="where-used-heading">
      <h3 className={styles.title} id="where-used-heading">
        Used by & dependencies
        <span className={styles.eyebrow}>blast radius</span>
      </h3>
      <UsedBy view={usedBy} />
      <Uses state={artifact} />
    </section>
  );
}

function UsedBy({ view }: { view: UsedByView }) {
  return (
    <div className={styles.block}>
      <div className={styles.blockHead}>
        <span className="eyebrow">Used by</span>
        <span className={styles.count} data-none={view.none}>
          {view.count}
        </span>
      </div>

      {view.none ? (
        <p className={styles.muted}>
          Not imported by analyzed source — it may be used only by stories or tests, or be an entry
          point.
        </p>
      ) : (
        <>
          {/* Copy-path is the affordance that always works (editor-links.ts:
              custom schemes fail silently); per-row it stays quiet next to the
              path. Editor-link chips are not repeated per row — five per file over
              a ten-file list is a wall — the component's own Open-in row above
              covers the jump-to-source case. */}
          <ul className={styles.files}>
            {view.files.map((f) => (
              <li key={f} className={styles.fileRow}>
                <code className={styles.file}>{f}</code>
                <CopyButton text={f} label="Copy" className={styles.rowCopy} />
              </li>
            ))}
          </ul>
          {view.sampled && (
            <p className={styles.muted}>
              Showing {view.files.length} of {view.count} importing files.
            </p>
          )}
        </>
      )}

      <p className={styles.caveat}>{USAGE_CAVEAT}</p>
    </div>
  );
}

function Uses({ state }: { state: ArtifactState }) {
  return (
    <div className={styles.block}>
      <span className="eyebrow">Dependencies</span>

      {(state.status === 'idle' || state.status === 'loading') && (
        <p className={styles.muted}>Resolving dependencies…</p>
      )}

      {state.status === 'error' && (
        <p className={styles.muted}>
          Couldn’t resolve dependencies here — the Portable tab has the full list.
        </p>
      )}

      {state.status === 'ready' && state.artifact && <UsesReady bundle={state.artifact.bundle} />}
    </div>
  );
}

function UsesReady({ bundle }: { bundle: PortableBundle }) {
  const uses = mapUses(bundle);

  if (uses.selfContained) {
    return (
      <div className={styles.selfContained}>
        <span className={styles.selfDot} />
        No external dependencies — fully self-contained.
      </div>
    );
  }

  return (
    <>
      {uses.deps.length > 0 && (
        <div className={styles.deps}>
          {uses.deps.map((d) => (
            <span key={d.name} className={styles.dep}>
              {d.name}
              <span className={styles.depVer}>{d.version}</span>
            </span>
          ))}
        </div>
      )}

      {/* The same honesty the Portable tab shows — surfaced here so a hidden stub
          or an unresolved import is visible before the copy, not after. */}
      {uses.stubbed.length > 0 && (
        <div className={styles.honesty} data-tone="warn">
          <p className={styles.honestyLead}>
            {uses.stubbed.length} module{uses.stubbed.length === 1 ? '' : 's'} stubbed for the
            preview:
          </p>
          <ul className={styles.honestyList}>
            {uses.stubbed.map((s) => (
              <li key={s.specifier}>
                <code>{s.specifier}</code> — {s.lost}
              </li>
            ))}
          </ul>
        </div>
      )}

      {uses.dangling.length > 0 && (
        <div className={styles.honesty} data-tone="danger">
          <p className={styles.honestyLead}>
            {uses.dangling.length} unresolved local import{uses.dangling.length === 1 ? '' : 's'}:
          </p>
          <ul className={styles.honestyList}>
            {uses.dangling.map((d) => (
              <li key={d}>
                <code>{d}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
