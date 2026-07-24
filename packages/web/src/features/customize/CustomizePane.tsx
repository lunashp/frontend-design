import { useEffect, useMemo, useState } from 'react';
import type { ComponentArtifact } from '../../api/types.js';
import { CopyButton } from '../../components/ui/CopyButton.js';
import {
  emitRootCss,
  emptyTokensReason,
  isCustomized,
  mergeTokenOverrides,
  EMPTY_CUSTOMIZATION,
  type CustomizationState,
} from '../../lib/customize.js';
import { emitDesignRule, emitDesignStyleObject } from '../../lib/design-overrides.js';
import type { DesignState } from '../../lib/design-overrides.js';
import type { Preset } from '../../lib/presets.js';
import { LocalPreview } from '../preview/LocalPreview.js';
import { TokenPanel } from './TokenPanel.js';
import { DesignControls } from './DesignControls.js';
import { PropControls } from './PropControls.js';
import { PresetBar } from './PresetBar.js';
import { ThemePresets } from './ThemePresets.js';
import { Foundations } from './Foundations.js';
import { partitionTokensBySource } from './token-sources.js';
import { usePresets } from './usePresets.js';
import styles from './Customize.module.css';

export function CustomizePane({
  artifact,
  projectRoot,
  state,
  onChange,
}: {
  artifact: ComponentArtifact;
  projectRoot: string;
  /** Owned by the app and keyed by component id, so it survives this pane
   *  unmounting on a tab switch or a different card being selected. */
  state: CustomizationState;
  onChange: (state: CustomizationState) => void;
}) {
  // Prop edits rebundle the preview, so debounce them; token & design edits
  // re-theme live (postMessage), so they apply from `state` immediately.
  // Seeded from the incoming state so a reopened pane renders the saved props
  // immediately instead of flashing the unedited component for one debounce.
  const [debouncedProps, setDebouncedProps] = useState<Record<string, unknown>>(
    () => state.propValues,
  );

  useEffect(() => {
    const t = setTimeout(() => setDebouncedProps(state.propValues), 400);
    return () => clearTimeout(t);
  }, [state.propValues]);

  // The interactive-state tab the Design controls are editing, forced visible in
  // the preview so a Hover/Focus/Active edit is seen without hovering/focusing —
  // which a non-focusable root can't receive. null = resting.
  const [previewState, setPreviewState] = useState<DesignState | null>(null);

  const tokens = artifact.tokenModel.tokens;
  // Derived tokens are mined from the app's TS theme and are a reference + copy
  // seed — they cannot live-edit a MUI preview, so they are kept out of the
  // re-themeable slider panel and shown read-only in Foundations instead. Only
  // extracted/user tokens (real CSS custom properties) drive the live preview.
  const { editable: editableTokens, derived: derivedTokens } = useMemo(
    () => partitionTokensBySource(tokens),
    [tokens],
  );

  // Named presets for this (project, component), persisted to localStorage.
  const presets = usePresets(projectRoot, artifact.descriptor.id);

  // Memoized so the preview's design payload keeps a stable identity across
  // re-renders — `?? {}` would otherwise mint a fresh object every time.
  const design = useMemo(() => state.designOverrides ?? {}, [state.designOverrides]);

  // Token overrides keyed by CSS var name (what the iframe applies), from live state.
  const tokenOverrides = useMemo(() => {
    const byName: Record<string, string> = {};
    for (const [id, value] of Object.entries(state.tokenOverrides)) {
      const token = tokens.find((t) => t.id === id);
      if (token) byName[token.name] = value;
    }
    return byName;
  }, [state.tokenOverrides, tokens]);

  const dirty = isCustomized(state);

  // Gated on what the emitter actually produces, not on key presence: a stored
  // no-op (a state value equal to the resting one) leaves keys behind while
  // emitting nothing, and offering "Copy design CSS" for an empty string is a
  // button that silently does nothing.
  const designRule = useMemo(
    () => emitDesignRule(artifact.descriptor.name, design),
    [artifact.descriptor.name, design],
  );
  // The guess-free companion: an inline-style object needs no selector, so it
  // works wherever the user pastes it onto the component. Resting state only.
  const designStyle = useMemo(() => emitDesignStyleObject(design), [design]);

  const setToken = (id: string, value: string) =>
    onChange({ ...state, tokenOverrides: { ...state.tokenOverrides, [id]: value } });
  const setProp = (name: string, value: unknown) =>
    onChange({ ...state, propValues: { ...state.propValues, [name]: value } });
  // Empty value = "unset": drop the key so it produces no CSS and clears dirty.
  const setDesign = (id: string, value: string) => {
    const next = { ...design };
    if (value === '') delete next[id];
    else next[id] = value;
    onChange({ ...state, designOverrides: next });
  };
  // Applying a named preset restores its whole snapshot; seeding a theme preset
  // merges that scheme's values onto the current overrides.
  const applyPreset = (preset: Preset) => onChange(preset.state);
  const seedTheme = (overrides: Readonly<Record<string, string>>) =>
    onChange(mergeTokenOverrides(state, overrides));

  return (
    <div className={styles.pane}>
      {artifact.sandpack.renderability === 'code-only' ? (
        <div className={styles.noPreview}>
          Live preview isn’t available for this component, but your edits still apply to the copied
          CSS below.
        </div>
      ) : (
        <LocalPreview
          projectRoot={projectRoot}
          id={artifact.descriptor.id}
          tokenOverrides={tokenOverrides}
          designOverrides={design}
          propOverrides={debouncedProps}
          previewState={previewState}
        />
      )}

      <PresetBar
        presets={presets.presets}
        canSave={dirty}
        persisted={presets.persisted}
        onSave={(name) => presets.save(name, state)}
        onApply={applyPreset}
        onRename={presets.rename}
        onDelete={presets.remove}
      />

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className="eyebrow">Design</span>
          <span className={styles.sectionNote}>applies to the component · any component</span>
        </div>
        <DesignControls overrides={design} onChange={setDesign} onStateChange={setPreviewState} />
      </section>

      {editableTokens.length > 0 ? (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <span className="eyebrow">Design tokens</span>
            <span className={styles.sectionNote}>re-themeable · from the source</span>
          </div>
          <TokenPanel tokens={editableTokens} overrides={state.tokenOverrides} onChange={setToken} />
        </section>
      ) : (
        // Not a net-new empty state — one honest clause so the missing token
        // panel reads as a fact about the component, not a bug. The reason is
        // derived from the bundle (does it ship a stylesheet of its own?).
        <p className={styles.emptyTokens}>{emptyTokensReason(artifact.bundle.files)}</p>
      )}

      {/* Starting presets the engine mined from the app's colorSchemes. Absent
          on plain-CSS targets — the section simply doesn't render. */}
      {artifact.tokenModel.themes && (
        <ThemePresets themes={artifact.tokenModel.themes} onSeed={seedTheme} />
      )}

      {/* The app's real design-system values, mined from its TS theme. Reference
          + copy seed, not live sliders. Renders only when derived tokens exist. */}
      <Foundations
        tokens={derivedTokens}
        disclosure={artifact.tokenModel.derivedFrom}
        overrides={state.tokenOverrides}
        projectRoot={projectRoot}
      />

      <PropControls props={artifact.propModel.props} values={state.propValues} onChange={setProp} />

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.reset}
          onClick={() => onChange(EMPTY_CUSTOMIZATION)}
          disabled={!dirty}
        >
          Reset
        </button>
        {designStyle !== '' && (
          <CopyButton text={`style={${designStyle}}`} label="Copy inline style" />
        )}
        {designRule !== '' && <CopyButton text={designRule} label="Copy design CSS" />}
        {tokens.length > 0 && (
          <CopyButton
            text={emitRootCss(tokens, state.tokenOverrides)}
            label="Copy themed tokens.css"
          />
        )}
      </div>

      <p className={styles.hint}>
        <strong>Design</strong> edits apply directly to the rendered component — size, colour,
        spacing, and more — even when it exposes no tokens, and each interactive state
        (hover · focus · active) is styled on its own tab. <strong>Token</strong> edits change only{' '}
        <code>tokens.css</code>, so the copied component stays re-themeable.
      </p>
    </div>
  );
}
