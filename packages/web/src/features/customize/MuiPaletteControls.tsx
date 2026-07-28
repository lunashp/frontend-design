import { ColorControl } from './ColorControl.js';
import { MUI_PALETTE_CONTROLS } from './mui-palette.js';
import styles from './Customize.module.css';

/**
 * Colour pickers for a MUI component's theme palette, live over the preview.
 *
 * Shown only for MUI components (the preview emits `--mui-palette-*` vars only
 * then). Each pick is stored as a customization override keyed by the control's
 * `mui:` id; CustomizePane expands those into the concrete `--mui-*` variable
 * overrides the preview applies. Controls start UNSET — a swatch is an override
 * slot, not a claim about the app's current value (which the pane doesn't hold).
 */
export function MuiPaletteControls({
  overrides,
  onChange,
}: {
  /** All customization overrides, keyed by id; MUI picks live under `mui:*`. */
  overrides: Readonly<Record<string, string>>;
  onChange: (id: string, value: string) => void;
}) {
  return (
    <div className={styles.panel}>
      {MUI_PALETTE_CONTROLS.map((control) => (
        <ColorControl
          key={control.id}
          label={control.label}
          title={control.cssVar}
          value={overrides[control.id] ?? ''}
          fallback="#888888"
          placeholder="—"
          onChange={(value) => onChange(control.id, value)}
        />
      ))}
    </div>
  );
}
