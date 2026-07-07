/**
 * Generates the Sandpack entry (`/index.tsx`) that mounts a component with
 * sample props, wrapped in provider stubs, importing the token stylesheet.
 * (Provider stubbing is enriched in P2.)
 */

import type { BuildEntryInput } from '../../types/adapter.js';

function withoutExt(p: string): string {
  return p.replace(/\.(tsx|ts|jsx|js)$/, '');
}

function serializeProps(props: Readonly<Record<string, unknown>>): string {
  // Functions are dropped by JSON — fine for rendering a sample instance.
  return JSON.stringify(props ?? {}, null, 2);
}

export function buildReactEntry(input: BuildEntryInput): string {
  const { descriptor, bundle, sampleProps, providers, tokenCssPath } = input;
  const importPath = `.${withoutExt(bundle.entryPath)}`;
  // Bind to a stable local alias using the real EXPORT name (not the display
  // name) so aliased exports like `export { Inner as Card }` resolve correctly.
  const entryImport = descriptor.isDefaultExport
    ? `import __Component from '${importPath}';`
    : `import { ${descriptor.exportName} as __Component } from '${importPath}';`;

  const open = providers.wrapperJsxOpen || '<>';
  const close = providers.wrapperJsxClose || '</>';

  return `import React from 'react';
import { createRoot } from 'react-dom/client';
import '${tokenCssPath}';
${entryImport}
${providers.imports}

${providers.providersFile}

const props = ${serializeProps(sampleProps)};

const root = createRoot(document.getElementById('root') as HTMLElement);
root.render(
  ${open}
    <__Component {...props} />
  ${close}
);
`;
}
