import { SandpackProvider, SandpackPreview } from '@codesandbox/sandpack-react';
import type { SandpackSpec } from '../../api/types.js';
import styles from './Customize.module.css';

/**
 * Live customization preview. The `spec` is memoized upstream, so its `files`
 * change only when a token/prop is edited; Sandpack re-syncs the changed files
 * (tokens.css defaults + entry, which also sets overridden vars inline).
 */
export default function CustomizeSandbox({ spec }: { spec: SandpackSpec }) {
  return (
    <SandpackProvider
      template="react-ts"
      files={spec.files}
      customSetup={{ dependencies: spec.dependencies }}
      options={{ activeFile: spec.entryPath, recompileMode: 'delayed', recompileDelay: 350 }}
    >
      <div className={styles.stage}>
        <SandpackPreview
          className={styles.preview}
          showOpenInCodeSandbox={false}
          showRefreshButton={false}
        />
      </div>
    </SandpackProvider>
  );
}
