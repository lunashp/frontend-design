/**
 * Harness for the preview keyboard-trap regression test. It mounts the REAL
 * `Inspector` — not a stand-in — with the same `overlay={compact}` wiring
 * app.tsx uses, between two sentinel buttons that stand for "the rest of the
 * page". `/api/artifact` and `/api/preview` are served by the mock middleware in
 * keyboard-trap.spec.ts, and the preview document it returns carries the REAL
 * PREVIEW_KEYBOARD_BRIDGE, so what runs here is the shipped pair.
 *
 * Sentinels matter: proving focus merely left the iframe is weaker than proving
 * it landed where the browser would have put it, and only a following tab stop
 * can show that.
 */

import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Inspector, type Tab } from '../../src/features/inspector/Inspector.js';
import { EMPTY_CUSTOMIZATION, type CustomizationState } from '../../src/lib/customize.js';
import { FIXTURE_COMPONENT } from '../fixture.js';

/** Same breakpoint app.tsx uses, so the harness flips modes where the app does. */
const COMPACT_QUERY = '(max-width: 1180px)';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

function Harness() {
  const compact = useMediaQuery(COMPACT_QUERY);
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<Tab>('Preview');
  const [customization, setCustomization] = useState<CustomizationState>(EMPTY_CUSTOMIZATION);
  const onClose = useCallback(() => setOpen(false), []);

  const inspector = (
    <Inspector
      component={open ? FIXTURE_COMPONENT : null}
      projectRoot="/fixture"
      tab={tab}
      onTabChange={setTab}
      customization={customization}
      onCustomizationChange={setCustomization}
      overlay={compact}
      onClose={onClose}
    />
  );

  return (
    <>
      <button type="button" id="before">
        before
      </button>
      {compact ? (
        <>
          <div className="harness-scrim" aria-hidden />
          <div className="harness-slide-over">{inspector}</div>
        </>
      ) : (
        <div className="harness-dock">{inspector}</div>
      )}
      <button type="button" id="after">
        after
      </button>
    </>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
