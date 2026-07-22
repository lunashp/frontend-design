import type { Token, TokenCategory, TokenUsage } from '../../api/types.js';
import { sortTokensByUsage } from '../../lib/customize.js';
import styles from './Customize.module.css';

const ORDER: TokenCategory[] = ['color', 'radius', 'typography', 'size', 'spacing', 'shadow', 'other'];
const LABEL: Record<TokenCategory, string> = {
  color: 'Colors',
  radius: 'Radius',
  typography: 'Font size',
  size: 'Size',
  spacing: 'Spacing',
  shadow: 'Shadow',
  other: 'Other',
};

/** Enough to recognise the token; the count carries the rest. */
const MAX_USAGES = 3;

function isHex(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
}

/** Usage paths are bundle-relative (`/src/ui/Button.module.css`) — drop the root slash. */
function shortUsagePath(file: string): string {
  return file.replace(/^\//, '');
}

/**
 * Where the token actually came from. Without this a slider is a blind guess;
 * with it, `--color-1` reads as "the background-color of .primary in
 * Button.module.css:14".
 */
function TokenUsages({ usages }: { usages: readonly TokenUsage[] }) {
  if (usages.length === 0) return null;
  const shown = usages.slice(0, MAX_USAGES);

  return (
    <ul className={styles.usages}>
      {shown.map((u, i) => (
        <li key={`${u.file}:${u.line}:${u.property}:${i}`} className={styles.usage}>
          <code className={styles.usageProp}>{u.property}</code>
          {u.selector && (
            <span className={styles.usageSelector} title={u.selector}>
              {u.selector}
            </span>
          )}
          <span className={styles.usageFile} title={u.file}>
            {shortUsagePath(u.file)}:{u.line}
          </span>
        </li>
      ))}
      {usages.length > shown.length && (
        <li className={styles.usageMore}>+{usages.length - shown.length} more</li>
      )}
    </ul>
  );
}

function TokenControl({
  token,
  value,
  onChange,
}: {
  token: Token;
  value: string;
  onChange: (value: string) => void;
}) {
  if (token.category === 'color') {
    return (
      <div className={styles.row}>
        <input
          type="color"
          className={styles.swatch}
          value={isHex(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${token.displayName} color`}
        />
        <span className={styles.tokenName} title={token.name}>
          {token.displayName}
        </span>
        <input
          type="text"
          className={styles.hex}
          value={value}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }
  return (
    <div className={styles.row}>
      <span className={styles.tokenName} title={token.name}>
        {token.displayName}
      </span>
      <input
        type="text"
        className={styles.text}
        value={value}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function TokenPanel({
  tokens,
  overrides,
  onChange,
}: {
  tokens: readonly Token[];
  overrides: Record<string, string>;
  onChange: (id: string, value: string) => void;
}) {
  if (tokens.length === 0) return null;
  // Grouped by category, then most-used first inside each group.
  const groups = ORDER.map(
    (cat) => [cat, sortTokensByUsage(tokens.filter((t) => t.category === cat))] as const,
  ).filter(([, ts]) => ts.length > 0);

  return (
    <div className={styles.panel}>
      {groups.map(([cat, ts]) => (
        <fieldset key={cat} className={styles.group}>
          <legend className="eyebrow">{LABEL[cat]}</legend>
          {ts.map((t) => (
            <div key={t.id} className={styles.token}>
              <TokenControl
                token={t}
                value={overrides[t.id] ?? t.value}
                onChange={(v) => onChange(t.id, v)}
              />
              <TokenUsages usages={t.usages} />
            </div>
          ))}
        </fieldset>
      ))}
    </div>
  );
}
