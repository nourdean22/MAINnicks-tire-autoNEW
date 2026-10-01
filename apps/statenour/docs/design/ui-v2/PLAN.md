# UI v2 · PLAN — what shipped, how it is proven, what is left

**Status (2026-10-01):** PR 1 of the cockpit wave is BUILT + TESTED on `statenour/ui-v2-cockpit`.
Not merged, not deployed. The operator merges on an explicit go-ahead.
Companions: [`README.md`](README.md) (audit · research · three directions · rubric),
[`SYSTEM.md`](SYSTEM.md) (the visual system), [`SURFACES.md`](SURFACES.md) (per-surface specs).

## 1 · The answer first

The app went from "dark dashboard with gold on everything" to a quiet instrument: warm near-black
work surfaces, Geist sentence-case titles, one gold signal per surface, translucent material only
on the rail and the composer, and an activity/receipt grammar in chat instead of debugger cards.
The difference is visible at a glance in `shots/` (section 6) on home, chat and missions at 390 and
1440. Nothing from #2864 was undone: the message list, composer contract, navigation-shell literals
and every pinned test still hold.

## 2 · Waves → what landed in this PR

| Wave | Scope | State |
|---|---|---|
| A · Foundation | tokens, base typography, effects prune, focus ring, `data-ui` lane | BUILT + TESTED |
| B · Shell | desktop spine, bottom tab bar, more-sheet, standard page, panel | BUILT + TESTED |
| C · Chat | island header, message list, composer, activity summary, tool receipt, quality bar, markdown map, memory inspector | BUILT + TESTED |
| D · Home | state line, lead, judgment queue, command line, morning-brief chip | BUILT + TESTED |
| E · Core workspaces | missions page actions/labels, mission card title, mission feed empty state, Nick side pane, particle canvas off | BUILT + TESTED (missions only) |
| E · remaining | journal, brain, people, stats, system pages, command palette, ticker | NOT STARTED — see §8 |

Shipping as one PR with staged commits is the operator's standing preference
("minimal PRs, the checks take forever", settled 2026-09-09).

## 3 · File-level plan (as shipped)

Styles (`app/styles/`)
- `tokens.css` — semantic roles (`--canvas … --surface-hover`, `--edge-*`, `--accent-*`, radius /
  shadow / motion / focus scales) with the legacy names (`--bg-*`, `--gold`, `--border-*`) aliased
  onto them; `@theme inline` registers every new role so the Tailwind utility exists; the
  `:root[data-ui="v1"]` block carries the old values. The severity `@theme` block is byte-identical.
- `base.css` — `h1,h2,h3` Geist sentence case; `.page-title`; `.eyebrow` / `.section-label` /
  `.vt-eyebrow` (the one caps role, mono 11px); `.vt-verdict` (Barlow, the one display role);
  `.ui-material`; `.notch`; `.glass-card` solid; `:focus-visible` ring; spine width 3.75rem at
  ≥1280; phone type floor block unchanged; `[data-neural-bg]` hidden outside the v1 lane.
- `effects.css` — 109 dead rule blocks and 31 dead keyframes removed (1939 → 1110 lines); white
  scrollbar; `.panel` flat; `.page-fade-in` off; `sparkline-draw` and `slideUpSheet` keyframes kept
  because two components reference them by NAME in inline style strings; the 40px gold glow on
  `.neural-glass-active` removed (its 1px gold edge stays — active is a signal).

Shell (`components/layout/`, `components/panel.tsx`)
- `desktop-spine.tsx` — 60px icon-led rail, labels in `aria-label` + `title`, active = raised step
  + one notch, `ui-material`. Literals the shell-contract test pins are unchanged.
- `bottom-tab-bar.tsx` — 52px tabs, Geist 11px labels, active = `text-fg` + 2px top bar.
- `more-sheet.tsx` — overlay surface tokens, `--radius-overlay`, `--shadow-l2`.
- `standard-page.tsx` — no page fade. `panel.tsx` — `--radius-surface`.

Chat (`features/chat-v2/components/`, `components/chat/`)
- `chat-island.tsx` — mono NICK wordmark, three 44px icon controls with `sr-only` labels, material
  jump button, canvas-coloured composer well.
- `chat-message-list.tsx` — 48rem reading column, user turn as a quiet interactive surface,
  assistant turn as plain prose with a NICK eyebrow, editorial empty state (rows + hover notch),
  tool-receipt footer, one pulsing "Working" line.
- `chat-composer.tsx` — `ui-material` well, 44px controls, gold only on the send button.
- `reasoning-trace-live.tsx` — Activity Summary (working line → "Worked Ns · N steps" → timeline →
  developer detail). Export name and props unchanged.
- `tool-result-card.tsx` — Tool Receipt (glyph is the only coloured pixel; raw JSON behind
  "Developer detail"). `UndoChip` and `isKnownToolName` unchanged.
- `quality-bar.tsx`, `nick-message.tsx` (markdown map), `memory-inspector-sidebar.tsx` — token
  re-colour, 11px floor, no gold on secondary text.

Home (`components/home/`)
- `brief-state-line.tsx` (notch before "Now"), `brief-lead.tsx` (edge rule + notch, gold CTA),
  `judgment-queue.tsx` (rose count), `nick-command-line.tsx` (neutral avatar + chips + morning-brief
  chip; gold kept on the prompt glyph, slash tokens, focus edge and the send button).

Core (`app/(mastery)/missions/page.tsx`, `components/missions/`, `components/mastery/`, `components/hud/`)
- missions page — sentence-case Geist secondary buttons (New mission / Focus / Filters / Back to
  the deck), active filter = raised surface not gold, mono 11px counts, status lines sentence case.
  The capture "+" stays the single gold primary.
- `mission-feed.tsx` — "Ask Nick for recommendations" neutral. `mission-card.tsx` — 17/18px title.
- `nick-side-pane.tsx` — the FAB is quiet material; pane header and 9px labels lifted to 11px.
- `neural-background.tsx` — no particle field outside the v1 lane (early return skips the rAF loop
  and the mousemove listener; CSS hides the canvas).

Lane + flags + lab
- `components/ui/ui-version-switch.tsx` (new) — `?ui=v1|v2` → cookie `statenour_ui` → reload.
- `app/layout.tsx` — async root layout reads the cookie, stamps `<html data-ui>`; `STATENOUR_UI=v1`
  env flips the default. `lib/feature-flags.ts` — `STATENOUR_UI` registered (read-only, canary).
- `app/(mastery)/system/ui-lab/page.tsx` — type scale, surfaces/edges/notch/buttons, activity
  summary (working + done) and tool receipts (running / complete / failed) as live fixtures.

Tests + docs
- `tests/repo/ui-v2-grammar.test.ts` (new, 7 tests) — pins the grammar; positive control: every
  assertion fails on `c8e3287c`.
- `tests/components/mobile-a11y.test.tsx` — header touch-floor regex retargeted to the new 44px
  literal (same floor, different class string).
- `docs/design/ui-v2/{README,SYSTEM,SURFACES,PLAN}.md`, `docs/DESIGN.md` pointer, `shots/`.

## 4 · Honest scope of the `?ui=v1` lane

The lane restores the OLD TOKENS AND TYPOGRAPHY (colours, surfaces, uppercase display headings,
gold shadows, particle canvas). It does NOT restore the component rewrites: the icon-led spine,
the activity summary, the tool receipt, the sentence-case buttons and the chat empty state render
the same under `v1`. So `?ui=v1` is a side-by-side for the *visual system*, not a full rollback.
Full rollback is `git revert` of this PR, which touches no schema, no API and no data.

## 5 · Test matrix and receipts (this checkout, 2026-10-01)

| Gate | Command | Receipt |
|---|---|---|
| Typecheck | `pnpm typecheck` | `tsc --noEmit` exit 0 · 1m27s |
| Lint | `pnpm lint` | exit 0 (pre-existing `any` warnings only, 0 errors) |
| Targeted vitest | 21 files that pin stylesheets, shell literals, chat a11y, home hydration, missions grouping, the new grammar test | `Test Files 21 passed (21) · Tests 138 passed (138)` · exit 0 |
| Anti-slop | `pnpm check:anti-slop` | exit 0 · no Inter / Roboto / Arial / purple gradient |
| Stale docs | `STALE_DOCS_STRICT=1 pnpm check:stale-docs` | 221 files · 0 critical · 0 warn |
| Contrast (measured on tokens) | primary 17.4:1 · secondary 9.1:1 · tertiary 4.6:1 on `--surface` | AA on every step |
| e2e (`chat-geometry-invariant`, `desktop-density`, `floating-collision`, `target-size`) | CI | NOT run locally — the hermetic runner needs Postgres this container lacks |
| `next build` | pre-push `build:affected` + CI | runs at push; see PR checks |

Rules the gates enforce that this diff had to respect: severity `@theme` verbatim, `state-aura-*`
rules present, phone type floor regex, navigation-shell literals, composer placeholder and
aria-labels, 44px targets.

## 6 · Before / after receipts (`shots/`)

Captured from the same hermetic dev server (`AUTH_FORCE_MOCK=1`, empty DB → skeleton states), Chromium,
service worker blocked. Before = working tree at `c8e3287c` (#2864); after = this branch.

| Surface | 390×844 | 1440×900 |
|---|---|---|
| Home | `before-home-390x844.png` → `after-home-390x844.png` | `before-home-1440x900.png` → `after-home-1440x900.png` |
| Chat (empty) | `before-chat-390x844.png` → `after-chat-390x844.png` | `before-chat-1440x900.png` → `after-chat-1440x900.png` |
| Missions | `before-missions-390x844.png` → `after-missions-390x844.png` | `before-missions-1440x900.png` → `after-missions-1440x900.png` |
| UI Lab (contract) | — | `after-ui-lab-1440x900.png` |
| Chat states (lab) | — | `after-chat-states-1440x900.png` |

"Can I see the difference?" — yes, without squinting: Geist sentence-case titles replace the
uppercase display wordmarks; the spine is icons + one notch; the particle field is gone; secondary
buttons are no longer gold outlines; the composer is a material well with one gold button.

Not captured: 430×932, 768×1024, 1280×800, 1728×1117 (brief §viewports). The layout is fluid
between the two captured extremes and the e2e `desktop-density` spec covers 1280/1440 in CI.

## 7 · Ratings (before → after, 1–10, by the rubric in README §4)

| Dimension | Before | After | Evidence |
|---|---|---|---|
| Attention hierarchy | 4 | 8 | one gold signal per surface; eyebrow / title / body / meta are four distinct sizes |
| Gold discipline | 3 | 8 | gold left on: active notch, primary buttons, focus edge, prompt glyph, N mark, status pills |
| Typography | 5 | 8 | Geist leads; Barlow only on `.vt-verdict`; no 9–10px text on touched surfaces |
| Material / depth | 4 | 8 | translucency on rail + composer only; content is solid; two shadow levels |
| Motion | 4 | 7 | three durations; one pulsing element (working); page fades off |
| Density / reading | 5 | 8 | 48rem chat column, 15–16px body, 44px controls |
| Accessibility | 6 | 8 | AA contrast on every step, visible focus ring, labelled icon controls |
| Consistency across app | 5 | 6 | journal / brain / people / stats / system not yet converted |

## 8 · Hostile review of this diff (found and either fixed or left on purpose)

Fixed before this PR
- Effects prune dropped `sparkline-draw` and `slideUpSheet` (referenced by NAME in inline styles,
  invisible to a class census) → restored, pinned by the grammar test.
- Grammar test asserted "no gold anywhere in effects.css" — wrong: gold borders on active / focus /
  doing states are sanctioned signals → assertion narrowed to scrollbar, glow and shadow tokens.
- Grammar test asserted the cookie literal in `layout.tsx`, which imports the constant → fixed.
- Dev-server OOM at a 6GB heap while compiling five routes is a tooling cost, not an app defect.

Left on purpose / known debts
- `?ui=v1` is partial (§4).
- Legacy token names (`border-edge`, `bg-raised`, `text-gold`) coexist with the new roles. They
  alias correctly; a rename sweep is a later, mechanical PR.
- `.vt-eyebrow` and the chat / side-pane "NICK" wordmark stay uppercase mono by design.
- Missions keeps a gold-ringed capture FAB on mobile in addition to the inline gold "+". Both are
  the same primary action; collapsing to one is a product call.
- The hermetic "TOOLS LIMITED · N DOWN" pill is amber status, not accent gold.
- Journal, brain, people, stats, system pages, the command palette and the ticker still render the
  old component grammar on top of the new tokens — they look better by inheritance, not by design.
- Research connectors (Parallel, Firecrawl) were unavailable during the wave; README §3 is marked
  CLAIM where it cites external guidance.

## 9 · Performance budget (brief §budgets)

Not measured in production. What changed in the direction of the budget: no particle canvas rAF
loop outside the v1 lane (was 60 particles × O(n²) connection pass per frame on desktop), 829 fewer
lines of CSS, no page-level fade, no layout change to the message list geometry (CLS unaffected).
LCP / INP / CLS get measured on the Railway deploy after merge; they are a REMAINING item.

## 10 · Next highest-leverage move

1. Merge on go-ahead → deploy → screenshot bdnick.info at 390 and 1440 → compare against `shots/`.
2. PR 2: command palette + ticker + journal / brain / people / stats / system pages onto the same
   grammar (the Panel / StandardPage primitives already carry the tokens, so this is mostly label
   and button casing plus removing gold-outline secondaries).
3. PR 3: delete the `[data-ui="v1"]` blocks, the cookie read and `UiVersionSwitch` once v2 is
   accepted; then the legacy token rename sweep.
