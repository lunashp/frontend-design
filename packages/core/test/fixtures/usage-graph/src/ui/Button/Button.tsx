import type { ReactNode } from 'react';

export interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
}

/**
 * The shared atom the usage index is measured against. Exported BOTH as a named
 * export AND as the default of the SAME declaration — the common real-world
 * pattern (see Badge in simple-react). Discovery catalogues it once, under the
 * named export, so a DEFAULT import of it must still resolve to that one
 * componentId: the usage index can only credit a default import correctly if it
 * matches on the declaration itself, not on the export name.
 */
export function Button({ children, onClick }: ButtonProps) {
  return (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  );
}

export default Button;
