import { useMemo, useState } from 'react';
import { CopyButton } from '../../components/ui/CopyButton.js';
import styles from './KitPane.module.css';

function basename(p: string): string {
  return p.split('/').filter(Boolean).slice(-1)[0] ?? p;
}

/**
 * Sort order for the merged kit: every component entry first (the files an
 * engineer actually imports), then the shared tokens.css, then the rest
 * alphabetically, with source-app files last since they are excluded from the
 * copy by default. Keeps the most relevant files at the top of a long list.
 */
function orderFiles(
  paths: readonly string[],
  entryPaths: ReadonlySet<string>,
  tokensCssPath: string,
  sourceApp: ReadonlySet<string>,
): string[] {
  const rank = (p: string): number => {
    if (entryPaths.has(p)) return 0;
    if (p === tokensCssPath) return 1;
    if (sourceApp.has(p)) return 3;
    return 2;
  };
  return [...paths].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export function KitFileList({
  files,
  entryPaths,
  tokensCssPath,
  sourceApp,
}: {
  files: Record<string, string>;
  /** Every component's entry file within `files`, badged as an entry. */
  entryPaths: ReadonlySet<string>;
  tokensCssPath: string;
  /** Files from the source app (theme/i18n/providers), badged distinctly. */
  sourceApp: ReadonlySet<string>;
}) {
  const ordered = useMemo(
    () => orderFiles(Object.keys(files), entryPaths, tokensCssPath, sourceApp),
    [files, entryPaths, tokensCssPath, sourceApp],
  );
  const [selected, setSelected] = useState<string>(ordered[0] ?? '');
  const active = selected in files ? selected : (ordered[0] ?? '');
  const code = files[active] ?? '';

  return (
    <div className={styles.browser}>
      <div className={styles.fileList} role="tablist" aria-label="Kit files">
        {ordered.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={p === active}
            data-active={p === active}
            className={styles.fileItem}
            onClick={() => setSelected(p)}
            title={p}
          >
            {entryPaths.has(p) && <span className={styles.dot} aria-hidden />}
            <span className={styles.fileName}>{basename(p)}</span>
            {p === tokensCssPath && <span className={styles.badge}>tokens</span>}
            {sourceApp.has(p) && <span className={styles.badge}>app</span>}
          </button>
        ))}
      </div>

      <div className={styles.filePane}>
        <div className={styles.filePaneHead}>
          <code className={styles.filePanePath}>{active}</code>
          <CopyButton text={code} label="Copy file" />
        </div>
        <pre className={styles.fileCode}>
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}
