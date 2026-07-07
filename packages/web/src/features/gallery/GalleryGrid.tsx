import type { ComponentSummary } from '../../api/types.js';
import { ComponentCard } from './ComponentCard.js';
import styles from './GalleryGrid.module.css';

export function GalleryGrid({
  components,
  projectRoot,
  selectedId,
  onSelect,
}: {
  components: readonly ComponentSummary[];
  projectRoot: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (components.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>No components match these filters.</p>
        <p className={styles.emptyBody}>Clear a filter or widen the search to see more.</p>
      </div>
    );
  }

  return (
    <div className={styles.grid}>
      {components.map((c, i) => (
        <ComponentCard
          key={c.descriptor.id}
          component={c}
          projectRoot={projectRoot}
          selected={c.descriptor.id === selectedId}
          index={i}
          onSelect={() => onSelect(c.descriptor.id)}
        />
      ))}
    </div>
  );
}
