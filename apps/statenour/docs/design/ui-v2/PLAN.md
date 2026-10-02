# UI v2 · PLAN — what shipped, how it is proven, what is left

**Status (2026-10-01 23:45Z):** PR 1 of the cockpit wave is LIVE + PROVEN. #2871 squash-merged as `18bf9ebc`,
Railway statenour-web `754fae93` SUCCESS, the served stylesheet carries the v2 tokens and none of the removed
rules, and `?ui=v1` stamps `data-ui="v1"` on production (verified with curl).
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
- `effects.css` — 79 dead class selectors and 36 dead keyframes removed across two passes
  (1939 → 947 lines, `wc -l`); white scrollbar; `.panel` flat; `.page-fade-in` off; `sparkline-draw` and `slideUpSheet` keyframes kept
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
- `tests/repo/ui-v2-grammar.test.ts` (new, 7 tests) — pins the grammar; positive control run
  against the `c8e3287c` files: 6 of 7 blocks fail there. The keyframe block passes on both
  grammars by design (a prune-regression guard, not a grammar detector).
- `tests/components/mobile-a11y.test.tsx` — header touch-floor regex retargeted to the new 44px
  literal (same floor, different class string).
- `docs/design/ui-v2/{README,SYSTEM,SURFACES,PLAN}.md`, `docs/DESIGN.md` pointer, `shots/`.

## 4 · Honest scope of the `?ui=v1` lane (historical — deleted in PR 3, §13)

The lane restores the OLD TOKENS AND TYPOGRAPHY: the five surface steps, three text levels, three edges,
glass, the three shadows, the shadcn bridge values (card / popover / muted / secondary / border / input /
ring / gold-glow — widened in the second pass), the display fonts and uppercase headings, the two size
scales, body letter-spacing, the eyebrow tracking and the 72px spine. It also re-enables the particle
canvas and keeps the old 9/10px density.

It does NOT restore: `--accent` (v2 components read it as the gold signal and would render black), anything
in `effects.css` (the pruned classes, the white scrollbar, the solid `.neural-glass`), or the component
rewrites (icon-led spine, activity summary, tool receipt, sentence-case buttons, chat empty state), which
render the same under `v1`. So `?ui=v1` is a side-by-side for the *colour and type system*, not a rollback.
Full rollback is `git revert` of this PR, which touches no schema, no API and no data.

## 5 · Test matrix and receipts (this checkout, 2026-10-01)

| Gate | Command | Receipt |
|---|---|---|
| Typecheck | `pnpm typecheck` | `tsc --noEmit` exit 0 · 1m27s |
| Lint | `pnpm lint` | exit 0 (pre-existing `any` warnings only, 0 errors) |
| Targeted vitest | 22 files that pin stylesheets, shell literals, chat a11y, home hydration, missions grouping, the grammar test and the lane resolver | `Test Files 22 passed (22) · Tests 146 passed (146)` · exit 0 (second pass) |
| Anti-slop | `pnpm check:anti-slop` | exit 0 · no Inter / Roboto / Arial / purple gradient |
| Stale docs | `STALE_DOCS_STRICT=1 pnpm check:stale-docs` | 221 files · 0 critical · 0 warn |
| Contrast (computed from the v2 tokens, WCAG 2.x) | primary 14.2–17.4:1 · secondary 7.5–9.1:1 · tertiary 4.6–5.7:1 across all seven surface steps (lowest on `--surface-hover`) · inverse text on accent 11.4:1 | AA on every step, AAA for primary and secondary |
| e2e (`chat-geometry-invariant`, `desktop-density`, `floating-collision`, `target-size`) | CI | NOT run locally — the hermetic runner needs Postgres this container lacks |
| `next build` | run locally (second pass) + CI | exit 0, full route table, `BUILD_ID` written |

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
loop outside the v1 lane (was 60 particles × O(n²) connection pass per frame on desktop), 795 fewer
lines across the three stylesheets (2574 → 1779, `wc -l`), no page-level fade, no layout change to the message list geometry (CLS unaffected).
LCP / INP / CLS get measured on the Railway deploy after merge; they are a REMAINING item.

## 10 · Next highest-leverage move

1. Merge on go-ahead → deploy → screenshot bdnick.info at 390 and 1440 → compare against `shots/`.
2. PR 2: command palette + ticker + journal / brain / people / stats / system pages onto the same
   grammar (the Panel / StandardPage primitives already carry the tokens, so this is mostly label
   and button casing plus removing gold-outline secondaries).
3. PR 3: delete the `[data-ui="v1"]` blocks, the cookie read and `UiVersionSwitch` once v2 is
   accepted; then the legacy token rename sweep.

## 11 · Second pass (2026-10-01) — hostile review of the first push, and what it changed

Three independent read-only reviewers were run over `49592699` (stylesheets + utilities · component behaviour
and a11y · docs-versus-code). The stylesheet reviewer compiled the committed `tokens.css` with the repo's
Tailwind 4.3 and found seven P1 defects the screenshots had not made obvious to me. All fixed on the branch:

| # | Defect in `49592699` | Fix |
|---|---|---|
| 1 | `border-edge-default` had no `--color-edge-default` in `@theme` → zero CSS at 20 call sites; the border painted in the text colour | registered; grammar test pins every utility the v2 components use |
| 2 | `h1/h2/h3` defaults were unlayered, so `text-[26px]` / `font-mono text-[13px]` on headings never applied (the chat "NICK" rendered 28px Geist Sans) | defaults moved into `@layer base`; test asserts it |
| 3 | `effects.css` kept the v10.0.526 `:focus-visible { outline: gold !important; box-shadow: gold-glow !important }`, so the v2 focus ring never rendered | deleted; the `box-shadow` ring survives `outline-none` without `!important` |
| 4 | the v2 focus rule set `border-radius`, snapping pills to 7px on Tab | line removed |
| 5 | unlayered `button, a, input` transitions reset every `transition-colors duration-[…]` utility | moved into `@layer base` |
| 6 | `bg-surface` is the legacy alias of `--surface-interactive`, so cards and user bubbles were the same colour | `bg-content` registered for the `--surface` role; receipt, diagnostic, error and tool-output cards use it |
| 7 | the prune dropped `.animate-fade-in-scale` with six live consumers | restored; pinned by the grammar test |

Also from that review: `.neural-glass` (GlassCard, 43 importers) and `.neural-glass-modal` (Dialog) still carried
the gradient, gold edge, gold top line and gold hover glow that SYSTEM.md §11 claimed were gone → now solid
surface / overlay steps. Ambient gold left behind (skeleton shimmer, `[data-card]` hover, `.glow-on-hover`, the
chart drop-shadow glow, the CRT scan-line overlay on `<body>`) → neutral or removed. Dead CSS the first prune
missed (`goldFlash`, `unload-pulse`, `revenue-pulse`, `float`, `nick-cursor-shimmer`, `page-fade-in`, the shadowed
`breath`, the `[data-anchor]` cascade with no emitter, `.command-input` with no consumer, the `.no-scrollbar`
duplicate of shadcn's utility, the ≤640px form-control duplicate) → removed. Native `<select>` palette → warm.
Firefox gets the thin scrollbar via `scrollbar-color`. The PWA `themeColor` / `background_color` match `--canvas`.
Raw arbitrary-value radius and shadow classes (the bracketed var() spelling, 56 sites) → the registered
`rounded-micro|control|surface|float|overlay` / `shadow-l1|l2`
utilities the token file asks for. The v1 lane now also restores the shadcn bridge values, body letter-spacing,
eyebrow tracking and the 72px spine (§4 says what it still does not restore).

Going beyond the review: the type floor and tracking cap now apply at every width under the v2 lane (§3 of
SYSTEM.md) — 1,526 sub-11px labels and 162 over-tracked eyebrows across journal, brain, people, stats and system
fixed by five CSS lines, reversible with `?ui=v1`.

**Tailwind scans the docs.** The first version of this very section spelled the retired classes with a literal
wildcard inside the brackets; Tailwind v4's automatic source detection reads every non-ignored file (Markdown
included), minted that as a utility, emitted `var(--radius-*)`, and the e2e run on `fceb606b` 500'd every page with
`Parsing CSS source code failed`. A grammar-test canary now refuses any bracketed var() class whose argument is not a real custom property in
any scanned file — the first fix swapped the asterisk for an ellipsis and Tailwind minted that too (`20eaaefa`).

Measured after the second pass (`wc -l`): `effects.css` 1939 → 947, `base.css` 351 → 366, `tokens.css` 284 → 333;
the three together 2574 → 1646 (928 fewer lines). Gates on this tree: `tsc --noEmit` exit 0 · eslint 0 errors ·
22 targeted test files, 146 tests, exit 0 · anti-slop 0 · stale-docs strict 222 files 0 critical · `next build`
exit 0 with the full route table (run locally, 2026-10-01).

**The comparison lane never worked in the first push.** `curl -H 'Cookie: statenour_ui=v1' /missions` returned
`data-ui="v2"`. Cause: `app/layout.tsx` imported `UI_VERSION_COOKIE` from the `"use client"` switch component,
so on the server it received a client *reference*, not the string, and `cookies().get()` silently missed. The
constant and the resolution logic now live in `lib/ui-version.ts` (plain module), `tests/lib/ui-version.test.ts`
pins both, and the same curl now returns `data-ui="v1"`. The CI e2e suite was green throughout because nothing
exercised the lane — a reminder that "CI green" is not "feature works".

Second-pass receipts in `shots/`: `after2-*` (v2 after the cascade repairs: the chat wordmark is 13px mono and
the empty-state title 26px, the composer edge is the hairline, receipts sit on `--surface`), `pre-sliceA-*` →
`post-sliceA-*` (brain / system / stats at 1440 before and after the desktop type floor), and `post-sliceA-journal`
/ `post-sliceA-people` (surfaces that still carry the old component grammar on the new tokens).

## 12 · PR 2 (2026-10-02) — every remaining surface

Branch `statenour/ui-v2-surfaces`, one PR, one squash merge, per the operator's "as few commits and merges as
possible". The first push converted journal · brain · people · stats · system · palette · ticker (five scoped
agents + page-tabs, home-brain-graph, page-nick). The operator pointed out that was not all slices; a strict
census agreed: ~1,990 legacy hits across 217 files remained, including chat and missions, which PR 1 had only
partly converted. Eight more scoped agents covered chat + layout + hud + home · missions + goals · actions +
operator + inspector + workset · ultron + power-atlas · settings + relationships + content + intelligence + 3d ·
mastery + `components/ui` · the remaining route pages, and one hostile reviewer read the first push. Result:
`git diff --stat 218e335c` 285 files, +4,969 / −4,747; census 0 unsanctioned.

**What each surface keeps as gold:** the one primary (journal "log reflection", people "Add person", stats "Log
Entry", /brain "Ask the brain", missions Start / Resume (Complete task in execution mode), actions / inbox
"Approve", camera "Simulate", photo-improver "Run", decisions "grade decision", pins "Pin", links "Create link",
outreach "Propose for approval", sign-in "Continue with Google", chat composer send, home command-line send,
dialog owner actions), `border-accent` / `bg-accent-soft` on selected tabs / chips / rows, the focus ring, the
notch (selected palette row, ticker sheet active row, inspector eyebrow, missions NOW section), the chart
`activeDot`, the NEW-node arc on the brain canvas, slider thumbs. Status hues and categorical hues untouched.

**Not class-only, disclosed:** palette tree (`CommandDialog` → `Dialog` + unstyled `DialogContent` + owned
`CommandPrimitive` root); ticker `live` flag + one `pulse-live` dot (an addition — the strip had no indicator
before); people's "Add person" `<Button>` → `<button>`; at-rest pulses and emoji-in-labels removed; ~75 control
labels in ~35 files sentence-cased; a case-sensitive grep of tests/ found no UI pin on any of them (the hits are
enum/action strings such as `action: "cancel"`).

**Found, not planned:** (1) the ⌘K Resolver throws on open at `218e335c` — FACT by positive control in
`tests/components/command-palette-cmdk-root.test.tsx`; "broken in production since" is an inference (shallow
clone, no Sentry receipt pulled). (2) Ten dead custom properties (`--bg-overlay`, `--bg-secondary`, `--text-muted`,
`--border-soft`, `--bg-card`, `--bg-primary`, `--border-focus`, `--bg-default`, `--brand`, `--success`) were
painting inputs, panels and chips transparent behind valid-looking class names; the grammar test now asserts every
custom property a `.tsx` reads is defined, with a planted positive control. (3) The hostile reviewer's findings on
the first push — emptied class on the open log row, text token used as chip fill (~3:1), invisible toggle track,
double `min-h`, gold palette input prefix, `.ui-material` on the ticker (now sanctioned in SYSTEM.md §1.2 as
bottom chrome), SYSTEM.md's overclaim about what the grammar test pins, "97 files", the ticker "fix" that was an
addition — all corrected. (4) `Metric` lost `tabular-nums` under one agent; a sibling's test caught it.

**Receipts (re-run after the second hostile review's fixes):** `tsc --noEmit` 0 · eslint 0 errors (210 changed files) · vitest 393 files / 5,067 passed, exit 0 ·
anti-slop 0 · stale-docs strict 0 · parity OK · `next build` (cleared cache) exit 0 (full route table, 111 s compile).

**Flagged for PR 3:** delete the `?ui=v1` lane (`lib/ui-version.ts`, the switch component, the v1 token block,
the `data-ui` gates in `base.css`), delete the unconsumed `Command` / `CommandDialog` / `CommandItem` /
`CommandShortcut` wrappers in `components/ui/command.tsx`, migrate the last `components/ui/card.tsx` importers
(stats) to `GlassCard`, lift the 24px inline edit buttons in brain's beliefs / contradiction / identity panels to
the 44px floor, redesign (not substitute) the realtime voice orb, sweep `rounded-md` / bare `rounded` / `slate-*`
on lines no agent touched, and capture after-screenshots on a machine with headroom for the dev server.

## 13 · PR 3 (2026-10-02) — the lane and the dead wrappers come out

Branch `statenour/ui-v2-delete-v1-lane`, one commit, one squash merge. Deleted: `lib/ui-version.ts` and its
test, `components/ui/ui-version-switch.tsx`, the cookie read + `data-ui` stamp + `<UiVersionSwitch />` in
`app/layout.tsx`, the `:root[data-ui="v1"]` colour block in `tokens.css` (36 lines) and typography block in
`base.css` (14 lines), the `:root:not([data-ui="v1"])` gate on the type floor (now unconditional), the
`STATENOUR_UI` flag-registry entry, and the particle canvas (`components/hud/neural-background.tsx` + its mount
in the mastery layout): with the lane gone its only remaining job was to mount a hidden canvas and return. In
`components/ui/command.tsx` the `Command`, `CommandDialog`, `CommandItem` and `CommandShortcut` wrappers (and
their Dialog / lucide imports) are gone; the Resolver owns its `CommandPrimitive` root and `PaletteRow`, and
the five primitives it still uses (`CommandInput/List/Empty/Group/Separator`) stay.

The grammar test's lane assertion flipped from "the lane exists" to "the lane is gone" (positive control: on
`1dfcfa2c` tokens.css has 2 `data-ui` hits, base.css 20, the layout imports the switch), the type-floor
assertion lost its `:root:not(...)` prefix, and the dead-custom-property gate no longer needs to strip the lane.
Rollback is `git revert`; nothing else restores the old grammar now.

**Receipts:** `tsc --noEmit` 0 · eslint 0 errors · vitest 38 files / 354 passed (every test referencing a
touched file + the grammar, nav-shell, anti-slop, mount-graph, palette-root contracts) · anti-slop 0 ·
stale-docs strict 0 · parity OK · `next build` (cleared cache) exit 0 (full route table).

**Still flagged (not this PR):** migrate the last `components/ui/card.tsx` importers (stats) to `GlassCard`,
lift the 24px inline edit buttons in brain's beliefs / contradiction / identity panels to 44px, redesign the
realtime voice orb, sweep `rounded-md` / bare `rounded` / `slate-*` on untouched lines, after-screenshots.

## 14 · PR 4 (2026-10-02) — the rest of the backlog

Branch `statenour/ui-v2-backlog`, four commits (the third corrects one receipt sentence, the fourth reverts seven mid-sentence capitalisations), one squash merge. Everything §13 left flagged, plus two things
found on the way.

- **`components/ui/card.tsx` deleted.** Its two importers (`components/stats/calibration-section.tsx`,
  `body-section.tsx`) now use `GlassCard` with plain `div` / `h3` / `p` slots. Doing that exposed a cascade
  trap: `.neural-glass` was unlayered, so every utility a caller passed (`border-l-[3px] border-l-sky-500/40`,
  `bg-rose-500/5` on an error card, `hover:bg-surface-hover`) was silently beaten by the class defaults at
  eight GlassCard call sites. `.neural-glass*` and `.ui-material` now sit in `@layer components`.
- **`cn` knows the v2 scales.** `lib/utils.ts` builds `cn` with `extendTailwindMerge` so `rounded-micro |
  control | surface | float | overlay` and `shadow-l1 | l2` merge last-wins (both PR 2 reviewers flagged the
  footgun). `tests/lib/cn-v2-tokens.test.ts` carries the positive control: the stock merger keeps
  `rounded-control rounded-full` as two classes.
- **Brain inline edit buttons** (beliefs / contradiction / identity panels): `h-6` → `min-h-11` on touch,
  `sm:min-h-6` from the tablet breakpoint so the dense desktop rows keep their height.
- **Voice overlay:** the gradient orb with `animate-ping` is gone (§13 "NO orb"). A solid `bg-surface-raised`
  disc carries the state as an edge hue + glyph (rose listening, amber Nick speaking, rose error); the only
  motion is one `pulse-live` ring while a voice is working. The serif status line became Geist 17/20px.
- **Radius + raw-neutral sweep** across `app/` and `components/` (not comments, not tests): `rounded-md` →
  `rounded-control`, `rounded-sm` → `rounded-micro`, `rounded-lg` → `rounded-control` on controls else
  `rounded-surface`, bare `rounded` → `rounded-control` on controls else `rounded-micro`, every `slate-*` →
  fg / edge / surface tokens. Control vs. surface was decided by the element (button / a / input / role) or a
  control-height class in the same string; skeletons are surfaces, ≤16px squares are micro.
- **`features/chat-v2` converted** (14 files): the conversation drawer, typed tool cards and media dock /
  focus / provenance had been outside every earlier scope and still carried ~75 legacy hits incl. gold fills.
- **After-screenshots** captured on the hermetic dev server (12 GB heap, two server lives of four routes each): `shots/after4-{home,chat,missions,brain,journal,people,stats,system}-{1440x900,390x844}.png`, 16 files. Brain exposed the last uppercase data labels on the graph lens chips; sentence-cased in the same commit.

**Receipts:** `tsc --noEmit` exit 0 · eslint 0 errors on the 130 changed TS/TSX files · vitest 136 files / 1,587 passed, exit 0 (every test referencing a changed file + grammar, nav-shell, anti-slop, mobile-a11y, mount-graph, palette-root, modal contracts) · `tests/lib/cn-v2-tokens.test.ts` 4/4 with the stock-merger positive control · anti-slop 0 · stale-docs strict 0 · parity 142/0 · `next build` with `.next/cache` cleared exit 0 (full route table). Hostile review of the orchestrator diff found and this commit fixes: every styled Dialog about to paint a gold hairline + 40px glow once `.neural-glass-modal` was layered (the class carries the look now), 23 GlassCard call sites whose dead `p-*` would have started painting (stripped: one card, one padding), six inputs/textareas on the wrong radius tier, `critical-glow` still animating behind a "no glow" comment (removed with its keyframe), a 20px `+` button left off the floor, a 7px radius on a 400px image, chip/panel tier drift, one `slate-400` leftover, lost card rhythm. Code diff 139 files, +708 / −660 before the 16 screenshots; one commit.

**Second commit — self-audit of the first (same PR).** Re-reading the diff and the 16 shots as a hostile reviewer found four things.
(1) The journal and brain shots still showed lowercase 11px mono control labels, so a brace-aware label scanner sentence-cased the
first text node of every `button` / `Link` / `a` and every `{cond ? "a" : "b"}` label: 243 labels in 90 files, 33 strings skipped
because a test pins them. It also caught two non-labels (`"Text-fg-secondary"`, `"CurrentColor"`), both reverted; `alert-inspector`
moved to sentence case together with its test pins; the seven mixed-case ternaries the scanner could not reach were fixed by hand
(`Pinned` / `Done` / `Create` / `Edit` / `Accept` / `Tie` / `Passed` + `Flagged for regen`). A second scan of the
diff found seven count/unit text nodes that follow an expression and had been capitalised mid-sentence (`3 Claims`, `12D`,
`3 More in the approval queue`); reverted, with the two leading hide/show ternaries capitalised instead. (2) Five row and icon buttons the radius
sweep had tiered `rounded-micro` because its lookback stopped short of the element (`recurring-enemies-card`, `compound-chain`,
`nick-reasoner`, `contradictions-card`, `decision-replay-card`) → `rounded-control`. (3) The voice overlay still carried legacy
aliases (`bg-canvas/95`, `text-fg*` variants) → canonical tokens. (4) The dead-custom-property gate only read `app/` and
`components/`; it now reads `features/`, `hooks/` and `lib/` too. Accepted and recorded, not changed: ~60 11px `font-mono`
micro-controls inside dense data panels stay mono — they are readouts, not labels.
**Receipts, second commit:** `tsc --noEmit` exit 0 · eslint 0 errors / 49 pre-existing warnings on the 95 changed TS/TSX files ·
vitest 142 files / 1,639 passed, exit 0 (same referencing-test rule, plus grammar, nav-shell, alert-inspector and cn-token contracts) ·
anti-slop 0 · stale-docs strict 0 (222 files) · parity 142/0. Cleared-cache `next build` on this
commit: compiled in 72 s, 210 static pages, full route table, exit 0. No git hooks are installed in the cloud container, so
lefthook's pre-push build never ran on these pushes; every gate above was run by hand and CI's turbo-affected verify is the
remote build gate.

**Open:** the `.glass-card` legacy class in base.css still carries `!important` on its state variants (47
adopters, not touched); tailwind-merge now merges radius/shadow but a consumer that passes `bg-*` to
`GlassCard` relies on the new layering, not on merging.
