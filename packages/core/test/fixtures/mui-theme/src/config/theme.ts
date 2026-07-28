import { createTheme } from '@mui/material/styles';

// A referenced constant, NOT a literal at the palette leaf. Static mining must
// count `palette.primary.dark` as UNRESOLVED rather than guess `brandNavy`'s
// value — a fabricated token is worse than an absent one.
const brandNavy = '#0d47a1';

// A spread of a non-literal object: the mined options are provably incomplete,
// so mining discloses the spread as unresolved too.
const extraOptions = { zIndex: { appBar: 1100 } };

export const appTheme = createTheme({
  spacing: 8,
  shape: { borderRadius: 12 },
  palette: {
    primary: { main: '#1976d2', light: '#42a5f5', dark: brandNavy },
    secondary: { main: '#9c27b0' },
    error: { main: '#d32f2f' },
    text: { primary: '#1a2027', secondary: '#5a6672' },
    background: { default: '#ffffff', paper: '#f7f9fc' },
  },
  typography: {
    fontFamily: '"Inter", system-ui, sans-serif',
    fontSize: 14,
    h1: { fontSize: '2.5rem', fontWeight: 700 },
    body1: { fontSize: '1rem' },
  },
  colorSchemes: {
    light: { palette: { primary: { main: '#1976d2' }, background: { default: '#ffffff' } } },
    dark: { palette: { primary: { main: '#90caf9' }, background: { default: '#0a1929' } } },
  },
  ...extraOptions,
});
