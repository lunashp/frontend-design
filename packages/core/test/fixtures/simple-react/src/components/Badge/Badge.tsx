import type { CSSProperties, ReactNode } from 'react';

export interface BadgeProps {
  /** Badge text. */
  children: ReactNode;
  /** Background color of the badge. */
  color?: string;
}

/** A presentational atom using inline styles (tests the inline-style strategy). */
export function Badge({ children, color = '#10b981' }: BadgeProps) {
  const style: CSSProperties = {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '9999px',
    fontSize: '12px',
    fontWeight: 600,
    color: '#ffffff',
    background: color,
  };
  return <span style={style}>{children}</span>;
}
