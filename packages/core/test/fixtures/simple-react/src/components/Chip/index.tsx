import type { CSSProperties } from 'react';
import { formatLabel } from '@/utils/format';

export interface ChipProps {
  /** Text shown in the chip. */
  label: string;
  /** Visual tone. */
  tone?: 'neutral' | 'accent';
}

/**
 * A presentational atom defined as a folder/index.tsx component that imports a
 * local .js util. Exercises the /index.tsx entry-collision and JS-sibling cases.
 */
export function Chip({ label, tone = 'neutral' }: ChipProps) {
  const style: CSSProperties = {
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: '6px',
    fontSize: '12px',
    background: tone === 'accent' ? '#6366f1' : '#e5e7eb',
    color: tone === 'accent' ? '#ffffff' : '#111827',
  };
  return <span style={style}>{formatLabel(label)}</span>;
}
