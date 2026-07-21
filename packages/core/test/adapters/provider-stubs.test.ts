import { describe, it, expect } from 'vitest';
import { buildProviderStub } from '../../src/adapters/react/provider-stubs.js';

describe('buildProviderStub', () => {
  it('emits no providers when nothing context-bound is used', () => {
    const r = buildProviderStub({ 'lodash-es': '^4.0.0' });
    expect(r.wrapperJsxOpen).toBe('');
    expect(r.wrapperJsxClose).toBe('');
    expect(r.providersFile).toBe('');
  });

  it('wraps MUI components in a ThemeProvider with a defensive theme', () => {
    const r = buildProviderStub({ '@mui/material': '^7.3.6' });
    expect(r.wrapperJsxOpen).toContain('<Providers>');
    expect(r.wrapperJsxClose).toContain('</Providers>');
    expect(r.providersFile).toMatch(/ThemeProvider/);
    // A defensive palette is the whole point: custom theme lookups like
    // `theme.palette.semantic.tags.warning.text` must resolve, not throw.
    expect(r.providersFile).toMatch(/Proxy/);
    expect(r.imports).toMatch(/@mui\/material/);
  });

  it('detects MUI via a submodule import too', () => {
    const r = buildProviderStub({ '@mui/material/styles': '^7.3.6' });
    expect(r.providersFile).toMatch(/ThemeProvider/);
  });

  it('adds a QueryClientProvider when react-query is used', () => {
    const r = buildProviderStub({ '@tanstack/react-query': '^5.0.0' });
    expect(r.providersFile).toMatch(/QueryClientProvider/);
    expect(r.imports).toMatch(/@tanstack\/react-query/);
  });

  it('composes both providers when both deps are present', () => {
    const r = buildProviderStub({ '@mui/material': '^7', '@tanstack/react-query': '^5' });
    expect(r.providersFile).toMatch(/ThemeProvider/);
    expect(r.providersFile).toMatch(/QueryClientProvider/);
    expect(r.wrapperJsxOpen).toBe('<Providers>');
  });

  it('wraps next-intl consumers in a NextIntlClientProvider that never throws on missing keys', () => {
    const r = buildProviderStub({ 'next-intl': '^4.6.1' });
    expect(r.providersFile).toMatch(/NextIntlClientProvider/);
    expect(r.imports).toMatch(/next-intl/);
    // Missing messages must resolve to the key (or empty), never throw — that
    // throw is exactly what blanked every translated component.
    expect(r.providersFile).toMatch(/getMessageFallback/);
  });

  it('composes MUI + react-query + next-intl together', () => {
    const r = buildProviderStub({
      '@mui/material': '^7',
      '@tanstack/react-query': '^5',
      'next-intl': '^4',
    });
    expect(r.providersFile).toMatch(/ThemeProvider/);
    expect(r.providersFile).toMatch(/QueryClientProvider/);
    expect(r.providersFile).toMatch(/NextIntlClientProvider/);
  });

  it('supplies a FormProvider (useForm) for react-hook-form consumers', () => {
    const r = buildProviderStub({ 'react-hook-form': '^7' });
    expect(r.imports).toMatch(/react-hook-form/);
    expect(r.providersFile).toMatch(/__FormProvider/);
    // useForm is a hook — it must be called INSIDE the Providers component.
    expect(r.providersFile).toMatch(/function Providers[^]*__useForm\(\)/);
  });

  it('wraps consuming components in detected self-contained providers', () => {
    const r = buildProviderStub(
      {},
      { providers: [{ path: '/src/Chat/PanelContext.tsx', exportName: 'ChatPanelProvider' }] },
    );
    expect(r.imports).toMatch(/import \{ ChatPanelProvider as __P0 \}/);
    expect(r.providersFile).toMatch(/<__P0>/);
  });
});
