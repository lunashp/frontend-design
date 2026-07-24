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

function usesReactHookForm(deps: Readonly<Record<string, string>>): boolean {
  return 'react-hook-form' in deps;
}

/** The palette-guard helpers: a Proxy that returns a fallback for any missing
 *  custom token instead of throwing. Defined once; each theme path applies it. */
const PALETTE_GUARD_HELPERS = `const __FALLBACK = '#9aa0a6';
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
}`;

/**
 * Build the preview's MUI theme so it EMITS overridable CSS variables.
 *
 * MUI reads its theme from a JS object, so a plain `<ThemeProvider theme={t}>`
 * exposes nothing a stylesheet can re-theme — which is why theme colours used to
 * be a read-only reference. MUI's own "CSS theme variables" mode fixes this: a
 * theme created with `cssVariables: true` (+ `colorSchemes`) emits
 * `--mui-palette-*` custom properties on `:root` that its components READ, so
 * setting those vars live-re-themes the preview. The engine (verified) forces
 * that mode here.
 *
 * Two shapes (both validated against the target's own MUI):
 *  - real app theme → rebuild it forcing cssVariables while carrying its palette
 *    (into `colorSchemes.light`) and the other appearance sections across, so the
 *    render stays faithful. `createTheme(builtTheme, { cssVariables: true })` does
 *    NOT re-emit vars, so the palette must be lifted into a fresh createTheme.
 *  - stub (no real theme) → a default cssVariables theme, then re-apply the
 *    missing-token guard to its palette AFTER createTheme (the vars are generated
 *    at createTheme time, so proxying the palette afterwards guards runtime
 *    `theme.palette.custom` access without disturbing the emitted vars).
 */
function realThemeBody(exportName: string): string {
  return (
    `const __theme = createTheme({\n` +
    `  cssVariables: true,\n` +
    `  colorSchemes: { light: { palette: (${exportName}).palette } },\n` +
    `  typography: (${exportName}).typography,\n` +
    `  shape: (${exportName}).shape,\n` +
    `  components: (${exportName}).components,\n` +
    `});`
  );
}

const STUB_THEME_BODY =
  `${PALETTE_GUARD_HELPERS}\n` +
  `const __base = createTheme({ cssVariables: true });\n` +
  `const __theme = __base;\n` +
  `__theme.palette = __wrap(__base.palette);`;

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
  const rhf = usesReactHookForm(deps);
  const customProviders = preview.providers ?? [];
  if (!mui && !rq && !intl && !rhf && customProviders.length === 0) return NONE;

  const importLines: string[] = [];
  const body: string[] = [];
  // Statements that must run INSIDE the Providers component (React hooks).
  const hookBody: string[] = [];

  // Build innermost → outermost. QueryClientProvider wraps ThemeProvider so a
  // component using both a query and the theme finds both in context.
  let inner = '{children}';
  if (mui) {
    importLines.push(`import { ThemeProvider, createTheme } from '@mui/material/styles';`);
    if (preview.theme) {
      // Real app theme → true brand colors, rebuilt to emit overridable CSS vars.
      importLines.push(
        `import { ${preview.theme.exportName} as __rawTheme } from '${rel(preview.theme.path)}';`,
      );
      body.push(realThemeBody('__rawTheme'));
    } else {
      // No real theme: a default cssVariables theme (so its standard palette is
      // overridable) with the missing-token guard re-applied to its palette.
      body.push(STUB_THEME_BODY);
    }
    inner = `<ThemeProvider theme={__theme}>${inner}</ThemeProvider>`;
  }
  if (rq) {
    importLines.push(`import { QueryClient, QueryClientProvider } from '@tanstack/react-query';`);
    body.push(`const __queryClient = new QueryClient();`);
    inner = `<QueryClientProvider client={__queryClient}>${inner}</QueryClientProvider>`;
  }
  if (rhf) {
    // `useFormContext()` returns null without a FormProvider; components then
    // crash destructuring `control`. Supply an empty form instance.
    importLines.push(`import { useForm as __useForm, FormProvider as __FormProvider } from 'react-hook-form';`);
    hookBody.push(`const __rhfMethods = __useForm();`);
    inner = `<__FormProvider {...__rhfMethods}>${inner}</__FormProvider>`;
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
  // Outermost: the app's own self-contained context providers (e.g.
  // ChatPanelProvider), so a consuming hook finds its context instead of
  // throwing "must be used within a Provider". Their module is already bundled.
  customProviders.forEach((p, i) => {
    const alias = `__P${i}`;
    importLines.push(`import { ${p.exportName} as ${alias} } from '${rel(p.path)}';`);
    inner = `<${alias}>${inner}</${alias}>`;
  });

  const hooks = hookBody.length > 0 ? `  ${hookBody.join('\n  ')}\n` : '';
  const providersFile = `${body.join('\n')}

function Providers({ children }: { children: React.ReactNode }) {
${hooks}  return ${inner};
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
