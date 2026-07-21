import { DESIGN_GROUPS, type DesignField } from '../../lib/design-overrides.js';
import styles from './Customize.module.css';

function isHex(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
}

function Field({
  field,
  value,
  onChange,
}: {
  field: DesignField;
  value: string;
  onChange: (value: string) => void;
}) {
  switch (field.control) {
    case 'range': {
      const current = value === '' ? (field.default ?? String(field.min ?? 0)) : value;
      return (
        <div className={styles.row}>
          <span className={styles.tokenName}>{field.label}</span>
          <input
            type="range"
            className={styles.range}
            min={field.min}
            max={field.max}
            step={field.step}
            value={current}
            onChange={(e) => onChange(e.target.value)}
            aria-label={field.label}
          />
          <span className={styles.rangeVal}>
            {current}
            {field.unit}
          </span>
        </div>
      );
    }
    case 'color':
      return (
        <div className={styles.row}>
          <input
            type="color"
            className={styles.swatch}
            value={isHex(value) ? value : '#888888'}
            onChange={(e) => onChange(e.target.value)}
            aria-label={`${field.label} color`}
          />
          <span className={styles.tokenName}>{field.label}</span>
          <input
            type="text"
            className={styles.hex}
            value={value}
            placeholder="—"
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
    case 'select':
      return (
        <label className={styles.row}>
          <span className={styles.tokenName}>{field.label}</span>
          <select
            className={styles.select}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          >
            {field.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      );
    default:
      return (
        <label className={styles.row}>
          <span className={styles.tokenName}>{field.label}</span>
          <input
            type="text"
            className={styles.text}
            value={value}
            placeholder={field.placeholder}
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      );
  }
}

export function DesignControls({
  overrides,
  onChange,
}: {
  overrides: Record<string, string>;
  onChange: (id: string, value: string) => void;
}) {
  return (
    <div className={styles.panel}>
      {DESIGN_GROUPS.map((group) => (
        <fieldset key={group.label} className={styles.group}>
          <legend className="eyebrow">{group.label}</legend>
          {group.fields.map((f) => (
            <Field
              key={f.id}
              field={f}
              value={overrides[f.id] ?? ''}
              onChange={(v) => onChange(f.id, v)}
            />
          ))}
        </fieldset>
      ))}
    </div>
  );
}
