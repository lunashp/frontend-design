/**
 * Renders a component's Sandpack spec into a self-contained preview document by
 * bundling it locally with esbuild against the TARGET project's own
 * node_modules — no external CDN (jsdelivr / codesandbox.io) involved. This is
 * what makes the design actually appear regardless of network, browser
 * extensions, or CDN availability.
 *
 * The target is still read strictly read-only: esbuild only resolves and reads
 * from its node_modules; nothing is written back to the project.
 */

import { build } from 'esbuild';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { patchEntryProps, type SandpackSpec } from '@ce/core';

export interface PreviewInput {
  readonly targetRoot: string;
  readonly spec: SandpackSpec;
  /** Prop values to merge into the mounted instance (Customize prop edits). */
  readonly propOverrides?: Readonly<Record<string, unknown>>;
  /** Called for each problem that did not stop the preview from rendering. */
  readonly onWarning?: (message: string) => void;
}

/** Resolve `/foo` sandbox-root specifiers to the temp bundle dir. */
function sandboxRootPlugin(dir: string) {
  return {
    name: 'sandbox-root',
    setup(b: { onResolve: (o: { filter: RegExp }, cb: (a: { path: string }) => { path: string } | undefined) => void }) {
      b.onResolve({ filter: /^\// }, (args) => {
        const p = path.join(dir, args.path);
        return existsSync(p) ? { path: p } : undefined; // else: real FS/node_modules
      });
    },
  };
}

function escapeForScript(js: string): string {
  // Prevent a literal </script> inside the bundle from closing the tag.
  return js.replace(/<\/script>/gi, '<\\/script>');
}

/**
 * Keyboard bridge, iframe -> embedder.
 *
 * The preview frame is sandboxed to an opaque origin (allow-scripts, and
 * deliberately NOT allow-same-origin — that boundary is what lets us render
 * arbitrary target code at all). One consequence is that its key events never
 * reach the parent document: the Inspector's Escape and Tab handlers are
 * registered on the PARENT, so while the preview held focus Escape stopped
 * closing the slide-over and Tab walked straight out of its focus trap. Granting
 * same-origin would fix that by giving the previewed component access to the
 * host page, so the keys travel as messages instead — postMessage is the only
 * channel that crosses an opaque origin.
 *
 * Taking Tab is only safe while something on the other end will move focus, so
 * the bridge announces itself and stays out of the way until an embedder
 * answers. That gate is not defensive habit — it is the fix for a real WCAG
 * 2.1.2 keyboard trap: this sender used to intercept Tab in EVERY preview while
 * the Inspector only listened in its narrow-viewport modal, so on the default
 * desktop layout preventDefault() fired and nobody moved focus, forward or
 * backward. Silence now means the browser's own Tab, which always gets out.
 *
 * Exported so it can be driven directly in a test; there is no DOM in this
 * package, hence plain ES5 with no dependencies.
 */
export const PREVIEW_KEYBOARD_BRIDGE = `(function () {
  // Same selector the Inspector's focus trap uses, so both ends agree on what
  // counts as a tab stop.
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

  var embedderListening = false;

  function send(message) {
    // Addressed to the origin this document was served from, never '*'. The
    // embedder loads the preview by relative URL, so that origin IS the
    // embedder — and a hostile page that framed the preview instead gets the
    // message dropped by the browser rather than a handle on our key events.
    try {
      parent.postMessage(message, location.protocol + '//' + location.host);
    } catch (e) {
      /* opened directly, with no embedder to notify */
    }
  }

  function visibleStops() {
    var all = document.querySelectorAll(FOCUSABLE);
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].offsetParent !== null) out.push(all[i]);
    }
    return out;
  }

  window.addEventListener('message', function (event) {
    // Identity, not origin: an embedder's message arrives with whatever origin
    // it was served from, but only the window that framed us can BE 'parent',
    // and that reference cannot be forged. A nested frame or an unrelated
    // window therefore cannot talk us into swallowing keys.
    if (!event || event.source !== parent) return;
    var data = event.data;
    if (data && data.type === 'ce:embedder-ready') embedderListening = true;
  });

  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      // Sent regardless of the handshake: Escape is never preventDefault-ed, so
      // an unheard one costs nothing and cannot strand anybody.
      send({ type: 'ce:escape' });
      return;
    }
    if (event.key !== 'Tab') return;
    // No embedder to hand focus to means the browser keeps the key. Doing
    // anything else here is the keyboard trap described above.
    if (!embedderListening) return;
    // Only the EDGES are forwarded: Tab has to keep working inside the preview,
    // or the sandbox stops being usable for checking a component's own keyboard
    // behaviour. At an edge the browser would move focus to whatever follows the
    // iframe in the PARENT document — outside the trap — so the embedder is
    // asked to place focus itself.
    var stops = visibleStops();
    var atEdge =
      stops.length === 0 ||
      (event.shiftKey
        ? document.activeElement === stops[0]
        : document.activeElement === stops[stops.length - 1]);
    if (!atEdge) return;
    event.preventDefault();
    send({ type: 'ce:tab-out', shiftKey: !!event.shiftKey });
  });

  // Opens the handshake. The embedder attaches its listener when the component
  // is selected, which is before it can possibly have rendered this frame, so
  // by the time this runs there is someone to hear it.
  send({ type: 'ce:preview-ready' });
})();`;

/**
 * Bundle the component and return a complete HTML document that mounts it.
 * Throws with esbuild's messages if the bundle can't be built.
 */
export async function renderPreviewHtml(input: PreviewInput): Promise<string> {
  const { targetRoot, spec, propOverrides, onWarning } = input;
  const nodeModules = path.join(targetRoot, 'node_modules');
  const warnings: string[] = [];

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-preview-'));
  try {
    for (const [p, content] of Object.entries(spec.files)) {
      let patched = content;
      if (p === spec.entryPath && propOverrides) {
        // Same merge the engine performs — one implementation, so a prop edit
        // never behaves differently in the preview than in a copied bundle.
        const result = patchEntryProps(content, propOverrides);
        patched = result.entry;
        warnings.push(...result.warnings);
      }
      const file = path.join(dir, p);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, patched);
    }
    for (const message of warnings) onWarning?.(message);

    const result = await build({
      entryPoints: [path.join(dir, spec.entryPath)],
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      outdir: path.join(dir, '__out'),
      jsx: 'automatic',
      loader: { '.tsx': 'tsx', '.ts': 'ts', '.js': 'jsx', '.jsx': 'jsx', '.css': 'css' },
      nodePaths: [nodeModules],
      plugins: [sandboxRootPlugin(dir)],
      define: { 'process.env.NODE_ENV': '"development"' },
      // Target code (api config, stores) often reads `process.env.*` or `global`
      // at module top level; neither exists in the browser. Shim them so the
      // module loads instead of throwing `process is not defined`. We also flip
      // NEXT_PUBLIC_USE_MOCK_DATA on: many apps gate a built-in mock layer on a
      // flag, so enabling it makes data-driven components render sample data
      // instead of hitting a real (absent) backend and blanking on a 404.
      banner: {
        js: `globalThis.process=globalThis.process||{env:{NODE_ENV:'development',NEXT_PUBLIC_USE_MOCK_DATA:'true'},platform:'browser',cwd:function(){return '/'}};globalThis.global=globalThis.global||globalThis;`,
      },
      logLevel: 'silent',
    });

    const js = result.outputFiles
      .filter((f) => f.path.endsWith('.js'))
      .map((f) => f.text)
      .join('\n');
    const css = result.outputFiles
      .filter((f) => f.path.endsWith('.css'))
      .map((f) => f.text)
      .join('\n');

    // A degraded merge must be visible, not silent: it also reaches the host
    // through `onWarning`, but the iframe console is where a user looking at a
    // wrong-looking preview actually looks.
    const warningScript = warnings.length
      ? `<script>${escapeForScript(
          warnings.map((w) => `console.warn(${JSON.stringify(`[component-explorer] ${w}`)});`).join('\n'),
        )}</script>\n`
      : '';

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>html,body{margin:0}#root{padding:16px}
${css}</style>
</head>
<body>
<div id="root"></div>
<script>
// Sandboxed opaque-origin previews (sandbox="allow-scripts", no allow-same-origin)
// throw a SecurityError on ANY access to window.localStorage / sessionStorage —
// even the property read — so components using useLocalStorage/useSidebarState
// crash before render. Install an in-memory shim BEFORE the bundle runs; this
// keeps the sandbox opaque (we do NOT grant same-origin) and the preview simply
// doesn't persist storage, which is correct for a throwaway render.
(function () {
  function memStorage() {
    var m = Object.create(null);
    return {
      getItem: function (k) { k = String(k); return k in m ? m[k] : null; },
      setItem: function (k, v) { m[String(k)] = String(v); },
      removeItem: function (k) { delete m[String(k)]; },
      clear: function () { m = Object.create(null); },
      key: function (i) { var ks = Object.keys(m); return i in ks ? ks[i] : null; },
      get length() { return Object.keys(m).length; }
    };
  }
  function usable(name) {
    try { var s = window[name]; if (!s) return false; s.getItem('__ce_probe__'); return true; }
    catch (e) { return false; }
  }
  ['localStorage', 'sessionStorage'].forEach(function (name) {
    if (usable(name)) return;
    try { Object.defineProperty(window, name, { value: memStorage(), configurable: true }); }
    catch (e) { try { window[name] = memStorage(); } catch (e2) { /* give up */ } }
  });
})();
</script>
<script>
// Live customization from the Customize panel, applied instantly with no rebundle:
//  - ce:tokens  -> set CSS custom properties on :root (re-theme via var(--token))
//  - ce:design  -> a universal override layer on the component's own root element
//                  (#root > *), so size/colour/spacing/etc. work for ANY component
//                  regardless of whether it exposes tokens.
//
// A ce:design message carries either \`sheet\` — a complete stylesheet, which is
// what emitDesignStyleSheet() produces and the only form that can express the
// hover / focus-visible / active states — or the legacy \`css\`, a bare
// declaration list for the resting state that we wrap ourselves.
window.addEventListener('message', function (e) {
  var d = e && e.data;
  if (!d) return;
  if (d.type === 'ce:tokens' && d.tokens) {
    for (var k in d.tokens) document.documentElement.style.setProperty(k, d.tokens[k]);
    return;
  }
  if (d.type === 'ce:design') {
    var el = document.getElementById('ce-design');
    if (!el) {
      el = document.createElement('style');
      el.id = 'ce-design';
      document.head.appendChild(el);
    }
    if (d.sheet) el.textContent = d.sheet;
    else el.textContent = d.css ? '#root > * {' + d.css + '}' : '';
    return;
  }
});
</script>
<script>
${PREVIEW_KEYBOARD_BRIDGE}
</script>
${warningScript}<script>${escapeForScript(js)}</script>
</body>
</html>`;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
