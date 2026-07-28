import { createContext, useContext } from 'react';

export interface Session {
  readonly role: 'admin' | 'viewer';
}

export const SessionContext = createContext<Session>({ role: 'viewer' });

/**
 * Consumes real app state — unlike `useTheme`, which is a styling concern, this
 * is what makes a component a container.
 */
export function useSession(): Session {
  return useContext(SessionContext);
}
