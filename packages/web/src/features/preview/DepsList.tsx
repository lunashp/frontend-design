import styles from './PreviewPane.module.css';

export function DepsList({ deps }: { deps: Record<string, string> }) {
  const entries = Object.entries(deps);
  if (entries.length === 0) return null;
  return (
    <div className={styles.deps}>
      <span className="eyebrow">Sandbox dependencies</span>
      <div className={styles.depChips}>
        {entries.map(([name, version]) => (
          <span key={name} className={styles.dep}>
            {name}
            <span className={styles.depVer}>{version}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
