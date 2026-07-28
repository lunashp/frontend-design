/**
 * Trigger a browser download of in-memory bytes. Kept as a tiny isolated module
 * because it is the one part of the kit download that touches the DOM/Blob APIs
 * and so cannot be unit tested in the no-jsdom vitest setup — the zip bytes it
 * receives ARE covered (zip.test.ts). Revokes the object URL so a large archive
 * is not pinned in memory after the click.
 */
export function downloadBytes(
  filename: string,
  bytes: Uint8Array,
  mime = 'application/zip',
): void {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
