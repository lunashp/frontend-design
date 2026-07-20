/**
 * Browser stand-ins for the Next.js modules a client component reaches for.
 *
 * `next` cannot run in the sandbox, so any component importing it — directly or
 * through its subtree — is written off as code-only. But what these components
 * actually use is a handful of thin client APIs: a link, an image, router hooks.
 * Swapping those imports for local stubs drops `next` from the dependency list
 * and lets the component render, which is the whole point of the preview.
 *
 * Server-only modules (`next/server`, `next/headers`) are deliberately absent:
 * a component using them is not a client component and has no design to show,
 * so it stays honestly code-only rather than rendering a lie.
 */

/** Bundle directory holding emitted stubs. Under /src like every mirrored file. */
export const NEXT_STUB_DIR = '/src/__next-stubs__';

const LINK = `import * as React from 'react';

/** next/link → a plain anchor. Next-only props are dropped, not forwarded. */
const Link = React.forwardRef(function Link(props, ref) {
  const { href, children, replace, scroll, prefetch, shallow, passHref, locale, legacyBehavior, onNavigate, ...rest } = props;
  const url = typeof href === 'string' ? href : (href && href.pathname) || '#';
  return React.createElement('a', { ...rest, ref, href: url }, children);
});

export default Link;
`;

const IMAGE = `import * as React from 'react';

/** next/image → a plain img. Handles both string src and static imports. */
export default function Image(props) {
  const { src, alt = '', width, height, fill, priority, quality, placeholder, blurDataURL, loader, unoptimized, sizes, style, ...rest } = props;
  const url = typeof src === 'string' ? src : (src && (src.src || src.default)) || '';
  const resolved = fill
    ? { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', ...style }
    : style;
  return React.createElement('img', { ...rest, src: url, alt, width, height, style: resolved });
}
`;

const NAVIGATION = `/** next/navigation → inert router. Navigation is a no-op in a preview. */
const noop = () => {};

export function useRouter() {
  return { push: noop, replace: noop, back: noop, forward: noop, refresh: noop, prefetch: noop };
}
export function usePathname() {
  return '/';
}
export function useSearchParams() {
  return new URLSearchParams();
}
export function useParams() {
  return {};
}
export function useSelectedLayoutSegment() {
  return null;
}
export function useSelectedLayoutSegments() {
  return [];
}
export function useServerInsertedHTML() {}
export function redirect() {}
export function permanentRedirect() {}
export function notFound() {}
export function forbidden() {}
export function unauthorized() {}
export const RedirectType = { push: 'push', replace: 'replace' };
export const ReadonlyURLSearchParams = URLSearchParams;
`;

const DYNAMIC = `import * as React from 'react';

/**
 * next/dynamic → React.lazy. The loader's own import target is only in the
 * bundle if the graph reached it; when it is not, this fails inside Suspense
 * and leaves the rest of the component rendered, rather than failing the module.
 */
export default function dynamic(loader, options = {}) {
  const Lazy = React.lazy(() =>
    Promise.resolve(typeof loader === 'function' ? loader() : loader).then((m) => ({
      default: (m && m.default) || m,
    })),
  );
  const Loading = options.loading;
  return function Dynamic(props) {
    return React.createElement(
      React.Suspense,
      { fallback: Loading ? React.createElement(Loading, {}) : null },
      React.createElement(Lazy, props),
    );
  };
}
export const noSSR = undefined;
`;

const HEAD = `import * as React from 'react';

/** next/head → renders nothing; document head is not part of a preview. */
export default function Head() {
  return null;
}
`;

const SCRIPT = `import * as React from 'react';

/** next/script → renders nothing; a preview must not execute injected scripts. */
export default function Script() {
  return null;
}
`;

const FONT = `/** next/font/* → the shape callers destructure, with no font loading. */
const font = () => ({ className: '', variable: '', style: { fontFamily: 'inherit' } });

export default font;
export const Inter = font;
export const Roboto = font;
export const localFont = font;
`;

const ROOT = `/** next (root) → only the bits a client component can legitimately touch. */
export default {};
`;

/**
 * Specifier → stub source. A `next/*` import missing from this map is one we
 * cannot honestly fake, and the component stays code-only.
 */
const STUBS: Readonly<Record<string, string>> = {
  next: ROOT,
  'next/link': LINK,
  'next/image': IMAGE,
  'next/navigation': NAVIGATION,
  'next/router': NAVIGATION,
  'next/dynamic': DYNAMIC,
  'next/head': HEAD,
  'next/script': SCRIPT,
  'next/font/google': FONT,
  'next/font/local': FONT,
};

export function isStubbableNextModule(specifier: string): boolean {
  return specifier in STUBS;
}

/** Bundle path for a stubbed specifier, e.g. `next/link` → `…/next-link.tsx`. */
export function nextStubPath(specifier: string): string {
  const slug = specifier.replace(/[/@]/g, '-').replace(/^-/, '');
  return `${NEXT_STUB_DIR}/${slug}.tsx`;
}

export function nextStubSource(specifier: string): string {
  return (STUBS[specifier] ?? PACKAGE_STUBS[specifier]) as string;
}

/**
 * Whole npm packages that hard-require the Next.js runtime (they `import 'next/…'`
 * in their own code), so the sandbox can't load them however the app imports them
 * — the module fails to resolve and the component renders blank. Their real job
 * (error telemetry) is a no-op in a preview, so a stub is both safe and correct.
 */
const SENTRY = `import * as React from 'react';
const noop = () => {};
const asyncNoop = () => Promise.resolve();
const scope = { setTag: noop, setTags: noop, setContext: noop, setLevel: noop, setUser: noop, setExtra: noop, setExtras: noop, setFingerprint: noop, addBreadcrumb: noop, clear: noop };
export const init = noop;
export const captureException = () => '';
export const captureMessage = () => '';
export const captureEvent = () => '';
export const withScope = (cb) => (typeof cb === 'function' ? cb(scope) : undefined);
export const configureScope = (cb) => { if (typeof cb === 'function') cb(scope); };
export const getCurrentScope = () => scope;
export const getCurrentHub = () => ({ getScope: getCurrentScope, captureException, captureMessage });
export const setUser = noop;
export const setTag = noop;
export const setTags = noop;
export const setContext = noop;
export const setExtra = noop;
export const setExtras = noop;
export const addBreadcrumb = noop;
export const startSpan = (o, cb) => (typeof cb === 'function' ? cb({ end: noop, setAttribute: noop, setStatus: noop }) : undefined);
export const startInactiveSpan = () => ({ end: noop, setAttribute: noop });
export const startTransaction = () => ({ finish: noop, setTag: noop, startChild: () => ({ finish: noop }) });
export const flush = asyncNoop;
export const close = asyncNoop;
export const setMeasurement = noop;
export const withSentryConfig = (config) => config;
export const browserTracingIntegration = () => ({});
export const replayIntegration = () => ({});
export const captureRouterTransitionStart = noop;
export function ErrorBoundary({ children }) { return React.createElement(React.Fragment, null, children); }
export const withErrorBoundary = (C) => C;
export function Profiler({ children }) { return React.createElement(React.Fragment, null, children); }
export const withProfiler = (C) => C;
export default {};
`;

/** npm package specifier → stub source. Matched by exact package name. */
const PACKAGE_STUBS: Readonly<Record<string, string>> = {
  '@sentry/nextjs': SENTRY,
  '@sentry/react': SENTRY,
  '@sentry/browser': SENTRY,
  '@sentry/core': SENTRY,
};

/**
 * Any import specifier the sandbox can't run but we can fake: a `next/*` module
 * or a whole unbundlable package. Callers rewrite these to a local stub and drop
 * the real dependency.
 */
export function isStubbableModule(specifier: string): boolean {
  return specifier in STUBS || specifier in PACKAGE_STUBS;
}

/** True for a `next/*` specifier we deliberately do NOT stub (server-only). */
export function isUnstubbableNextModule(specifier: string): boolean {
  return /^next(\/|$)/.test(specifier) && !(specifier in STUBS);
}

export function stubPath(specifier: string): string {
  return nextStubPath(specifier);
}

export function stubSource(specifier: string): string {
  return nextStubSource(specifier);
}

/** The dependency name a stubbed specifier belongs to (so it can be dropped). */
export function stubbedPackageOf(specifier: string): string {
  if (/^next(\/|$)/.test(specifier)) return 'next';
  return specifier;
}
