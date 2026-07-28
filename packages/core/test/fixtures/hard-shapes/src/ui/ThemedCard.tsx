import type { ReactNode } from 'react';
import { lightTheme } from '../config/theme.js';

interface ThemedCardProps {
  children?: ReactNode;
}

/**
 * Reads a CUSTOM top-level theme section. If the preview's rebuilt theme drops
 * `customShadows`, this throws on mount — the shape behind the largest cluster of
 * "Needs app context" cards on a real target.
 */
export const ThemedCard = ({ children }: ThemedCardProps) => (
  <div style={{ boxShadow: lightTheme.customShadows.card }}>{children}</div>
);
