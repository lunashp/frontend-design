import type { ReactNode } from 'react';
import { Button } from '@/components/Button/Button';
import { Badge } from '@/components/Badge/Badge';

export interface CardProps {
  /** Card title. */
  title: string;
  /** Optional status badge label. */
  status?: string;
  /** Card body content. */
  children: ReactNode;
  /** Primary action label. */
  actionLabel?: string;
  /** Primary action handler. */
  onAction?: () => void;
}

/**
 * A molecule composing Button + Badge. Imports children via the `@/` path
 * alias to exercise alias resolution in the import graph.
 */
export function Card({ title, status, children, actionLabel, onAction }: CardProps) {
  return (
    <section
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: '12px',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <h3 style={{ margin: 0, fontSize: '18px' }}>{title}</h3>
        {status ? <Badge>{status}</Badge> : null}
      </header>
      <div>{children}</div>
      {actionLabel ? (
        <Button variant="primary" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </section>
  );
}
