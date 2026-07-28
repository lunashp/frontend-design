import type { HeuristicWarning, ScanFailure } from '../../api/types.js';
import { editorLinks, formatLocation } from '../../lib/editor-links.js';
import { CopyButton } from '../../components/ui/CopyButton.js';
import { failureView, scanNotes } from './scan-failures.js';
import styles from './ScanIssues.module.css';

/**
 * Everything the scan could not do, stated concretely. A count on its own
 * ("40 components could not be analyzed") is unactionable — the whole point is
 * knowing WHICH, so each failure names its component, its path and the error,
 * and links straight into an editor.
 *
 * It stays collapsed: on a large target this list is long, and it shares a
 * scroll container with the catalogue it must never push off screen.
 */
export function ScanIssues({
  failures,
  heuristicWarnings,
  projectRoot,
  analyzed,
}: {
  failures: readonly ScanFailure[];
  /**
   * Scan-LEVEL findings, typed. Taken as their own prop rather than as part of
   * the prose `warnings` list, which mixed them with per-component failure
   * restatements and forced this panel to tell them apart by string match.
   */
  heuristicWarnings: readonly HeuristicWarning[];
  projectRoot: string;
  /** Components that DID analyze, for an honest "n of m". */
  analyzed: number;
}) {
  const view = failureView(failures, projectRoot);
  const notes = scanNotes(heuristicWarnings);
  if (view.total === 0 && notes.length === 0) return null;

  return (
    <section className={styles.issues} aria-label="Scan issues">
      {notes.length > 0 && (
        // Collapsed by default: these are advisory heuristic diagnostics, not
        // errors, and a prominent warning block on every scan reads as "something
        // is wrong". One muted line the reader can expand for the detail.
        <details className={styles.noteDisclosure}>
          <summary className={styles.noteSummary}>
            <span className={styles.noteCount}>{notes.length}</span>
            <span>scan {notes.length === 1 ? 'note' : 'notes'}</span>
            <span className={styles.noteHeadlines}>
              {notes.map((n) => n.headline).join(' · ')}
            </span>
            <span className={styles.toggle} aria-hidden />
          </summary>
          <ul className={styles.notes}>
            {notes.map((note) => (
              <li key={note.key} className={styles.note}>
                <p className={styles.noteHeadline}>{note.headline}</p>
                <p className={styles.noteBody}>{note.message}</p>
              </li>
            ))}
          </ul>
        </details>
      )}

      {view.total > 0 && (
        <details className={styles.disclosure}>
          <summary className={styles.summary}>
            <span className={styles.count}>{view.total}</span>
            <span className={styles.summaryText}>
              of {analyzed + view.total} discovered components could not be analyzed
            </span>
            <span className={styles.toggle} aria-hidden />
          </summary>

          <ul className={styles.list}>
            {view.rows.map((row) => (
              <li key={row.key} className={styles.row}>
                <div className={styles.head}>
                  <span className={styles.name}>{row.name}</span>
                  <span className={styles.path}>{row.relPath}</span>
                </div>
                <p className={styles.message}>{row.message}</p>
                <div className={styles.actions}>
                  {/* Only the two commonest schemes, in EDITORS' documented
                      order: a custom scheme fails silently with no handler
                      registered, so eight rows × five schemes would be mostly
                      dead links. Copy-path is the fallback that always works and
                      so is on every row. */}
                  {editorLinks(row.location)
                    .slice(0, 2)
                    .map((link) => (
                      <a key={link.id} className={styles.link} href={link.url}>
                        {link.label}
                      </a>
                    ))}
                  <CopyButton
                    text={formatLocation(row.location)}
                    label="Copy path"
                    className={styles.copy}
                  />
                </div>
              </li>
            ))}
          </ul>

          {view.hidden > 0 && (
            <p className={styles.more}>
              +{view.hidden} more not listed — the full set is in the scan log.
            </p>
          )}
        </details>
      )}
    </section>
  );
}
