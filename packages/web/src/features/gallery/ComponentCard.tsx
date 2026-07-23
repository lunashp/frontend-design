import type { ComponentSummary } from '../../api/types.js';
import { KIND_LABEL } from '../../lib/taxonomy.js';
import { RankChip } from './RankChip.js';
import { ContextMeter } from './ContextMeter.js';
import styles from './ComponentCard.module.css';

function shortPath(filePath: string, root: string): string {
  const rel = filePath.startsWith(root) ? filePath.slice(root.length).replace(/^\//, '') : filePath;
  return rel.length > 42 ? `…${rel.slice(-41)}` : rel;
}

export function ComponentCard({
  component,
  projectRoot,
  selected,
  onSelect,
}: {
  component: ComponentSummary;
  projectRoot: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { descriptor, classification, propModel } = component;
  const propCount = propModel.props.length;

  return (
    <button
      type="button"
      className={selected ? `${styles.card} ${styles.selected}` : styles.card}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <div className={styles.top}>
        <RankChip level={classification.atomicLevel} />
        <span className={styles.kind}>{KIND_LABEL[classification.kind]}</span>
      </div>

      <div className={styles.identity}>
        <h3 className={styles.name}>{descriptor.name}</h3>
        <span className={styles.export}>
          {descriptor.isDefaultExport ? 'default' : 'named'} export
        </span>
      </div>

      <span className={styles.path}>{shortPath(descriptor.filePath, projectRoot)}</span>

      <div className={styles.foot}>
        <span className={styles.props}>
          <span className={styles.propNum}>{propCount}</span>
          {propCount === 1 ? 'prop' : 'props'}
        </span>
        <ContextMeter score={classification.contextDependencyScore} compact />
      </div>
    </button>
  );
}
