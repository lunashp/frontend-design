import { createContext, useContext } from 'react';

export interface Theme {
  readonly accent: string;
  readonly mode: 'light' | 'dark';
}

export const ThemeContext = createContext<Theme>({ accent: '#3b82f6', mode: 'light' });

/** Consumes the theme context — a container-ish signal for classification. */
export function useTheme(): Theme {
  return useContext(ThemeContext);
}
