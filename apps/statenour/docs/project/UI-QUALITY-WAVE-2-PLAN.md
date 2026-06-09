# Statenour — UI Quality Wave 2 Plan

**Date:** 2026-06-09
**Branch:** `statenour-ui-quality-audit` (Wave 1 already pushed to `main` @ `b93e50a1`)
**Author:** Claude (Opus) — UI session, disciplined to UI-owned SAFE/CAREFUL work
**Companion:** [UI-UX-QUALITY-AUDIT.md](./UI-UX-QUALITY-AUDIT.md) (Wave 1 audit, People-edit finding corrected)

> **Honest framing (read first).** Most of the *highest-leverage* product improvements (mobile command palette, in-loop XP/reward, task-completion feel, chat chip dedup) are owned by **Cleaner** (XP/stat/reward/task logic) or **Nick/Wiring** (chat route + command registry) — correctly fenced off from this session. The UI session's SAFE lane is **clarity, states, nav cues, and premium polish**. This plan ranks *everything* but only builds the UI-owned SAFE wins. Don't mistake a small SAFE diff for the big-leverage items — those need Cleaner/Nick.

## Evidence baseline (re-verified on current main, post-sibling)
- Wave 1 shipped + live-verified: `/system` #418 gone, AVG LATENCY shows "— / no data yet", `/pins` injected badge from server order (6/6 unit test), `/goals`→`/stats#goals`, toast 4s, violet→gold on knowledge/pins/system-actions.
- A sibling **Cleaner/Nick "Wires 1-5"** wave landed on main (`1e8d5bd0`): `/convert` slash command, `use-slash-commands`, DAILY-checkoff XP, task-rescue, action-receipts, missions page, **new `/system/digest`**, `hub-grid`. These are **Cleaner/Nick-owned** — out of scope.
- Re-scan: **13 violet/purple leaks remain** across 6 files (`system/{ai-cost,alerts,health,crons,logs}`, `photo-improver`) — all the category-palette ones Wave 1 deferred. `--nour-*` CSS tokens are **valid aliases** (not a bug). `MissionScoreboard`/`NicksScoreboardBrief` orphans live in **missions/actions** (Cleaner lane).

---

## Opportunity Matrix

Evidence: `observed live` / `repo-verified` / `code-inferred` / `unknown`. Owner: UI / Cleaner / Nick/Wiring / Hold. Risk: SAFE / CAREFUL / HOLD.

| # | Idea | Surface | User Pain | Evidence | Owner | Risk | Exec Value | Build Cost | Files Likely Touched | Recommended Action |
|---|------|---------|-----------|----------|-------|------|-----------|-----------|---------------------|--------------------|
| **A — Mobile power access** |
| A1 | Visible ⌘K/search launcher on mobile | orb / composer | ⌘K unreachable on iPhone; richest surface desktop-only | observed live + repo-verified | **Nick/Wiring** | HOLD | high | medium | `command-palette.tsx` + trigger | **HOLD → Nick** (command registry) |
| A2 | Stronger slash-command hint affordance | chat | slash only hinted via rotating placeholder | repo-verified | **Nick/Wiring** | HOLD | medium | small | `slash-command-dropdown`, `use-adaptive-placeholder` | HOLD → Nick |
| **B — Navigation clarity** |
| B1 | **Orb reflects current location** (real icon on depth pages + current-page label in menu) | orb / all pages | orb shows generic shield off the 4 mobile tabs; no "you are here" | repo-verified (`floating-home.tsx` `OrbIcon = activeTab?.icon ?? Shield`, activeTab = MOBILE_TABS only) | **UI** | **SAFE** | high | small | `floating-home.tsx` (+helper+test) | **BUILD ✅** |
| B2 | Fix stale nav comments | nav | `nav-items.ts` says "bottom nav 4 wide" (no bar exists); orb docstring "Ultron/Nick/Actions" | repo-verified | **UI** | SAFE | low | small | `nav-items.ts`, `floating-home.tsx` | Build (folded into B1) |
| B3 | Surface orb SmartNow/Recent more | orb | powerful but one tap deep | repo-verified | UI | CAREFUL | medium | medium | `floating-home.tsx` | Defer (needs design) |
| **C — Motivation visibility** |
| C1 | In-loop XP/level glance (home/missions header) | home/missions | progress only visible on `/stats` | repo-verified | **Cleaner** | HOLD | high | medium | mastery data + headers | **HOLD → Cleaner** (XP/stat data) |
| C2 | Reward moment + toast→/stats tap-through | missions | completion = silent 2s toast | repo-verified | **Cleaner** | HOLD | high | small | `task-reward`, toast wiring | HOLD → Cleaner |
| C3 | Plain "/stats" signpost link from a daily surface | home | stats not signposted | code-inferred | UI | SAFE | low | small | a home component | Defer (marginal) |
| **D — Duplicate intelligence surfaces** |
| D1 | Differentiate home-brief vs missions-brief (label) | home/missions | two identical gold "Nick" cards | repo-verified | UI (content=Nick) | CAREFUL | medium | small | `nicks-home-brief`, `nicks-morning-brief` | Defer → coordinate w/ Nick |
| D2 | Unify 4 chip surfaces (quickActions/SmartReplies/PromptSuggestions/NickSuggestions) | chat | identical chip rows, no hierarchy | repo-verified | **Nick/Wiring** | HOLD | medium | medium | chat components | HOLD → Nick |
| **E — Empty/loading/error states** |
| E1 | **error.tsx polish** (real icon, back-home escape, keep retry) | global error | "!" glyph reads as missing icon; retry-only trap | repo-verified (`error.tsx:18-32`) | **UI** | **SAFE** | medium | small | `app/(mastery)/error.tsx` | **BUILD ✅** |
| E2 | **/knowledge empty state + gold skeleton** | knowledge | empty grid renders nothing; bare `.skeleton` | repo-verified (`knowledge/page.tsx:185,309-329`) | **UI** | **SAFE** | low-med | small | `knowledge/page.tsx` | **BUILD ✅** |
| E3 | not-found stale "Command Center" label (/ is chat) | 404 | minor copy drift | repo-verified | UI | SAFE | low | small | `app/not-found.tsx` | Defer (tiny) |
| E4 | system subpages ad-hoc loading text → skeleton | /system/* | inconsistent loaders | code-inferred | UI | SAFE | low | medium | many `system/*` pages | Defer (batch later) |
| E5 | /system/digest "loading…" text → skeleton | /system/digest | sibling's new surface | repo-verified | **Cleaner** (their file) | CAREFUL | low | small | `system/digest/page.tsx` | Defer → Cleaner |
| **F — Mobile touch / readability** |
| F1 | pins edit/unpin 44px | pins | sub-44px | repo-verified | UI | — | — | — | **DONE (Wave 1)** |
| F2 | StatCard tooltips hover-only + 8px goal links | stats | invisible on touch, below iOS min | repo-verified | **Cleaner** (stats/XP) | HOLD | medium | small | `character-sheet.tsx` | HOLD → Cleaner |
| F3 | chat chips <44px | chat | small targets | repo-verified | **Nick/Wiring** | HOLD | medium | small | chat components | HOLD → Nick |
| **G — Content hierarchy** |
| G1 | /system 10-subpage overlap (logs vs reviews, actions vs approvals) | system | unclear which to open | repo-verified | UI/product | CAREFUL | medium | medium | hub-grid + IA | Defer (IA decision) |
| G2 | /stats long scroll, goals buried below 33 stats | stats | next move unclear | observed live | **Cleaner** (stats) | HOLD | medium | medium | stats/character-sheet | HOLD → Cleaner |
| **H — Premium feel / polish** |
| H1 | Violet category palettes → on-brand (alerts/crons/logs) | system/* | off-brand purple, AI-slop tell | repo-verified (13 occ.) | **UI** | CAREFUL | medium | medium | `system/{alerts,crons,logs}` maps | Careful follow-up (collision risk) |
| H2 | Single-use violet (ai-cost gradient, health header) | system | stray purple | repo-verified (`ai-cost:60`, `health:309-310`) | UI | SAFE | low | small | 2 files | Candidate (deferred this pass for focus) |
| H3 | photo-improver violet | photo-improver | off-brand (⌘K-only page) | repo-verified | UI | SAFE | low | small | `photo-improver/page.tsx` | Defer (low-traffic) |
| **I — Dead / orphaned UI** |
| I1 | MissionScoreboard / NicksScoreboardBrief / derive-mission-matrix orphans | missions/scoreboard | dead code | code-inferred (refs in missions+tests; needs import-graph proof) | **Cleaner** (missions/actions lane) | HOLD | low | small | `components/{actions,scoreboard,missions}` | **HOLD → Cleaner** (do not delete from UI session) |

---

## Selected Wave 2 builds (UI-owned, SAFE, repo-verified)

Only **3** — quality over quantity, and Wave 2 is **not pushed** (no live verification possible pre-deploy), so each is small, isolated, and typecheck/build/test-verified.

### Build 1 — Orb current-location cue (B1/B2) — area B
- **Why it matters:** the floating orb is the *only* persistent nav. On every depth page (`/stats`, `/people`, `/brain`, `/system`, `/settings`) it shows a generic shield — no "you are here." Daily friction on the primary device.
- **Evidence:** `floating-home.tsx` — `activeTab = MOBILE_TABS.find(...)`, `OrbIcon = activeTab?.icon ?? Shield`. Depth items have icons in `NAV_ITEMS` but aren't consulted.
- **Change (smallest):** add a pure `resolveActiveNav(pathname, NAV_ITEMS)` helper (reuses the existing `/` exact-match rule), use its icon for `OrbIcon` and show its label in the expanded-menu header; fix the 2 stale comments. + unit test for the resolver.
- **Files:** `components/layout/floating-home.tsx`, `lib/nav/active-nav.ts` (new), `lib/nav/active-nav.test.ts` (new).

### Build 2 — error.tsx polish (E1) — area E
- **Why it matters:** the global mastery error boundary shows a literal "!" (reads as a broken glyph) and offers **only** "Try Again" — on a non-recoverable error (bad deploy) the operator is trapped in a retry loop.
- **Evidence:** `app/(mastery)/error.tsx:18-32`.
- **Change (smallest):** swap "!" for a lucide icon, add a "Back to home" secondary link beside "Try Again", normalize to canonical tokens.
- **Files:** `app/(mastery)/error.tsx`.

### Build 3 — /knowledge empty state + gold skeleton (E2) — area E
- **Why it matters:** an empty/filtered knowledge corpus renders a blank area (no guidance); loading uses a bare `.skeleton`.
- **Evidence:** `knowledge/page.tsx:185` (bare skeleton), `:309-329` (empty grid → nothing).
- **Change (smallest):** render the shared `EmptyState` when `results.length===0 && sortedFiltered.length===0`; swap the bare `.skeleton` for `ShimmerSkeleton`.
- **Files:** `app/(mastery)/knowledge/page.tsx`.

## Explicitly routed elsewhere (NOT built here)
- **→ Cleaner:** in-loop XP glance (C1), reward moment (C2), StatCard touch/readability (F2), /stats hierarchy (G2), dead missions/scoreboard orphans (I1), /system/digest loading (E5).
- **→ Nick/Wiring:** mobile ⌘K launcher (A1), slash hints (A2), chat chip dedup (D2), chat chip sizes (F3).
- **→ Careful UI follow-up (needs a small design pass):** violet category palettes (H1), home/missions brief differentiation (D1), /system subpage IA (G1).

## Recommended build sequence (UI lane)
1. This wave: B1 (orb cue) · E1 (error) · E2 (knowledge states).
2. Next UI wave (SAFE follow-ups): H2 (single-use violet) · E3 (not-found copy) · E4 (system loaders) · H3 (photo-improver).
3. Coordinated (needs Cleaner/Nick): everything in "routed elsewhere".

*Wave 2 builds are committed to the branch but NOT pushed — awaiting operator approval.*
