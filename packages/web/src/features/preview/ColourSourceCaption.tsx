import type { PortableBundle } from '../../api/types.js';
import { previewColourSource } from '../../lib/source-app.js';
import styles from './PreviewPane.module.css';

/**
 * States where the preview's colours come from (#1): the app's real theme, or a
 * placeholder palette. Without this an engineer reads a placeholder rendering as
 * the product's actual colours and copies the wrong thing.
 */
export function ColourSourceCaption({ bundle }: { bundle: PortableBundle }) {
  const src = previewColourSource(bundle);
  return (
    <p className={styles.colourSource} data-real={src.real}>
      {src.caption}
    </p>
  );
}
