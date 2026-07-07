import { useEffect, useState } from 'react';
import type { ComponentSummary } from '../../api/types.js';
import { useArtifact } from '../../api/useArtifact.js';
import { KIND_LABEL, RANKS } from '../../lib/taxonomy.js';
import { RankChip } from '../gallery/RankChip.js';
import { ContextMeter } from '../gallery/ContextMeter.js';
import { PreviewPane } from '../preview/PreviewPane.js';
import { PortablePane } from '../portable/PortablePane.js';
import { CustomizePane } from '../customize/CustomizePane.js';
import { PropTable } from './PropTable.js';
import styles from './Inspector.module.css';

const TABS = ['Details', 'Preview', 'Portable', 'Customize'] as const;
type Tab = (typeof TABS)[number];
const ENABLED_TABS: ReadonlySet<Tab> = new Set<Tab>([
  'Details',
  'Preview',
  'Portable',
  'Customize',
]);

function DetailsBody({
  component,
  projectRoot,
}: {
  component: ComponentSummary;
  projectRoot: string;
}) {
  const { descriptor, classification, propModel } = component;
  const relPath = descriptor.filePath.startsWith(projectRoot)
    ? descriptor.filePath.slice(projectRoot.length).replace(/^\//, '')
    : descriptor.filePath;

  return (
    <>
      <dl className={styles.meta}>
        <div>
          <dt>Source</dt>
          <dd className={styles.mono}>{relPath}</dd>
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
  onClose,
}: {
  component: ComponentSummary | null;
  projectRoot: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('Details');
  const id = component?.descriptor.id ?? null;

  // Reset to Details when a different component is opened.
  useEffect(() => {
    setTab('Details');
  }, [id]);

  // Build the full artifact once for whichever tab needs it.
  const needsArtifact = tab === 'Preview' || tab === 'Portable' || tab === 'Customize';
  const artifactState = useArtifact(projectRoot, needsArtifact ? id : null);

  if (!component) {
    return (
      <aside className={styles.panel} aria-label="Inspector">
        <div className={styles.placeholder}>
          <span className={styles.placeholderMark}>◧</span>
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
    <aside className={styles.panel} aria-label={`Inspector: ${descriptor.name}`}>
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
              onClick={() => enabled && setTab(t)}
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
            <PreviewPane artifact={artifactState.artifact} />
          ) : tab === 'Portable' ? (
            <PortablePane artifact={artifactState.artifact} projectRoot={projectRoot} />
          ) : (
            <CustomizePane artifact={artifactState.artifact} />
          ))}
      </div>
    </aside>
  );
}
