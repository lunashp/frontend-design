import { Card } from '@/components/Card/Card';
import { useTheme } from '@/context/ThemeContext';
import { useSession } from '@/context/SessionContext';
import { useToggle } from '@/hooks/useToggle';

export interface UserPanelProps {
  /** Display name of the user. */
  name: string;
}

/**
 * A container/organism: reads session (app) state as well as theme (styling)
 * context, uses a hook, and composes a Card. Higher contextDependencyScore than
 * the presentational atoms — driven by the session, not by the theme.
 */
export function UserPanel({ name }: UserPanelProps) {
  const theme = useTheme();
  const session = useSession();
  const [expanded, toggle] = useToggle(false);

  return (
    <Card
      title={name}
      status={session.role}
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
