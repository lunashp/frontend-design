/**
 * Trigger a browser download of an in-memory HTML string. Isolated in its own
 * tiny module because it is the one part of the catalog export that touches the
 * DOM/Blob APIs and so cannot run in the no-jsdom vitest setup — the HTML string
 * it receives IS fully covered (catalog-builder.test.ts). Mirrors the kit's
 * download pattern; revokes the object URL so the blob is not pinned after click.
 */
export function downloadHtml(filename: string, html: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
