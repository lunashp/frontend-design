import { useState } from 'react';
import type { ComponentArtifact } from '../../api/types.js';
import { BackingToggle } from './BackingToggle.js';
import type { PreviewBacking } from './backing.js';
import { ColourSourceCaption } from './ColourSourceCaption.js';
import { DepsList } from './DepsList.js';
import { LocalPreview } from './LocalPreview.js';
import { renderabilityLabel } from './renderability.js';
import { classifyCodeOnly } from './code-only-reason.js';
import styles from './PreviewPane.module.css';

export function PreviewPane({
  artifact,
  projectRoot,
}: {
  artifact: ComponentArtifact;
  projectRoot: string;
}) {
  const spec = artifact.sandpack;
  const meta = renderabilityLabel(artifact);
  const [backing, setBacking] = useState<PreviewBacking>('checker');

  return (
    <div className={styles.pane}>
      <div className={styles.badge} data-tone={meta.tone}>
        <span className={styles.badgeDot} />
        <span className={styles.badgeLabel}>{meta.label}</span>
        {meta.stubbed.length > 0 && (
          <span className={styles.stubCount} title="Modules swapped for local stubs — see notes below">
            {meta.stubbed.length} stubbed
          </span>
        )}
        <span className={styles.badgeBlurb}>{meta.blurb}</span>
      </div>

      {spec.renderability === 'code-only' ? (
        (() => {
          // A specific reason, not one generic line — above all, a genuine Server
          // Component is named as such (a fact about the component, not a tool
          // failure) rather than lumped in with "too complex".
          const reason = classifyCodeOnly(artifact.bundle);
          return (
            <div className={styles.codeOnly} data-kind={reason.kind}>
              <strong className={styles.codeOnlyHead}>{reason.headline}</strong>
              <span>{reason.detail}</span>
            </div>
          );
        })()
      ) : (
        <>
          <div className={styles.stageHead}>
            <span className="eyebrow">Backing</span>
            <BackingToggle value={backing} onChange={setBacking} />
          </div>
          <LocalPreview projectRoot={projectRoot} id={artifact.descriptor.id} backing={backing} />
          <ColourSourceCaption bundle={artifact.bundle} />
        </>
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
