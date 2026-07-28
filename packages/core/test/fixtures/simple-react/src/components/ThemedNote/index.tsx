import { useTheme } from '@/context/ThemeContext';

/**
 * An anonymous default export — it has no identifier, so its name comes from
 * the folder. It reads ONLY the theme, which is a styling concern: it must stay
 * a presentational atom with a zero context score.
 */
export default () => {
  const theme = useTheme();
  return <p style={{ color: theme.accent, margin: 0 }}>Themed note</p>;
};
