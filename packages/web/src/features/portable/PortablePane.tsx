import { lazy, Suspense } from 'react';
import type { ComponentArtifact } from '../../api/types.js';
import { CopyButton } from '../../components/ui/CopyButton.js';
import { DepsInstall } from './DepsInstall.js';
import { FileBrowser } from './FileBrowser.js';
import styles from './PortablePane.module.css';

const SandboxView = lazy(() => import('../preview/SandboxView.js'));

function allFilesDump(files: Record<string, string>): string {
  return Object.entries(files)
    .map(([path, code]) => `// ${path}\n${code}`)
    .join('\n\n');
}

export function PortablePane({ artifact }: { artifact: ComponentArtifact; projectRoot: string }) {
  const { bundle, sandpack } = artifact;
  const fileCount = Object.keys(bundle.files).length;

  return (
    <div className={styles.pane}>
      <div className={styles.head}>
        <div>
          <span className={styles.count}>{fileCount}</span>
          <span className={styles.unit}>self-contained file{fileCount === 1 ? '' : 's'}</span>
        </div>
        <CopyButton text={allFilesDump(bundle.files)} label="Copy all files" />
      </div>

      {(bundle.incomplete || bundle.warnings.length > 0) && (
        <ul className={styles.warnings} data-severe={bundle.incomplete}>
          {bundle.incomplete && (
            <li>Some local imports couldn’t be resolved — this bundle may be incomplete.</li>
          )}
          {bundle.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      <DepsInstall deps={bundle.externalDeps} />

      <FileBrowser files={bundle.files} entryPath={bundle.entryPath} />

      <section className={styles.previewSection}>
        <span className="eyebrow">Preview of the copied code</span>
        {sandpack.renderability === 'code-only' ? (
          <div className={styles.codeOnly}>
            The extracted code can’t be rendered live in the sandbox (see notes on the Preview tab),
            but the files above are copy-ready.
          </div>
        ) : (
          <Suspense fallback={<div className={styles.loading}>Loading preview…</div>}>
            <SandboxView spec={sandpack} />
          </Suspense>
        )}
      </section>

      <p className={styles.usage}>
        Paste these files into your project (keeping the relative structure), install the
        dependencies above, then import the entry file. Re-theming controls arrive in the Customize
        tab.
      </p>
    </div>
  );
}
