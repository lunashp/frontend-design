/**
 * Generates the Sandpack entry (`/index.tsx`) that mounts a component with
 * sample props, wrapped in provider stubs, importing the token stylesheet.
 * (Provider stubbing is enriched in P2.)
 */

import type { BuildEntryInput } from '../../types/adapter.js';

function withoutExt(p: string): string {
  return p.replace(/\.(tsx|ts|jsx|js)$/, '');
}

const FUNCTION_TYPE = /=>|\bFunction\b/;

/** A prop value as a JS literal. JSON.stringify covers primitives/arrays/objects,
 *  but flattens a `Date` to a quoted string — so a component calling `date.getX()`
 *  would still throw. Recurse so a `Date` at ANY depth (a synthesized object's
 *  nested field) is emitted as a real `new Date(...)`. */
function serializeValue(v: unknown): string {
  if (v instanceof Date) return `new Date(${JSON.stringify(v.toISOString())})`;
  if (Array.isArray(v)) return `[${v.map(serializeValue).join(', ')}]`;
  if (v !== null && typeof v === 'object') {
    const entries = Object.entries(v).map(
      ([k, val]) => `${JSON.stringify(k)}: ${serializeValue(val)}`,
    );
    return `{ ${entries.join(', ')} }`;
  }
  return JSON.stringify(v);
}

/**
 * Serialize sample props to a JS object literal. JSON drops functions, so a
 * function-typed prop (a `t(key)` translator, an `onX` handler, or a RENDER PROP
 * like `renderRow` the component CALLS while rendering) is injected as a safe
 * stub: it returns its first string arg (so `t('a.b')` shows the key) else
 * undefined. Both required AND optional function props are stubbed — a render
 * prop the component invokes unconditionally throws `x is not a function` whether
 * or not its type says `?`, and a stub is harmless for a genuine optional handler
 * (it just does nothing).
 */
function serializeProps(
  props: Readonly<Record<string, unknown>>,
  propModel: BuildEntryInput['propModel'],
): { code: string; needsStub: boolean } {
  const fnProps = propModel.props.filter(
    (p) => FUNCTION_TYPE.test(p.tsType) && !(p.name in props),
  );
  const jsonEntries = Object.entries(props).map(
    ([k, v]) => `  ${JSON.stringify(k)}: ${serializeValue(v)}`,
  );
  const fnEntries = fnProps.map((p) => `  ${JSON.stringify(p.name)}: __fnStub`);
  const all = [...jsonEntries, ...fnEntries];
  return { code: `{\n${all.join(',\n')}\n}`, needsStub: fnProps.length > 0 };
}

export function buildReactEntry(input: BuildEntryInput): string {
  const { descriptor, bundle, sampleProps, providers, tokenCssPath, propModel } = input;
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
      // Not framed as an error: a component that consumes a router, a data store,
      // an app-specific settings/theme provider, i18n, or that renders async on
      // the server genuinely CANNOT render standalone — that is a property of the
      // component, not a fault of the tool. Say so calmly and point at the code,
      // rather than a red alert that reads as "the tool is broken".
      return (
        // Marked so a thumbnail shot skips it: a card showing a cropped paragraph
        // of explanation is worse than the component's monogram placeholder.
        <div data-ce-unrenderable="1" style={{ font: '13px/1.6 system-ui, sans-serif', color: '#3f4650', padding: '16px 18px', maxWidth: 460 }}>
          <strong style={{ display: 'block', marginBottom: 6, color: '#1f2530' }}>Needs app context to render live</strong>
          <span style={{ color: '#6b727c' }}>
            This component depends on something an isolated preview can't supply —
            a router, a data store, an app-specific provider, i18n, or async
            server rendering. Its full source is on the <strong>Portable</strong> tab.
          </span>
          <pre style={{ whiteSpace: 'pre-wrap', margin: '10px 0 0', fontSize: 11, color: '#9aa0a6' }}>{String(this.state.error?.message ?? this.state.error)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const __fnStub = (...args: unknown[]): unknown => (typeof args[0] === 'string' ? args[0] : undefined);
const props = ${serializeProps(sampleProps, propModel).code};

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
