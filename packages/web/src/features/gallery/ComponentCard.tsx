import type { ComponentSummary } from '../../api/types.js';
import { useBasket } from '../kit/basket-context.js';
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
  const basket = useBasket();
  const picked = basket.has(descriptor.id);

  // The card is itself a stretched <button> (it selects the component), so the
  // basket control CANNOT nest inside it — nested interactive elements are
  // invalid HTML and break keyboard/AT semantics. It is a sibling inside a
  // positioned wrapper instead, floating over the card's free top-right corner.
  return (
    <div className={styles.wrap}>
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

      <button
        type="button"
        className={styles.basketToggle}
        data-picked={picked}
        aria-pressed={picked}
        aria-label={picked ? `Remove ${descriptor.name} from kit` : `Add ${descriptor.name} to kit`}
        title={picked ? 'In kit — click to remove' : 'Add to kit'}
        onClick={() => basket.toggle(descriptor.id)}
      >
        {picked ? '✓' : '+'}
      </button>
    </div>
  );
}
