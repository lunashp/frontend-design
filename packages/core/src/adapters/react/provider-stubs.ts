/**
 * Provider stubs that let a context-consuming component render in isolation.
 *
 * The commonest reason an extracted component renders blank is that it reads app
 * context the sandbox does not supply — most often a themed MUI provider. A
 * component doing `sx={{ color: t => t.palette.semantic.tags.warning.text }}`
 * throws the instant it mounts without a ThemeProvider, so `#root` stays empty.
 *
 * We can't bundle the app's bespoke theme, but we can wrap the component in a
 * provider whose theme never throws on an unknown lookup: real MUI values pass
 * through, unknown custom tokens resolve to a placeholder colour. The component
 * renders (approximate colours) instead of crashing.
 */

import type { PreviewContext, ProviderStubResult } from '../../types/adapter.js';
import type { ComponentDescriptor } from '../../types/component.js';
import type { ReactProgramHandle } from './ts-program.js';

const NONE: ProviderStubResult = {
  providersFile: '',
  wrapperJsxOpen: '',
  wrapperJsxClose: '',
  imports: '',
  dependencies: {},
  unresolved: [],
};

function usesMui(deps: Readonly<Record<string, string>>): boolean {
  return Object.keys(deps).some((d) => d === '@mui/material' || d.startsWith('@mui/'));
}

function usesReactQuery(deps: Readonly<Record<string, string>>): boolean {
  return '@tanstack/react-query' in deps;
}

function usesNextIntl(deps: Readonly<Record<string, string>>): boolean {
  return 'next-intl' in deps;
}

/** Wrap a base theme's palette so unknown custom tokens degrade, not throw. */
const PALETTE_GUARD = `const __FALLBACK = '#9aa0a6';
function __colorProxy() {
  const f = () => __FALLBACK;
  return new Proxy(f, {
    get(_t, key) {
      if (key === Symbol.toPrimitive || key === 'toString' || key === 'valueOf') return () => __FALLBACK;
      if (typeof key === 'symbol') return undefined;
      return __colorProxy();
    },
  });
}
function __wrap(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  return new Proxy(obj, {
    get(target, key) {
      if (key in target) {
        const v = Reflect.get(target, key);
        return v && typeof v === 'object' ? __wrap(v) : v;
      }
      if (typeof key === 'symbol') return Reflect.get(target, key);
      return __colorProxy();
    },
  });
}
const __theme = { ...__baseTheme, palette: __wrap(__baseTheme.palette) };`;

/** Bundle path → relative specifier for an entry-inlined import (entry at root). */
function rel(bundlePath: string): string {
  return `.${bundlePath.replace(/\.\w+$/, '')}`;
}

/**
 * Assemble the provider wrapper from the packages the bundle actually pulls in.
 * Returns NONE when nothing context-bound is present, so a plain component is
 * left unwrapped (and needs no extra sandbox dependency). When `preview` carries
 * the app's real theme / messages, they are used for a faithful render; else a
 * defensive stub keeps the component from crashing (placeholder colors/keys).
 */
export function buildProviderStub(
  deps: Readonly<Record<string, string>>,
  preview: PreviewContext = {},
): ProviderStubResult {
  const mui = usesMui(deps);
  const rq = usesReactQuery(deps);
  const intl = usesNextIntl(deps);
  if (!mui && !rq && !intl) return NONE;

  const importLines: string[] = [];
  const body: string[] = [];

  // Build innermost → outermost. QueryClientProvider wraps ThemeProvider so a
  // component using both a query and the theme finds both in context.
  let inner = '{children}';
  if (mui) {
    importLines.push(`import { ThemeProvider, createTheme } from '@mui/material/styles';`);
    if (preview.theme) {
      // Real app theme → true brand colors. Used AS-IS: it is complete, and the
      // palette guard must NOT wrap it — the guard returns a truthy proxy for any
      // missing key, which trips MUI's internal `theme.palette.<x>` existence
      // checks and corrupts color resolution (renders everything a placeholder).
      importLines.push(
        `import { ${preview.theme.exportName} as __theme } from '${rel(preview.theme.path)}';`,
      );
    } else {
      // No real theme: a defensive stub keeps custom-token components from
      // throwing (placeholder colors) instead of blanking.
      body.push(`const __baseTheme = createTheme();`);
      body.push(PALETTE_GUARD);
    }
    inner = `<ThemeProvider theme={__theme}>${inner}</ThemeProvider>`;
  }
  if (rq) {
    importLines.push(`import { QueryClient, QueryClientProvider } from '@tanstack/react-query';`);
    body.push(`const __queryClient = new QueryClient();`);
    inner = `<QueryClientProvider client={__queryClient}>${inner}</QueryClientProvider>`;
  }
  if (intl) {
    // `useTranslations` throws hard without this provider. With the real message
    // catalogue the component shows true labels; without it, fall back to the
    // key so it renders text instead of crashing.
    importLines.push(`import { NextIntlClientProvider } from 'next-intl';`);
    let msgExpr = '{}';
    if (preview.messagesPath) {
      importLines.push(`import __messages from '${rel(preview.messagesPath)}';`);
      msgExpr = '__messages';
    }
    inner =
      `<NextIntlClientProvider locale="ko" messages={${msgExpr}} onError={() => {}} getMessageFallback={({ key }) => key}>` +
      inner +
      `</NextIntlClientProvider>`;
  }

  const providersFile = `${body.join('\n')}

function Providers({ children }: { children: React.ReactNode }) {
  return ${inner};
}`;

  return {
    providersFile,
    wrapperJsxOpen: '<Providers>',
    wrapperJsxClose: '</Providers>',
    imports: importLines.join('\n'),
    // The packages are already bundle dependencies (the component imports them),
    // so the providers add nothing the sandbox isn't installing anyway.
    dependencies: {},
    unresolved: [],
  };
}

export function generateReactProviderStubs(
  _descriptor: ComponentDescriptor,
  _handle: ReactProgramHandle,
  deps: Readonly<Record<string, string>> = {},
  preview: PreviewContext = {},
): ProviderStubResult {
  return buildProviderStub(deps, preview);
}
