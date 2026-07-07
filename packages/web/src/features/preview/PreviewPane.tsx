import { lazy, Suspense } from 'react';
import type { ComponentArtifact, Renderability } from '../../api/types.js';
import { DepsList } from './DepsList.js';
import styles from './PreviewPane.module.css';

const SandboxView = lazy(() => import('./SandboxView.js'));

const RENDERABILITY: Record<Renderability, { label: string; tone: string; blurb: string }> = {
  full: { label: 'Isolated render', tone: 'ok', blurb: 'Renders cleanly with no app context.' },
  stubbed: {
    label: 'Stubbed render',
    tone: 'warn',
    blurb: 'Needs app context — shown without providers; may look off.',
  },
  'code-only': {
    label: 'Code only',
    tone: 'danger',
    blurb: "Can't run live in the sandbox.",
  },
};

export function PreviewPane({ artifact }: { artifact: ComponentArtifact }) {
  const spec = artifact.sandpack;
  const meta = RENDERABILITY[spec.renderability];

  return (
    <div className={styles.pane}>
      <div className={styles.badge} data-tone={meta.tone}>
        <span className={styles.badgeDot} />
        <span className={styles.badgeLabel}>{meta.label}</span>
        <span className={styles.badgeBlurb}>{meta.blurb}</span>
      </div>

      {spec.renderability === 'code-only' ? (
        <div className={styles.codeOnly}>
          This component can’t run live in the sandbox. Its portable code and dependency list are
          on the Portable tab.
        </div>
      ) : (
        <Suspense fallback={<div className={styles.state}>Loading sandbox…</div>}>
          <SandboxView spec={spec} />
        </Suspense>
      )}

      {spec.notes.length > 0 && (
        <ul className={styles.notes}>
          {spec.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}

      <DepsList deps={spec.dependencies} />
    </div>
  );
}
