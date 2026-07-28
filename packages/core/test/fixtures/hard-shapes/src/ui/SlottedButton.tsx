import type { ReactNode } from 'react';

interface SlottedButtonProps {
  children?: ReactNode;
  /** Adornment slots. They are `ReactNode`, so they ACCEPT a string — and filling
   *  them with one crams a word into a 20x20 icon box, overlapping the label. */
  startIcon?: ReactNode;
  endIcon?: ReactNode;
  loadingIndicator?: ReactNode;
  /** A content slot that is not `children`: it should name ITSELF, not the
   *  component, or one component renders its own name three times over. */
  helperText?: ReactNode;
}

export const SlottedButton = ({
  children,
  startIcon,
  endIcon,
  loadingIndicator,
  helperText,
}: SlottedButtonProps) => (
  <span>
    <button type="button">
      <span data-slot="start">{startIcon}</span>
      <span data-slot="label">{children}</span>
      <span data-slot="end">{endIcon}</span>
      <span data-slot="loading">{loadingIndicator}</span>
    </button>
    <small>{helperText}</small>
  </span>
);
