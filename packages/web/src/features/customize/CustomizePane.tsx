import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { ComponentArtifact } from '../../api/types.js';
import { CopyButton } from '../../components/ui/CopyButton.js';
import {
  customizeSpec,
  emitRootCss,
  EMPTY_CUSTOMIZATION,
  type CustomizationState,
} from '../../lib/customize.js';
import { TokenPanel } from './TokenPanel.js';
import { PropControls } from './PropControls.js';
import styles from './Customize.module.css';

const CustomizeSandbox = lazy(() => import('./CustomizeSandbox.js'));

const EDITABLE_KINDS = new Set(['enum', 'boolean', 'number', 'color', 'string']);

export function CustomizePane({ artifact }: { artifact: ComponentArtifact }) {
  const [state, setState] = useState<CustomizationState>(EMPTY_CUSTOMIZATION);
  // The preview re-bundles on a keyed remount; debounce so it only rebuilds once
  // the user pauses, while the control inputs stay immediately responsive.
  const [previewState, setPreviewState] = useState<CustomizationState>(EMPTY_CUSTOMIZATION);

  useEffect(() => {
    const t = setTimeout(() => setPreviewState(state), 400);
    return () => clearTimeout(t);
  }, [state]);

  const tokens = artifact.tokenModel.tokens;
  const editableProps = artifact.propModel.props.filter((p) => EDITABLE_KINDS.has(p.kind));
  const spec = useMemo(() => customizeSpec(artifact, previewState), [artifact, previewState]);
  const previewKey = useMemo(() => JSON.stringify(previewState), [previewState]);
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
        <Suspense fallback={<div className={styles.noPreview}>Loading live preview…</div>}>
          <CustomizeSandbox key={previewKey} spec={spec} />
        </Suspense>
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
