import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { ComponentSummary } from '../../api/types.js';
import { ComponentCard } from './ComponentCard.js';
import { gridDirectionFor, nextGridIndex } from './grid-nav.js';
import { useGridWindow } from './useGridWindow.js';
import { rowOffset } from './windowing.js';
import styles from './GalleryGrid.module.css';

/**
 * "Put focus on this card." Sent by the app when the inspector closes with focus
 * inside it — without it, focus falls to <body> and the next Tab restarts at the
 * top of the document (WCAG 2.4.3). `nonce` is what makes a repeat of the SAME
 * index a new request; the index alone would be ignored the second time.
 */
export interface FocusRequest {
  readonly index: number;
  readonly nonce: number;
}

interface GalleryGridProps {
  components: readonly ComponentSummary[];
  projectRoot: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  focusRequest?: FocusRequest | null;
}

export function GalleryGrid({
  components,
  projectRoot,
  selectedId,
  onSelect,
  focusRequest,
}: GalleryGridProps) {
  if (components.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>No components match these filters.</p>
        <p className={styles.emptyBody}>Clear a filter or widen the search to see more.</p>
      </div>
    );
  }

  return (
    <VirtualGrid
      components={components}
      projectRoot={projectRoot}
      selectedId={selectedId}
      onSelect={onSelect}
      focusRequest={focusRequest}
    />
  );
}

/**
 * Which collection index the focused element belongs to, or -1 if it is not a
 * card. Rows carry `data-row` and each row's children are its cards in visual
 * order, so DOM position IS the index — no per-card marker is needed and
 * ComponentCard stays untouched (the kit feature owns it).
 */
function cardIndexAt(target: EventTarget | null, columnCount: number): number {
  let el = target instanceof HTMLElement ? target : null;
  while (el) {
    const parent = el.parentElement;
    if (parent && parent.dataset.row !== undefined) {
      const row = Number.parseInt(parent.dataset.row, 10);
      const column = [...parent.children].indexOf(el);
      if (Number.isNaN(row) || column < 0) return -1;
      return row * columnCount + column;
    }
    el = parent;
  }
  return -1;
}

/**
 * The focusable card <button> at a collection index — null while its row sits
 * outside the mounted window, which is the normal case for a jump.
 */
function cardButtonAt(
  outer: HTMLElement | null,
  index: number,
  columnCount: number,
): HTMLElement | null {
  if (!outer || columnCount <= 0) return null;
  const row = outer.querySelector<HTMLElement>(`[data-row="${Math.floor(index / columnCount)}"]`);
  const cell = row?.children[index % columnCount];
  // The card button is the FIRST button in the cell; ComponentCard renders the
  // basket toggle after it, and focusing that would arm "add to kit" instead.
  return cell instanceof HTMLElement ? cell.querySelector('button') : null;
}

/**
 * Only the rows whose band intersects the scroll viewport (plus overscan) are
 * mounted. The full collection's height is reserved on the spacer so the
 * scrollbar stays honest, and each mounted row is absolutely positioned at its
 * real offset via `translateY` (a compositor-friendly transform, not `top`).
 *
 * Each row is its own responsive CSS grid of exactly `columnCount` equal tracks,
 * so the layout is identical to the old single auto-fill grid at every width —
 * `columnCount` is derived from the same `minmax(248px, 1fr)` rule. DOM order is
 * row-then-column, matching the visual order, so a card scrolled into view is a
 * real focusable <button> in the natural tab sequence.
 */
function VirtualGrid({
  components,
  projectRoot,
  selectedId,
  onSelect,
  focusRequest,
}: GalleryGridProps) {
  const { outerRef, measureRef, range, columnCount } = useGridWindow(components.length);
  // The index arrow keys asked for. It is a REQUEST, not a fact: virtualization
  // means the card may not exist yet, so it is held here until it does.
  const [pending, setPending] = useState<number | null>(null);
  const markerRef = useRef<HTMLDivElement | null>(null);

  // An outside caller asking for focus joins the same queue the arrow keys use,
  // so it inherits the off-window scroll-then-focus path already proven for
  // Home/End rather than a second, untested way of reaching an unmounted card.
  const nonce = focusRequest?.nonce ?? null;
  const requestedIndex = focusRequest?.index ?? -1;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the nonce IS the signal; re-running when only the index changes would steal focus on every re-render.
  useEffect(() => {
    if (nonce === null || requestedIndex < 0) return;
    setPending(requestedIndex);
  }, [nonce]);

  // Focus the requested card as soon as it is in the DOM. Keyed on the mounted
  // window as well as the index: when the target row is off-window the first
  // pass only scrolls, and it is the resulting window change that re-runs this
  // and completes the move. Without that dependency a Home/End jump would scroll
  // and then focus nothing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the mounted range is the change SIGNAL that must re-run this, not a value the body reads — what the body reads is the DOM that range produced, through the ref.
  useEffect(() => {
    if (pending === null) return;
    if (pending >= components.length) {
      // The filter narrowed under the request; the card it named is gone.
      setPending(null);
      return;
    }
    const card = cardButtonAt(outerRef.current, pending, columnCount);
    if (card) {
      card.focus();
      setPending(null);
      return;
    }
    // Off-window: the marker below sits at exactly the target row's band, so the
    // browser can scroll it into view for us — including finding the scroll
    // container, which the grid deliberately does not know about.
    markerRef.current?.scrollIntoView({ block: 'nearest' });
  }, [pending, components.length, columnCount, range.startRow, range.endRow, outerRef]);

  // Arrow/Home/End move focus between cards. This is an ADDITION to the tab
  // order, not a replacement: every card stays a real tab stop, so Tab still
  // walks the grid and focus is never trapped in it.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction = gridDirectionFor(event.key);
    if (!direction) return;
    // A modifier means the user asked the BROWSER for something (⌘←, Home with
    // Shift to extend, …). Leave those alone.
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const from = cardIndexAt(event.target, columnCount);
    // Focus is inside the grid but not on a card (the basket toggle): let the
    // key do whatever it normally does there.
    if (from < 0) return;
    // We own the key from here: arrows would otherwise scroll the page out from
    // under the card that still has focus.
    event.preventDefault();
    const next = nextGridIndex(from, direction, components.length, columnCount);
    if (next < 0 || next === from) return;
    setPending(next);
  };

  const rows = [];
  for (let row = range.startRow; row <= range.endRow; row++) {
    const from = row * columnCount;
    const slice = components.slice(from, Math.min(from + columnCount, components.length));
    if (slice.length === 0) continue;
    const rowStyle: CSSProperties = {
      transform: `translateY(${rowOffset(row, range.rowPitch)}px)`,
      // A number CSS var: substituted into `repeat(var(--cols), …)` in the module.
      ['--cols' as string]: columnCount,
    };
    rows.push(
      <div
        key={row}
        className={styles.row}
        data-row={row}
        style={rowStyle}
        ref={row === range.startRow ? measureRef : undefined}
      >
        {slice.map((component) => (
          <ComponentCard
            key={component.descriptor.id}
            component={component}
            projectRoot={projectRoot}
            selected={component.descriptor.id === selectedId}
            onSelect={() => onSelect(component.descriptor.id)}
          />
        ))}
      </div>,
    );
  }

  const pendingRow = pending === null ? null : Math.floor(pending / Math.max(1, columnCount));
  const offWindow =
    pendingRow !== null && (pendingRow < range.startRow || pendingRow > range.endRow);

  return (
    // The keydown listener sits on the container rather than on each card: it
    // needs the grid geometry (column count, mounted window) that only this level
    // has, and key events from the cards bubble to it. The interactive elements
    // are still the <button>s inside — this adds nothing to the a11y tree.
    <div
      ref={outerRef}
      className={styles.viewport}
      style={{ height: range.totalHeight }}
      onKeyDown={onKeyDown}
    >
      {rows}
      {offWindow && pendingRow !== null && (
        // A zero-content stand-in for a row that does not exist yet — the only
        // thing that can be scrolled to before its cards are mounted.
        <div
          ref={markerRef}
          aria-hidden
          className={styles.scrollMarker}
          style={{
            transform: `translateY(${rowOffset(pendingRow, range.rowPitch)}px)`,
            height: range.rowPitch,
          }}
        />
      )}
    </div>
  );
}
