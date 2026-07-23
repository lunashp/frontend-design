import { useMemo } from 'react';
import type { ComponentArtifact } from '../../api/types.js';
import { LocalPreview } from '../preview/LocalPreview.js';
import { type VariantMatrix, buildVariantMatrix } from './variant-matrix.js';
import styles from './VariantsMatrix.module.css';

/**
 * The Storybook-style overview: the component rendered across combinations of its
 * enumerable props. The combination strategy (product, cap, highest-signal
 * subset) is the pure `buildVariantMatrix`; this component is only the grid.
 *
 * Live cells reuse `LocalPreview` AS-IS — one sandbox iframe per combination with
 * that cell's `propOverrides`. Mounting is lazy: the inspector unmounts a tab's
 * body when it is not selected, so the grid (and its iframes) only exists while
 * the Variants tab is open. A code-only component can't render live, so it shows
 * the generated combinations as a table instead — same graceful degrade as the
 * Preview and Portable tabs.
 */
export function VariantsMatrix({
  artifact,
  projectRoot,
}: {
  artifact: ComponentArtifact;
  projectRoot: string;
}) {
  const matrix = useMemo(
    () => buildVariantMatrix(artifact.propModel.props),
    [artifact.propModel.props],
  );
  const codeOnly = artifact.sandpack.renderability === 'code-only';

  if (matrix.empty) {
    return (
      <div className={styles.pane}>
        <p className={styles.none}>
          No variant props detected — this component exposes no enumerable props (selects or
          booleans) to vary, so there is no matrix to show.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.pane}>
      <header className={styles.head}>
        <span className="eyebrow">Variants</span>
        <p className={styles.summary}>
          {matrix.capped
            ? `Showing ${matrix.shown} of ${matrix.total} combinations`
            : `${matrix.shown} combination${matrix.shown === 1 ? '' : 's'}`}
          <span className={styles.varying}> · varying {matrix.variedProps.join(', ')}</span>
        </p>
      </header>

      {codeOnly ? (
        <CodeOnlyTable matrix={matrix} />
      ) : (
        <div className={styles.grid}>
          {matrix.cells.map((cell) => (
            <figure key={cell.key} className={styles.cell}>
              <div className={styles.frame}>
                <LocalPreview
                  projectRoot={projectRoot}
                  id={artifact.descriptor.id}
                  propOverrides={cell.propOverrides}
                />
              </div>
              <figcaption className={styles.caption}>{cell.caption}</figcaption>
            </figure>
          ))}
        </div>
      )}

      {matrix.capped && (
        <p className={styles.note}>
          {matrix.total - matrix.shown} more combination
          {matrix.total - matrix.shown === 1 ? '' : 's'} exist.
          {matrix.pinnedProps.length > 0 && (
            <> Props not varied here ({matrix.pinnedProps.join(', ')}) are held at their default.</>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Code-only fallback: the generated combinations as a table of prop values. No
 * iframes — the component can't render live — but the matrix the user would have
 * seen is still legible.
 */
function CodeOnlyTable({ matrix }: { matrix: VariantMatrix }) {
  return (
    <div className={styles.codeOnly}>
      <p className={styles.codeOnlyNote}>
        This component can’t render live (see the Preview tab), so the generated combinations are
        shown as a table. A live variant matrix needs a renderable component.
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.rowNumHead}>#</th>
              {matrix.variedProps.map((name) => (
                <th key={name}>{name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.cells.map((cell, i) => (
              <tr key={cell.key}>
                <td className={styles.rowNum}>{i + 1}</td>
                {matrix.variedProps.map((name) => (
                  <td key={name}>
                    <code>{String(cell.propOverrides[name])}</code>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
