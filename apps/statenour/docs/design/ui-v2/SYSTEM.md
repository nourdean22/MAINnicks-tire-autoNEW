# BDNick Visual System 2.0 — Precision Material Cockpit

Deliverable D. The single source of truth for the *values* is `app/styles/tokens.css`; this file is the
rationale and the rules. When they disagree, the stylesheet wins and this file is stale.

## 1 · Governing rules

1. **Work is solid.** Content surfaces are opaque, warm near-black steps. No blur on anything that holds text you read.
2. **Controls can float.** Translucent material (`--control-glass` + blur) is for the desktop spine, the phone tab bar,
   the composer shell, the command palette, popovers, sheets and the inspector dock. Nothing else.
3. **Gold signals.** `#FDB913` means *selected · active · primary owner action · keyboard focus · milestone*. It is
   never a border by default, never a hover, never a scrollbar, never a heading colour, never `strong`.
4. **Motion explains.** Every animation names one of four semantics: enter/exit, selection, completion, state change.
   Nothing animates at rest except a *working* state. `prefers-reduced-motion` collapses everything to instant.
5. **Structure is felt.** Alignment, spacing, type scale, indentation and surface steps first; a hairline only when
   proximity cannot explain the grouping; a border only on an interactive or floating object.
6. **Unknown stays unknown.** No token, surface or animation may make an unmeasured state look healthy or empty.

## 2 · Colour — semantic roles

Legacy names stay as aliases (every one of the 6,339 utility call sites re-tints without an edit, the same
mechanism as the 2026-08-09 severity-tier block). New code uses the semantic role.

**Utility trap (found by the 2026-10-01 hostile review):** the Tailwind utility `bg-surface` is the LEGACY alias
of `--surface-interactive` (#1C1B17), not of the `--surface` role. The content-card role is reached with
`bg-content` (registered as `--color-content: var(--surface)`); `border-edge-default` is registered too. A
utility whose token is not in `@theme inline` emits zero CSS and fails silently — `tests/repo/ui-v2-grammar.test.ts`
now pins every utility the v2 components use.

| Role | Token | Value | Legacy alias it feeds |
|---|---|---|---|
| canvas (page) | `--canvas` | `#090907` | `--bg-void`, `--background` |
| workspace (main column) | `--workspace` | `#0D0D0A` | `--bg-base` |
| surface (content card) | `--surface` | `#121210` | `--bg-raised`, `--card`, `--popover` |
| surface raised (context) | `--surface-raised` | `#171714` | `--bg-elevated` |
| surface interactive (rows, user message) | `--surface-interactive` | `#1C1B17` | `--bg-surface` |
| surface hover | `--surface-hover` | `#22201B` | — |
| surface selected | `--surface-selected` | `color-mix(in oklab, var(--accent) 8%, var(--surface))` | — |
| overlay (sheet / dialog body) | `--overlay` | `#101010` | — |
| control glass | `--control-glass` | `rgba(16,16,13,.78)` + `--glass-blur: 18px` | `--glass-bg` |
| text primary | `--text-primary` | `#F2EFE8` | `--foreground` |
| text secondary | `--text-secondary` | `#B5AFA2` | — |
| text muted | `--text-tertiary` | `#8E887C` | `--muted-foreground` |
| edge subtle | `--edge-subtle` | `rgba(255,255,255,.055)` | `--glass-border` |
| edge default | `--edge-default` | `rgba(255,255,255,.085)` | `--border-default`, `--border` |
| edge strong | `--edge-strong` | `rgba(255,255,255,.14)` | `--border-hover` |
| accent | `--accent` | `#FDB913` | `--gold`, `--primary`, `--ring` |
| accent soft | `--accent-soft` | `rgba(253,185,19,.08)` | `--gold-ghost` |
| accent medium | `--accent-medium` | `rgba(253,185,19,.16)` | `--gold-glow` |
| accent hover / pressed | `--accent-hover` / `--accent-pressed` | `#FFC53D` / `#D49A0E` | `--gold-dim` |

Measured contrast (WCAG 2.x, this session): primary 17.4:1 on canvas, 14.2:1 on hover; secondary 9.1 → 7.5;
muted 5.7 → 4.6 (AA on every surface step); gold 11.5 → 9.4 as text, 11.4 as a fill with near-black text.
Status hues are unchanged: the equal-lightness rose/red/amber/emerald/sky tiers already in `tokens.css`.
Gold is not a health status.

Scrollbar thumb: `rgba(255,255,255,.14)`, hover `.24`. Selection: `--accent-medium` (selection *is* a
selected state — the one place ambient gold survives).

## 3 · Typography

| Role | Font | Size / line | Weight | Case |
|---|---|---|---|---|
| Page title (`.page-title`, `h1`) | Geist Sans | 28px / 1.1 → 32px md → 36px xl | 600 | sentence |
| Section title (`.section-title`, `h2`) | Geist Sans | 17px / 1.25 | 600 | sentence |
| Sub-head (`h3`) | Geist Sans | 15px / 1.3 | 600 | sentence |
| Eyebrow (`.eyebrow`, `.vt-eyebrow`, `.section-label`) | Geist Mono | 11px, tracking .12em | 500 | upper (the one surviving caps role) |
| The verdict (`.vt-verdict`) — **one per page** | Barlow Condensed | 30px → 40px md → 48px xl / 0.98 | 700 | upper |
| Big metric (`.stat-number`) | Barlow Condensed | contextual, tabular | 700 | — |
| Body / page copy | Geist Sans | 15px / 1.55 (16px / 1.6 in chat prose) | 400 | — |
| Controls | Geist Sans | 13–14px / 1.3 | 500 | sentence |
| Metadata (`font-mono`) | Geist Mono | 12px / 1.35 | 400–500 | — |
| Micro metadata | Geist Mono | 11px | 500 | — |

Type floor: `text-[9px]`/`text-[10px]` are lifted to 11/12px below `md` (the existing phone gate, unchanged)
and, under the v2 lane, to 11px at every width; `tracking-[0.16em|0.18em|0.2em]` settles at 0.12em. Both are
class-substring rules in `base.css` (1,526 + 162 call sites fixed by five lines; `?ui=v1` keeps the old density).
No element default is uppercase any more; uppercase is opt-in via the eyebrow and verdict roles. The `h1/h2/h3`
defaults live in `@layer base` so a size utility on a heading wins — unlayered, they silently beat every utility.

## 4 · Radius

| Token | px | Object |
|---|---|---|
| `--radius-micro` | 4 | tags, status chips, kbd |
| `--radius-control` | 7 | buttons, inputs, list rows |
| `--radius-surface` | 10 | cards, panels, user message |
| `--radius-float` | 14 | popovers, tool receipts that float, sheets' top edge |
| `--radius-overlay` | 18 | composer shell, command palette, dialogs |
| `9999` | — | pills only |

`rounded-xl` / `rounded-2xl` by instinct is retired in the files this wave touches.

## 5 · Elevation

| Level | Token | Use |
|---|---|---|
| L0 | none | content surfaces |
| L1 | `--shadow-l1: 0 1px 0 rgba(255,255,255,.03), 0 10px 28px rgba(0,0,0,.22)` | raised context (inspector dock, menus) |
| L2 | `--shadow-l2: 0 24px 80px rgba(0,0,0,.5), 0 1px 0 rgba(255,255,255,.05)` | floating controls (palette, composer when focused, sheets) |

`--shadow-gold-*` aliases now resolve to L1/L2 (no gold in any shadow). `shadow-2xl` on the composer is gone.

## 6 · Motion

| Token | Value | Semantics |
|---|---|---|
| `--motion-micro` | 120ms | press, toggle, copy |
| `--motion-state` | 180ms | hover/active/selected colour, chevrons |
| `--motion-panel` | 240ms | sheet / dock / palette enter-exit |
| `--ease-standard` | `cubic-bezier(.2,0,0,1)` | all of the above |
| `--ease-exit` | `cubic-bezier(.4,0,1,1)` | exits |

Compositor-only (transform, opacity). The universal `page-fade-in` on `StandardPage` is removed; `.page-enter`
on the layout stays as the single route entrance. The element-level `button, a, input` transition in
`effects.css` sits in `@layer base`, so a component's own `transition-* duration-[var(--motion-state)]`
utilities apply (unlayered, the old rule reset every button to transform/opacity and colours snapped). `pulse-live` animates only while a state is *working*.
`prefers-reduced-motion`: durations 0, the view-transition keyframes already pinned in `effects.css`.

## 7 · Focus

`--focus-ring: 0 0 0 2px var(--canvas), 0 0 0 4px var(--accent)` applied through `:focus-visible` on every
interactive element by `base.css`. Two rings so it survives on void, raised, glass and on a gold fill. It is a
`box-shadow`, so Tailwind's `outline-none` cannot suppress it and no `!important` is needed; the ring follows the
element's own radius. The v10.0.526 `!important` gold outline + glow in `effects.css`, which silently overrode this
ring in the first pass, is deleted.

## 8 · Icons

Lucide, 1.75 stroke at rest, 2.25 when active, sizes 14 (inline), 16 (controls), 18 (spine/tab). An icon
needs a job: the chat header, tool receipts and the spine keep theirs; decorative icons beside every label
are removed where this wave touches.

## 9 · Status grammar

| State | Hue | Motion |
|---|---|---|
| healthy | emerald-300 text / emerald-400 dot | none |
| working | amber-300 / amber-400 | `pulse-live` (the only pulsing state) |
| attention | amber | none |
| blocked / failed | rose | none |
| unknown | muted, with the word "unknown" | none |
| offline | muted + strike/offline word | none |

Never colour alone; every state carries its word or glyph (`✓ ◌ ! × ?`).

## 10 · Density

Page density is a *page* decision, carried by `StandardPage rhythm` (compact / comfortable / loose / workspace):
Chat relaxed reading · Missions dense operation · Stats analytical · Brain exploratory · System diagnostic ·
Home selective. A user-facing density preference is deferred until the default has been used for a week.

## 11 · Material

```css
.ui-material            /* spine, tab bar, composer shell, palette, popovers, inspector dock */
  background: var(--control-glass);
  backdrop-filter: blur(var(--glass-blur)) saturate(115%);
  border-color: var(--edge-default);
```

Nothing that is read gets `backdrop-filter`. `.glass-card` is kept as a name for its 47 adopters but renders as
a solid `--surface` card with an `--edge-subtle` border. `.neural-glass` (GlassCard, 43 importers) is the same
solid card since the second pass: no gradient, no gold edge, no gold top line, no gold hover glow; `-active`
keeps its 1px gold edge and `-critical` its red one. `.neural-glass-modal` (Dialog) is a solid `--overlay` step
with the L2 shadow. The skeleton shimmer, `[data-card]` hover and `.glow-on-hover` are neutral; the CRT scan-line
overlay and the chart drop-shadow glow are gone.

## 12 · The motif — the signal notch

One calibrated gold segment (`.notch`, 2px × 12–16px, radius 9999) marks *the selected route, the NOW
section, the active mission, the focused inspector object*. It is the only gold that appears without the
operator acting. It never glows and never animates.

## 13 · Anti-slop hard rules (added to the DESIGN.md checklist)

NO decorative purple · NO glass on content · NO orb · NO grid/particle background · NO gold generic hover ·
NO permanent glow · NO uppercase element defaults · NO border where spacing explains the group · NO animation
without one of the four semantics · NO pulse unless working · NO raw JSON by default · NO assistant bubble ·
NO tile because a number exists · NO gradient hero · NO new primitive where an existing one can be evolved.
