import { CopyButton } from '../../components/ui/CopyButton.js';
import styles from './PortablePane.module.css';

export function DepsInstall({ deps }: { deps: Record<string, string> }) {
  const entries = Object.entries(deps);

  if (entries.length === 0) {
    return (
      <div className={styles.selfContained}>
        <span className={styles.selfDot} />
        No external dependencies — fully self-contained.
      </div>
    );
  }

  const command = `npm install ${entries.map(([name]) => name).join(' ')}`;

  return (
    <div className={styles.deps}>
      <div className={styles.depsHead}>
        <span className="eyebrow">Install in the destination project</span>
        <CopyButton text={command} label="Copy" />
      </div>
      <code className={styles.command}>{command}</code>
      <div className={styles.depVersions}>
        {entries.map(([name, version]) => (
          <span key={name} className={styles.depVersion}>
            {name}
            <span className={styles.depVersionNum}>{version}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
