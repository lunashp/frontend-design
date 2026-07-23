import { useState } from 'react';
import type { Token } from '../../api/types.js';
import { EMPTY_CUSTOMIZATION, emptyTokensReason } from '../../lib/customize.js';
import type { Preset, PresetList } from '../../lib/presets.js';
import { TokenPanel } from '../customize/TokenPanel.js';
import { usePresets } from '../customize/usePresets.js';
import { changedKitTokens, kitPresetScopeId } from './kit-retheme.js';
import styles from './KitPane.module.css';

/**
 * Saved-preset strip for the kit: save the current override map under a name, and
 * re-apply / delete saved ones. A leaner cousin of the customize PresetBar —
 * re-theming a kit only carries token overrides, so there is no prop/design state
 * to snapshot and no rename affordance to justify. Presets live under a scope id
 * derived from the exact basket (see `kitPresetScopeId`), so applying one never
 * seeds token ids the current kit does not have.
 */
function KitPresetStrip({
  presets,
  persisted,
  canSave,
  onSave,
  onApply,
  onDelete,
}: {
  presets: PresetList;
  persisted: boolean;
  canSave: boolean;
  onSave: (name: string) => void;
  onApply: (preset: Preset) => void;
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
    <div className={styles.presets}>
      <div className={styles.presetSave}>
        <input
          className={styles.presetInput}
          value={name}
          placeholder="Save this theme as…"
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
          title={canSave ? 'Save the current re-theme' : 'Change a token first'}
        >
          Save preset
        </button>
      </div>

      {!persisted && (
        <p className={styles.presetWarn}>
          Couldn’t write to local storage (private mode or it’s full), so presets won’t survive a
          reload here.
        </p>
      )}

      {presets.length > 0 && (
        <ul className={styles.presetList}>
          {presets.map((p) => (
            <li key={p.id} className={styles.presetChip}>
              <button
                type="button"
                className={styles.presetApply}
                onClick={() => onApply(p)}
                title="Apply this preset to the whole kit"
              >
                {p.name}
              </button>
              <button
                type="button"
                className={styles.presetDelete}
                onClick={() => onDelete(p.id)}
                aria-label={`Delete ${p.name}`}
                title="Delete"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The kit's bulk re-theme editor: set token override values ONCE and they apply
 * across every component in the kit (one shared token namespace). A saved preset
 * can seed those overrides; a reset returns the kit to its original tokens; the
 * changed-token line keeps it honest about what differs from the source. When the
 * kit exposes no extractable tokens the editor is replaced by the honest reason
 * (reusing `emptyTokensReason`) rather than an empty panel.
 *
 * Controlled: the KitPane owns `overrides` so it can regenerate the downloadable
 * `tokens.css` and the file browser from the same map this editor mutates.
 */
export function KitRetheme({
  projectRoot,
  ids,
  tokens,
  bundleFiles,
  overrides,
  onChange,
}: {
  projectRoot: string;
  /** The basket's component ids — scopes saved presets to this exact kit. */
  ids: readonly string[];
  /** The kit's ONE shared token set (every token id is used across the kit). */
  tokens: readonly Token[];
  /** The kit's files, for the "why is this empty" reason when there are no tokens. */
  bundleFiles: Readonly<Record<string, string>>;
  overrides: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const presets = usePresets(projectRoot, kitPresetScopeId(ids));

  const changed = changedKitTokens(tokens, overrides);
  const dirty = changed.length > 0;

  const setToken = (id: string, value: string) => onChange({ ...overrides, [id]: value });
  const reset = () => onChange({});
  // Applying a preset restores its whole snapshot of token overrides — a fresh
  // copy so the stored preset object is never shared into live state.
  const applyPreset = (preset: Preset) => onChange({ ...preset.state.tokenOverrides });
  const save = (name: string) =>
    presets.save(name, { ...EMPTY_CUSTOMIZATION, tokenOverrides: overrides });

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className="eyebrow">Re-theme this kit</span>
        <span className={styles.rethemeNote}>one token set · every component at once</span>
      </div>

      {tokens.length === 0 ? (
        <p className={styles.emptyTokens}>{emptyTokensReason(bundleFiles)}</p>
      ) : (
        <>
          <KitPresetStrip
            presets={presets.presets}
            persisted={presets.persisted}
            canSave={dirty}
            onSave={save}
            onApply={applyPreset}
            onDelete={presets.remove}
          />

          <TokenPanel tokens={tokens} overrides={overrides} onChange={setToken} />

          <div className={styles.rethemeFoot}>
            <button
              type="button"
              className={styles.rethemeReset}
              onClick={reset}
              disabled={!dirty}
            >
              Reset to original
            </button>
            <span className={styles.changedSummary}>
              {dirty
                ? `${changed.length} token${changed.length === 1 ? '' : 's'} re-themed: ${changed
                    .map((t) => t.name)
                    .join(', ')}`
                : 'Original theme — nothing changed yet.'}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
