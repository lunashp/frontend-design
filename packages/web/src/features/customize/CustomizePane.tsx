import { useEffect, useMemo, useState } from 'react';
import type { ComponentArtifact } from '../../api/types.js';
import { CopyButton } from '../../components/ui/CopyButton.js';
import { emitRootCss, EMPTY_CUSTOMIZATION, type CustomizationState } from '../../lib/customize.js';
import { LocalPreview } from '../preview/LocalPreview.js';
import { TokenPanel } from './TokenPanel.js';
import { PropControls } from './PropControls.js';
import styles from './Customize.module.css';

const EDITABLE_KINDS = new Set(['enum', 'boolean', 'number', 'color', 'string']);

export function CustomizePane({
  artifact,
  projectRoot,
}: {
  artifact: ComponentArtifact;
  projectRoot: string;
}) {
  const [state, setState] = useState<CustomizationState>(EMPTY_CUSTOMIZATION);
  // Prop edits rebundle the preview, so debounce them; token edits re-theme live
  // (CSS-var postMessage), so they apply from `state` immediately.
  const [debouncedProps, setDebouncedProps] = useState<Record<string, unknown>>({});

  useEffect(() => {
    const t = setTimeout(() => setDebouncedProps(state.propValues), 400);
    return () => clearTimeout(t);
  }, [state]);

  const tokens = artifact.tokenModel.tokens;
  const editableProps = artifact.propModel.props.filter((p) => EDITABLE_KINDS.has(p.kind));
  // Token overrides keyed by CSS var name (what the iframe applies), from live state.
  const tokenOverrides = useMemo(() => {
    const byName: Record<string, string> = {};
    for (const [id, value] of Object.entries(state.tokenOverrides)) {
      const token = tokens.find((t) => t.id === id);
      if (token) byName[token.name] = value;
    }
    return byName;
  }, [state.tokenOverrides, tokens]);
  const dirty =
    Object.keys(state.tokenOverrides).length > 0 || Object.keys(state.propValues).length > 0;

  if (tokens.length === 0 && editableProps.length === 0) {
    return (
      <div className={styles.empty}>
        Nothing to customize — no design tokens were extractable (e.g. CSS-in-JS/inline styles) and
        there are no editable props.
      </div>
    );
  }

  const setToken = (id: string, value: string) =>
    setState((s) => ({ ...s, tokenOverrides: { ...s.tokenOverrides, [id]: value } }));
  const setProp = (name: string, value: unknown) =>
    setState((s) => ({ ...s, propValues: { ...s.propValues, [name]: value } }));

  return (
    <div className={styles.pane}>
      {artifact.sandpack.renderability === 'code-only' ? (
        <div className={styles.noPreview}>
          Live preview isn’t available for this component, but your edits still apply to the copied
          tokens below.
        </div>
      ) : (
        <LocalPreview
          projectRoot={projectRoot}
          id={artifact.descriptor.id}
          tokenOverrides={tokenOverrides}
          propOverrides={debouncedProps}
        />
      )}

      <TokenPanel tokens={tokens} overrides={state.tokenOverrides} onChange={setToken} />
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
        {tokens.length > 0 && (
          <CopyButton
            text={emitRootCss(tokens, state.tokenOverrides)}
            label="Copy themed tokens.css"
          />
        )}
      </div>

      <p className={styles.hint}>
        Token edits change only <code>tokens.css</code> — the component keeps its{' '}
        <code>var(--token, fallback)</code> references, so the copied code stays re-themeable.
      </p>
    </div>
  );
}
