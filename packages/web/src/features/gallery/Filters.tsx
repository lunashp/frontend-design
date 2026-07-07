import type { AtomicLevel, ComponentKind } from '../../api/types.js';
import { KIND_LABEL, RANKS, RANK_ORDER } from '../../lib/taxonomy.js';
import { toggle, type FilterState } from '../../lib/filter.js';
import styles from './Filters.module.css';

const KINDS: ComponentKind[] = ['presentational', 'container', 'layout'];

export function Filters({
  filters,
  onChange,
}: {
  filters: FilterState;
  onChange: (next: FilterState) => void;
}) {
  const set = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch });

  return (
    <div className={styles.filters}>
      <label className={styles.search}>
        <span className={styles.searchIcon} aria-hidden>
          ⌕
        </span>
        <input
          type="search"
          placeholder="Filter by name or path"
          value={filters.query}
          onChange={(e) => set({ query: e.target.value })}
          aria-label="Filter components"
        />
      </label>

      <fieldset className={styles.group}>
        <legend className="eyebrow">Atomic level</legend>
        <div className={styles.chips}>
          {RANK_ORDER.map((level: AtomicLevel) => {
            const active = filters.ranks.includes(level);
            return (
              <button
                key={level}
                type="button"
                className={styles.rank}
                data-active={active}
                style={{ ['--rank' as string]: RANKS[level].colorVar }}
                onClick={() => set({ ranks: toggle(filters.ranks, level) })}
              >
                <span className={styles.rankDot} />
                {RANKS[level].label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className="eyebrow">Kind</legend>
        <div className={styles.chips}>
          {KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className={styles.kind}
              data-active={filters.kinds.includes(kind)}
              onClick={() => set({ kinds: toggle(filters.kinds, kind) })}
            >
              {KIND_LABEL[kind]}
            </button>
          ))}
        </div>
      </fieldset>

      <button
        type="button"
        className={styles.switch}
        role="switch"
        aria-checked={filters.presentationalOnly}
        onClick={() => set({ presentationalOnly: !filters.presentationalOnly })}
      >
        <span className={styles.track} data-on={filters.presentationalOnly}>
          <span className={styles.thumb} />
        </span>
        Presentational only
        <span className={styles.hint}>renders most reliably</span>
      </button>
    </div>
  );
}
