import { useEffect, useMemo, useState } from 'react';
import type { ComponentArtifact } from '../../api/types.js';
import { CopyButton } from '../../components/ui/CopyButton.js';
import { emitRootCss, EMPTY_CUSTOMIZATION, type CustomizationState } from '../../lib/customize.js';
import { emitDesignCss, emitDesignRule } from '../../lib/design-overrides.js';
import { LocalPreview } from '../preview/LocalPreview.js';
import { TokenPanel } from './TokenPanel.js';
import { DesignControls } from './DesignControls.js';
import { PropControls } from './PropControls.js';
import styles from './Customize.module.css';

export function CustomizePane({
  artifact,
  projectRoot,
}: {
  artifact: ComponentArtifact;
  projectRoot: string;
}) {
  const [state, setState] = useState<CustomizationState>(EMPTY_CUSTOMIZATION);
  // Prop edits rebundle the preview, so debounce them; token & design edits
  // re-theme live (postMessage), so they apply from `state` immediately.
  const [debouncedProps, setDebouncedProps] = useState<Record<string, unknown>>({});

  useEffect(() => {
    const t = setTimeout(() => setDebouncedProps(state.propValues), 400);
    return () => clearTimeout(t);
  }, [state]);

  const tokens = artifact.tokenModel.tokens;
  const design = state.designOverrides ?? {};

  // Token overrides keyed by CSS var name (what the iframe applies), from live state.
  const tokenOverrides = useMemo(() => {
    const byName: Record<string, string> = {};
    for (const [id, value] of Object.entries(state.tokenOverrides)) {
      const token = tokens.find((t) => t.id === id);
      if (token) byName[token.name] = value;
    }
    return byName;
  }, [state.tokenOverrides, tokens]);

  const designCss = useMemo(() => emitDesignCss(design), [design]);

  const dirty =
    Object.keys(state.tokenOverrides).length > 0 ||
    Object.keys(state.propValues).length > 0 ||
    Object.keys(design).length > 0;

  const setToken = (id: string, value: string) =>
    setState((s) => ({ ...s, tokenOverrides: { ...s.tokenOverrides, [id]: value } }));
  const setProp = (name: string, value: unknown) =>
    setState((s) => ({ ...s, propValues: { ...s.propValues, [name]: value } }));
  // Empty value = "unset": drop the key so it produces no CSS and clears dirty.
  const setDesign = (id: string, value: string) =>
    setState((s) => {
      const next = { ...(s.designOverrides ?? {}) };
      if (value === '') delete next[id];
      else next[id] = value;
      return { ...s, designOverrides: next };
    });

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
          designCss={designCss}
          propOverrides={debouncedProps}
        />
      )}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className="eyebrow">Design</span>
          <span className={styles.sectionNote}>applies to the component · any component</span>
        </div>
        <DesignControls overrides={design} onChange={setDesign} />
      </section>

      {tokens.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <span className="eyebrow">Design tokens</span>
            <span className={styles.sectionNote}>re-themeable · from the source</span>
          </div>
          <TokenPanel tokens={tokens} overrides={state.tokenOverrides} onChange={setToken} />
        </section>
      )}

      <PropControls props={artifact.propModel.props} values={state.propValues} onChange={setProp} />

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.reset}
          onClick={() => setState(EMPTY_CUSTOMIZATION)}
          disabled={!dirty}
        >
          Reset
        </button>
        {Object.keys(design).length > 0 && (
          <CopyButton text={emitDesignRule(artifact.descriptor.name, design)} label="Copy design CSS" />
        )}
        {tokens.length > 0 && (
          <CopyButton
            text={emitRootCss(tokens, state.tokenOverrides)}
            label="Copy themed tokens.css"
          />
        )}
      </div>

      <p className={styles.hint}>
        <strong>Design</strong> edits apply directly to the rendered component — size, colour,
        spacing, and more — even when it exposes no tokens. <strong>Token</strong> edits change only{' '}
        <code>tokens.css</code>, so the copied component stays re-themeable.
      </p>
    </div>
  );
}
