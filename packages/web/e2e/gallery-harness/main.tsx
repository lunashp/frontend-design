/**
 * Mounts the REAL GalleryGrid — not a stand-in — with a 1000-component fixture
 * inside a scrolling host, so the virtualization spec drives the shipped code.
 * The grid must find `#scroller` as its scroll parent and mount only the rows in
 * the viewport window. Selection is real state so a card click/keypress is a live
 * path, and the grid's public props are exactly what app.tsx passes.
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
// The app's global tokens (--space-4, --text-lg, …) so cards render at real size
// and getComputedStyle reports real px for the gap the windowing math reads.
import '../../src/styles/global.css';
import { GalleryGrid } from '../../src/features/gallery/GalleryGrid.js';
import { GALLERY_COMPONENTS } from '../gallery-fixture.js';

/** The index the focus-restore case aims at: far outside the mounted window. */
const FAR_INDEX = 900;

function Harness() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Stands in for app.tsx handing focus back to the gallery when the docked
  // inspector closes. Only the GRID half of that contract is exercised here —
  // "a request focuses that card, mounted or not" — which is the part with the
  // virtualization hazard in it.
  const [focusRequest, setFocusRequest] = useState<{ index: number; nonce: number } | null>(null);
  return (
    <>
      <GalleryGrid
        components={GALLERY_COMPONENTS}
        projectRoot="/fixture"
        selectedId={selectedId}
        onSelect={setSelectedId}
        focusRequest={focusRequest}
      />
      {/* AFTER the grid: the tab-order scenario Tabs from `#before` and must land
          on the first card, so nothing focusable may sit between them. */}
      <button
        type="button"
        id="send-focus"
        onClick={() => setFocusRequest((r) => ({ index: FAR_INDEX, nonce: (r?.nonce ?? 0) + 1 }))}
      >
        restore focus to card {FAR_INDEX}
      </button>
    </>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
