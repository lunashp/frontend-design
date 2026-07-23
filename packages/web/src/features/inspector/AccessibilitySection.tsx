import { useA11y } from '../../api/useA11y.js';
import type { A11yReport } from '../../api/types.js';
import { summaryChips, totalIssues } from './a11y-view.js';
import styles from './AccessibilitySection.module.css';

/**
 * The inspector's advisory accessibility read on a component, from the SAME
 * rendered preview the Preview tab shows. It exists so an engineer sees a
 * component's a11y debt (missing alt/label/name, contrast, ARIA) BEFORE copying
 * it — not a pass/fail gate, an advisory.
 *
 * Honesty is the whole point, so the disclosure is a first-class part of the UI,
 * never fine print: a stubbed render is labelled as such, an unavailable audit
 * says why, and a clean pass is scoped to "the rendered preview" rather than
 * overclaiming. The audit is heavier than a thumbnail, so it is fetched lazily
 * here — only when a component is actually opened — never per gallery card.
 */
export function AccessibilitySection({ projectRoot, id }: { projectRoot: string; id: string }) {
  const { status, response, error } = useA11y(projectRoot, id);

  return (
    <section className={styles.section} aria-labelledby="a11y-heading">
      <h3 className={styles.title} id="a11y-heading">
        Accessibility
        <span className={styles.eyebrow}>axe · advisory</span>
      </h3>

      {(status === 'loading' || status === 'idle') && (
        <p className={styles.muted}>Rendering the component and running the audit…</p>
      )}

      {status === 'error' && (
        <p className={styles.error}>{error ?? 'Could not run the accessibility audit.'}</p>
      )}

      {status === 'ready' && response && !response.available && (
        <div className={styles.unavailable} data-reason={response.reason}>
          <span className={styles.unavailableLabel}>
            {response.reason === 'code-only' ? 'Not auditable' : 'Audit unavailable'}
          </span>
          <p className={styles.disclosure}>{response.disclosure}</p>
        </div>
      )}

      {status === 'ready' && response && response.available && <Report report={response} />}
    </section>
  );
}

/** The completed audit: a clean pass, or the impact summary + the findings list. */
function Report({ report }: { report: A11yReport }) {
  const total = totalIssues(report.summary);
  const chips = summaryChips(report.summary);

  if (total === 0) {
    return (
      <div className={styles.clean}>
        <span className={styles.cleanMark} aria-hidden />
        <div>
          <p className={styles.cleanTitle}>No issues in the rendered preview</p>
          <p className={styles.disclosure}>{report.disclosure}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={styles.summary}>
        {chips.map((c) => (
          <span key={c.impact} className={styles.chip} data-tone={c.tone}>
            <span className={styles.chipCount}>{c.count}</span>
            {c.label}
          </span>
        ))}
      </div>

      <ul className={styles.findings}>
        {report.findings.map((f) => (
          <li key={f.ruleId} className={styles.finding} data-impact={f.impact}>
            <div className={styles.findingHead}>
              <span className={styles.impact} data-impact={f.impact}>
                {f.impact}
              </span>
              <span className={styles.ruleId}>{f.ruleId}</span>
              {f.nodeCount > 1 && <span className={styles.nodeCount}>{f.nodeCount} elements</span>}
            </div>
            <p className={styles.help}>{f.help}</p>
            {f.targets.length > 0 && (
              <code className={styles.targets}>{f.targets.join('  ·  ')}</code>
            )}
            <a
              className={styles.learn}
              href={f.helpUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              How to fix
            </a>
          </li>
        ))}
      </ul>

      {report.truncated && (
        <p className={styles.muted}>
          Showing the highest-impact findings. Re-run the full audit for the complete list.
        </p>
      )}

      <p className={styles.disclosure} data-stubbed={report.stubbedContext}>
        {report.disclosure}
      </p>
    </>
  );
}
