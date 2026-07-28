import type { ReactNode } from 'react';

interface IconOnlyProps {
  /** The component's ONLY content. Emptying this slot as "an adornment" leaves a
   *  0px frame — the regression the adornment rule caused on its first pass. */
  icon: ReactNode;
  label?: string;
}

export const IconOnly = ({ icon, label }: IconOnlyProps) => (
  <span aria-label={label}>{icon}</span>
);
