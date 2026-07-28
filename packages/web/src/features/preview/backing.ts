/**
 * Backing surface behind the preview iframe. A component authored for a dark app
 * is invisible on a light stage (dark text on dark ground shows as nothing), and
 * vice-versa — so the stage backing must be switchable, independent of the app's
 * own theme. `checker` is the neutral default that keeps transparency visible.
 */
export type PreviewBacking = 'checker' | 'light' | 'dark';

export const BACKINGS: readonly { value: PreviewBacking; label: string }[] = [
  { value: 'checker', label: 'Checker' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
