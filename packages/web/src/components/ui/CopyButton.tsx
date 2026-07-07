import { useEffect, useRef, useState } from 'react';
import { copyText } from '../../lib/clipboard.js';
import styles from './CopyButton.module.css';

export function CopyButton({
  text,
  label = 'Copy',
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onClick = async () => {
    if (await copyText(text)) {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <button
      type="button"
      className={className ? `${styles.copy} ${className}` : styles.copy}
      onClick={onClick}
      data-copied={copied}
    >
      {copied ? 'Copied ✓' : label}
    </button>
  );
}
