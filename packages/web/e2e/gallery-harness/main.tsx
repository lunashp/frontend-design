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

function Harness() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <GalleryGrid
      components={GALLERY_COMPONENTS}
      projectRoot="/fixture"
      selectedId={selectedId}
      onSelect={setSelectedId}
    />
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
