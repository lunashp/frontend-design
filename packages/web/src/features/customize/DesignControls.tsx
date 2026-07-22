import { useState } from 'react';
import {
  DESIGN_GROUPS,
  DESIGN_STATE_SELECTORS,
  type DesignState,
} from '../../lib/design-overrides.js';
import { ColorControl } from './ColorControl.js';
import {
  DESIGN_STATE_TABS,
  designFieldBindings,
  designStateCaveat,
  statesWithOverrides,
  type DesignFieldBinding,
  type DesignOverrideKey,
} from './design-state.js';
import styles from './Customize.module.css';

/**
 * A control takes a whole binding, never a loose id: the key it writes and the
 * value it shows have to come from the same state, and the binding is the only
 * thing that can carry a `DesignOverrideKey`.
 */
function Field({
  binding,
  onChange,
}: {
  binding: DesignFieldBinding;
  onChange: (value: string) => void;
}) {
  const { field, value } = binding;
  switch (field.control) {
    case 'range': {
      // Unset shows what the control inherits — on a state tab that is the
      // resting value, so the slider starts where the component actually is.
      const current = value === '' ? binding.inherited : value;
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
        <ColorControl
          label={field.label}
          value={value}
          fallback="#888888"
          placeholder="—"
          onChange={onChange}
        />
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

/**
 * The controls edit one interactive state at a time. Every control is wired by
 * `designFieldBindings`, so picking `Hover` and dragging Radius stores
 * `hover:radius` — without that mapping the hover/focus/active half of the
 * override vocabulary is unreachable and the tab strip is decoration. `onChange`
 * accepts only a `DesignOverrideKey`, so this component cannot route around it.
 *
 * Each tab carries a dot when that state already paints something: a hover
 * colour is invisible until the preview is hovered, and an edit the user cannot
 * see they made comes back as a bug report, not as a feature.
 */
export function DesignControls({
  overrides,
  onChange,
}: {
  overrides: Record<string, string>;
  onChange: (key: DesignOverrideKey, value: string) => void;
}) {
  const [state, setState] = useState<DesignState | null>(null);
  const marked = statesWithOverrides(overrides);
  const caveat = designStateCaveat(state);

  return (
    <div className={styles.panel}>
      <div className={styles.states} role="group" aria-label="Interactive state">
        {DESIGN_STATE_TABS.map((tab) => {
          const selected = tab.state === state;
          const overridden = marked.has(tab.state);
          return (
            <button
              key={tab.label}
              type="button"
              className={selected ? `${styles.stateTab} ${styles.stateTabOn}` : styles.stateTab}
              aria-pressed={selected}
              // The dot is decorative, so the same fact goes in the label —
              // otherwise a screen-reader user cannot tell an edited state from
              // an untouched one.
              aria-label={overridden ? `${tab.label} (has overrides)` : tab.label}
              title={tab.title}
              onClick={() => setState(tab.state)}
            >
              {tab.label}
              {overridden && <span className={styles.stateDot} aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      {state !== null && (
        <p className={styles.stateNote}>
          Applied on <code>{DESIGN_STATE_SELECTORS[state]}</code> only — fields left unset keep
          their resting value, and a field set back to its resting value emits nothing.
        </p>
      )}

      {/* Disclosed rather than left inert: the Focus tab paints nothing at all
          for the common wrapper-<div> root, and a control that silently does
          nothing is worse than an absent one. */}
      {caveat !== null && <p className={styles.stateWarn}>{caveat}</p>}

      {DESIGN_GROUPS.map((group) => (
        <fieldset key={group.label} className={styles.group}>
          <legend className="eyebrow">{group.label}</legend>
          {designFieldBindings(state, group.fields, overrides).map((binding) => (
            <Field
              key={binding.key}
              binding={binding}
              onChange={(v) => onChange(binding.key, v)}
            />
          ))}
        </fieldset>
      ))}
    </div>
  );
}
