import type { ControlKind, PropControl } from '../../api/types.js';
import styles from './Customize.module.css';

const EDITABLE: ReadonlySet<ControlKind> = new Set<ControlKind>([
  'enum',
  'boolean',
  'number',
  'color',
  'string',
]);

function Control({
  prop,
  value,
  onChange,
}: {
  prop: PropControl;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  switch (prop.kind) {
    case 'enum':
      return (
        <select
          className={styles.select}
          value={String(value ?? prop.options?.[0] ?? '')}
          onChange={(e) => onChange(e.target.value)}
        >
          {prop.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case 'boolean':
      return (
        <input
          type="checkbox"
          className={styles.check}
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case 'number':
      return (
        <input
          type="number"
          className={styles.text}
          value={String(value ?? 0)}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      );
    case 'color':
      return (
        <input
          type="text"
          className={styles.text}
          value={String(value ?? '')}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    default:
      return (
        <input
          type="text"
          className={styles.text}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

export function PropControls({
  props,
  values,
  onChange,
}: {
  props: readonly PropControl[];
  values: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
}) {
  const editable = props.filter((p) => EDITABLE.has(p.kind));
  if (editable.length === 0) return null;

  return (
    <fieldset className={styles.group}>
      <legend className="eyebrow">Props</legend>
      {editable.map((p) => (
        <label key={p.name} className={styles.row}>
          <span className={styles.tokenName} title={p.tsType}>
            {p.name}
          </span>
          <Control prop={p} value={values[p.name]} onChange={(v) => onChange(p.name, v)} />
        </label>
      ))}
    </fieldset>
  );
}
