import { useState } from 'react';
import type { ComponentSummary } from '../../api/types.js';
import { useBasket } from '../kit/basket-context.js';
import { KIND_LABEL } from '../../lib/taxonomy.js';
import { RankChip } from './RankChip.js';
import { ContextMeter } from './ContextMeter.js';
import { nextThumbnailState, thumbnailUrl, type ThumbnailState } from './thumbnail.js';
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
  const { descriptor, classification, propModel, usage } = component;
  const propCount = propModel.props.length;
  const usedBy = usage?.usedByCount ?? 0;
  const basket = useBasket();
  const picked = basket.has(descriptor.id);

  // The grid is virtualized, so this card is already on screen — mounting the
  // <img> here IS the lazy fetch. The host renders/caches the PNG; a code-only
  // component, an absent browser, or any render failure answers 204, the <img>
  // errors, and the frame falls back to a designed placeholder instead of a
  // rendered preview. The frame is a fixed height in every state so the
  // virtualized row pitch (measured, uniform across cards) never shifts.
  const [thumb, setThumb] = useState<ThumbnailState>('loading');
  const thumbSrc = thumbnailUrl(projectRoot, descriptor.id);

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

        {/* Decorative: the name/kind/path already identify the component to AT,
            so a rendered preview is aria-hidden to avoid duplicate noise. */}
        <div className={styles.thumb} aria-hidden="true">
          {thumb !== 'unavailable' && (
            <img
              className={styles.thumbImg}
              src={thumbSrc}
              alt=""
              loading="lazy"
              decoding="async"
              data-ready={thumb === 'ready'}
              onLoad={() => setThumb((s) => nextThumbnailState(s, 'load'))}
              onError={() => setThumb((s) => nextThumbnailState(s, 'error'))}
            />
          )}
          {thumb === 'loading' && <span className={styles.thumbSkeleton} />}
          {thumb === 'unavailable' && (
            <span className={styles.thumbFallback}>{descriptor.name.slice(0, 2)}</span>
          )}
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
          {usage && (
            // Reuse signal: imports from the SCANNED source only. A component used
            // only by stories/tests reads 0 (those files are outside the scan), so
            // the title states the caveat rather than implying "unused".
            <span
              className={styles.usage}
              title={`Imported by ${usedBy} scanned file${usedBy === 1 ? '' : 's'} (stories & tests excluded)`}
            >
              <span className={styles.usageNum}>{usedBy}</span>
              used by
            </span>
          )}
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
