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
  // Import the whole namespace and pick the export by name, falling back to the
  // default. `export default <named const>` is reported by ts-morph under the
  // const's NAME, not `default`, so a strict named import would miss it; this
  // resolves the component whether it is a named export, a default, or both.
  const entryImport =
    `import * as __ns from '${importPath}';\n` +
    `const __Component: any = (__ns as any)[${JSON.stringify(descriptor.exportName)}] ?? (__ns as any).default ?? __ns;`;

  const open = providers.wrapperJsxOpen || '<>';
  const close = providers.wrapperJsxClose || '</>';

  return `import React from 'react';
import { createRoot } from 'react-dom/client';
import '${tokenCssPath}';
${entryImport}
${providers.imports}

${providers.providersFile}

// A component fed synthetic props often dereferences data it never received and
// throws while rendering. Without a boundary React unmounts the whole tree and
// the preview is a mysterious blank; here it shows what threw instead.
class __ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div role="alert" style={{ font: '13px/1.5 ui-monospace, monospace', color: '#b4232c', padding: '12px 14px', maxWidth: 520 }}>
          <strong style={{ display: 'block', marginBottom: 6 }}>This component threw while rendering in isolation.</strong>
          <span style={{ color: '#7a7f87' }}>
            It likely needs real data or context the preview can't synthesize. Message:
          </span>
          <pre style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{String(this.state.error?.message ?? this.state.error)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const props = ${serializeProps(sampleProps)};

const root = createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <__ErrorBoundary>
    ${open}
      <__Component {...props} />
    ${close}
  </__ErrorBoundary>
);
`;
}
