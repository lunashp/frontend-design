import { useState } from 'react';
import { CopyButton } from '../../components/ui/CopyButton.js';
import styles from './PortablePane.module.css';

function basename(p: string): string {
  return p.split('/').filter(Boolean).slice(-1)[0] ?? p;
}

export function FileBrowser({
  files,
  entryPath,
}: {
  files: Record<string, string>;
  entryPath: string;
}) {
  const paths = Object.keys(files).sort((a, b) => {
    if (a === entryPath) return -1;
    if (b === entryPath) return 1;
    return a.localeCompare(b);
  });
  const [selected, setSelected] = useState(entryPath in files ? entryPath : (paths[0] ?? ''));
  const active = selected in files ? selected : (paths[0] ?? '');
  const code = files[active] ?? '';

  return (
    <div className={styles.browser}>
      <div className={styles.tabs} role="tablist">
        {paths.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            className={styles.tab}
            data-active={p === active}
            aria-selected={p === active}
            onClick={() => setSelected(p)}
            title={p}
          >
            {basename(p)}
            {p === entryPath && <span className={styles.entryDot} title="Entry" />}
          </button>
        ))}
      </div>

      <div className={styles.fileHead}>
        <code className={styles.filePath}>{active}</code>
        <CopyButton text={code} label="Copy file" />
      </div>

      <pre className={styles.code}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
