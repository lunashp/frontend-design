import { Card } from '@/components/Card/Card';
import { useTheme } from '@/context/ThemeContext';
import { useToggle } from '@/hooks/useToggle';

export interface UserPanelProps {
  /** Display name of the user. */
  name: string;
}

/**
 * A container/organism: reads theme context, uses a hook, and composes a Card.
 * Higher contextDependencyScore than the presentational atoms.
 */
export function UserPanel({ name }: UserPanelProps) {
  const theme = useTheme();
  const [expanded, toggle] = useToggle(false);

  return (
    <Card
      title={name}
      status={theme.mode}
      actionLabel={expanded ? 'Collapse' : 'Expand'}
      onAction={toggle}
    >
      {expanded ? (
        <p style={{ color: theme.accent }}>More details about {name}.</p>
      ) : (
        <p>Tap expand to see details.</p>
      )}
    </Card>
  );
}
