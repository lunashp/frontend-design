import { SandpackProvider, SandpackPreview } from '@codesandbox/sandpack-react';
import type { SandpackSpec } from '../../api/types.js';
import styles from './SandboxView.module.css';

/**
 * Renders an extracted component in an isolated Sandpack iframe. The engine has
 * already assembled every file + dependency; we just hand the spec to Sandpack.
 * Lazy-loaded (default export) because the Sandpack bundler client is heavy.
 */
export default function SandboxView({ spec }: { spec: SandpackSpec }) {
  return (
    <SandpackProvider
      template="react-ts"
      files={spec.files}
      customSetup={{ dependencies: spec.dependencies }}
      options={{ activeFile: spec.entryPath, recompileMode: 'delayed' }}
    >
      <div className={styles.stage}>
        <SandpackPreview
          className={styles.preview}
          showOpenInCodeSandbox={false}
          showRefreshButton
          showSandpackErrorOverlay
        />
      </div>
    </SandpackProvider>
  );
}
