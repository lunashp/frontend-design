import type { Token, TokenCategory } from '../../api/types.js';
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

function isHex(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
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
  const groups = ORDER.map(
    (cat) => [cat, tokens.filter((t) => t.category === cat)] as const,
  ).filter(([, ts]) => ts.length > 0);

  return (
    <div className={styles.panel}>
      {groups.map(([cat, ts]) => (
        <fieldset key={cat} className={styles.group}>
          <legend className="eyebrow">{LABEL[cat]}</legend>
          {ts.map((t) => (
            <TokenControl
              key={t.id}
              token={t}
              value={overrides[t.id] ?? t.value}
              onChange={(v) => onChange(t.id, v)}
            />
          ))}
        </fieldset>
      ))}
    </div>
  );
}
