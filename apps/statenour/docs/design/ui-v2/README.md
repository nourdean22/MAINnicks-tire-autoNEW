# BDNick UI v2 — Precision Material Cockpit

**Status:** design + foundation + first visible slices, 2026-10-01. Branch `statenour/ui-v2-cockpit`.
**Baseline it replaces:** production `c8e3287c` (#2864, "converge and harden operator UI") — structure
converged, visual grammar unchanged. The operator's verdict on it, verbatim: "it looks the same."
**Verdict of this document in one line:** StateNour's backend, operator model, Home brief contract,
tool registry, inspector and chat runtime are assets (8–9/10). The rendered grammar is the debt:
condensed-uppercase-first type, ambient gold, glass-on-content, an effects sheet that is 68% dead code,
and a chat that renders Nick in a bordered bubble with a debugger for reasoning. This wave attacks the
rendered grammar only.

Files in this folder:

| File | Deliverable (brief §142–153) |
|---|---|
| `README.md` (this) | A · current visual audit (code-grounded + rendered) · B · research book · C · three directions + rubric |
| `SYSTEM.md` | D · visual system 2.0 (tokens, type, radius, elevation, motion, icon, focus, status, density) |
| `SURFACES.md` | E · chat spec · F · home spec · G · core surfaces · H · component disposition |
| `PLAN.md` | I · file-level plan · J · what shipped in this wave · K · test matrix · L · before/after receipts · ratings + hostile review |

Everything below is stated with its evidence class: **FACT** (read from the repo or measured here),
**CLAIM** (from the operator's research brief or recalled, not re-fetched this session — the research
connectors were rate-limited / out of credits on 2026-10-01), **DECISION** (ours).

---

## A · Current visual audit (what the pixels are made of)

### A1 · Where the "industrial dashboard" feeling comes from — ranked by visual impact

| # | Finding | Evidence (FACT) | Impact |
|---|---|---|---|
| 1 | **Every page title is a 56–72px uppercase Barlow Condensed masthead.** `h1/h2/h3` are Barlow uppercase by element default; `.page-title` scales to 4.5rem at ≥1280px; `.vt-verdict` to 4.25rem. Mission titles are 22–24px uppercase Barlow. | `app/styles/base.css` lines 24–28, 247–262; `components/missions/mission-card.tsx:281` | The whole OS reads as a themed poster, not a tool. |
| 2 | **Gold is ambient, not precious.** Gold scrollbar thumb, gold text selection, gold `::before` gradient line on every `.panel` (209 files), gold hover border on every `.glass-card` (47 files), gold `strong`/`h1`/`h2`/table headers inside every Nick reply, gold `text-gold` on every active nav item plus a gold bar. | `effects.css:69–75, 842–867`; `base.css:33–38`; `components/chat/nick-message.tsx:204–210, 338`; spine + tab bar | The one brand colour means nothing because it is everywhere. |
| 3 | **Tiny uppercase mono labels carry the hierarchy.** 256 files use `uppercase tracking-…`; nav labels, chat header buttons, quality bar (9px mono), tool receipts (11px display uppercase 0.18em), inspector eyebrows. | grep census; `features/chat-v2/components/chat-island.tsx:295–302`; `components/chat/quality-bar.tsx:97` | "Developer dashboard" energy; fatiguing at phone size (the phone floor rule exists *because* of this). |
| 4 | **Chat is a chatbot.** Nick's reply sits in a `border border-glass bg-raised/85 rounded-2xl` bubble; reasoning is a zinc debugger card ("Deep Reasoning in progress…", raw JSON detail); tool results are left-bordered colour-coded cards with a raw-JSON expander; the composer is `rounded-2xl` + `shadow-2xl` + gold focus ring with two permanently visible square buttons. | `chat-message-list.tsx:455`; `reasoning-trace-live.tsx`; `tool-result-card.tsx:139–160`; `chat-composer.tsx` | The highest-craft surface looks like every AI app, then worse. |
| 5 | **Effects sheet is 68% dead.** 111 class selectors in `effects.css`; 76 are referenced by zero `.ts/.tsx` files (neon-*, hud-*, nick-orb-*, nick-ring-*, particle-burst, glitch-text, data-stream, float-particle, btn-gold*, log-entry*, …). Of the 76, only `state-aura-*` (built via template string in `ambient-aura.tsx`) and the `recharts-*` library selectors are legitimately live. | census script, this session | 1,939 lines nobody can reason about; every "glow" the operator sees came from here. |
| 6 | **Three shell chromes stack at the bottom on phones:** pulse ticker + tab bar + (on chat) composer. The ticker is a permanent 32px strip of ambient brain signal. | `bottom-tab-bar.tsx`, `ultron/bottom-pulse-ticker.tsx` | Silence carries no information because nothing is ever silent. |
| 7 | **Motion without origin.** `page-fade-in` (280ms translate-fade) on every `StandardPage` mount plus `.page-enter` on the layout; `pulse-live` dots; `chat-tool-shimmer`. | `standard-page.tsx:151`, `(mastery)/layout.tsx`, `effects.css` | Navigation feels like a slideshow; status feels urgent when it is idle. |
| 8 | **Surfaces are containers inside containers.** Desktop spine `border-r`, page header `border-b`, panel border + gradient, card border, inner `rounded-lg border` rows. | spine, `page-header.tsx`, `panel.tsx`, `typed-tool-cards.tsx` | Structure is outlined, not felt. |
| 9 | **Two `PageHeader` components exist** (`components/layout/page-header.tsx`, unused by StandardPage; `components/layout/ui.tsx`, used). | FACT | Drift door. |
| 10 | **Desktop spine is 72px with 11px uppercase mono labels** under each icon, gold active text + gold bar. | `desktop-spine.tsx:45–83` | The rail competes with the work. |

### A2 · What is already right (keep, do not re-litigate)

- **Home's information architecture** — `operator.brief` → State / Move / Nick / Judgment / Horizon / Change, zero cards, ≤7 actionable objects enforced server-side (`home-console.tsx` header). FACT. Recompose the visuals; keep the contract.
- **The shell architecture** from #2864 — one `nav[aria-label="Primary"]` on phones, `aside[data-spine]` at ≥1280px, measured `--bottom-chrome-h`, focus-clearance, safe-area handling, Base UI dialogs, the inspector host with one `<ViewTransition>` consumer. All pinned by `tests/repo/navigation-shell-contract.test.ts` and the e2e geometry/collision/target-size specs.
- **Chat runtime** — memoised message shells, Streamdown with plugins, exactly-once pending queue, 44px phone floors, action rows with aria-labels pinned by `tests/components/chat-message-actions.test.tsx`.
- **Tool semantics** — `tool-result-registry.tsx` (1,265 lines of per-tool labels, subtitles, rich bodies, deep links, undo tokens). Keep the registry; replace only the renderer.
- **Truth discipline** — `EmptyState` tone gates, `Metric` "relative to what", `EvidenceMark` provenance, `InspectorNotice` four non-content states, unknown ≠ zero.
- **The severity-tier colour block** in `tokens.css` (rose/red/amber/emerald/sky at equal lightness, chroma inside gamut, pinned by `__tests__/severity-tier-gamut.test.ts`). Status hues are already disciplined; gold was the problem.

### A3 · Clutter map by surface (rendered at 390×844 and 1440×900 on the hermetic dev server; shots in `PLAN.md` §L)

- **Home** — masthead `NOW` verdict at 68px uppercase; gold left rule + gold CTA in uppercase Barlow; judgment count in 30px rose Barlow; context rail hairlines. Two shouts per screen (verdict + CTA) where one is the rule.
- **Chat** — header: `NICK` + capability pill + three bordered uppercase buttons (Context / History / Voice); empty state: gold mono eyebrow, four bordered command cards; composer: glass + 2xl shadow + gold ring. Everything is a box.
- **Missions** — 22–24px uppercase Barlow mission titles in a card deck; gold drag handles; mono uppercase meta on every row; `vt-verdict` next-move shout.
- **System** — appropriately dense; the one surface where the current grammar is nearly right (diagnostic density is its job).
- **Spine / tab bar** — gold active text + gold bar + uppercase mono labels on both.

---

## B · Research book

Research connectors were unavailable this session (Parallel Search free-tier rate limit; Firecrawl account
out of credits — both receipts in the session log). The entries below are therefore **CLAIM** unless marked
FACT, carried from the operator's brief and from training knowledge, and are used as *principles to test
against the rendered product*, never as pixels to copy. Re-verify dates before quoting externally.

| Source | Pattern | Why it works | Transfer to BDNick | Do not copy |
|---|---|---|---|---|
| **Linear, 2026 interface refresh** (CLAIM) | Dimmer navigation, fewer separators, smaller icon footprint; "structure should be felt, not seen"; an internal design toolbar to flip old/new UI and tune tokens live. | Attention is a budget: the working surface must win it. A live toggle removes the "rebuild to compare" tax. | Spine recedes (60px, icon-led, one gold index mark); hairlines only where proximity cannot explain grouping; `?ui=v1` cookie toggle for side-by-side. | Its sidebar, its exact neutrals, its near-invisible level of change (our success test is *visible* difference). |
| **Raycast 2.0** (CLAIM) | Rebuilt so "every pixel feels new" without breaking muscle memory; glass only on control chrome; engineering budget spent on no flicker / no stale frames / stable resize; Quick AI and AI Chat unified around one composer. | Premium = absence of glitches as much as presence of polish. | Composer is the one chat surface that gets translucent material; zero layout shift on stream; command palette as the power layer. | Its launcher layout, its exact glass values. |
| **Apple HIG, Liquid Glass** (CLAIM; principle is stable across HIG revisions) | Glass belongs to the navigation/controls layer floating above content; content layer stays opaque; reduce motion means fewer repetitive and depth animations; 44pt targets; safe areas. | Hierarchy needs an opaque reading plane. | Glass allowed: spine, tab bar, composer, palette, popovers, inspector. Glass banned: cards, messages, metrics. Reduced-motion collapses to instant. | Blanket translucency. |
| **Vercel AI Elements** (CLAIM; API read earlier in this repo's history — `docs/UPSTREAMS.md` already carries a STUDY-ONLY verdict for React Spectrum's AI preview) | Conversation / Message / Reasoning / Tool / Sources / PromptInput as distinct primitives; Tool has pending → approval-requested → running → complete → error → denied states. | AI interaction is several object kinds, not one bubble. | Our registry already has richer semantics; adopt the *decomposition*: editorial Nick message, Activity Summary, Tool Receipt with the same six states, Sources footer, stateful composer. | The dependency (Base UI is the incumbent; UPSTREAMS rule 20). |
| **Vercel Geist** (CLAIM) | Sparse background layers, precise text/icon hierarchy, controlled border scales, typography roles. | Few values, consistently applied. | Six surface steps, three edge strengths, four text roles, five radii. | — |
| **Superhuman ⌘K** (CLAIM) | Shortcuts taught beside each command. | Power moves to the palette so the chrome can be simple. | Palette rows show their chord; the spine's ⌘K is the only permanent "advanced" door. | — |
| **Cursor 3 / agent workspaces** (CLAIM) | Long outputs leave the chat column; element-level screenshot context for agents. | A 2,000-word plan is not a message. | Artifact → "Open workspace" entry point (phase 1 in this wave is the message-level affordance, not a second canvas). UI Lab + baseline screenshots become the agent contract. | Tiled multi-agent panes (not this product's primary job yet). |
| **WCAG 2.2** (FACT — standard) | 2.4.11 Focus Not Obscured (min), 2.4.13 Focus Appearance, 2.5.8 Target Size (24px min; this repo holds 44px on phones by its own gate). | Fixed bottom chrome is exactly where focus gets hidden. | Keep the focus-clearance handler; the new focus ring is 2px accent + 2px canvas offset so it survives on void, raised, glass and gold. | — |
| **web.dev / Core Web Vitals** (FACT — published thresholds) | LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1 at p75; animate transform/opacity only; `content-visibility` for offscreen heavy sections. | A premium interface that lags is not premium. | Motion tokens compile to transform/opacity; no new dependency; no chat virtualisation (repo rejected it with receipts — stick-to-bottom). | — |
| **Self-Determination Theory** (CLAIM) | Autonomy + competence + relatedness motivate; pressure and variable rewards corrode. | Explains why "3 things moved today" beats streak anxiety. | Momentum copy is competence-based and real-data only; no streak fire, no guilt. | Gamification. |

---

## C · Three directions, one choice

Scored against the brief's rubric (visual clarity 15 · task speed 15 · hierarchy 12 · distinctiveness 10 ·
density 10 · mobile 10 · desktop 10 · a11y 8 · perf feasibility 5 · consistency 5 = 100). Scores are
design-review judgements, not user-study results.

| | A · Precision Instrument | **B · Precision Material Cockpit** | C · Editorial Command |
|---|---|---|---|
| Character | ultra-flat, dense, Geist everywhere, no translucency, hairlines only | warm near-black solid work plane + translucent *control* chrome, Geist-led, one Barlow shout per page, one gold index mark | dramatic type, wide workspace, cinematic hierarchy, serif accents |
| Home | state line → verdict in 28px Geist → one CTA | verdict stays the single Barlow shout (scaled down), CTA in Geist, judgment ledger rows | 64px editorial verdict, two-column essay layout |
| Chat | plain text, no composer material | editorial Nick, compact graphite user, smoked composer, Activity Summary, Tool Receipts | magazine-width prose, pull-quote style Nick |
| Missions | table rows | dense rows + inspector | cards with big type |
| Clarity / speed / hierarchy | 14 / 15 / 11 | 14 / 14 / 12 | 12 / 11 / 12 |
| Distinctiveness / density | 6 / 10 | 9 / 9 | 10 / 6 |
| Mobile / desktop | 9 / 9 | 9 / 10 | 7 / 9 |
| A11y / perf / consistency | 8 / 5 / 5 | 8 / 5 / 5 | 7 / 4 / 4 |
| **Total** | **92** | **95** | **82** |
| Risk | sterile; indistinguishable from any Geist dashboard | glass creep back onto content | density loss; slower operation |

**DECISION: B.** It keeps A's speed and clarity, borrows C's personality in exactly two places (the `NOW`
verdict and big metrics stay Barlow; everything else is Geist), and gives the chrome a material the content
never gets. Governing sentence: **work is solid, controls can float, gold signals, motion explains.**

Rendered as code, not Figma: the three directions were prototyped as token sets against the hermetic dev
server (a `?ui=v1` comparison lane kept the old grammar reachable until PR 3 deleted it); B is what ships.
