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

import type { ProviderStubResult } from '../../types/adapter.js';
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

/**
 * Runtime source (sandbox-side) of a theme whose palette tolerates any lookup.
 * Existing MUI keys pass through; a missing key returns a callable/indexable
 * proxy that coerces to a placeholder colour, so `palette.a.b.c` never throws
 * however deep the app nested its custom tokens.
 */
const DEFENSIVE_THEME = `const __FALLBACK = '#9aa0a6';
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
const __base = createTheme();
const __theme = { ...__base, palette: __wrap(__base.palette) };`;

/**
 * Assemble the provider wrapper from the packages the bundle actually pulls in.
 * Returns NONE when nothing context-bound is present, so a plain component is
 * left unwrapped (and needs no extra sandbox dependency).
 */
export function buildProviderStub(deps: Readonly<Record<string, string>>): ProviderStubResult {
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
    body.push(DEFENSIVE_THEME);
    inner = `<ThemeProvider theme={__theme}>${inner}</ThemeProvider>`;
  }
  if (rq) {
    importLines.push(`import { QueryClient, QueryClientProvider } from '@tanstack/react-query';`);
    body.push(`const __queryClient = new QueryClient();`);
    inner = `<QueryClientProvider client={__queryClient}>${inner}</QueryClientProvider>`;
  }
  if (intl) {
    // `useTranslations` throws hard without this provider — it blanks every
    // translated component. We have no real message catalogue, so swallow the
    // missing-key error and fall back to the key itself: the component renders
    // with its i18n keys as visible text instead of crashing.
    importLines.push(`import { NextIntlClientProvider } from 'next-intl';`);
    inner =
      `<NextIntlClientProvider locale="en" messages={{}} onError={() => {}} getMessageFallback={({ key }) => key}>` +
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
): ProviderStubResult {
  return buildProviderStub(deps);
}
