import { createTheme } from '@mui/material/styles';

/**
 * A real app theme extended with its OWN top-level section, declared the way a
 * real target declares it: `customShadows` is handed to `createTheme` as an extra
 * option (apps module-augment MUI's `Theme` to type it), and MUI carries unknown
 * options through onto the built theme.
 *
 * The preview used to REBUILD this theme through `createTheme` while copying only
 * palette/typography/shape/components — so `customShadows` vanished and every
 * `theme.customShadows.*` read threw. That one omission was the largest single
 * cause of unrenderable components on a real target, which is why the shape is
 * pinned here.
 */
export const lightTheme = createTheme({
  customShadows: {
    tooltip: '0px 4px 12px rgba(0, 0, 0, 0.15)',
    card: '0px 1px 3px rgba(0, 0, 0, 0.08)',
  },
  palette: { mode: 'light', primary: { main: '#58D8F3' } },
  shape: { borderRadius: 8 },
});
