/**
 * Renders a PreflightView: the "here is what I will scan" profile the user sees
 * before/around the auto-scan, plus the diagnosis that replaces the old dead-end
 * empty/error screens. All wording and severity come from preflight-view.ts (the
 * tested layer); this component only lays them out.
 *
 * `variant="banner"` is the post-scan happy-path form — a slim summary line that
 * keeps the gallery the focus, expanding to the diagnosis rows only when there
 * is something worth flagging.
 */

import type { PreflightView, SuggestedMember } from './preflight-view.js';
import styles from './PreflightCard.module.css';

interface PreflightCardProps {
  view: PreflightView;
  variant?: 'full' | 'banner';
  /** Re-target the scan at a workspace member the user picked. */
  onScanMember?: (path: string) => void;
}

function MemberButton({
  member,
  onScanMember,
}: {
  member: SuggestedMember;
  onScanMember?: (path: string) => void;
}) {
  return (
    <button
      type="button"
      className={styles.member}
      onClick={() => onScanMember?.(member.path)}
      disabled={!onScanMember}
      title={`Scan ${member.path}`}
    >
      <span className={styles.memberName}>{member.name}</span>
      <span className={styles.memberPath}>{member.relPath}</span>
    </button>
  );
}

function Diagnoses({
  view,
  onScanMember,
}: {
  view: PreflightView;
  onScanMember?: (path: string) => void;
}) {
  if (view.diagnoses.length === 0) return null;
  return (
    <div className={styles.diagnoses}>
      {view.diagnoses.map((d) => (
        <div key={d.headline} className={styles.diagnosis} data-tone={d.tone}>
          <p className={styles.diagHeadline}>{d.headline}</p>
          <p className={styles.diagDetail}>{d.detail}</p>
          {d.suggestedMembers.length > 0 && (
            <div className={styles.members}>
              {d.suggestedMembers.map((m) => (
                <MemberButton key={m.path} member={m} onScanMember={onScanMember} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function PreflightCard({ view, variant = 'full', onScanMember }: PreflightCardProps) {
  const framework = view.facts.find((f) => f.label === 'Framework');
  const deps = view.facts.find((f) => f.label === 'Dependencies');

  if (variant === 'banner') {
    return (
      <section
        className={`${styles.card} ${styles.banner}`}
        data-tone={view.tone}
        aria-label="Scan profile"
      >
        <div className={styles.summary}>
          <span className={styles.summaryName}>{view.projectName}</span>
          {framework && (
            <>
              <span className={styles.summaryDot} aria-hidden />
              <span>{framework.value}</span>
            </>
          )}
          {deps && (
            <>
              <span className={styles.summaryDot} aria-hidden />
              <span>{deps.value}</span>
            </>
          )}
        </div>
        <Diagnoses view={view} onScanMember={onScanMember} />
      </section>
    );
  }

  return (
    <section className={styles.card} data-tone={view.tone} aria-label="Scan profile">
      <header className={styles.head}>
        <div className={styles.identity}>
          <span className={styles.name}>{view.projectName}</span>
          <span className={styles.root}>{view.rootPath}</span>
        </div>
        {framework && <span className={styles.confidence}>{framework.value}</span>}
      </header>

      <dl className={styles.facts}>
        {view.facts.map((f) => (
          <div key={f.label} className={styles.fact}>
            <dt className={styles.factLabel}>{f.label}</dt>
            <dd className={styles.factValue} data-tone={f.tone ?? 'ok'}>
              {f.value}
            </dd>
          </div>
        ))}
      </dl>

      <Diagnoses view={view} onScanMember={onScanMember} />
    </section>
  );
}
