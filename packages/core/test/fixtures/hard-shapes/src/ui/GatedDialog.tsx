import type { ReactNode } from 'react';

interface GatedDialogProps {
  /** The visibility gate. Synthesized as `false`, this component renders NOTHING
   *  — which is how every modal in a real target previewed as an empty frame. */
  open: boolean;
  onClose: () => void;
  /** A dialog's title is a real design prop, but `title` is also an HTML global
   *  attribute — so a filter aimed at inherited DOM noise removed it. */
  title: string;
  // Left UNDOCUMENTED on purpose (a `//` comment, not JSDoc): react-docgen-typescript
  // silently drops a `children` that carries no description, and 76% of the real
  // target's components declare it exactly like this — so their preview renders an
  // empty box. A JSDoc here would hide the bug this fixture exists to pin.
  children?: ReactNode;
}

export const GatedDialog = ({ open, onClose, title, children }: GatedDialogProps) => {
  if (!open) return null;
  return (
    <div role="dialog" aria-label={title}>
      <h2>{title}</h2>
      <div>{children}</div>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  );
};
