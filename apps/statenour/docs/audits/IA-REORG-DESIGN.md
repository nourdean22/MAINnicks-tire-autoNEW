# statenour — IA Reorganization Design Doc

**Status:** DESIGN — awaiting operator approval before implementation. Read-only audit; no code changed.
**Repo:** `apps/statenour` (Next 16 App Router · tRPC · Prisma/Neon · Railway → bdnick.info · iOS PWA, phone-primary)
**Stance:** kaizen (surgical, standardize) · karpathy (simplest thing that works, verifiable) · frontend-design (no AI-slop) · mobile-design (44px, thumb-zone) · database-architect (rollback before destructive moves)
**Branch rule:** never push main; one `statenour/<task>` branch per phase. No schema/migrations needed.
**Provenance:** 13-agent read-only workflow (5 audit lenses → 3 judged IA proposals → synthesis → adversarial review). Adversarial fixes folded into §3 and §6 below.

---

## 1. Master audit — the verified state

35 page routes. One flat `NAV_ITEMS` array sectioned only by code comments. cmdK (`command-palette.tsx`) hardcodes ~50 actions with **zero** shared source with the nav array. The orb (`floating-home.tsx`) renders neither the DEPTH nor MISC nav sections. **There is no bottom tab bar** — the only `fixed bottom-0` element is `BottomPulseTicker` (21px read-only ticker). cmdK has **no tap trigger** (`setOpen(true)` lives only in the keydown handler) — on a keyboardless iOS PWA, ~50 destinations are unreachable.

| Problem class | Count | Verified specifics |
|---|---|---|
| 🔴 **Orphan pages** (in no nav surface, phone-unreachable) | **9** | `/crm` `/finance` `/wealth` `/learn` `/system/alerts` `/system/inbox` `/system/cockpit-observability` + `/goals` `/scoreboard` (un-surfaced redirect stubs) |
| 🔴 **Money nav entries** | **0** | No `/money` `/finance` `/wealth` `/crm` entry anywhere in `nav-items.ts` (only comment L143). Reachable only by URL or sibling-app short-links. |
| 🟠 **Shadowed-dead pages** (real page + linked, but redirect wins) | **2** | `/system/tools` (next.config L196 → `/system`, linked from `hub-grid.tsx:160` + `tool-result-registry.tsx:563`) · `/system/proactive-preview` (L211 → `/system`, linked from `hub-grid.tsx:216`) |
| 🟠 **cmdK label-theater** (distinct labels → generic hub) | **~10** | ~7 labels (Quality, Anti-patterns, Operator State, Judge-eval, Lens Stats, Stale Data, Calibration) → `/system/calibration`; ~4 (Devices×2, Power, API Tokens) → `/system` |
| 🟠 **Dead nav data dimensions** | 3 | `systemTab`, `pulseKey`, `SYSTEM_TABS` — declared, never read by any renderer (`pulseCount` retired `floating-home.tsx:102-108`). ⚠ `mobileTab` is NOT dead (see §6 fix). |
| 🟠 **Unrendered nav entries** | 12 of 22 | DEPTH + MISC sections iterate nowhere; survive only via cmdK or URL |
| 🟡 **Money double-render** | 1 | Personal-finance grid (`financial-tab.tsx:330-379`) duplicates `/wealth`'s `investmentValue` inside `/business?tab=money` |
| 🟡 **Three-way nav drift** | — | `NAV_ITEMS` (data) / cmdK (hardcoded) / orb (renders neither) drift independently; already drifted ("HQ Dashboard"≠Home, "Tasks/Actions"≠Missions) |
| 🟢 **Zombie stubs** (clean) | 2 | `/goals` → `redirect("/stats#goals")`, `/scoreboard` → `redirect("/stats")` — already-correct in-page stubs |
| 🟢 **Dead components / API (0 importers)** | — | `components/scoreboard/` (2 files) · `components/plan/goal-next-actions-card.tsx` (the unmounted `/plan` card). ⚠ `app/api/goals/next-actions/route.ts` is NOT dead — see §6 fix #4. |

**Phone reachability today:** ~10 of 32 pages tappable without typing a URL. Six (`/crm /finance /wealth /voice /decisions /learn`) are invisible in **every** surface (orb AND cmdK).

**Load-bearing invariants a reorg MUST NOT break** (VERIFIED): (a) `lib/services/*` (162 files) is the **sole** business-logic layer — routers stay thin delegators; legacy REST route + tRPC procedure call the *same* service fn (drift-proofing); (b) `lib/validators/*` zod = the shared REST↔tRPC contract; (c) `(mastery)/layout.tsx` provider order — `TRPCProvider` outermost; (d) `MegaConfirmHost` (layout L95) is the in-DOM two-tap confirm — the PWA suppresses `window.confirm`.

---

## 2. Recommended target IA — MOBILE-FREQUENCY-FIRST (+ grafts)

Phone-primary, no keyboard → the operator's real mental model is **tap-depth ranked by daily-touch frequency**. Lowest conceptual delta from today = smallest blast radius. Grafts the judges pulled from the runners-up: **verb section labels** (jobs-to-be-done), **307-first redirect discipline**, **no-number-disappears rule** (domain-first), **don't over-fold** low-frequency surfaces, and the universal freebie — **cmdK tap-trigger + cmdK iterates the single NAV source** (makes a stale label structurally impossible).

### Bottom tabs (5, fixed, `env(safe-area-inset-bottom)`, 44px+)

| Slot | Tab | Route | Why daily |
|---|---|---|---|
| 1 | **Home** | `/` (chat-home) | Default surface; "home IS Nick." |
| 2 | **Missions** | `/missions` | Execution loop |
| 3 | **Journal** | `/journal` | Reflection loop |
| 4 | **Stats** | `/stats` | Plan/review loop |
| 5 | **More** | → launcher sheet | Index for everything else |

Slots 1–4 are *exactly* the four surfaces `lib/floating-home/smart-now.ts:93-146` already rotates by time-of-day — match the engine, don't guess. **Admin↗ demoted out of primary** → External row in the MORE footer. **Swipe-nav extended to include Stats** (today only Home↔Missions↔Journal).

### MORE sheet (replaces the lost-in-space orb)

Full-height thumb-scrollable bottom sheet. **Top: 🔍 Search button wired to `setOpen(true)`** (the #1 fix — unblocks ~50 destinations on a keyboardless device). Sections by verb, data-driven + reorderable:

```
🔍 Search…
CAPTURE   Voice · Pins
EXECUTE   Content · Market · Knowledge · Learn · Photo Improver
REFLECT   Brain · People
MONEY     Money · Business
OPERATE   System
────────────
Settings · Admin ↗ (external)
```

Recent-3 + SmartNow suggestion carry to the top. Orb retired as primary; if kept as a quick-capture FAB, widen the peek sliver from `w-2` (~8px) to ≥44px and auto-restore on route change (VERIFIED stranding bug `floating-home.tsx:328`).

**Tally: 35 routes → 5 tabs + ~14 MORE rows + 11 system-hub children + 3 hidden (`/decisions/[id]`, `/auth/sign-in`, `/chat` alias) + 5 redirected. 0 phone-unreachable. 0 shadowed-dead left.**

---

## 3. Disposition of every problem page (adversarial fixes folded in)

| Route | Problem | Decision | Action |
|---|---|---|---|
| `/crm` | Orphan | **BUILD `/business?tab=clients` tab, THEN redirect (same deploy)** ⚠fix#2 | port crm body → Clients tab; `307 /crm → /business?tab=clients` only after tab renders |
| `/finance` | Orphan | **REDIRECT, keep page body as tab** | `307 /finance → /money?tab=finance` |
| `/wealth` | Orphan; needs `FINNHUB_API_KEY` (IA-independent) | **REDIRECT, keep page body as tab** | `307 /wealth → /money?tab=wealth` |
| `/learn` | Orphan | **SURFACE** — flat MORE row (Execute) | add to NAV |
| `/photo-improver` | In array, rendered nowhere, not in cmdK | **SURFACE** — MORE row (Execute) | renders via new model |
| `/knowledge` | cmdK-only | **SURFACE** — flat MORE row (Execute) | add to NAV |
| `/pins` | Unrendered nav entry | **SURFACE** — flat MORE row (Capture) | renders via new model |
| `/voice` | Fully orphaned (outside `(mastery)`, no confirm host) | **SURFACE** — MORE row (Capture) + cmdK; keep outside layout (focused mode) | add to NAV + cmdK |
| `/system/alerts` `/system/inbox` `/system/cockpit-observability` | Orphans | **SURFACE** — `/system` hub tiles + cmdK | hub-grid tiles |
| `/system/tools` `/system/proactive-preview` | Shadowed-dead | **UN-SHADOW** — remove next.config L196/L211; **verify pages render** ⚠fix#6 | hub links resolve |
| `/goals` `/scoreboard` | Un-surfaced redirect stubs | **KEEP-HIDDEN as-is** (lower churn) | leave stubs; delete dead `components/scoreboard/` |
| `/decisions/[id]` | Deep-link only | **KEEP-HIDDEN** (correct — dynamic detail) | none |
| cmdK ~10 theatrical labels | Label theater | **DELETE** when cmdK iterates NAV (Phase 3) | structural |
| `components/plan/goal-next-actions-card.tsx` | Unmounted card, 0 importers | **DELETE** card only | ⚠fix#4: KEEP `app/api/goals/next-actions/route.ts` + its service (live REST↔tRPC mirror) |

---

## 4. Money & relationship surfaces — final decision

Three clean buckets split by **audience**:

1. **NEW `/money` (PERSONAL wallet)** — two tabs mirroring the proven `business/page.tsx` PageTabs pattern: `?tab=finance` (current `/finance` ledger) + `?tab=wealth` (current `/wealth` portfolio). **Top summary strip:** net cashflow + portfolio value + net worth. `307` `/finance` + `/wealth` → `/money?tab=*`; page bodies become the tab panels. **+1 nav entry, −2 orphans.**
2. **De-dup `/business?tab=money`** — strip the bolted-on personal-finance grid (`financial-tab.tsx:330-379`); `/money` owns net-worth now; `/business` becomes pure Nick's-Tire revenue/target/forecast. **Bound by the no-number-disappears rule:** grep grid consumers first, move the *render* but keep the `FinancialSnapshot` data path, net-worth must appear in `/money`'s strip on the **same deploy**.
3. **`/crm` → `/business?tab=clients`** (Money · Funnel · Clients): coaching pipeline sits adjacent to the funnel it feeds; zero new top-level items.
4. **`/people` stays separate from `/crm`** — VERIFIED distinct tables (`PersonProfile` = inward strategic dossier; `Contact` = outward coaching pipeline). Add only a one-way **"Track in Power Atlas"** action (CRM Contact → `PersonProfile` via existing `source` field, routed through `MegaConfirmHost`, **no auto-sync** — email/phone are display-only, not match keys).

---

## 5. Code-structure changes (nav/route surgery only — no logic moves)

- **(a) `nav-items.ts` → sectioned data model** — one source the bar + MORE sheet + cmdK all read: `section` (capture/execute/reflect/money/operate), `bottomTab`, `flatRow`, `external`, `tabs[]`. Exports `BOTTOM_TABS`, `bySection()`. Delete genuinely-dead `systemTab`/`pulseKey`/`SYSTEM_TABS`. Collapse 5 duplicate `?tab=` entries into 3 canonical parents.
- **(b) cmdK becomes a NAV consumer** — navigation group = `NAV.map(...)`; keep only genuine *action* commands hardcoded. Structurally deletes the ~10 theatrical labels and fixes drift.
- **(c) New components** — `components/layout/bottom-tab-bar.tsx` (fixed, safe-area, active-state via `lib/nav/active-nav.ts`) + `components/layout/more-sheet.tsx`. Mount in `(mastery)/layout.tsx`.
- **(d) `/system` hub owns its sub-nav** — `hub-grid.tsx` is canonical index; add tiles for alerts/inbox/cockpit-observability + un-shadowed tools/proactive-preview.
- **(e) New `/money` route** — `app/(mastery)/money/page.tsx` (PageTabs). Page→tRPC→service chain unchanged.
- **(f) `next.config.ts`** — ADD `307`s `/finance`→`/money?tab=finance`, `/wealth`→`/money?tab=wealth`, `/crm`→`/business?tab=clients`; REMOVE L196 + L211.
- **(g) Opportunistic** — wrap touched/new pages in `<StandardPage>` (only 20/33 use it today). Not a gate.
- **(h) Deferred cosmetic** — rename `components/relationships/`→`people/`; bucket `lib/services/*` (162 flat files). Separate PRs, not nav-blocking.

---

## 6. Phased plan (each = one reversible `statenour/<task>` branch; gate `pnpm typecheck && pnpm lint && pnpm test`)

**Keep the orb mounted as live fallback until Phase 4 flips it. Verify each phase on the real iOS PWA before deleting anything.**

- **Phase 0 — `statenour/dead-code-cleanup`** (pure delete, instant revert). Delete `components/scoreboard/`, `components/plan/goal-next-actions-card.tsx` (⚠ NOT the API route — fix#4). Un-shadow: remove next.config L196/L211; **confirm both pages render without error** (⚠fix#6), then verify hub-grid links resolve. *Pre-step (⚠fix#5):* grep outbound `bdnick.info/<path>` strings in `lib/services/email.ts`, `lib/ai/tools/*`, cron notifiers; confirm each still resolves (flag the pre-existing broken `/drift` email link as out-of-scope).
- **Phase 1 — `statenour/cmdk-tap-trigger`** (universal freebie, ship first). Add 🔍 Search button calling `setOpen(true)`; add the 5 missing targets (`/crm /finance /wealth /voice /learn`) to cmdK as a stopgap.
- **Phase 2 — `statenour/nav-items-sectioned`** (additive — old array still works). Introduce sectioned model alongside existing exports; surface 9 orphans; collapse duplicate `?tab=` entries; add `/system` hub tiles.
- **Phase 3 — `statenour/cmdk-iterates-nav`** (kill drift). cmdK derives from NAV; delete ~10 theatrical labels; delete dead `systemTab`/`pulseKey`/`SYSTEM_TABS`. ⚠**fix#1: do NOT delete `mobileTab` here** — `swipe-navigation.tsx:5,25` + `floating-home.tsx:32,449` still consume `MOBILE_TABS`. Defer `mobileTab` removal to Phase 4 (or alias it to `bottomTab`). Phases 3 & 4 share `nav-items.ts` — sequence strictly, not parallel.
- **Phase 4 — `statenour/bottom-tab-bar`** (the visible flip). Build `bottom-tab-bar.tsx` + `more-sheet.tsx`; mount in `layout.tsx` (preserve MegaConfirmHost L95); extend swipe to Stats; demote Admin↗; retire orb as primary; **now** remove `mobileTab`. Rollback = unmount 2 components + restore orb (no data implication). Full phone pass.
- **Phase 5 — `statenour/money-hub`** (the one data-touching phase). Build `/money` (PageTabs + summary strip) **and** `/business?tab=clients` (CRM port) **before** their redirects (⚠fix#2, same deploy). Strip `financial-tab.tsx:330-379` bound by the no-number-disappears rule. Add 307s. Add "Track in Power Atlas" via MegaConfirmHost. ⚠**fix#3: short-links live in the sibling bdnick.info app** — re-pointing them is an EXTERNAL, operator-owned dependency; do NOT block statenour's 308 promotion on it.
- **Phase 6 (deferred)** — cosmetic rename + `lib/services/*` bucketing.

**Calibration window:** after Phase 4, week 1 = data-gathering. Top reorder candidate: promote `/money` toward a 5th content tab if the daily money-glance out-ranks Stats (one-line array change).

---

## 7. Adversarial verdict

**SHIP-WITH-FIXES** — folded above: #1 `mobileTab` ordering (HIGH), #2 build Clients tab before `/crm` redirect (HIGH), #4 don't delete the shared service (MED), #3/#5 scope corrections, #6 render-check before un-shadow. No `window.confirm/alert/prompt` dependency in any proposed UI change. The taxonomy and the universal cmdK fix are sound; the only breakage was in phase ordering and redirect-target sequencing, now corrected.
