import { useState } from 'react';
import type { ComponentArtifact } from '../../api/types.js';
import { CopyButton } from '../../components/ui/CopyButton.js';
import { copyableFiles, sourceAppFiles } from '../../lib/source-app.js';
import { ColourSourceCaption } from '../preview/ColourSourceCaption.js';
import { LocalPreview } from '../preview/LocalPreview.js';
import { DepsInstall } from './DepsInstall.js';
import { FileBrowser } from './FileBrowser.js';
import styles from './PortablePane.module.css';

function allFilesDump(files: Record<string, string>): string {
  return Object.entries(files)
    .map(([path, code]) => `// ${path}\n${code}`)
    .join('\n\n');
}

export function PortablePane({
  artifact,
  projectRoot,
}: {
  artifact: ComponentArtifact;
  projectRoot: string;
}) {
  const { bundle, sandpack } = artifact;
  const fileCount = Object.keys(bundle.files).length;
  const sourceApp = sourceAppFiles(bundle);
  // Source-app files are excluded from "Copy all files" by default (#1): copied
  // blind they import the source app's design system wholesale. The engineer can
  // opt them in, but only knowingly.
  const [includeSourceApp, setIncludeSourceApp] = useState(false);
  const copySet = copyableFiles(bundle.files, sourceApp, includeSourceApp);
  const copyCount = Object.keys(copySet).length;

  return (
    <div className={styles.pane}>
      <div className={styles.head}>
        <div>
          <span className={styles.count}>{fileCount}</span>
          <span className={styles.unit}>self-contained file{fileCount === 1 ? '' : 's'}</span>
        </div>
        <CopyButton
          text={allFilesDump(copySet)}
          label={`Copy ${copyCount} file${copyCount === 1 ? '' : 's'}`}
        />
      </div>

      {sourceApp.size > 0 && (
        <div className={styles.sourceAppNotice}>
          <p className={styles.sourceAppLead}>
            {sourceApp.size} file{sourceApp.size === 1 ? '' : 's'} below{' '}
            {sourceApp.size === 1 ? 'is' : 'are'} the source app’s own design system (theme, i18n,
            or providers) — bundled so the preview is faithful, but not part of this component.
            They’re excluded from the copy above by default.
          </p>
          <label className={styles.sourceAppToggle}>
            <input
              type="checkbox"
              checked={includeSourceApp}
              onChange={(e) => setIncludeSourceApp(e.target.checked)}
            />
            Include the app’s design system in the copy
          </label>
        </div>
      )}

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

      <FileBrowser files={bundle.files} entryPath={bundle.entryPath} sourceApp={sourceApp} />

      <section className={styles.previewSection}>
        <span className="eyebrow">Preview of the copied code</span>
        {sandpack.renderability === 'code-only' ? (
          <div className={styles.codeOnly}>
            The extracted code can’t be rendered in an isolated preview (see notes on the Preview
            tab), but the files above are copy-ready.
          </div>
        ) : (
          <>
            <LocalPreview projectRoot={projectRoot} id={artifact.descriptor.id} />
            <ColourSourceCaption bundle={bundle} />
          </>
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
