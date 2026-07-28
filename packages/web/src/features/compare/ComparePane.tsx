import { useEffect, useMemo, useRef } from 'react';
import { compareMany, type DepCell, type PropCell, type TokenCell } from './compare.js';
import { CompareColumns } from './CompareColumns.js';
import { CompareMeta } from './CompareMeta.js';
import { CompareTable } from './CompareTable.js';
import { useArtifacts } from './useArtifacts.js';
import styles from './ComparePane.module.css';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';

/** Visible, focusable descendants in tab order — for the modal focus trap. */
function tabStops(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/** The Compare view accepts 2 or 3 components — enough to weigh duplicates, few
 *  enough to fit side by side and stay legible. */
const MIN_COMPARE = 2;
const MAX_COMPARE = 3;

export interface CompareItem {
  id: string;
  name: string;
}

function gridTemplateFor(count: number): string {
  return `minmax(9rem, 1.1fr) repeat(${count}, minmax(0, 1fr))`;
}

function renderPropCell(cell: PropCell | null) {
  if (cell === null) return <span className={styles.absent}>absent</span>;
  return (
    <span className={styles.propCell}>
      <code className={styles.type}>{cell.tsType}</code>
      <span className={styles.propMeta}>
        {cell.required ? (
          <span className={styles.reqTag}>required</span>
        ) : (
          <span className={styles.optTag}>optional</span>
        )}
        {cell.defaultValue !== null && (
          <span className={styles.defTag}>= {cell.defaultValue}</span>
        )}
      </span>
    </span>
  );
}

function renderTokenCell(cell: TokenCell | null) {
  if (cell === null) return <span className={styles.absent}>absent</span>;
  return (
    <span className={styles.tokenCell}>
      {cell.category === 'color' && (
        <span className={styles.swatch} style={{ background: cell.value }} aria-hidden="true" />
      )}
      <code className={styles.type}>{cell.value}</code>
    </span>
  );
}

function renderDepCell(cell: DepCell | null) {
  if (cell === null) return <span className={styles.absent}>not required</span>;
  return <code className={styles.type}>{cell}</code>;
}

/** How many distinct facts differ — used for the honest verdict headline. */
function differenceCount(comparison: ReturnType<typeof compareMany>): number {
  return (
    comparison.props.differing.length +
    comparison.tokens.differing.length +
    comparison.deps.differing.length +
    comparison.meta.filter((m) => m.contract && !m.identical).length
  );
}

/**
 * The Compare drawer: 2–3 components side by side — thumbnails on top, then the
 * structured diff of their DESIGN CONTRACT (props, tokens, deps) with differences
 * loud and matches muted. It answers "are these the same component, and which is
 * canonical?" without a byte diff of the rewritten bundle. A modal overlay with a
 * focus trap and Escape-to-close, mirroring the kit drawer's keyboard contract.
 */
export function ComparePane({
  projectRoot,
  items,
  onClose,
  onRemove,
}: {
  projectRoot: string;
  /** The basket selection with resolved names, in order. */
  items: readonly CompareItem[];
  onClose: () => void;
  onRemove: (id: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const inRange = items.length >= MIN_COMPARE && items.length <= MAX_COMPARE;
  // Only fetch when the selection is comparable; out of range we guide instead of
  // building artifacts the view will not show.
  const compareIds = useMemo(
    () => (inRange ? items.map((i) => i.id) : []),
    [inRange, items],
  );
  const { status, artifacts, error } = useArtifacts(projectRoot, compareIds);

  const comparison = useMemo(
    () =>
      status === 'ready' && artifacts.length >= MIN_COMPARE
        ? compareMany(artifacts, projectRoot)
        : null,
    [status, artifacts, projectRoot],
  );

  // Modal keyboard contract: focus the panel on open, trap Tab, Escape closes, and
  // focus returns to the opener on close — the same WCAG 2.1.2 handling the kit
  // drawer and inspector slide-over use (those files are not ours to share from).
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const stops = tabStops(panel);
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!first || !last) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const activeEl = document.activeElement;
      if (event.shiftKey && (activeEl === first || activeEl === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeEl === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (opener?.isConnected) opener.focus();
    };
  }, [onClose]);

  const gridTemplate = gridTemplateFor(Math.max(items.length, MIN_COMPARE));

  return (
    <>
      <div className={styles.scrim} onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compare-title"
        tabIndex={-1}
      >
        <div className={styles.head}>
          <div className={styles.title}>
            <span id="compare-title" className={styles.titleText}>
              Compare components
            </span>
            <span className={styles.titleSub}>
              {inRange
                ? `${items.length} side by side`
                : `${items.length} selected — pick ${MIN_COMPARE}–${MAX_COMPARE}`}
            </span>
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close compare"
          >
            ✕
          </button>
        </div>

        <div className={styles.body}>
          {items.length < MIN_COMPARE ? (
            <div className={styles.guide}>
              <p className={styles.guideTitle}>Pick at least two</p>
              <p>
                Add {MIN_COMPARE}–{MAX_COMPARE} components to the kit with the{' '}
                <strong>+</strong> on each gallery card, then reopen Compare to weigh them side by
                side — props, tokens, and dependencies, with the differences highlighted.
              </p>
            </div>
          ) : items.length > MAX_COMPARE ? (
            <div className={styles.guide}>
              <p className={styles.guideTitle}>Too many to compare</p>
              <p>
                Compare shows up to {MAX_COMPARE} at once — you have {items.length}. Remove some to
                get down to {MAX_COMPARE}:
              </p>
              <div className={styles.trimChips}>
                {items.map((item) => (
                  <span key={item.id} className={styles.trimChip}>
                    {item.name}
                    <button
                      type="button"
                      className={styles.trimRemove}
                      onClick={() => onRemove(item.id)}
                      aria-label={`Remove ${item.name} from comparison`}
                      title="Remove"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ) : status === 'error' ? (
            <p className={styles.error}>{error ?? 'Failed to build the components.'}</p>
          ) : comparison ? (
            <>
              <div
                className={styles.verdict}
                data-identical={comparison.identical}
                role="status"
              >
                {comparison.identical ? (
                  <>
                    <span className={styles.verdictMark}>=</span>
                    <span>
                      No meaningful differences — these look like the same component.{' '}
                      {comparison.mostUsedIndex !== null
                        ? 'Keep the most-used one and drop the rest.'
                        : "Reuse can't pick a winner, so keep whichever fits."}
                    </span>
                  </>
                ) : (
                  <>
                    <span className={styles.verdictMark}>≠</span>
                    <span>
                      {differenceCount(comparison)} difference
                      {differenceCount(comparison) === 1 ? '' : 's'} across props, tokens, and
                      dependencies.
                    </span>
                  </>
                )}
              </div>

              <CompareColumns
                projectRoot={projectRoot}
                columns={comparison.columns}
                mostUsedIndex={comparison.mostUsedIndex}
                gridTemplate={gridTemplate}
                onRemove={onRemove}
              />

              <CompareMeta meta={comparison.meta} gridTemplate={gridTemplate} />

              <CompareTable
                title="Props"
                differing={comparison.props.differing}
                same={comparison.props.same}
                renderCell={renderPropCell}
                gridTemplate={gridTemplate}
                emptyLabel="Neither declares props"
              />
              <CompareTable
                title="Design tokens"
                differing={comparison.tokens.differing}
                same={comparison.tokens.same}
                renderCell={renderTokenCell}
                gridTemplate={gridTemplate}
                emptyLabel="No tokens extracted"
              />
              <CompareTable
                title="External dependencies"
                differing={comparison.deps.differing}
                same={comparison.deps.same}
                renderCell={renderDepCell}
                gridTemplate={gridTemplate}
                emptyLabel="Both are self-contained"
              />
            </>
          ) : (
            <p className={styles.loading}>Building {items.length} components to compare…</p>
          )}
        </div>
      </div>
    </>
  );
}
