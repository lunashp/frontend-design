import clsx from 'clsx';
import type { ReactNode } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps {
  /** Visual style of the button. */
  variant?: ButtonVariant;
  /** Size of the button. */
  size?: ButtonSize;
  /** Button label / content. */
  children: ReactNode;
  /** Click handler. */
  onClick?: () => void;
  /** Disable interaction. */
  disabled?: boolean;
}

/** A presentational button atom styled with CSS Modules. */
export function Button({
  variant = 'primary',
  size = 'md',
  children,
  onClick,
  disabled = false,
}: ButtonProps) {
  return (
    <button
      type="button"
      className={clsx(styles.button, {
        [styles.secondary]: variant === 'secondary',
        [styles.small]: size === 'sm',
      })}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
