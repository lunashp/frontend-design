import type { AtomicLevel, ComponentKind } from '../../api/types.js';
import { KIND_LABEL, RANKS, RANK_ORDER } from '../../lib/taxonomy.js';
import { toggle, type FilterState } from '../../lib/filter.js';
import type { DirectoryFacet } from '../../lib/source-area.js';
import styles from './Filters.module.css';

const KINDS: ComponentKind[] = ['presentational', 'container', 'layout'];

/** Directories shown in the facet — the design-system-ish ones first, then the
 *  most populated, capped so the list stays scannable. */
function facetOrder(facets: readonly DirectoryFacet[]): DirectoryFacet[] {
  return [...facets]
    .sort(
      (a, b) =>
        Number(b.area === 'design-system') - Number(a.area === 'design-system') ||
        b.count - a.count,
    )
    .slice(0, 12);
}

export function Filters({
  filters,
  onChange,
  facets,
}: {
  filters: FilterState;
  onChange: (next: FilterState) => void;
  facets: readonly DirectoryFacet[];
}) {
  const set = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch });
  const dirs = facetOrder(facets);

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

      <button
        type="button"
        className={styles.switch}
        role="switch"
        aria-checked={filters.designOnly}
        onClick={() => set({ designOnly: !filters.designOnly })}
      >
        <span className={styles.track} data-on={filters.designOnly}>
          <span className={styles.thumb} />
        </span>
        Design components only
        <span className={styles.hint}>hides icons, pages &amp; app plumbing</span>
      </button>

      {dirs.length > 1 && (
        <fieldset className={styles.group}>
          <legend className="eyebrow">Folder</legend>
          <div className={styles.chips}>
            <button
              type="button"
              className={styles.dir}
              data-active={filters.dir === null}
              onClick={() => set({ dir: null })}
            >
              All
            </button>
            {dirs.map((f) => (
              <button
                key={f.dir}
                type="button"
                className={styles.dir}
                data-active={filters.dir === f.dir}
                data-area={f.area}
                title={`${f.dir} · ${f.count}`}
                onClick={() => set({ dir: filters.dir === f.dir ? null : f.dir })}
              >
                {f.dir.split('/').slice(-1)[0] || f.dir}
                <span className={styles.dirCount}>{f.count}</span>
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className={styles.group}>
        <legend className="eyebrow">Atomic level</legend>
        <div className={styles.chips}>
          {RANK_ORDER.filter((level) => !filters.designOnly || level !== 'page').map((level: AtomicLevel) => {
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
