/**
 * Pure HTML renderer for the shared catalog — a CatalogModel → a single
 * self-contained document string. No I/O, no DOM: it only builds a string, so it
 * is fully unit-testable in the no-jsdom web test setup.
 *
 * SELF-CONTAINED is the contract. The file is opened later, elsewhere, with no
 * host and no network — so ALL CSS is inlined, there are NO external requests
 * (no <link>, no remote fonts/images/scripts), and the content is fully readable
 * with scripts disabled. A small inline vanilla script adds live filter + sort,
 * but it only shows/hides and reorders DOM nodes that are ALREADY in the markup —
 * it never injects data, so it adds no XSS surface.
 *
 * SECURITY: component names and file paths are untrusted target content. Every
 * interpolated value goes through escapeHtml, in both element and attribute
 * context, so a component literally named `<img onerror=…>` renders as text.
 */

import type { AtomicLevel } from '../../api/types.js';
import { KIND_LABEL, contextLoadLabel } from '../../lib/taxonomy.js';
import type { CatalogModel, CatalogRow } from './catalog-model.js';

/** Escape the five HTML-significant characters — safe in element AND attribute context. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const LEVEL_LABEL: Record<AtomicLevel, string> = {
  atom: 'Atom',
  molecule: 'Molecule',
  organism: 'Organism',
  page: 'Page',
};

/** Isolation tone from the context-dependency score — the honest render proxy. */
function isolationTone(score: number): 'ok' | 'warn' | 'danger' {
  if (score <= 2) return 'ok';
  if (score <= 5) return 'warn';
  return 'danger';
}

/** 1–2 leading alphanumerics of the name, for the placeholder monogram tile. */
function monogram(name: string): string {
  const letters = name.replace(/[^A-Za-z0-9]/g, '');
  return (letters.slice(0, 2) || '·').toUpperCase();
}

function propSummary(row: CatalogRow): string {
  if (row.propCount === 0) return 'none';
  const shown = row.propSample.join(', ');
  const more = row.propCount > row.propSample.length ? ` +${row.propCount - row.propSample.length}` : '';
  return `${row.propCount} · ${shown}${more}`;
}

function renderRow(row: CatalogRow, maxUsed: number): string {
  const ratio = maxUsed > 0 ? row.usedByCount / maxUsed : 0;
  const tone = isolationTone(row.contextScore);
  const isoLabel = contextLoadLabel(row.contextScore);
  // One lowercased haystack the inline filter matches against — escaped because
  // it lands in a double-quoted attribute.
  const search = escapeHtml(
    `${row.name} ${row.relativePath} ${row.propSample.join(' ')}`.toLowerCase(),
  );
  const exportBadge =
    row.exportName !== row.name
      ? `<span class="export">as ${escapeHtml(row.exportName)}</span>`
      : '';
  // A rendered thumbnail if one was captured, else the monogram tile — same box,
  // so the row height is identical either way and a partial capture reads cleanly.
  const tile = row.thumbnail
    ? `<img class="tile tile-img" src="${escapeHtml(row.thumbnail)}" alt="" loading="lazy" />`
    : `<span class="tile lvl-${row.atomicLevel}" aria-hidden="true">${escapeHtml(monogram(row.name))}</span>`;
  return [
    `<tr class="row" data-search="${search}" data-name="${escapeHtml(row.name.toLowerCase())}" data-used="${row.usedByCount}">`,
    '<td class="c-name">',
    tile,
    '<span class="name-wrap">',
    `<span class="name">${escapeHtml(row.name)}</span>`,
    exportBadge,
    '</span>',
    '</td>',
    `<td class="c-path"><code>${escapeHtml(row.relativePath)}</code></td>`,
    `<td><span class="badge lvl-${row.atomicLevel}">${escapeHtml(LEVEL_LABEL[row.atomicLevel])}</span></td>`,
    `<td><span class="badge kind">${escapeHtml(KIND_LABEL[row.kind])}</span></td>`,
    `<td class="num"><span class="usedby"><span class="bar" style="--w:${ratio.toFixed(3)}"></span><span class="usedby-n">${row.usedByCount}</span></span></td>`,
    `<td><span class="iso iso-${tone}">${escapeHtml(isoLabel)}</span></td>`,
    `<td class="c-props">${escapeHtml(propSummary(row))}</td>`,
    '</tr>',
  ].join('');
}

function renderGroup(dir: string, rows: readonly CatalogRow[], maxUsed: number): string {
  const label = dir === '' ? '(project root)' : dir;
  const body = rows.map((r) => renderRow(r, maxUsed)).join('');
  return [
    '<section class="group">',
    '<div class="group-head">',
    `<h2 class="dir"><code>${escapeHtml(label)}</code></h2>`,
    `<span class="group-count">${rows.length}</span>`,
    '</div>',
    '<div class="table-scroll">',
    '<table class="rows">',
    '<thead><tr>',
    '<th>Component</th><th>Path</th><th>Level</th><th>Kind</th>',
    '<th class="num">Used&nbsp;by</th><th>Isolation</th><th>Props</th>',
    '</tr></thead>',
    `<tbody>${body}</tbody>`,
    '</table>',
    '</div>',
    '</section>',
  ].join('');
}

function renderStatChips(model: CatalogModel): string {
  const levels = model.levelCounts
    .filter((l) => l.count > 0)
    .map(
      (l) =>
        `<span class="chip"><span class="dot lvl-${l.level}"></span>${escapeHtml(LEVEL_LABEL[l.level])}<b>${l.count}</b></span>`,
    )
    .join('');
  const kinds = model.kindCounts
    .filter((k) => k.count > 0)
    .map((k) => `<span class="chip">${escapeHtml(KIND_LABEL[k.kind])}<b>${k.count}</b></span>`)
    .join('');
  return `<div class="chips">${levels}${kinds}</div>`;
}

function renderLede(model: CatalogModel): string {
  const count =
    model.shownCount === model.totalCount
      ? `${model.shownCount} design component${model.shownCount === 1 ? '' : 's'}`
      : `${model.shownCount} of ${model.totalCount} design components`;
  return `${escapeHtml(model.framework)} &middot; ${count} &middot; generated ${escapeHtml(model.generatedAtLabel)}`;
}

// CSS is a plain template literal (no backticks / ${} inside CSS), inlined so the
// file needs no stylesheet request. Theme-aware: a light base with a dark
// override via prefers-color-scheme. Editorial rather than a raw table dump —
// scale contrast in the masthead, a monospace path column, level-hued badges.
const STYLE = `
:root{
  --bg:#f7f7f5; --surface:#ffffff; --surface-2:#f1f1ee; --line:#e3e3de;
  --line-strong:#cfcfc8; --text:#1a1a17; --text-dim:#65655d; --text-faint:#8a8a80;
  --accent:#4f46e5; --shadow:0 1px 2px rgba(20,20,15,.06),0 8px 24px rgba(20,20,15,.05);
  --atom:#0e9f6e; --molecule:#3b82f6; --organism:#8b5cf6; --page:#d97706;
  --radius:12px; --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  --sans:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#131311; --surface:#1c1c19; --surface-2:#242420; --line:#31312b;
    --line-strong:#43433b; --text:#f2f2ec; --text-dim:#a9a99e; --text-faint:#77776d;
    --accent:#a5b4fc; --shadow:0 1px 2px rgba(0,0,0,.4),0 10px 30px rgba(0,0,0,.35);
    --atom:#34d399; --molecule:#60a5fa; --organism:#a78bfa; --page:#fbbf24;
  }
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--sans);
  font-size:15px;line-height:1.5;padding:clamp(1.25rem,3vw,3rem);}
.wrap{max-width:1140px;margin:0 auto;}
.masthead{margin-bottom:2rem;}
.eyebrow{font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;
  color:var(--text-faint);font-weight:700;}
h1{font-size:clamp(2rem,5vw,3.4rem);line-height:1.02;margin:.35rem 0 .5rem;
  letter-spacing:-.02em;font-weight:800;}
.lede{color:var(--text-dim);margin:0 0 1.1rem;font-size:1rem;}
.chips{display:flex;flex-wrap:wrap;gap:.5rem;}
.chip{display:inline-flex;align-items:center;gap:.4rem;padding:.28rem .6rem;
  background:var(--surface);border:1px solid var(--line);border-radius:999px;
  font-size:.82rem;color:var(--text-dim);}
.chip b{color:var(--text);font-variant-numeric:tabular-nums;}
.dot{width:.6rem;height:.6rem;border-radius:50%;display:inline-block;}
.dot.lvl-atom,.badge.lvl-atom,.tile.lvl-atom{--c:var(--atom)}
.dot.lvl-molecule,.badge.lvl-molecule,.tile.lvl-molecule{--c:var(--molecule)}
.dot.lvl-organism,.badge.lvl-organism,.tile.lvl-organism{--c:var(--organism)}
.dot.lvl-page,.badge.lvl-page,.tile.lvl-page{--c:var(--page)}
.dot{background:var(--c)}
.toolbar{display:none;margin:0 0 1.4rem;gap:.6rem;flex-wrap:wrap;align-items:center;}
html.has-js .toolbar{display:flex;}
.toolbar input,.toolbar select{font:inherit;color:var(--text);background:var(--surface);
  border:1px solid var(--line-strong);border-radius:10px;padding:.5rem .7rem;}
.toolbar input{flex:1;min-width:220px;}
.toolbar .count{color:var(--text-faint);font-size:.85rem;font-variant-numeric:tabular-nums;}
.group{margin:0 0 1.8rem;background:var(--surface);border:1px solid var(--line);
  border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;}
.group-head{display:flex;align-items:center;justify-content:space-between;gap:1rem;
  padding:.85rem 1.1rem;border-bottom:1px solid var(--line);background:var(--surface-2);}
.dir{margin:0;font-size:.95rem;font-weight:600;}
.dir code{font-family:var(--mono);font-size:.86rem;color:var(--text);}
.group-count{font-variant-numeric:tabular-nums;color:var(--text-faint);font-size:.82rem;
  background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:.1rem .55rem;}
.table-scroll{overflow-x:auto;}
table.rows{width:100%;border-collapse:collapse;font-size:.88rem;}
thead th{text-align:left;font-size:.7rem;letter-spacing:.06em;text-transform:uppercase;
  color:var(--text-faint);font-weight:700;padding:.6rem 1.1rem;border-bottom:1px solid var(--line);
  white-space:nowrap;}
tbody td{padding:.62rem 1.1rem;border-bottom:1px solid var(--line);vertical-align:middle;}
tbody tr:last-child td{border-bottom:none;}
tbody tr:hover td{background:var(--surface-2);}
.c-name{min-width:180px;}
.tile{display:inline-grid;place-items:center;width:1.9rem;height:1.9rem;border-radius:8px;
  margin-right:.6rem;font-family:var(--mono);font-size:.72rem;font-weight:700;color:#fff;
  background:var(--c);vertical-align:middle;}
.tile-img{object-fit:contain;background:var(--surface-2);border:1px solid var(--line);padding:2px;}
.name-wrap{display:inline-flex;flex-direction:column;vertical-align:middle;}
.name{font-weight:650;}
.export{font-size:.72rem;color:var(--text-faint);font-family:var(--mono);}
.c-path code{font-family:var(--mono);font-size:.8rem;color:var(--text-dim);word-break:break-all;}
.badge{display:inline-block;padding:.12rem .5rem;border-radius:6px;font-size:.74rem;font-weight:600;
  color:var(--c);background:color-mix(in srgb,var(--c) 14%,transparent);
  border:1px solid color-mix(in srgb,var(--c) 34%,transparent);white-space:nowrap;}
.badge.kind{--c:var(--text-dim);color:var(--text-dim);}
.num{text-align:right;}
.usedby{display:inline-flex;align-items:center;gap:.5rem;justify-content:flex-end;
  font-variant-numeric:tabular-nums;}
.bar{width:44px;height:6px;border-radius:3px;background:var(--surface-2);position:relative;overflow:hidden;}
.bar::after{content:"";position:absolute;inset:0;width:calc(var(--w,0)*100%);
  background:var(--accent);border-radius:3px;}
.iso{font-size:.76rem;white-space:nowrap;}
.iso-ok{color:var(--atom);} .iso-warn{color:var(--page);} .iso-danger{color:var(--organism);}
.c-props{color:var(--text-dim);font-size:.82rem;max-width:260px;}
.empty{padding:2.5rem;text-align:center;color:var(--text-faint);background:var(--surface);
  border:1px dashed var(--line-strong);border-radius:var(--radius);}
footer{margin-top:2.5rem;padding-top:1.2rem;border-top:1px solid var(--line);
  color:var(--text-faint);font-size:.8rem;line-height:1.6;}
footer b{color:var(--text-dim);font-weight:600;}
`;

// Vanilla, dependency-free. Deliberately NO template literals / ${} inside — the
// whole document is itself a TS template literal, so this uses string concat and
// single quotes only. It reads existing DOM (data-* attrs) and toggles/reorders
// rows; it never injects markup, so it is not an XSS vector.
const SCRIPT = [
  "document.documentElement.classList.add('has-js');",
  "var q=document.getElementById('q');",
  "var sort=document.getElementById('sort');",
  "var live=document.getElementById('live');",
  "var groups=Array.prototype.slice.call(document.querySelectorAll('.group'));",
  "function apply(){",
  "  var term=(q&&q.value||'').trim().toLowerCase();",
  "  var shown=0;",
  "  groups.forEach(function(g){",
  "    var rows=Array.prototype.slice.call(g.querySelectorAll('tr.row'));",
  "    var vis=0;",
  "    rows.forEach(function(r){",
  "      var hit=!term||(r.getAttribute('data-search')||'').indexOf(term)!==-1;",
  "      r.hidden=!hit; if(hit){vis++;shown++;}",
  "    });",
  "    g.hidden=vis===0;",
  "  });",
  "  if(live){live.textContent=shown+' shown';}",
  "}",
  "function reorder(){",
  "  var mode=sort&&sort.value||'used';",
  "  groups.forEach(function(g){",
  "    var body=g.querySelector('tbody'); if(!body)return;",
  "    var rows=Array.prototype.slice.call(body.querySelectorAll('tr.row'));",
  "    rows.sort(function(a,b){",
  "      if(mode==='name'){",
  "        return (a.getAttribute('data-name')||'').localeCompare(b.getAttribute('data-name')||'');",
  "      }",
  "      return (+b.getAttribute('data-used'))-(+a.getAttribute('data-used'));",
  "    });",
  "    rows.forEach(function(r){body.appendChild(r);});",
  "  });",
  "}",
  "if(q){q.addEventListener('input',apply);}",
  "if(sort){sort.addEventListener('change',reorder);}",
  "apply();",
].join('\n');

function renderToolbar(model: CatalogModel): string {
  return [
    '<div class="toolbar" role="search">',
    `<input id="q" type="search" placeholder="Filter ${model.shownCount} components by name, path, or prop…" aria-label="Filter components">`,
    '<label>Sort <select id="sort"><option value="used">Most used</option><option value="name">Name</option></select></label>',
    '<span id="live" class="count" aria-live="polite"></span>',
    '</div>',
  ].join('');
}

/** Render the model as a complete, self-contained HTML document string. Pure. */
export function renderCatalogHtml(model: CatalogModel): string {
  const maxUsed = model.groups.reduce(
    (max, g) => g.rows.reduce((m, r) => Math.max(m, r.usedByCount), max),
    0,
  );
  const body =
    model.groups.length === 0
      ? '<div class="empty">No components in this view.</div>'
      : model.groups.map((g) => renderGroup(g.dir, g.rows, maxUsed)).join('');

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>Component catalog — ${escapeHtml(model.projectName)}</title>`,
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    '<div class="wrap">',
    '<header class="masthead">',
    '<div class="eyebrow">Component catalog</div>',
    `<h1>${escapeHtml(model.projectName)}</h1>`,
    `<p class="lede">${renderLede(model)}</p>`,
    renderStatChips(model),
    '</header>',
    renderToolbar(model),
    `<main>${body}</main>`,
    '<footer>',
    '<p>A static snapshot from <b>Component Explorer</b> — no live data, no tool required. ',
    'The <b>Isolation</b> column reflects each component&#39;s context-dependency score ',
    '(lower renders more standalone); live renderability and previews need the running tool ',
    'and are intentionally omitted from a shared file.</p>',
    '</footer>',
    '</div>',
    `<script>${SCRIPT}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
