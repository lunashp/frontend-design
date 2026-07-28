import type { PropControl } from '../../api/types.js';
import { CONTROL_GLYPH } from '../../lib/taxonomy.js';
import { groupPropsByOrigin, type PropGroup } from './prop-groups.js';
import styles from './PropTable.module.css';

function PropRow({ prop }: { prop: PropControl }) {
  return (
    <li className={styles.row}>
      <span className={styles.glyph} title={prop.kind}>
        {CONTROL_GLYPH[prop.kind]}
      </span>
      <div className={styles.main}>
        <div className={styles.nameRow}>
          <span className={styles.name}>{prop.name}</span>
          {prop.required && (
            <span className={styles.req} title="Required">
              *
            </span>
          )}
          {prop.defaultValue != null && <span className={styles.default}>= {prop.defaultValue}</span>}
        </div>
        <code className={styles.type}>{prop.tsType}</code>
        {prop.description && <p className={styles.desc}>{prop.description}</p>}
        {prop.options && (
          <div className={styles.options}>
            {prop.options.map((o) => (
              <span key={o} className={styles.option}>
                {o}
              </span>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

function groupNote(group: PropGroup): string | null {
  if (group.origin === 'own') return null;
  if (group.origin === 'unknown') {
    return 'Declared somewhere the type checker could not resolve.';
  }
  return 'Inherited from the component this one wraps.';
}

export function PropTable({ props }: { props: readonly PropControl[] }) {
  if (props.length === 0) {
    return <p className={styles.none}>This component takes no props.</p>;
  }

  // Own API first. A wrapper's table is otherwise 60+ rows of library surface
  // with its two real props buried alphabetically among them.
  const groups = groupPropsByOrigin(props);

  // One undifferentiated group (a plain component, or a scan where nothing could
  // be classified) has nothing to separate — headings would be noise.
  if (groups.length === 1) {
    return (
      <ul className={styles.table}>
        {props.map((p) => (
          <PropRow key={p.name} prop={p} />
        ))}
      </ul>
    );
  }

  return (
    <div className={styles.groups}>
      {groups.map((group) => {
        const note = groupNote(group);
        return (
          <section key={group.key} className={styles.group} data-origin={group.origin}>
            <h4 className={styles.groupHead}>
              <span className={styles.groupLabel}>{group.label}</span>
              <span className={styles.groupCount}>{group.props.length}</span>
            </h4>
            {note && <p className={styles.groupNote}>{note}</p>}
            <ul className={styles.table}>
              {group.props.map((p) => (
                <PropRow key={p.name} prop={p} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
