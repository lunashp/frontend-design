import type { ComponentArtifact, Renderability } from '../../api/types.js';
import { DepsList } from './DepsList.js';
import { LocalPreview } from './LocalPreview.js';
import styles from './PreviewPane.module.css';

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

export function PreviewPane({
  artifact,
  projectRoot,
}: {
  artifact: ComponentArtifact;
  projectRoot: string;
}) {
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
          This component can’t be bundled for an isolated preview (it composes too many files or
          depends on a server-only runtime). Its portable code and dependency list are on the
          Portable tab.
        </div>
      ) : (
        <LocalPreview projectRoot={projectRoot} id={artifact.descriptor.id} />
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
