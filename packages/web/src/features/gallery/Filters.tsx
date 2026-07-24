import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { AtomicLevel, ComponentKind } from '../../api/types.js';
import { KIND_LABEL, RANKS, RANK_ORDER, ROLE_LABEL, ROLE_ORDER } from '../../lib/taxonomy.js';
import { toggle, type FilterState, type SortOrder } from '../../lib/filter.js';
import type { DirectoryFacet } from '../../lib/source-area.js';
import { isTextEntry } from './shortcuts.js';
import styles from './Filters.module.css';

const KINDS: ComponentKind[] = ['presentational', 'container', 'layout'];

/** Sort options, paired with the label the control shows for each. */
const SORTS: { value: SortOrder; label: string }[] = [
  { value: 'reliability', label: 'Most reliable' },
  { value: 'mostUsed', label: 'Most used' },
];

/**
 * The context-score caps offered, as a single-select "at most this much app
 * context" ladder. `null` = no cap. The thresholds mirror the meter's own
 * bands (see `contextLoadLabel`): 0 is isolated, ≤2 light, ≤5 some. This is the
 * app's headline "will it port cleanly" signal — sortable already, now
 * filterable. Single-select because it is a ceiling, not a set.
 */
const CONTEXT_CAPS: { value: number | null; label: string }[] = [
  { value: null, label: 'Any' },
  { value: 0, label: 'Isolated' },
  { value: 2, label: '≤ Light' },
  { value: 5, label: '≤ Some' },
];

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
  const inputRef = useRef<HTMLInputElement>(null);

  // `/` jumps here from anywhere — the search-first reflex every catalogue has.
  // The listener lives with the input it focuses, so there is no ref to thread
  // through the app and it unregisters with the sidebar it belongs to.
  useEffect(() => {
    const onSlash = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      // Someone typing `/Users/…` into the scan form means the character, not
      // the shortcut. Stealing focus mid-path made that field unusable.
      if (isTextEntry(document.activeElement)) return;
      event.preventDefault();
      const input = inputRef.current;
      input?.focus();
      // Select rather than append: `/` on a stale query means "search again".
      input?.select();
    };
    document.addEventListener('keydown', onSlash);
    return () => document.removeEventListener('keydown', onSlash);
  }, []);

  // Escape in the field clears it and steps back out to the gallery. It stops
  // there too: app.tsx also closes the inspector on Escape, and one keypress
  // wiping the query AND the selection is a surprise, not a shortcut.
  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    if (filters.query) set({ query: '' });
    event.currentTarget.blur();
  };

  return (
    <div className={styles.filters}>
      <label className={styles.search}>
        <span className={styles.searchIcon} aria-hidden>
          ⌕
        </span>
        <input
          ref={inputRef}
          type="search"
          placeholder="Filter by name or path"
          value={filters.query}
          onChange={(e) => set({ query: e.target.value })}
          onKeyDown={onSearchKeyDown}
          aria-label="Filter components"
        />
        {/* States the shortcut at the thing it operates on — the cheapest kind of
            discoverability, and it doubles as the "you can type here" cue. */}
        <kbd className={styles.searchKey} aria-hidden>
          /
        </kbd>
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
        <legend className="eyebrow">Sort by</legend>
        <div className={styles.chips}>
          {SORTS.map((s) => (
            <button
              key={s.value}
              type="button"
              className={styles.kind}
              data-active={filters.sort === s.value}
              aria-pressed={filters.sort === s.value}
              onClick={() => set({ sort: s.value })}
            >
              {s.label}
            </button>
          ))}
        </div>
        {filters.sort === 'mostUsed' && (
          <span className={styles.hint}>imports from scanned source; stories &amp; tests excluded</span>
        )}
      </fieldset>

      <fieldset className={styles.group}>
        <legend className="eyebrow">Context</legend>
        <div className={styles.chips}>
          {CONTEXT_CAPS.map((c) => (
            <button
              key={c.label}
              type="button"
              className={styles.kind}
              data-active={filters.maxContext === c.value}
              aria-pressed={filters.maxContext === c.value}
              onClick={() => set({ maxContext: c.value })}
            >
              {c.label}
            </button>
          ))}
        </div>
        <span className={styles.hint}>how much app context it needs to render</span>
      </fieldset>

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
        <legend className="eyebrow">Role</legend>
        <div className={styles.chips}>
          {ROLE_ORDER.map((role) => (
            <button
              key={role}
              type="button"
              className={styles.kind}
              data-active={filters.roles.includes(role)}
              aria-pressed={filters.roles.includes(role)}
              onClick={() => set({ roles: toggle(filters.roles, role) })}
            >
              {ROLE_LABEL[role]}
            </button>
          ))}
        </div>
        <span className={styles.hint}>what the component is for</span>
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
