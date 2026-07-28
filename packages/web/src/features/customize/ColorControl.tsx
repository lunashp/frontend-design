import {
  alphaPercent,
  parseColorValue,
  swatchValue,
  withAlphaPercent,
  withPickedColor,
} from './color-value.js';
import styles from './Customize.module.css';

/**
 * One colour row, shared by the token panel and the design controls.
 *
 * The swatch is only ever shown (and only ever writes) the opaque half of the
 * colour, because `<input type="color">` has no alpha at all. Alpha therefore
 * gets its own slider and a percentage readout — visible, editable, and carried
 * through a swatch drag by `withPickedColor` instead of being quietly dropped.
 * The text field stays authoritative for values the swatch cannot express
 * (`var(--brand)`, `oklch(…)`), which is why it shows `value` verbatim.
 */
export function ColorControl({
  label,
  title,
  value,
  fallback,
  placeholder,
  onChange,
}: {
  label: string;
  /** Tooltip for the label — the raw token name, where it differs. */
  title?: string;
  value: string;
  /** What the swatch falls back to when the value is not a colour it can show. */
  fallback: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const color = parseColorValue(value);

  return (
    <div className={styles.row}>
      <input
        type="color"
        className={styles.swatch}
        value={swatchValue(value, fallback)}
        onChange={(e) => onChange(withPickedColor(value, e.target.value))}
        aria-label={`${label} color`}
      />
      <span className={styles.tokenName} title={title ?? label}>
        {label}
      </span>
      <div className={styles.colorEnd}>
        {color !== null && (
          <>
            <input
              type="range"
              className={styles.alpha}
              min={0}
              max={100}
              step={1}
              value={alphaPercent(color.alpha)}
              onChange={(e) => onChange(withAlphaPercent(value, Number(e.target.value)))}
              aria-label={`${label} alpha`}
              title="Alpha"
            />
            <span className={styles.alphaVal}>{alphaPercent(color.alpha)}%</span>
          </>
        )}
        <input
          type="text"
          className={styles.hex}
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}
