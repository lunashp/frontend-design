import type { ReactNode, RefObject } from 'react';

interface AnchoredMenuProps {
  /**
   * A ref is a CONTAINER for an element, not an element. Skipping it because its
   * type mentions `HTMLDivElement` left it undefined and `ref.current` threw —
   * the regression the DOM-element rule caused on its first pass.
   */
  containerRef: RefObject<HTMLDivElement>;
  /**
   * A live DOM node. Synthesized as `{}` it is TRUTHY, so `Boolean(anchorEl)`
   * opens the menu against something that is not an element and the overlay
   * library throws from inside its own modal manager. `null` is a value the type
   * already permits, and it renders the trigger instead of an error card.
   */
  anchorEl: HTMLElement | null;
  /**
   * An ARRAY whose element type merely MENTIONS ReactNode. The control classifier
   * matched that mention anywhere in the type text and called the whole prop a
   * `node`, so it was filled with a string and `options.map` threw.
   */
  options: Array<{ value: string; label: string; icon?: ReactNode }>;
  onSelect: (value: string) => void;
}

export const AnchoredMenu = ({ anchorEl, containerRef, options, onSelect }: AnchoredMenuProps) => (
  <div ref={containerRef} data-has-ref={String(containerRef.current !== undefined)}>
    <button type="button" data-open={Boolean(anchorEl)}>
      Open
    </button>
    <ul>
      {options.map((o) => (
        <li key={o.value}>
          <button type="button" onClick={() => onSelect(o.value)}>
            {o.icon}
            {o.label}
          </button>
        </li>
      ))}
    </ul>
  </div>
);
