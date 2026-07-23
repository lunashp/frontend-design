import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { computeGridWindow, type GridWindow } from './windowing.js';

/**
 * Measures the live grid geometry (scroll offset, viewport height, container
 * width, one card's height, the gap) and turns it into the row window to mount.
 *
 * The scroll container is NOT this component's own element — in the app the grid
 * sits inside `.catalogue` inside `.main`, and `.main` is the `overflow-y: auto`
 * scroller. So the hook walks up to find the nearest scrolling ancestor and reads
 * the grid's offset within it, rather than assuming it owns a scrollport. That is
 * what lets GalleryGrid keep the exact same public props and drop into app.tsx
 * unchanged while virtualizing internally.
 */

/** Mirrors GalleryGrid.module.css `minmax(248px, 1fr)`: the auto-fill track floor. */
const MIN_COLUMN_PX = 248;
/** A few rows above and below the fold so a fast scroll never shows blank space. */
const OVERSCAN_ROWS = 3;
/** Used only for the very first render, before layout is measured (px). */
const FALLBACK_GAP = 16;
const FALLBACK_CARD_HEIGHT = 168;
const FALLBACK_VIEWPORT = 800;
const FALLBACK_WIDTH = 1040;

interface Geometry {
  readonly cardHeight: number;
  readonly gap: number;
}

interface Viewport {
  readonly scrollOffset: number;
  readonly viewportHeight: number;
  readonly width: number;
}

export interface GridWindowState {
  /** Attach to the sized spacer element that holds the absolutely-positioned rows. */
  readonly outerRef: React.RefObject<HTMLDivElement | null>;
  /** Attach to the first mounted row so its height and gap can be measured live. */
  readonly measureRef: (el: HTMLElement | null) => void;
  readonly range: GridWindow;
  /** Cards per row — also the CSS `--cols` count and the row-slice width. */
  readonly columnCount: number;
}

/** The auto-fill column count for a width and gap: how many `MIN_COLUMN_PX` tracks fit. */
function columnCountFor(width: number, gap: number): number {
  if (width <= 0) return 1;
  return Math.max(1, Math.floor((width + gap) / (MIN_COLUMN_PX + gap)));
}

function findScrollParent(el: HTMLElement | null): HTMLElement {
  let node = el?.parentElement ?? null;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return document.documentElement;
}

export function useGridWindow(itemCount: number): GridWindowState {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const [geom, setGeom] = useState<Geometry>({
    cardHeight: FALLBACK_CARD_HEIGHT,
    gap: FALLBACK_GAP,
  });
  const [view, setView] = useState<Viewport>({
    scrollOffset: 0,
    viewportHeight: FALLBACK_VIEWPORT,
    width: FALLBACK_WIDTH,
  });

  // Re-point a single ResizeObserver at whichever row is currently first, so a
  // card growing (a late web font, a wrapped name) updates the measured pitch
  // instead of silently drifting every row below it.
  const rowObserver = useRef<ResizeObserver | null>(null);
  const measureRow = useCallback((el: HTMLElement) => {
    const cardHeight = el.offsetHeight;
    if (cardHeight <= 0) return;
    const gap = Number.parseFloat(getComputedStyle(el).columnGap) || FALLBACK_GAP;
    setGeom((prev) => (prev.cardHeight === cardHeight && prev.gap === gap ? prev : { cardHeight, gap }));
  }, []);
  const measureRef = useCallback(
    (el: HTMLElement | null) => {
      rowObserver.current?.disconnect();
      if (!el) return;
      const observer = new ResizeObserver(() => measureRow(el));
      observer.observe(el);
      rowObserver.current = observer;
      measureRow(el);
    },
    [measureRow],
  );

  useLayoutEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const scroller = findScrollParent(outer);
    const isDocument = scroller === document.documentElement;
    const scrollTarget: Window | HTMLElement = isDocument ? window : scroller;

    const recompute = () => {
      const width = outer.clientWidth;
      const viewportHeight = isDocument ? window.innerHeight : scroller.clientHeight;
      const outerTop = outer.getBoundingClientRect().top;
      const scrollerTop = isDocument ? 0 : scroller.getBoundingClientRect().top;
      // Positive once the grid's top has scrolled above the scroller's visible top.
      const scrollOffset = scrollerTop - outerTop;
      setView((prev) =>
        prev.scrollOffset === scrollOffset && prev.viewportHeight === viewportHeight && prev.width === width
          ? prev
          : { scrollOffset, viewportHeight, width },
      );
    };

    recompute();
    scrollTarget.addEventListener('scroll', recompute, { passive: true });
    window.addEventListener('resize', recompute);
    const resizeObserver = new ResizeObserver(recompute);
    resizeObserver.observe(outer);
    if (!isDocument) resizeObserver.observe(scroller);

    return () => {
      scrollTarget.removeEventListener('scroll', recompute);
      window.removeEventListener('resize', recompute);
      resizeObserver.disconnect();
    };
    // Element identity is stable across renders; the listeners are attached once.
  }, []);

  const columnCount = columnCountFor(view.width, geom.gap);
  const range = computeGridWindow({
    itemCount,
    columnCount,
    rowHeight: geom.cardHeight,
    rowGap: geom.gap,
    scrollOffset: view.scrollOffset,
    viewportHeight: view.viewportHeight,
    overscanRows: OVERSCAN_ROWS,
  });

  return { outerRef, measureRef, range, columnCount };
}
