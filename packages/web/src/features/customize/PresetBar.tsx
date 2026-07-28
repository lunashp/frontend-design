import { useState } from 'react';
import type { Preset, PresetList } from '../../lib/presets.js';
import styles from './Customize.module.css';

/**
 * One saved preset: an Apply button carrying the name, plus inline rename and a
 * delete. Rename swaps the label for a field in place — no modal, no prompt — so
 * the whole preset lifecycle stays inside this small strip.
 */
function PresetRow({
  preset,
  onApply,
  onRename,
  onDelete,
}: {
  preset: Preset;
  onApply: (preset: Preset) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(preset.name);

  const commit = () => {
    const next = draft.trim();
    if (next !== '' && next !== preset.name) onRename(preset.id, next);
    setEditing(false);
  };

  if (editing) {
    return (
      <li className={styles.presetChip}>
        <input
          className={styles.presetRenameInput}
          value={draft}
          autoFocus
          spellCheck={false}
          aria-label={`Rename ${preset.name}`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(preset.name);
              setEditing(false);
            }
          }}
        />
      </li>
    );
  }

  return (
    <li className={styles.presetChip}>
      <button
        type="button"
        className={styles.presetApply}
        onClick={() => onApply(preset)}
        title="Apply this preset"
      >
        {preset.name}
      </button>
      <button
        type="button"
        className={styles.presetIcon}
        onClick={() => {
          setDraft(preset.name);
          setEditing(true);
        }}
        aria-label={`Rename ${preset.name}`}
        title="Rename"
      >
        ✎
      </button>
      <button
        type="button"
        className={styles.presetIcon}
        onClick={() => onDelete(preset.id)}
        aria-label={`Delete ${preset.name}`}
        title="Delete"
      >
        ✕
      </button>
    </li>
  );
}

/**
 * Save the current customization under a name, then re-apply / rename / delete
 * saved ones. This is the fix for "re-theming evaporates on reload": the map
 * that holds live edits is in-memory React state, but a saved preset is written
 * to localStorage and survives a refresh, so minutes of theming are one click
 * away again.
 */
export function PresetBar({
  presets,
  canSave,
  persisted,
  onSave,
  onApply,
  onRename,
  onDelete,
}: {
  presets: PresetList;
  /** Whether there is anything to save (the state is customized). */
  canSave: boolean;
  /** False when the last write did not reach storage — disclosed, not hidden. */
  persisted: boolean;
  onSave: (name: string) => void;
  onApply: (preset: Preset) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState('');

  const trimmed = name.trim();
  const submit = () => {
    if (trimmed === '' || !canSave) return;
    onSave(trimmed);
    setName('');
  };

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className="eyebrow">Presets</span>
        <span className={styles.sectionNote}>saved locally · survives reload</span>
      </div>

      <div className={styles.presetSave}>
        <input
          className={styles.presetInput}
          value={name}
          placeholder="Name this look…"
          spellCheck={false}
          aria-label="Preset name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <button
          type="button"
          className={styles.presetSaveBtn}
          onClick={submit}
          disabled={trimmed === '' || !canSave}
          title={canSave ? 'Save the current customization' : 'Customize something first'}
        >
          Save
        </button>
      </div>

      {!persisted && (
        <p className={styles.presetWarn}>
          Couldn’t write to local storage (private mode or it’s full), so presets won’t survive a
          reload here.
        </p>
      )}

      {presets.length > 0 ? (
        <ul className={styles.presetList}>
          {presets.map((p) => (
            <PresetRow
              key={p.id}
              preset={p}
              onApply={onApply}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </ul>
      ) : (
        <p className={styles.presetEmpty}>
          No saved presets yet. Customize the component, then save the result under a name to come
          back to it after a reload.
        </p>
      )}
    </section>
  );
}
