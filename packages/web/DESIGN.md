# Moonstone — the design system for `@ce/web`

This is the **only** design direction for this app. It describes what the code
already is, not an aspiration. When a generic design menu (a global ruleset, a
component library's defaults, a "worthwhile style directions" list) conflicts
with this document, **this document wins** — those menus describe options for
projects that have not chosen yet. This one has.

Two rules govern changes:

1. **Do not introduce a treatment that is not in here.** If a surface needs
   something new, add it to this document *with its reason* first, then build it.
2. **Do not restate a fact in a second visual channel.** See
   [One fact, one encoding](#one-fact-one-encoding) — it is the rule this system
   breaks most often and the one that makes output look machine-generated.

Source of truth for values: `src/styles/tokens.css`. This document explains
*why* and *when*; the tokens are *what*. Never hardcode a colour, size, radius or
duration in a module — if there is no token, the answer is a new token.

---

## The direction

Component Explorer looks at other people's components through glass — a specimen
under a lens — so the surface **is** glass, over a cool pearl ground, in the
colours a moonstone throws when light moves across it.

It is **editorial**, not dashboard: a serif display face names things, a
technical face measures them, and the page has a reading rhythm rather than a
uniform grid of equal boxes.

**Light only.** There is no dark theme and no `prefers-color-scheme` handling in
the app. (The *exported catalogue*, `features/catalog/render-catalog.ts`, is a
separate artifact and does carry a dark override — that is a document being
handed to someone else, not this UI.) Do not add a half-built dark mode; either
it is designed as thoroughly as this, or it does not exist.

### Palette

One cabinet of **dusty gems** — every accent shares a low, unified chroma
(~0.06–0.09) so nothing shouts and they read as one set.

| Role | Tokens |
|---|---|
| Ground / surfaces | `--bg` `--surface` `--surface-2` `--surface-3` |
| Hairlines | `--line` `--line-strong` |
| Ink | `--text` `--text-dim` `--text-faint` |
| Glass | `--glass-bg` `--glass-bg-strong` `--glass-blur` `--glass-border` `--glass-hi` |
| Cards | `--card-bg` `--card-bg-hover` `--card-border` `--card-shadow` |
| Accent | `--accent` `--accent-strong` `--accent-ink` |
| Selection light | `--sheen` `--sheen-soft` `--glow-select` `--border-select` |
| Taxonomy | `--rank-atom` `--rank-molecule` `--rank-organism` `--rank-page` |
| State | `--danger` `--warn` `--ok` |
| Asides | `--aside-bg` `--aside-bg-warn` `--aside-bg-accent` `--aside-line-warn` `--aside-line-accent` |
| Preview | `--preview-surface` `--preview-check` |

Non-negotiable colour rules:

- **Body text is ink.** Never a gem colour, never an accent. Glass lowers
  effective contrast; `--text-faint` is for labels only, never body copy.
- **Rank colours are dot / border / tint only.** The label is ink. The four ranks
  are separated by *lightness* (a real luminance ladder), so they survive
  greyscale and colour-vision deficiency. Do not even out those lightnesses —
  that flattening is the exact bug the ladder exists to avoid.
- **Every glass surface carries an opaque fallback.**
- **Preview surfaces are deliberately un-themed.** They host components scanned
  out of someone else's project; staining them would misreport what that
  component looks like.

### Glass

- **Real `backdrop-filter` belongs to fixed chrome only** — header, sidebar,
  inspector, summary. Things that do not move.
- **Cards get "glass-lite"**: translucency + a top edge highlight
  (`inset 0 1px 0 var(--glass-hi)`), never blur. A blur per card repaints an
  offscreen buffer for every card in the window on every scroll frame.
- Card definition comes from a quiet cool hairline (`--card-border`) and a soft
  lift, **never** a coloured border.

### Type

| Face | Token | Job |
|---|---|---|
| Fraunces | `--font-display` | Headings — names things |
| IBM Plex Sans | `--font-body` | Body |
| IBM Plex Mono | `--font-mono` | Identifiers, paths, types, counts, eyebrows |

Display and body must never be the same family — that is a placeholder, not a
pairing. Fraunces runs at `SOFT 60, WONK 1` and near-zero tracking: at display
sizes its `opsz` axis ramps thick/thin contrast and it starts reading as a
fashion Didone; softened, it reads like something set in a book.

**Anything the machine measured is set in mono** — prop counts, usage counts,
file paths, type signatures, rank/kind labels. That is the system's way of
saying "this is a measurement", and it is why the eyebrow utility (`.eyebrow`,
in `global.css`) is monospace.

### Space, radius, motion

- Spacing scale `--space-1 … --space-10`. **Deliberate rhythm, not uniform
  padding** — a card's inner padding, a section's gap and a page's gutter are
  three different decisions.
- Radius varies **by element role**: `--radius-chip` 6px · `--radius-input` 10px
  · `--radius-card` 16px · `--radius-pill`. Uniform radius everywhere is one of
  the listed template smells.
- Motion: `--dur-fast` / `--dur` / `--dur-slow` with `--ease`
  (`cubic-bezier(0.16, 1, 0.3, 1)`).
- **Animate compositor-friendly properties only** — `transform`, `opacity`,
  `clip-path`. Never `width`/`height`/`top`/`left`/`background-position` on
  anything that repeats. The thumbnail shimmer is a `translateX` sweep for
  exactly this reason.
- `prefers-reduced-motion` is honoured globally in `global.css`; any new
  keyframe animation must also be neutralised there or locally.

---

## One fact, one encoding

**A visual channel earns its place by carrying information no other channel is
already carrying.** If the text already says it, the colour must not repeat it;
if a chip already states it, a bar must not restate it.

The canonical statement of this rule lives in `ComponentCard.module.css`:

> There is no rank spine: the RankChip already states the rank in words, so a
> rail repeating it in colour is a second encoding of one fact — decoration
> wearing the costume of information.

### Banned patterns

These are banned in this codebase. Not discouraged — banned.

- **Coloured left-border "emphasis" rails.** A 2–3px stripe down the left edge of
  a callout, finding, note or warning. It is the most recognisable
  machine-generated UI tic there is, it restates something the text already says,
  and a list of them turns a panel into a ladder of stripes. Use the **aside
  surface** below instead.
  *Structural* left borders are fine and are a different thing: a panel's own
  edge against the page (`Inspector`, `KitPane`) and a divider between two
  segments of a segmented control.
- Severity or category encoded **only** by colour.
- A uniform grid of equal cards with no hierarchy.
- Uniform radius / spacing / shadow across every component.
- Library defaults shipped unmodified.
- A coloured 1px accent ring as the selected state — selection here is a **bloom
  of light** (`--glow-select`), because a saturated ring reads as loud against
  pale glass and light does not.

---

## Component idioms

Reach for the existing idiom before inventing one.

### Card (`ComponentCard`)

Glass-lite pane · cool hairline · soft lift on hover (`translateY(-3px)`) ·
selection is a periwinkle sheen falling from the top-left plus `--glow-select`.

**Every card is exactly the same height.** The gallery virtualizes by a measured
row pitch, so a card that grows with its content puts every row below it a few
pixels off, accumulating into visible drift. Concretely: the thumbnail frame is a
fixed height in *every* state (loading / loaded / fallback), and the name
reserves exactly two lines and clamps.

**Cards must be able to shrink.** `.wrap` and `.card` both set `min-width: 0`. A
grid item's automatic minimum size is its *min-content* size, and a card's
min-content is set by the un-wrappable file path — without opting out, the card
lays out wider than its own track and paints over its neighbour.

### Chip

`--radius-chip`, mono, uppercase, wide tracking. Chips **state** things:
`RankChip` says the rank in words, the a11y `impact` chip says the severity in
words. Because the chip says it, nothing else needs to.

### Role tag

The "what is this component FOR" facet (`action`, `form-control`, …), shown on
the gallery card's metadata line and in the inspector header. A quiet
accent-tinted tag: `color: var(--accent)` on `color-mix(accent 10%)` with a
`color-mix(accent 22%)` border, `--radius-chip`. It is a THIRD encoding channel
distinct from the two already on the card — the rank chip carries rank in its
own colour, the kind is faint mono text — so the three facets never restate one
another. Hidden entirely for the `other` catch-all (an "Other" tag is noise, not
a fact) via `roleLabel()`, which returns null there. On the card it shares the
one metadata line with the export type and never adds height — the virtualized
grid needs every card the same height whether or not it carries a role.

### Aside — caveat, limitation, heuristic note

The replacement for the banned rail. A recessed **plane**, so the whole surface
says "a different kind of statement lives here":

```css
padding: var(--space-2) var(--space-3);
border-radius: var(--radius-input);
background: var(--aside-bg);        /* neutral: a caveat that is merely quiet */
```

Toned variants only when the aside reports a real limitation:

| Situation | Background | Border |
|---|---|---|
| Quiet caveat, fine print | `--aside-bg` | none |
| Heuristic / degraded result | `--aside-bg-warn` | none, or `--aside-line-warn` |
| A control that cannot deliver | `--aside-bg-accent` | `--aside-line-accent` |

In use: `WhereUsed .caveat` · `VariantsMatrix .note` · `ScanIssues .notes` ·
`AccessibilitySection .disclosure` · `Customize .stateWarn` / `.presetWarn` ·
`KitPane .presetWarn`.

### Panel / drawer

Frosted (`--glass-bg-strong`, `--glass-blur`) with a `--glass-border` edge
against the page. The docked inspector and the kit/compare drawers.

### Empty & failure states

Never a bare message. An empty filter result says what to do next; a failed scan
shows the profile card with the diagnosis and a route out. A dead end is a design
bug.

---

## Floors that are not negotiable

**Accessibility**

- Interactive elements are real `<button>` / `<input>`; nested interactive
  elements are never used (this is why the basket toggle is a *sibling* of the
  card button, not a child).
- Focus is visible everywhere: `:focus-visible` outline in `--accent`.
- Keyboard additions (arrow navigation) are **additive** — every card stays an
  ordinary tab stop and focus is never trapped in the grid.
- Modals trap focus and restore it; the docked inspector hands focus back to the
  card that opened it.
- Decorative imagery is `aria-hidden`; a rendered thumbnail is decorative
  because the name/kind/path already identify the component.

**Performance**

- No `backdrop-filter` on anything that repeats or scrolls.
- No per-index entrance stagger in a virtualized list — a card at index N mounts
  and unmounts as it scrolls, so a staggered delay re-fades it every time.
- Long lists virtualize; that constraint feeds back into the card design above.

**Responsive**

- Multi-column at desktop, single column only when genuinely narrow, no
  horizontal overflow at 320 / 768 / 1024 / 1440. Enforced by
  `e2e/gallery-virtualization.spec.ts`.
- Below 1180px the inspector stops being a column and becomes a modal
  slide-over. It never silently vanishes while selection keeps working.

---

## Checklist

Before calling a surface done:

- [ ] Every value comes from a token.
- [ ] No coloured left-edge rail anywhere.
- [ ] Nothing states the same fact twice in two channels.
- [ ] Body text is ink; gem colours are dots, borders and tints only.
- [ ] Hover, focus-visible and active states all exist and were designed.
- [ ] Fixed-height rows if the list virtualizes.
- [ ] Motion is transform/opacity only, and reduced-motion is handled.
- [ ] No horizontal overflow at 320 / 768 / 1024 / 1440.
- [ ] The empty state and the failure state both offer a way forward.
