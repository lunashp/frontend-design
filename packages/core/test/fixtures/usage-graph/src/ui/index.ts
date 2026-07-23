/**
 * A barrel that RE-EXPORTS Button. A file importing Button through this barrel
 * must credit Button, never this file — and this file itself must never appear
 * as a "used by" of Button, because a re-export is not a usage.
 */
export { Button } from './Button/Button';
export type { ButtonProps } from './Button/Button';
