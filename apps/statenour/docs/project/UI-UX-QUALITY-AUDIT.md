# Statenour — UI / UX / Product-Quality Audit

**Date:** 2026-06-09
**Auditor:** Claude (Opus) — read-only hybrid audit (live `bdnick.info` + code)
**Code baseline:** worktree `statenour-ui-quality-audit` @ `43b63268` (branched from `origin/main`)
**Scope:** Audit only. No code written, no data changed, no `main`, no push. Only this file was created.
**Skills applied:** ux-audit (Nielsen heuristics) · frontend-design (premium / anti-AI-slop) · mobile-design (touch ergonomics) · clarity-gate (evidence labelling).

> ⚠️ **`main` is a moving target.** A sibling "Cleaner" session pushed during this audit — `origin/main` advanced from `c4716a90` → `43b63268` mid-session. Everything code-side below reflects `43b63268`. Live `bdnick.info` may lag or lead that commit (Railway deploy timing).

---

## 1. Evidence Policy (clarity-gate)

This is a **judgment** document. The 1–10 scores are **calibrated expert assessment against UX heuristics — they are NOT measurements.** Every score carries an evidence label so a future reader (or LLM) never mistakes an opinion for a metric.

| Label | Meaning |
|-------|---------|
| **Observed live** | I saw it rendered on `bdnick.info` (authenticated session, `ceo laptop` Chrome, desktop 1512px) on 2026-06-09. |
| **Code-inferred** | Derived from reading source at `43b63268` (and 4 read-only code-explorer agents). An **estimate** — not seen running. |
| **Not observed** | Could not be verified either way; flagged as unknown. |

**State separation** (per the brief — Cleaner is actively pushing):
- **Live on bdnick.info** — what I screenshotted today.
- **Present on origin/main** — what exists in code at `43b63268`.
- **Possibly pending in Cleaner's branch** — reward/XP/completion surfacing is being actively changed; I did **not** audit any unpushed Cleaner branch.
- **Unknown / not observed** — explicitly marked.

**Hard limits of this audit:**
- **True mobile rendering could NOT be captured.** The browser resize tool did not change the screenshot viewport (all "mobile" captures returned at 1512px desktop). Therefore **every `Mobile quality` score is `Code-inferred`** (from responsive classes + agent analysis), except where the desktop layout makes mobile behaviour self-evident. Nour's real device is an **iOS PWA** — even a true narrow render would not capture standalone/safe-area/PWA specifics.
- Empty/error states are hard to force on a populated production account, so most are `Code-inferred`.
- Scores reflect a single auditor's heuristic read, not user testing.

---

## 2. What Was Observed Live (bdnick.info, 2026-06-09, desktop)

| Surface | URL | Console | Headline observation |
|---------|-----|---------|----------------------|
| Home (chat-as-home) | `/` | clean | Nick "TODAY" brief + ONE-TAP MOVES (2) + WATCH NICK 85/100 · 41 PENDING + composer |
| Missions | `/missions` | clean | Morning brief + "THE MISSION FOR RIGHT NOW" spotlight (KRUEGER, 70% bar, **NEXT 60 MIN →**) + BOARD HEALTH 9 (5 healthy/4 idle) |
| Stats | `/stats` | clean | POWER **Lvl 203** · 3,577 XP · NEXT REP Advertising 2 XP→Lvl 7 · BODY/MIND stat cards w/ deltas |
| System | `/system` | **❌ React #418 hydration error** | HEALTHY · DB 611ms · REQUESTS 211 · **AVG LATENCY 0ms** (data tell) · ERRORS(24h) 1 |
| People | `/people` | clean | Power Atlas · Nick relationship brief · 7 PEOPLE · 0 NEGLECTED · 3 HIGH TRUST |
| Chat / Nick | `/chat` | clean | Cold state: gold orb + "afternoon, Nour." + adaptive opener chips + rich composer (mic/attach/+/send) |
| Brain (memory) | `/brain` | clean | Tabs Memory/Board/Wisdom/Reason · 33 BRAIN MATURITY · identity 8/8 · ghost acc 22% |
| Journal | `/journal` | clean | Nick brief ("58 dumps, 0 threads") · TODAY'S PROMPT · REFLECT what/so-what/now-what composer |

**Global chrome seen on every page:** top strip `● CALLS · 1 callback pending` (GlobalTopTicker), bottom `🏆 DONE 2h ago · MONDAY ROI MEETING · 1/5` (BottomPulseTicker), and the **gold floating orb** bottom-right. **No sidebar or bottom tab bar on any viewport** — the orb is the only persistent nav.

**The one live bug:** `/system` throws **React minified error #418** (hydration text mismatch — almost certainly the "Last refresh: 12:49:09 PM" / "just now" client-time render). The page's own `ERRORS(24h) 1` may be this error self-reported via the layout ErrorBoundary.

---

## 3. What Was Inferred From Code (not seen running)

- All **mobile** behaviour (responsive classes, 44px targets, bottom sheets, safe-area, swipe-nav) — strong primitives, but unverified on a real device.
- All **empty / loading / error** states except the chat cold-state and the `/system` error.
- `/missions` has **no filter/search/sort** (TaskFilters deleted from it; stranded behind the dead `/tasks` redirect).
- The **reward toast** content (`formatReward`) and the absence of any celebration UI (verified in `lib/mastery/task-reward.ts`).
- `/goals` is a **pure redirect** to `/stats` (verified, 17-line file).
- **PersonEditDrawer** blanks 5 fields on edit (verified `people/page.tsx:482-487`).
- **Pins** "injected" badge is position-dependent (`pins/page.tsx`, agent-reported).
- Dead/orphaned components (`MissionScoreboard`, `NicksScoreboardBrief` — 0 importers).
- `⌘K` command-palette internals (40+ actions, semantic brain search) — read in `components/command-palette.tsx`, not exercised live.

## 4. What Could NOT Be Observed

- **A true mobile/iOS-PWA render** (resize did not take; no device). Highest-impact gap in this audit.
- Live **empty states** (account is populated) — e.g. zero-people, zero-missions, cold journal.
- Live **error/offline** flows (offline queue, stall banner, provider degradation, undo-send) — code-only.
- Whether the PersonEditDrawer **save** actually writes the blanked fields back as null (data-loss vs display-only) — **save path runtime-unknown**.
- `/system/*` subpages, `/knowledge`, `/pins`, `/content`, `/market`, `/business`, `/voice` — code-only (not visited live this pass).
- Anything in **Cleaner's unpushed branch**.

---

## 5. Current UI Map

**Framework:** Next.js app-router. All product surfaces live under the `(mastery)` route group; root layout adds the ambient chrome.

**Navigation model (all viewports):** a single **draggable floating orb** (`components/layout/floating-home.tsx`) — tap = quick-nav menu, drag = reposition, swipe = hide to a 2px peek sliver. Orb border tone = system health (gold calm / amber watch / red alert). **There is no persistent sidebar or bottom tab bar.** On mobile, add **swipe left/right** between 3 tabs (Home/Missions/Journal) and **⌘K is unavailable** (no keyboard).

```
ROOT LAYOUT (app/layout.tsx)
├─ Toaster (sonner, top-center, 2000ms)
├─ CommandPalette (⌘K — desktop only; mounts outside TRPCProvider)
└─ (mastery)/layout.tsx
   ├─ NeuralBackground · AmbientAura(state glow) · NeuralBackground
   ├─ GlobalTopTicker (priority signals)  ← top
   ├─ BottomPulseTicker (ambient brain signals, paginated) ← bottom
   ├─ SwipeNavigation (mobile: swipe between Home/Missions/Journal + pull-to-refresh)
   ├─ FloatingHome (the orb — THE nav surface)
   ├─ DeepModeNudge · BrainDumpModal(⌘⇧J) · MegaConfirmHost(in-DOM confirm) · SessionExpiryBanner
   └─ page content (ErrorBoundary-wrapped)

PRIMARY SURFACES (in nav / orb / swipe)
  /          Home = chat-as-home (HomeStrip + Nick brief + one-tap moves + composer)
  /missions  Mission-led task board (rename of /tasks)
  /journal   Reflection feed
  Admin ↗    external → nickstire.org/admin
  /chat      Full chat (same engine as home)

DEPTH (orb menu + ⌘K)
  /stats     Character sheet + goals + KPIs (absorbed /scoreboard + /goals)
  /people    Power Atlas (per-person dossier + Greene coach + ledger)
  /brain     Memory · Board · Wisdom · Reason (tabs)
  /system    Ops hub → 10 subpages (actions, ai-cost, alerts, approvals,
             calibration, coach-events, crons, health, logs, reviews)
  /settings

⌘K / Nick-chat ONLY (invisible in nav)
  /knowledge /pins /content /photo-improver /business /market
  /body /financial /decisions /cameras /devices /integrations

REDIRECTS (consolidation history)
  /tasks→/missions · /goals→/stats · /scoreboard→/stats · /mastery→/stats
  /cockpit→/ · /radar+/seo→/market tabs · /reason→/brain?tab=reason · /plan→/stats
```

**Tasks** have no route — they render inside `/missions` (MissionCard → MissionTaskRow) and as an "active task companion" on the home desk.

---

## 6. Surface Scores

> Format per the brief: **Dimension | Score (1–10) | Evidence | Reason.** Scores are evidence-labelled judgment, not metrics. `Mobile quality` is `Code-inferred` throughout (no live mobile render possible). For ops/utility surfaces, `Motivation/reward` is scored for relevance, not forced.

### 6.1 Home `/` — avg ≈ 8.3
| Dimension | Score | Evidence | Reason |
|-----------|-------|----------|--------|
| Purpose clarity | 9/10 | Observed live | Nick "TODAY" brief → ONE-TAP MOVES → WATCH line → composer reads instantly as "today + talk to Nick." |
| Daily usefulness | 9/10 | Observed live + code-inferred | Push-first brief + 2 one-tap moves + 41-pending watch line. High-signal daily landing. |
| Visual quality | 9/10 | Observed live | Dark-void + gold + mono editorial. Distinctive, not AI-slop. |
| Speed/ease | 7/10 | Observed live + code-inferred | One-tap moves load async (pop-in, no timed skeleton) and go to a *surface*, not the action; ⌘/Ctrl+Enter hint is desktop-only. |
| Mobile quality | 8/10 | Code-inferred | 44px composer, 16px input, `active:scale`. But `pb-32` + layout `pb-20` = ~208px dead space below composer. |
| Motivation/reward | 7/10 | Observed live + code-inferred | "WATCH NICK 85/100" + journal/mission nudges motivate; no XP/streak/level on home. |

### 6.2 Missions `/missions` — avg ≈ 8.0
| Dimension | Score | Evidence | Reason |
|-----------|-------|----------|--------|
| Purpose clarity | 9/10 | Observed live | "THE MISSION FOR RIGHT NOW" + NEXT 60 MIN is an unambiguous focus mechanic. |
| Daily usefulness | 9/10 | Observed live | Morning brief + single-focus mission + board health = strong daily command surface. |
| Visual quality | 9/10 | Observed live | Gold progress bar, semantic status colors, clean card rhythm. |
| Speed/ease | 6/10 | Observed live + code-inferred | **No filter/search/sort** on the primary task surface; reorder = repeated ↑/↓ taps each a server round-trip; editing a due-date opens an 8-field sheet. |
| Mobile quality | 8/10 | Code-inferred | 44px targets, bottom-sheet editor, 16px inputs (verified). Snooze popover `w-44` may clip in a narrow card; root missing `mx-auto px-3` that home has. |
| Motivation/reward | 7/10 | Observed live + code-inferred · ⚠ Cleaner-pending | Progress %/deadline/streak are good; completion reward is a 2s auto-dismiss toast (see §11). |

### 6.3 Stats `/stats` — avg ≈ 7.3
| Dimension | Score | Evidence | Reason |
|-----------|-------|----------|--------|
| Purpose clarity | 8/10 | Observed live | "Character sheet" is clear; section counts (33, 4, 11) are unlabeled; goals/KPIs buried below a long character sheet. |
| Daily usefulness | 6/10 | Observed live + code-inferred | Motivating to visit, but not a daily-action surface; "NEXT REP" says *which* stat but not *how* to earn it. |
| Visual quality | 9/10 | Observed live | Richest visual on the app — RPG skill-tree feel, per-stat colors, deltas. |
| Speed/ease | 6/10 | Observed live + code-inferred | 33 stats = long scroll (default all-expanded); StatCard tooltip is hover-only (invisible on touch). |
| Mobile quality | 6/10 | Code-inferred | Long scroll; 8px goal-link text is below iOS min readable; tooltips unreachable on touch. |
| Motivation/reward | 9/10 | Observed live · ⚠ XP logic fenced | Levels/XP/weekly deltas/next-rep — the motivation engine. No level-up *moment* (static numbers). |

### 6.4 System `/system` (+10 subpages) — avg ≈ 6.5
| Dimension | Score | Evidence | Reason |
|-----------|-------|----------|--------|
| Purpose clarity | 8/10 | Observed live | Status-first layout, clear KPI grid + observability row. |
| Daily usefulness | 6/10 | Observed live + code-inferred | Powerful for triage; not a daily surface for most days. |
| Visual quality | 7/10 | Observed live + code-inferred | Clean hub, but **violet/purple leaks** in subpages (actions/alerts/crons/health) break the gold identity; **AVG LATENCY "0ms"** should be an empty state. |
| Speed/ease | 6/10 | Observed live + code-inferred | **Live #418 hydration error**; 10 subpages with real overlap (logs vs reviews, actions vs approvals, health vs alerts) — unclear which to open. |
| Mobile quality | 5/10 | Code-inferred | Dense KPI/telemetry grids; runtime-unknown but high reflow risk on 390px. |
| Motivation/reward | 3/10 | Code-inferred · low-relevance | Ops surface; the orb tone (calm/watch/alert) is the real "reward." |

### 6.5 Chat / Nick `/chat` (and `/`) — avg ≈ 8.5
| Dimension | Score | Evidence | Reason |
|-----------|-------|----------|--------|
| Purpose clarity | 9/10 | Observed live | The heart of the product; cold state is calm and obvious. |
| Daily usefulness | 10/10 | Observed live + code-inferred | The primary interface — capture, ask, act; deep capability (drafts, undo, offline queue, prefetch, semantic recall). |
| Visual quality | 9/10 | Observed live + code-inferred | Kinetic send-morph, spring-physics scroll, streaming cursor, ambient aura. Premium. |
| Speed/ease | 8/10 | Observed live + code-inferred | Fast and considered; but **slash commands near-undiscoverable** and **two identical "what next?" chip rows** compete below replies. |
| Mobile quality | 8/10 | Code-inferred | Excellent contract (16px, safe-area, long-press action sheet, haptics). But audio-attach is desktop-only; auto-fire countdown is invisible if scrolled up; several chips <44px. |
| Motivation/reward | 7/10 | Observed live + code-inferred | Nick-quality score + proactive suggestions; intentionally not gamified. |

### 6.6 Tasks (component: `/missions` + home desk) — avg ≈ 7.2
| Dimension | Score | Evidence | Reason |
|-----------|-------|----------|--------|
| Purpose clarity | 7/10 | Observed live + code-inferred | Tasks live *inside* missions; an "active task companion" appears on the home desk when DOING — discoverable but spread across surfaces. |
| Daily usefulness | 8/10 | Code-inferred | Rich: session logging (notes/photo/voice), AI classification w/ approve gate, snooze, streak, finish-condition. |
| Visual quality | 8/10 | Observed live + code-inferred | Consistent tokens, semantic colors. |
| Speed/ease | 6/10 | Code-inferred | No filter/search on the primary surface; quick-add then a second edit for full fields; date label shows "YYYY-MM-DD" to a mobile user. |
| Mobile quality | 8/10 | Code-inferred | Strong: 44px rows, mobile-visible actions (not hover-gated), 16px inputs, bottom sheets. |
| Motivation/reward | 6/10 | Code-inferred · ⚠ Cleaner-pending | Inline streak "🔥N"; reward toast otherwise silent. |

### 6.7 Goals (`/goals` → `/stats`) — avg ≈ 4.8
| Dimension | Score | Evidence | Reason |
|-----------|-------|----------|--------|
| Purpose clarity | 4/10 | Observed code | `/goals` is a silent redirect to `/stats`; a "Goals" mental model lands on a "Stats" page with no signpost. |
| Daily usefulness | 5/10 | Code-inferred | GoalBoard exists on `/stats` but **below** a 33-stat character sheet — hard to reach. |
| Visual quality | 7/10 | Code-inferred | GoalBoard uses ProgressRing (not seen live). |
| Speed/ease | 4/10 | Code-inferred | To reach goals: orb → Stats → scroll past the whole character sheet. |
| Mobile quality | 5/10 | Code-inferred | Inherits the long-scroll problem of `/stats`. |
| Motivation/reward | 6/10 | Code-inferred | Goal progress visuals exist but are buried. |

### 6.8 Journal `/journal` — avg ≈ 7.3
| Dimension | Score | Evidence | Reason |
|-----------|-------|----------|--------|
| Purpose clarity | 8/10 | Observed live | Clear: Nick brief + today's prompt + reflect composer + feed. |
| Daily usefulness | 8/10 | Observed live + code-inferred | Daily prompt, multi-source capture, thread detection. |
| Visual quality | 8/10 | Observed live | On-brand; one subtle gradient (metacognition card). |
| Speed/ease | 6/10 | Observed live + code-inferred | Two filter rows (up to 15 chips) + always-on composer push the feed far down; 100-entry / 60-day cap with **no "load more."** |
| Mobile quality | 7/10 | Code-inferred | Good targets (`pointer:coarse` 44px), but the filter banks consume vertical space before any entry on a phone. |
| Motivation/reward | 7/10 | Observed live + code-inferred | Metacognition score, learning-velocity ticker — but hidden in a collapsed drawer. |

### 6.9 People `/people` — avg ≈ 7.2
| Dimension | Score | Evidence | Reason |
|-----------|-------|----------|--------|
| Purpose clarity | 8/10 | Observed live | "Power Atlas — tap a name to open their dossier" + subtitle is explicit. |
| Daily usefulness | 8/10 | Observed live + code-inferred | Relationship brief + today's picks + trust/ledger = strong daily nudge. |
| Visual quality | 8/10 | Observed live | Serif names, mono trust scores, premium. |
| Speed/ease | 6/10 | Observed live + code-inferred · ⚠ defect | **PersonEditDrawer opens with birthday/anniversary/cadence/phone/email blanked** (`people/page.tsx:482-487`); inline `relativeTime` duplicates shared util. |
| Mobile quality | 7/10 | Code-inferred | 44px row actions; but the 2/3+1/3 bento stacks on mobile, pushing deposit/withdraw actions below the full dossier+ledger. |
| Motivation/reward | 6/10 | Code-inferred | Trust/ledger/balance is lightly gamified. |

### 6.10 Memory (`/brain` + `/knowledge` + `/pins`) — avg ≈ 6.3
| Dimension | Score | Evidence | Reason |
|-----------|-------|----------|--------|
| Purpose clarity | 7/10 | Observed live (brain) + code-inferred | `/brain` tabs are clear, but "memory" is split across 3 surfaces (brain/knowledge/pins). |
| Daily usefulness | 6/10 | Observed live + code-inferred | Powerful self-model; not a daily destination. |
| Visual quality | 7/10 | Observed live (brain) | Brain maturity rollup is a nice at-a-glance; knowledge viewer drops page chrome. |
| Speed/ease | 6/10 | Code-inferred | `/knowledge` uses a bare `.skeleton` + has **no empty state**; file viewer has no load state. |
| Mobile quality | 6/10 | Code-inferred | Runtime-unknown; dense stat rollups. |
| Motivation/reward | 6/10 | Observed live | "33 BRAIN MATURITY · identity 8/8 · ghost acc 22%" is a subtle maturity game. ⚠ **Pins "injected" badge is position-dependent** — sorting by stalest mislabels which pins are in the prompt. |

### 6.11 Navigation — orb + swipe + tickers — avg ≈ 6.8
| Dimension | Score | Evidence | Reason |
|-----------|-------|----------|--------|
| Purpose clarity | 6/10 | Observed live + code-inferred | The orb is novel and elegant but there's **no persistent nav chrome**; depth pages show a generic shield icon (orb only reflects the 4 mobile tabs). Stale comments claim a "bottom nav 4 wide" bar that doesn't exist. |
| Daily usefulness | 7/10 | Observed live + code-inferred | Orb SmartNow ("do this now") + Recent-3 jumps are genuinely useful — but buried one tap inside the orb. |
| Visual quality | 9/10 | Observed live | Orb + health-tone halo + peek-tab is a premium, memorable signature. |
| Speed/ease | 6/10 | Observed live + code-inferred | Depth nav = orb-tap → menu; swipe only spans 3 tabs; orb can be flicked off-screen to a 2px sliver (re-discovery risk). |
| Mobile quality | 7/10 | Code-inferred + observed | Pointer-events unify touch/mouse; iOS edge-guard on swipe; but no always-visible tab bar (non-standard for iOS). |
| Motivation/reward | 6/10 | Observed live | Orb tone = ambient system-vitals signal. |

### 6.12 Command palette / slash commands — avg ≈ 6.2 (mobile drags it down)
| Dimension | Score | Evidence | Reason |
|-----------|-------|----------|--------|
| Purpose clarity | 7/10 | Code-inferred | Rich + grouped, but label drift ("HQ Dashboard" → `/` which is now chat; many commands collapse to the same page). |
| Daily usefulness | 8/10 | Code-inferred | Enormous: nav + diagnostics + power actions + **semantic second-brain search** (RRF over memories+chat) + relationship-logging. |
| Visual quality | 8/10 | Code-inferred | cmdk dialog, on-brand. |
| Speed/ease | 7/10 | Code-inferred | Recents + repeat-last (⌘⇧K) on desktop are fast. |
| Mobile quality | 2/10 | Code-inferred · CRITICAL | **⌘K is unreachable on a phone** (no keyboard) and slash is near-undiscoverable — so the single richest surface is effectively desktop-only on a mobile-primary product. |
| Motivation/reward | 5/10 | Code-inferred · low-relevance | Utility surface. |

### 6.13 Mobile layout (cross-cutting) — avg ≈ 7.0
| Dimension | Score | Evidence | Reason |
|-----------|-------|----------|--------|
| Purpose clarity | 7/10 | Code-inferred | Single-column surfaces are clear; nav model (orb + swipe) is learnable but unconventional. |
| Daily usefulness | 8/10 | Code-inferred | It's the primary device and the core loop (brief → mission → chat) works one-handed. |
| Visual quality | 8/10 | Code-inferred | The premium aesthetic carries to narrow widths. |
| Speed/ease | 6/10 | Code-inferred | Orb-only nav + no ⌘K + 3-tab swipe limits reach to depth pages. |
| Mobile quality | 7/10 | Code-inferred | Strong floor (44px on *primary* actions, safe-area, bottom sheets, haptics) but **secondary** chips/menu rows leak below 44px and command power is gated. |
| Motivation/reward | 6/10 | Code-inferred | Reward surfacing weak on mobile (toast-only, no stats glance). |

### 6.14 Empty states — avg ≈ 6.2
| Dimension | Score | Evidence | Reason |
|-----------|-------|----------|--------|
| Purpose clarity | 7/10 | Observed live (chat) + code-inferred | A strong `EmptyState` primitive exists (icon + why + unlock + CTA); chat/journal empties are well done. |
| Daily usefulness | 6/10 | Code-inferred | Good where adopted (journal differentiates search-empty vs filter-empty). |
| Visual quality | 7/10 | Code-inferred | The primitive is polished. |
| Speed/ease | 5/10 | Code-inferred | **Adoption is patchy** — `/knowledge` file grid has none; many surfaces use bare `<p>` instead of `EmptyState`. |
| Mobile quality | 6/10 | Code-inferred | Fine where present. |
| Motivation/reward | 6/10 | Code-inferred | Empties include channel hints (⌘⇧J) — desktop-keyboard framing on a phone app. |

### 6.15 Loading states — avg ≈ 5.3
| Dimension | Score | Evidence | Reason |
|-----------|-------|----------|--------|
| Purpose clarity | 6/10 | Code-inferred | Gold `PageSkeleton`/`ShimmerSkeleton` primitives are mature and on-brand. |
| Daily usefulness | 5/10 | Code-inferred | When present, they prevent blank flashes. |
| Visual quality | 7/10 | Code-inferred | The shimmer is premium. |
| Speed/ease | 4/10 | Code-inferred | **Barely adopted** — `PageSkeleton` is used on **one** surface (`/people`); `/pins` has none, `/knowledge` uses a bare `.skeleton`, system subpages use ad-hoc "loading…" text. No route-level `loading.tsx` anywhere. |
| Mobile quality | 5/10 | Code-inferred | Inconsistent → blank/unstyled flashes on slow mobile. |
| Motivation/reward | n/a | — | — |

### 6.16 Error states — avg ≈ 6.0
| Dimension | Score | Evidence | Reason |
|-----------|-------|----------|--------|
| Purpose clarity | 6/10 | Observed live + code-inferred | `(mastery)/error.tsx` exists ("Something broke" + Try Again); `not-found.tsx` clear copy. |
| Daily usefulness | 6/10 | Code-inferred | Error boundary isolates the page, not the chrome — good. |
| Visual quality | 5/10 | Code-inferred | error.tsx uses a literal "!" character as the icon (reads as a missing glyph); not-found renders with **no nav chrome**. |
| Speed/ease | 6/10 | Code-inferred + observed | Retry-only error (no "back home" escape → retry-loop trap on a bad deploy). Live #418 surfaced silently (page still rendered). |
| Mobile quality | 6/10 | Code-inferred | not-found's missing chrome is more disorienting on mobile. |
| Motivation/reward | n/a | — | — |

### 6.17 Toasts / feedback — avg ≈ 6.8
| Dimension | Score | Evidence | Reason |
|-----------|-------|----------|--------|
| Purpose clarity | 7/10 | Code-inferred + observed | sonner top-center (correct for PWA); probe results + undo-send + auto-fire all routed through toast (not dead `alert()`). |
| Daily usefulness | 7/10 | Observed live + code-inferred | Two persistent tickers replace the retired bell; undo-send grace window is thoughtful. |
| Visual quality | 7/10 | Code-inferred | On-brand glass toasts. |
| Speed/ease | 6/10 | Code-inferred | **`duration=2000ms` is too short** for actionable toasts (e.g. the reward toast auto-dismisses before it registers). |
| Mobile quality | 7/10 | Code-inferred | top-center avoids the home indicator; undo button sized for thumb. Some inline toasts may stack under the bottom ticker. |
| Motivation/reward | 6/10 | Code-inferred | The reward "celebration" is *only* a 2s toast (see §11). |

### 6.18 XP / reward / progress visuals — avg ≈ 6.0
| Dimension | Score | Evidence | Reason |
|-----------|-------|----------|--------|
| Purpose clarity | 7/10 | Observed live | On `/stats` the leveling model is crystal clear. |
| Daily usefulness | 5/10 | Observed live + code-inferred | The progress only exists where you have to *go look* (`/stats`); invisible during the work. |
| Visual quality | 8/10 | Observed live | The character sheet is genuinely good. |
| Speed/ease | 5/10 | Code-inferred | No XP/level anywhere in the daily loop (home/missions/chat). |
| Mobile quality | 6/10 | Code-inferred | Long-scroll stats; deltas tiny. |
| Motivation/reward | 5/10 | Observed live + code-inferred · ⚠ Cleaner-pending | **The loop is broken at the moment of reward** — completing a task fires a 2s toast, no celebration, no tap-through to stats, day-1 streaks show nothing. |

### Scoreboard (rounded surface averages — judgment, evidence-labelled)
| Surface | Clarity | Daily | Visual | Speed | Mobile | Reward | ~Avg |
|---------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Chat / Nick | 9 | 10 | 9 | 8 | 8 | 7 | **8.5** |
| Home | 9 | 9 | 9 | 7 | 8 | 7 | **8.3** |
| Missions | 9 | 9 | 9 | 6 | 8 | 7 | **8.0** |
| Stats | 8 | 6 | 9 | 6 | 6 | 9 | **7.3** |
| Journal | 8 | 8 | 8 | 6 | 7 | 7 | **7.3** |
| Tasks | 7 | 8 | 8 | 6 | 8 | 6 | **7.2** |
| People | 8 | 8 | 8 | 6 | 7 | 6 | **7.2** |
| Mobile layout | 7 | 8 | 8 | 6 | 7 | 6 | **7.0** |
| Navigation (orb) | 6 | 7 | 9 | 6 | 7 | 6 | **6.8** |
| Toasts/feedback | 7 | 7 | 7 | 6 | 7 | 6 | **6.8** |
| System | 8 | 6 | 7 | 6 | 5 | 3 | **6.5** |
| Memory (brain/kn/pins) | 7 | 6 | 7 | 6 | 6 | 6 | **6.3** |
| Command palette/slash | 7 | 8 | 8 | 7 | 2 | 5 | **6.2** |
| Empty states | 7 | 6 | 7 | 5 | 6 | 6 | **6.2** |
| Error states | 6 | 6 | 5 | 6 | 6 | – | **6.0** |
| XP/reward visuals | 7 | 5 | 8 | 5 | 6 | 5 | **6.0** |
| Loading states | 6 | 5 | 7 | 4 | 5 | – | **5.3** |
| Goals (redirect) | 4 | 5 | 7 | 4 | 5 | 6 | **4.8** |

---

## 7. Biggest Friction Points

1. **The richest surface (⌘K) is desktop-only.** On Nour's primary device (iPhone PWA) there's no keyboard → no ⌘K, and slash commands are near-undiscoverable. Semantic brain-search, power actions, and probes are effectively unreachable on mobile. *(Code-inferred + live: no mobile ⌘K entry exists.)*
2. **The reward loop dies at the moment of reward.** Completing a task = one 2s auto-dismiss toast (`"✓ +N XP · 🔥 N-day streak"`), no celebration, no tap-through to `/stats`, and **day-1 streaks produce no toast at all**. XP/level only appears if you navigate to `/stats`. *(Verified `task-reward.ts` + live.)*
3. **No filter / search / sort on `/missions`** (the primary task surface). With many tasks across missions, the only way to find one is to scroll. The built filter (`TaskFilters`: kind/domain/search) is stranded behind the dead `/tasks` redirect. *(Code-inferred, agent-verified.)*
4. **Redundant surfaces with identical visual language** create "which is which?" confusion: two near-identical gold "Nick brief" cards (home vs missions); two identical sparkle chip-strips above the composer (PromptSuggestions vs NickSuggestions); two identical chip rows below replies (quickActions vs SmartReplies). *(Code-inferred + live.)*
5. **Loading states barely adopted.** A mature gold `PageSkeleton` exists but is used on one surface; most surfaces flash blank or unstyled text on slow loads. *(Code-inferred, agent-verified.)*
6. **Navigation has no persistent chrome.** The orb is elegant but a first-time/low-muscle-memory entry to depth pages is a multi-step (orb-tap → menu), and the orb can be flicked to a 2px sliver. No bottom tab bar despite stale comments claiming one. *(Observed live + code.)*
7. **Secondary touch targets leak below 44px** (slash rows ~40px, header overflow ~28px, reply chips ~26px, suggestion-dismiss ~32px, stall/retry ~24px) even though primary actions are correctly 44px. *(Code-inferred.)*
8. **Live `/system` hydration error (#418)** + **AVG LATENCY "0ms"** rendering a non-value as a number. *(Observed live.)*

---

## 8. Best Hidden Powers (present in code, hard to discover in UI)

1. **⌘K semantic second-brain search** — RRF fusion (FTS + vector) over memories + chat, plus relationship-logging by typing `name +N note`. Buried behind a keyboard shortcut. *(Code-inferred.)*
2. **Orb "SmartNow"** — context-aware "do this now" suggestion + Recent-3 jumps, tinted by urgency. Hidden one tap inside the orb. *(Observed live in code path; orb menu not expanded live.)*
3. **Active-task companion** — when a task is DOING, the home desk exposes ask-Nick / note / photo / voice-dictation / progress-log + a session event feed. *(Code-inferred.)*
4. **Per-task session logging** (notes, photos, voice transcripts tied to a task) — invisible unless a task is in flight. *(Code-inferred.)*
5. **BrainDump capture (⌘⇧J) from anywhere** — global modal; keyboard-only hint. *(Code-inferred.)*
6. **Journal deep-links + auto-reload** — `#bd-<id>` highlight, `?search=` seeding, live refresh when a chat tool writes a journal entry. *(Code-inferred.)*
7. **AI task classification with an approve/dismiss chip** — a real human-in-the-loop signal, only visible when confidence is low. *(Code-inferred.)*
8. **Adaptive composer placeholder** — surfaces live signals ("3 contradictions", "/brain to see all"); one of the only slash hints. *(Observed live + code.)*

---

## 9. Top 15 UI Opportunities (ranked)

Ranked by the brief's weighting: daily usefulness → clarity → motivation → low regression risk → no backend/migration → mobile → premium feel. **Owner** flags who should do it (see §13–14).

| # | Opportunity | Why it ranks | Owner | Risk |
|---|-------------|--------------|-------|------|
| 1 | **Mobile entry to the command palette** (a visible ⌘K/search button in the orb or composer that opens the existing CommandPalette) | Unlocks the single richest surface on the primary device | **Nick/Wiring** (touches command registry) | Med |
| 2 | **Make the reward moment land** — celebratory completion state + tap-through from toast to `/stats`; show day-1 streak | Fixes the broken motivation loop; high daily emotional payoff | **Cleaner** (owns reward feedback) | Low |
| 3 | **Restore filter/search on `/missions`** (re-mount the existing `TaskFilters`) | Daily task-finding is currently scroll-only | **Cleaner/Nick** (missions surface) | Med |
| 4 | **Adopt `PageSkeleton` everywhere** (replace bare/`.skeleton`/text loaders) | Removes blank-flash; pure presentational; big perceived-speed win | **UI (safe)** | Low |
| 5 | **Surface a lightweight XP/level glance in the daily loop** (small level/▲today chip on home or missions header) | Keeps progress visible during work, not only on `/stats` | **Cleaner** (XP visuals) | Low |
| 6 | **Differentiate the redundant chip/brief surfaces** (label or merge: home-brief vs missions-brief; quickActions vs smartReplies; PromptSuggestions vs NickSuggestions) | Removes "which is which" confusion | **Nick/Wiring** (chat) + **UI** (briefs) | Med |
| 7 | **Fix `/system` #418 hydration + "0ms" empty state** | Live error + false-zero data tell | **UI (safe)** | Low |
| 8 | **Add a persistent minimal nav affordance** (e.g. keep the orb always visible / a slim home-tab so depth is reachable without hunting) | Nav discoverability on mobile | **UI (safe)** | Med |
| 9 | **Raise all secondary touch targets to 44px** (slash rows, header overflow, reply chips, suggestion dismiss, stall retry) | Mobile ergonomics on the primary device | **UI** + **Nick** (chat chips) | Low |
| 10 | **Sign-post consolidations** (Goals→Stats anchor/scroll; a "Goals" tab on `/stats`) | Removes label→destination mismatch | **UI (safe)** | Low |
| 11 | **Replace violet/purple leaks with gold tokens** in `/system/*` + `/knowledge` | Restores the premium identity (anti-AI-slop) | **UI (safe)** | Low |
| 12 | **PersonEditDrawer: pre-fill all fields** (birthday/anniversary/cadence/phone/email) | Fixes a real edit defect / potential data loss | **UI (safe-ish)** | Low |
| 13 | **Pins: server-authoritative "injected" badge** (not sort-position) | Currently mislabels which pins are in the prompt | **UI/Cleaner** | Low |
| 14 | **Lengthen actionable toast duration** (≥4–5s or until-dismiss for reward/undo) | 2s is below readable-for-action | **UI (safe)** | Low |
| 15 | **Tame journal filter density on mobile** (collapse the 2 filter rows behind a control; add "load more" past the 100-cap) | Feed is pushed far down; silent truncation | **UI (safe)** | Low |

---

## 10. Top 5 Quick Wins (low risk, no backend, this-session-safe, high payoff)

> All are presentational/layout only; none touch chat route, command registry, reward/XP logic, missions reward, migrations, or prod data.

1. **`PageSkeleton` everywhere** (#4) — swap ad-hoc/missing loaders for the existing gold skeleton. Pure win, no logic.
2. **`/system` fixes** (#7) — make AVG LATENCY render an empty state like its siblings; fix the #418 time-render mismatch (`suppressHydrationWarning`/client-only time).
3. **Violet → gold** (#11) — replace the inherited purple tints in `/system/*` + `/knowledge` refresh button with palette tokens.
4. **Toast duration** (#14) — bump `duration` for actionable toasts to ≥4s (or `Infinity` + dismiss for undo/reward).
5. **Consolidation signposts + stale comments** (#10) — `/goals` and `/scoreboard` land with an anchor/section header on `/stats`; fix the stale `nav-items.ts` / orb docstrings ("Ultron/Nick/Actions", "bottom nav 4 wide" that doesn't exist) and the ⌘K "HQ Dashboard"→`/` label.

---

## 11. Top 5 Larger Upgrades

1. **Make progress visible in the daily loop** — a persistent, tasteful level/XP/streak glance on home + missions, plus a celebratory completion moment that tap-throughs to `/stats`. (The reward engine is honest and good; the *surfacing* is the gap.) — **Cleaner-owned.**
2. **Bring command power to mobile** — a first-class mobile launcher (button → existing CommandPalette) so semantic search + power actions + slash work on the phone. — **Nick/Wiring-owned.**
3. **Unify the "intelligence chip" system** — one labelled vocabulary for action-taken vs do-next vs proactive-suggestion vs typing-completion, instead of four identical-looking chip rows. — **Nick/Wiring (chat) + UI.**
4. **Missions task management at scale** — restore filter/search/sort + consider drag-reorder (vs per-tap server round-trips) + an in-place quick-edit for due/energy. — **Cleaner/Nick.**
5. **Mobile nav model** — decide between "orb-only" (and make depth reachable in ≤1 tap with discoverability) vs a hybrid persistent tab strip; resolve the stale "bottom nav" intent. — **UI + product decision.**

---

## 12. Cross-Cutting Findings

**Mobile issues** (all `Code-inferred` — no live mobile render): ⌘K unreachable; no persistent tab bar; depth pages need orb-tap→menu; secondary chips/menu rows <44px; audio-attach desktop-only in composer; auto-fire countdown pause is desktop-`onMouseEnter` only (runs full-speed on touch); StatCard tooltips invisible on touch; 8px goal-link text below iOS minimum; journal filter banks eat the fold. **Strong** mobile primitives where they exist: 44px on primary actions, 16px inputs (no iOS zoom), safe-area insets, bottom sheets, haptics, swipe + pull-to-refresh via `router.refresh()` (not full reload).

**Command discoverability issues:** slash commands have **no visible affordance** (only the rotating placeholder occasionally hints `/brain`, `/plan`); ⌘K and ⌘⇧J are keyboard-only on a phone-first app; ⌘K labels drift ("HQ Dashboard"→chat); many ⌘K commands resolve to the same page (`/system/calibration` ×7).

**Reward/XP visibility issues:** the entire reward surface = a 2s toast + a 9px streak glyph + a separate `/stats` page. No level-up moment, no in-loop XP, no toast→stats link, day-1 streak silent. `/stats` itself is excellent but you must go to it. *(⚠ Cleaner is actively changing this — commit `46fb2739` "surface task completion rewards" just shipped.)*

**Premium feel (an asset, not a problem):** dark-void + gold + monospace eyebrows + editorial type + restrained motion (orb halo, spring scroll, send-morph, ambient aura) is genuinely distinctive and **not** AI-slop. Protect it by killing the violet leaks and keeping emoji/rainbow accents disciplined.

---

## 13. What Should Wait for Cleaner

Cleaner is the **active writer** and recent `main` commits show its lane: completion rewards (`46fb2739`), command shortcuts, action-receipt feed, task-rescue scanner, system-change digest. **Do not touch:**
- Anything in **/missions reward feedback** or the completion-reward path (`lib/mastery/task-reward.ts`, the toast wiring) → Opportunities **#2, #5**.
- **XP / stat / goal logic** (`lib/mastery/**`) → the XP-glance (#5) and reward-moment (#2) must be Cleaner's.
- **Dead-code cleanup** of reward/scoreboard orphans (`MissionScoreboard`, `NicksScoreboardBrief`) — likely Cleaner's housekeeping lane; coordinate before deleting.
- The **`/missions` filter restore (#3)** touches the missions surface Cleaner is editing — coordinate.

## 14. What Should Wait for Nick / Wiring

The Nick/Wiring session (`statenour-nick-agent-gap-audit`) owns the agent + chat plumbing. **Do not touch:**
- **Chat route** (`app/(mastery)/chat/page.tsx`) and chat components' behaviour → the chip-dedup (#6), competing quickActions/smartReplies, auto-fire toast.
- **Command registry / ⌘K actions** (`components/command-palette.tsx`) → the **mobile command entry (#1)** and slash-discoverability work register against this; design the trigger UI but let Nick/Wiring own the registry change.
- **Slash command set** (`slash-command-dropdown` + its hook) and `page-context-bridge`.

## 15. Recommended Build Sequence (for a LATER session — do not build now)

**Wave A — UI-safe quick wins (this session's lane; no Cleaner/Nick overlap, no backend):**
1. `PageSkeleton` adoption (#4)
2. `/system` #418 + "0ms" empty state (#7)
3. Violet → gold tokens (#11)
4. Toast duration (#14)
5. Consolidation signposts + stale comments/labels (#10)
6. PersonEditDrawer field pre-fill (#12) · Pins injected-badge (#13) · 44px secondary targets that are *not* in chat (#9 partial)
7. Journal filter density + load-more (#15)

**Wave B — coordinate with Cleaner (reward/XP/missions):**
8. Reward moment + toast→stats tap-through + day-1 streak (#2)
9. In-loop XP/level glance (#5)
10. `/missions` filter/search restore (#3)

**Wave C — coordinate with Nick/Wiring (chat/command):**
11. Mobile command-palette entry (#1)
12. Unify/label the intelligence-chip surfaces (#6) + chat-side 44px chips (#9 remainder)

**Wave D — product decision then build:**
13. Mobile nav model — orb-only vs hybrid tab strip (#8, larger-upgrade #5)

---

## 16. Verification Notes (clarity-gate)

Claims marked "verified" were spot-checked against source at `43b63268`:
- `/goals` pure redirect — **verified** `app/(mastery)/goals/page.tsx:15-17`.
- Reward toast content / day-1-silent — **verified** `lib/mastery/task-reward.ts:24-32`.
- PersonEditDrawer blanks 5 fields on edit-open — **verified** `app/(mastery)/people/page.tsx:482-487` (save-path = **not observed**, so "potential data loss" is stated conditionally).
- No bottom tab bar / orb-only nav — **verified** `app/(mastery)/layout.tsx` (only `FloatingHome`) + observed live.
- `/system` #418 + "0ms" — **observed live** (console + screenshot, 2026-06-09).

Findings sourced from 4 read-only code-explorer agents (file:line-cited) + 8 live surfaces; cross-checked where flagged. Surface coverage of `/settings`, `/content`, `/market`, `/business`, `/voice`, and the 10 `/system/*` subpages is **code-only** this pass.

*End of audit. No code was changed. This document is the only file written.*
