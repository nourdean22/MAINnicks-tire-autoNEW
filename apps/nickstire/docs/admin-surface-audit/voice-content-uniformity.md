# Admin Surface Audit — Voice / Content / Command + Cross-Page Uniformity

**Date:** 2026-06-03 · **Worktree:** `nickstire-admin-audit` · **Stance:** kaizen + clarity-gate
**Method:** READ-ONLY. Code-audit of all ~31 `pages/admin/*.tsx` + `shared/*` primitives + live-drive
of Voice / CommandCenter / Content pages on prod (nickstire.org/admin, authed, Claude-in-Chrome, own tab).
**Legend:** `[C]` = CONFIRMED (file:line or live-obs) · `[I]` = INFERRED.
**Classification:** `FIX-NOW-safe` (behavior-neutral) · `OPERATOR-DECISION` (behavior/UX change) · `DEFER`.

Builds on `docs/admin-excellence/DESIGN.md` (Y1-Y13) and `docs/ADMIN_DFII_AUDIT.md` (wave-50).

---

## 0. Canonical building blocks (the uniformity yardstick)

The admin HAS a well-built shared design system in `client/src/pages/admin/shared/` (re-exported via
`shared.tsx`). These are the canonical primitives every section *should* compose: `[C]`

| Concern | Canonical primitive | File |
|---|---|---|
| Page header | `PageHeader` (+ `Section`) | `shared/layout.tsx:8` |
| Card / content block | `Panel` (square corners, accent variants) | `shared/layout.tsx:57` |
| Metric grid | `MetricGrid` + `StatCard` / `KpiTile` | `shared/layout.tsx:148`, `shared/cards.tsx:76` |
| Loading / empty / error | `LoadingState` / `EmptyState` / `ErrorState` | `shared/states.tsx` |
| Tabs | `TabBar` (border + pill variants) | `shared/table.tsx:197` |
| Search | `SearchInput` | `shared/table.tsx:272` |
| Clickable rows | `ClickableRow` + `RowAction` | `shared/table.tsx:35` |
| Filter chips | `FilterChips` | `shared/table.tsx:132` |
| Date formatting | `formatDate` / `formatDateTime` / `formatRelativeDate` / `timeAgoShort` | `shared/format.ts` |
| Confirm (iOS-PWA-safe) | `confirmDialog` | `components/admin/ConfirmDialog.tsx` |
| Toast | `sonner` (`import { toast } from "sonner"`) | — |
| Insight callout | `SectionInsightStrip` / `InsightStrip` | `shared/insight.tsx` |
| Colors | 3-signal palette (emerald/amber/red) + `primary`; **no purple/pink/cyan/violet/orange** | `shared/constants.tsx:31-53` |

**The gap is NOT a missing system — it's partial adoption.** Two notable holes in the system itself:
- **No shared MONEY formatter** in `shared/format.ts` (it only covers dates). Every section that prints
  dollars reinvents one → the #1 divergence below.
- `Panel` uses **square corners** but ~5 large sections use `rounded-lg`/`-md` raw cards → the most
  *visible* divergence below.

---

## 1. Cross-page uniformity findings (PRIMARY — the operator's core ask)

### U1 — Money formatting is fragmented across ≥7 private copies `[C]` · **FIX-NOW-safe**
**Canonical:** there are two *intentionally distinct* money formatters in `money/`:
`revenueFormat.ts:19 formatDollars(dollars)` (full precision `$1,234`) and
`moneyMath.ts:61 formatMoneyShort(dollars)` (compact `$1.2K`) — `revenueFormat.ts:7-9` explicitly says
"do not consolidate them." Fine. **The divergence is that everyone OUTSIDE `money/` re-defines their own
instead of importing one of the two:**
- `customers/CustomersBrief.tsx:42` → local `formatCents(cents)`
- `leads/LeadsBrief.tsx:53` → local `formatCents(cents)` (byte-identical to above)
- `WalkInCalculatorSection.tsx:53,57` → local `formatCents` + `formatDollars`
- `today/MorningBrief.tsx:39` → local `formatDollars(d)`
- `money/MoneyBrief.tsx:51` → `const formatDollars = formatMoneyShort` (alias — a 3rd name for the compact one)

Plus **~90 inline `$${Math.round(x/100).toLocaleString()}` / `$${x.toLocaleString()}`** scattered across
CommandCenter, Customers, Overview, DeclinedEstimates, WorkOrders, SettingsStatus, Snap, TireSalesPanel,
TrafficFunnel, etc. (full list in the formatter grep).

**Hazard (matches MEMORY #12):** `formatCents` takes *cents*, `formatDollars` takes *dollars*. Multiple
private copies of each name with different unit contracts = a latent 100× bug the moment a value is
copied across files. The earlier rename of CustomersBrief/LeadsBrief's cents-formatters to `formatCents`
(honest name) fixed the *naming* but left the *duplication*.

**Standardize:** add `formatCents(cents)` + `formatDollars(dollars)` + `formatMoneyShort(dollars)` to
`shared/format.ts` (move the two `money/` ones there verbatim; keep `money/` re-exporting for back-compat),
then delete the 5 private copies and import from `./shared`. Inline `toLocaleString` money can migrate
opportunistically. Pure refactor, identical output → tsc + the existing money tests are the gate.

### U2 — Card shape split: rounded vs square corners `[C]` · **OPERATOR-DECISION** (visual)
`Panel` (canonical) renders **square** cards (`bg-card border ${accent}` — no radius, `layout.tsx:88`).
But large sections render **rounded** cards via raw `rounded-lg`/`rounded-md`:
- `CommandCenterSection.tsx` — 23 `rounded*` (every card + the gradient banner) `[C]`
- `OverviewSection.tsx` — 42 `rounded*` `[C]`
- `WorkOrdersSection.tsx` — 35 · `money/DashboardView.tsx` — 39 · `SmsSection.tsx` — 24 `[C]`

Net: the operator sees **rounded corners on Today/Money/Voice/SMS and square corners on
Customers/Settings/Compliance** — same app, two visual languages. This is the most at-a-glance
"not uniform" signal. Decision needed: **square (Panel) is canonical → migrate the rounded sections**,
OR change `Panel` to `rounded-md` and standardize on rounded. (Recommend square = less work, matches the
already-canonical primitive.) Also: **166 raw `bg-card border border-border/{30,40}`** usages across 37
files that bypass `Panel` entirely — same root cause. `[C]`

### U3 — Off-palette colors (purple / pink / violet) `[C]` · **FIX-NOW-safe** (mostly)
`shared/constants.tsx:41-44` explicitly bans `text-purple-* · text-cyan-* · text-pink-* · text-yellow-* ·
text-orange-*`. Live deviations:
- **DispatchSection.tsx:86,345,409,478** — heavy `purple` for QC-review state (`bg-purple-600`, `text-purple-400`). `[C]`
- **voice/LiveCallsCard.tsx:41,48,57,64,67,135** — `violet` everywhere for the "greeted" call state + the
  whole card border/heading. `[C]` (one of my assigned pages — see V4.)
- **ContentSection.tsx:118,348** — `text-purple-400` for "AI Generations" stat + MATH archetype. `[C]`
- **LeadsSection.tsx:96,127,898** · **WorkOrdersSection.tsx:74** · **money/DashboardView.tsx:88,402** ·
  **money/TireSalesPanel.tsx:66** · **money/InvoiceListView.tsx:283** · **Customer360Panel.tsx:116** ·
  **settings/AlgProbeBudgetPanel.tsx:43** — scattered purple. `[C]`
- **settings/IgAutopostPanel.tsx:66,99** — `pink` (defensible: IG brand color; flag as a deliberate exception). `[C]`

**Standardize:** purple→`primary` (brand action) or a signal color per semantics; violet→`primary` for the
live-call accent. Note CustomersSection.tsx:310 already has a comment recording a prior purple→fix, so this
is a known, half-finished sweep. Behavior-neutral (CSS only).

### U4 — `CommandCenterSection` ships a private `timeAgo` `[C]` · **FIX-NOW-safe**
`CommandCenterSection.tsx:28` defines a local `timeAgo()` despite `shared/format.ts` exporting
`timeAgoShort` + `formatRelativeDate` for exactly this. (DESIGN.md's E-time item consolidated the
Compliance/Snap copies but CommandCenter still has its own.) Replace with `timeAgoShort` import; identical
output shape (`"5m ago"`, `"3h ago"`, `"2d ago"`) — only difference is "Never" for null, easily preserved
at the call site. `[C]`

### U5 — Date formatting still partly ad-hoc `[C]` · **FIX-NOW-safe**
`shared/format.ts` exists precisely because (its own header says) sections used `toLocaleDateString()` /
`toLocaleString()` ad-hoc. Adoption is incomplete — **bare locale-dependent calls remain** (format drifts
with operator locale, the exact bug the helper was made to kill):
- `LeadsSection.tsx:165,959` · `CouponsSection.tsx:133` · `ReviewRequestsSection.tsx:274-281,493` ·
  `WinBackSection.tsx:475-478,589` · `SpecialsSection.tsx:238-239` · `WorkOrdersSection.tsx:441,575` ·
  `OverviewSection.tsx:1138` — `new Date(x).toLocaleString()` / `.toLocaleDateString()` with **no args**. `[C]`

**Standardize:** route through `formatDate` / `formatDateTime` / `formatRelativeDate`. Behavior-neutral
(pins en-US, adds null-safety `—`). Defensible exceptions: VapiPanel/AlgProbeBudget pass explicit en-US
options already (consistent enough).

### U6 — Page-header inconsistency: 2 top-level sections skip `PageHeader` `[C]` · **FIX-NOW-safe**
30/32 top-level sections use the canonical `PageHeader`. Deviants:
- **CampaignsSection.tsx** — NO `PageHeader`, no heading at all (`[C]` grep + live: the "Outreach" title
  comes only from the outer shell). Jumps straight into stat cards + a view switcher. Add `PageHeader
  title="Outreach"`.
- **OverviewSection.tsx** — rolls its own bespoke header (`[C]`). Today/Overview is the densest hand-built
  page; lower priority but worth aligning the title block.

### U7 — The "Brief" family is consistent-by-copy-paste, not by component `[C]` · **DEFER / OPERATOR-DECISION**
There's a family of 3-line auto-narrative cards: `VoiceBrief`, `customers/CustomersBrief`,
`leads/LeadsBrief`, `outreach/OutreachBrief`, `money/MoneyBrief`, `today/MorningBrief`. They LOOK uniform
because devs copied the pattern — but each independently: rolls its own card container (`bg-card border
border-border/40 rounded-lg p-4`, not `Panel`), redefines its own `formatDuration`/`formatCents`/
`formatDollars`/`greeting`, and writes its own loading shimmer. `[C]` (VoiceBrief.tsx:47,54,77;
CustomersBrief.tsx:42; LeadsBrief.tsx:53; MorningBrief.tsx:39). Fragile (U1's 100× hazard lives here).
A shared `<Brief>` shell (header + signal-line rows + loading state) would make the family uniform by
construction. Larger refactor → DEFER, but it's the structural root of U1/U2 in these files.

### U8 — Two parallel theming systems mid-migration `[C]` · **OPERATOR-DECISION** (context, not a defect)
Live DOM shows a **"Toggle admin theme — preview the neutral redesign"** button + "Grit"/"light mode"
toggles in the top bar (`[C]` ref_23/ref_34 on every page). Most sections use Tailwind semantic tokens
(`bg-card`, `text-foreground/X`, `border-border/30`). But **voice/LiveCallsCard.tsx:112,118,135** uses raw
CSS vars (`var(--bg-base)`, `var(--text-tertiary)`, `var(--border-default)`) — a different token vocabulary.
Any uniformity/standardization pass MUST land on whichever token system the in-flight "neutral redesign"
is settling on, or it'll be redone. **Flag to operator: which theme system wins?** before mass color/card edits.

---

## 2. My assigned pages — page-specific findings

### VoiceReceptionistSection.tsx (+ voice/ subdir)
Overall: the **best-maintained** of my three. Uses `PageHeader`, `Panel`, `MetricGrid`, `StatCard`,
`EmptyState`, skeleton loaders; clean ELON-cut history (5→3 KPI tiles, dead OutboundCallCard removed).
Live: renders clean, "QUIET DAY" badge, 0 console errors. `[C]`

- **V1 — Inline search + sort instead of shared primitives** `[C]` · FIX-NOW-safe.
  `VoiceReceptionistSection.tsx:304-328` hand-rolls a search `<input>` + sort `<select>` with bespoke
  classes instead of `SearchInput` (`shared/table.tsx:272`). Use the shared component for visual + behavior
  parity with the rest of admin.
- **V2 — `voice/FilterChip` is a one-off, not shared `FilterChips`** `[C]` · DEFER.
  The voice page has its own `FilterChip.tsx`; admin's canonical is `shared/table.tsx FilterChips`. Different
  shape (count-badge chips vs clear-filter chips) so not a drop-in — note as a divergence, low priority.
- **V3 — voice cards bypass `Panel`** `[C]` · OPERATOR-DECISION (ties to U2).
  `TransferDestinationCard.tsx:152,161,174` and `LiveCallsCard.tsx:57` render raw `bg-card border ... rounded`
  containers + bespoke inline loading skeleton (`TransferDestinationCard.tsx:150-156`) and a bespoke error
  block (`:159-171`) instead of `Panel` + `ErrorState`/`EmptyState`.
- **V4 — `LiveCallsCard` violet + raw CSS-vars** `[C]` · FIX-NOW-safe (color) / OPERATOR-DECISION (tokens).
  `LiveCallsCard.tsx:41-67,135` uses banned `violet` for the live-call accent AND mixes `var(--bg-base)` /
  `var(--text-tertiary)` (U8 token split). The other 3 call states (blue/amber/emerald) are on-palette;
  only "greeted"→violet is off. Map violet→`primary`.
- **V5 — `voice/format.ts` `fmtTime` duplicates date logic** `[C]` · DEFER. Voice keeps its own `fmtDuration`/
  `fmtTime`/`fmtPhone`. `fmtTime` overlaps `formatDateTime`; `fmtPhone`/`fmtDuration` are voice-specific
  (legit). Low priority.

### ContentSection.tsx
Good structure: `PageHeader`, `TabBar` (Manager/Ideas/Specials), `StatCard`, `LoadingState`/`ErrorState`,
`sonner`, lazy Specials. Live: renders clean, 13 articles, 0 console errors. `[C]`

- **CT1 — GBP post generator produces ZERO variety (live)** `[C]` · OPERATOR-DECISION (content quality).
  Live "POST HISTORY · LAST 14 (variety window)" = **14/14 identical rows: `Jun 1 · MATH · cron · FREE
  INSPECTION`**. The code's `gbpPostHistory` "variety guard window" (ContentSection.tsx:334) is displaying
  but the cron is generating the same MATH/"FREE INSPECTION" post every run. Compounds **Y1** (DESIGN.md:
  gbpContentGenerator fabricates names/testimonials/prices → FTC risk): the thing is *both* monotonous *and*
  fabricating. Strengthens the case to gate or rework the GBP generator before it keeps posting to Google.
- **CT2 — Dual content surfaces** `[C]` · OPERATOR-DECISION.
  ContentSection links out to a SEPARATE legacy full-page route `/admin/content` (`App.tsx:241` →
  `AdminContent`) **twice** (ContentSection.tsx:130 "OPEN" button + the top-bar "AI Content" link
  Admin.tsx:623). This is the only admin section that punts to a non-SPA route — split brain. Decide:
  fold the full manager into the SPA tab, or drop the in-section duplicate link.
- **CT3 — `toLocaleDateString` in GBP history** `[C]` · FIX-NOW-safe. ContentSection.tsx:343 ad-hoc date
  (covered by U5). Articles list correctly uses `formatDate` — so it's inconsistent *within the same file*.
- **CT4 — purple "AI Generations" stat** `[C]` · FIX-NOW-safe (U3). ContentSection.tsx:118.

### CommandCenterSection.tsx (Y12 — sharpened)
This is the headline. **Confirmed nav-dead AND wrapping a BROKEN integration.** `[C]`

- **CC1 — Nav-orphaned** `[C]`. Still in `AdminSection` union (`types.ts:16`) + routed
  (`Admin.tsx:81 section==="commandCenter"`), so URL-reachable at `?section=commandCenter`, but **NOT in the
  6-item sidebar** (`nav.tsx:41-57`). The nav file's own comment (`nav.tsx:35-37`) says it was killed:
  *"NOUR OS Bridge → 433 lines for 2 hyperlinks + a status dot; links live in the sidebar footer already."*
- **CC2 — The bridge is DOWN in prod (live)** `[C]`. Live: Bridge Status = **"Error"**, Last Sync =
  **"Never"**, Bridge Error = **`HTTP 404: DEPLOYMENT_NOT_FOUND sfo1::gvb87-...` (Vercel)**. The push target
  is a dead Vercel deployment. So "Push to NOUR OS" / "Events Synced" / `totalEventsSent` push into a 404.
- **CC3 — "Recent Events" is a wall of identical noise (live)** `[C]`. 20+ rows, every one
  `nickstire:vendor_health` with the same JSON — no variety, just the vendor-health cron echoing.
- **CC4 — Its content duplicates the sidebar footer** `[C]`. The banner's "Ask Nick" + "Open NOUR OS"
  (CommandCenterSection.tsx:91-108) duplicate the always-present sidebar footer links (Admin.tsx, live
  ref_26/ref_27).
- **CC5 — Worst U2/U4 offender** `[C]`. 23 `rounded*` cards + gradient banner (`:77`) + private `timeAgo`
  (`:28`) + raw `toLocaleString` money (`:189,325,333`).

**Recommendation (sharpening Y12):** the page is a 439-line zombie around a broken (404) integration whose
only working parts (2 links + a status dot) already exist in the sidebar footer. **Strong DELETE candidate**
— remove `CommandCenterSection.tsx`, the `commandCenter` union member + Admin.tsx route + lazy import, and
the `nourOsBridge` tRPC surface if nothing else consumes it. If the operator wants to keep NOUR-OS visibility,
reduce to a single status dot in the footer. **OPERATOR-DECISION** (delete vs fix the bridge), but the
evidence says delete.

---

## 3. Confirmed uniformity WINS (don't "fix" these)

- **`confirmDialog` is fully adopted** `[C]`. Zero raw `window.confirm/alert/prompt` remain in admin
  sections (grep: only in migration comments + one test asserting the inline-input pattern). iOS-PWA-safe
  everywhere. This is the standardization model to copy for the other patterns.
- **`sonner` toast is universal** `[C]` (32 files). No `alert()` for feedback.
- **`PageHeader` is near-universal** (30/32) and `StatCard`/`MetricGrid` are broadly used.
- **voice/format.ts already trimmed** dead `VAPI_LINKS` (DESIGN.md D-links) — only `callDetail` remains,
  and it IS used (LiveCallsCard.tsx:131, CallDetailsDrawer). `[C]`
- **Palette is documented** (`constants.tsx:31`) with a single `CHART_THEME`/`CHART_COLORS` source — the
  rules exist, they just need enforcement (U3).

---

## 4. Top-5 highest-leverage fixes (ranked)

1. **U1 — Centralize money formatters** into `shared/format.ts`; delete 5 private `formatCents`/`formatDollars`
   copies. Kills the 100× cents/dollars hazard. FIX-NOW-safe, pure refactor.
2. **CC / Y12 — Delete CommandCenterSection** (nav-dead + 404-broken bridge + duplicates footer links).
   ~439 LOC + a dead tRPC surface gone. OPERATOR-DECISION (delete recommended).
3. **U2 — Standardize card shape** (square `Panel` as canon; migrate the 5 rounded sections + 166 raw
   `bg-card` usages). The most visible "not uniform" signal. Sequence AFTER U8 theme decision.
4. **U3 — Purple/violet → palette sweep** (Dispatch, LiveCallsCard, Content, Leads, +others). Finishes a
   half-done sweep. FIX-NOW-safe, CSS-only.
5. **U5 + U4 — Route ad-hoc dates through `shared/format.ts`** + replace CommandCenter's private `timeAgo`.
   FIX-NOW-safe.

**Blocking question for the operator (U8):** there is a live "neutral redesign" theme toggle in the admin.
Confirm which token system (Tailwind semantic tokens vs `--bg-base`/`--text-*` CSS vars) is the target
BEFORE any mass color/card-shape edits — otherwise U2/U3 get redone.

**Also surface to operator:** CT1 (GBP generator posts the identical "FREE INSPECTION / MATH" post every
cron run, live-confirmed) reinforces the deferred Y1 FTC concern — the generator is both fabricating and
monotonous.
