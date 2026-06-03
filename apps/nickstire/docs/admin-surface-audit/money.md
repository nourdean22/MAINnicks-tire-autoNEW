# Admin Surface Audit — MONEY pages

**Date:** 2026-06-03 · **Auditor:** read-only pass (kaizen + clarity-gate)
**Scope:** `RevenueSection` (+ `money/` subdir), `MembershipsSection`, `CouponsSection`,
`LoyaltyAdminSection`, `WalkInCalculatorSection`, `SpecialsSection`.
**Method:** read each `.tsx` → trace tRPC router → schema → live-drive prod
(nickstire.org/admin, operator's authed Chrome, own tab) → cross-check.

Every finding is tagged **CONFIRMED** (file:line or live-observation) or **INFERRED**.
Classifications: **FIX-NOW-safe** (no behavior change / pure correctness) ·
**OPERATOR-DECISION** (changes business behavior or pricing) · **DEFER** (low value or
needs design).

> Builds on prior `docs/admin-excellence/DESIGN.md` (Y1–Y13). Already-deferred items
> Y9 (WalkIn over-quote) and Y13 (coupon cap) are **confirmed + sharpened** below, not
> re-litigated. New issues are marked NEW.

---

## Navigation reality (context for the whole group)

The "MONEY" admin group is **not one place**. Live routing (CONFIRMED via Admin.tsx
section switch + live drive):

| Page | Reachable at | Mount |
|---|---|---|
| RevenueSection | `?section=revenue` (alias `?section=money`) | top-level section |
| MembershipsSection | `?section=memberships` | top-level (no sidebar slot — by design) |
| CouponsSection | `?section=customers&customersTab=coupons` | tab inside **Customers** |
| LoyaltyAdminSection | `?section=customers&customersTab=loyalty` | tab inside **Customers** |
| SpecialsSection | `?section=content&contentTab=specials` | tab inside **Content & AI** |
| WalkInCalculatorSection | event-bus drawer (`WalkInQuoteDrawer`, no URL) | global drawer |

This is the wave-181 IA (Money hub = invoices/declined/financing only). Worth knowing:
coupons/specials/loyalty are "money levers" but live under Customers/Content — fine, but
it means an operator hunting for "where do I set a promo" has three different homes.

---

## RevenueSection + money/ subdir

| # | Dim | Status | Evidence | Issue | Proposed fix | Class |
|---|-----|--------|----------|-------|--------------|-------|
| R1 | deficit | **CONFIRMED** | live-obs revenue page: `MoneyBrief` stuck on "Loading money brief…" while full dashboard below rendered with data; gate `MoneyBrief.tsx:74` `if (!stats \|\| !kpi \|\| !declined \|\| !intel)` | The 3-line MoneyBrief (the entire point of Money Phase 2) is **perpetually invisible in prod**. It runs its OWN 5 query instances; the dashboard renders fine off its own copies, so one of brief's queries (likely `invoices.declined`/`intelligence`) never resolves *for the brief* and it's stuck on the shimmer. Operator never sees velocity/pipeline/action lines. | Investigate why brief's `declined`/`intel` don't resolve (query-key mismatch vs RevenueContent's? error swallowed?). Likely fix: relax the gate to render velocity from `stats`+`kpi` alone and lazy-fill pipeline/action lines, instead of all-or-nothing. | **FIX-NOW-safe** (after root-cause) |
| R2 | correctness/consistency | **CONFIRMED** | live-obs: top KPI "Total Revenue" **$53,620** (30d) vs DEEP intel "Total Revenue" **$54,115** (30d) vs MONTHLY PACE **$42,563**, same screen. Code: `invoices.ts:325` `stats` uses JS `cutoff.setDate(-days)` (rolling, tz-naive) + `toISOString().split` UTC-day buckets; `invoices.ts:415` `intelligence` uses `DATE_SUB(CURDATE(), INTERVAL n DAY)` (server-local midnight) | Two "30-day" windows compute **different totals** for the same metric on the same page. Confusing and erodes trust in the numbers. UTC-vs-local-midnight + rolling-vs-calendar boundary. | Pick one window definition and share it. Simplest: have `intelligence` and `stats` both use `DATE_SUB(CURDATE(), INTERVAL n DAY)`; ensure byDay grouping uses local date not `toISOString()`. | **FIX-NOW-safe** |
| R3 | deficit | **CONFIRMED** | live-obs: "LABOR vs PARTS SPLIT" shows **$81 (0%) labor / $384 (1%) parts** while Total Revenue $54,115 | Imported (`source='shopdriver'`) invoices carry rolled-up totals with `laborCost`/`partsCost` ≈ 0 (ALG REST gives no split — stated `InvoiceListView.tsx:253`). The panel renders "0% / 1%", which reads as broken to the operator. Same root makes SERVICE BREAKDOWN collapse to one "Other $12,358 / 24 jobs" row (REGEXP finds little; 24 jobs vs 105 invoices is the window gap too). | Either (a) hide LABOR/PARTS + SERVICE panels when `laborTotal+partsTotal` is a tiny fraction of revenue (honest empty-state: "ALG doesn't expose line items"), or (b) label them "where captured" so 0% isn't mistaken for a bug. | **OPERATOR-DECISION** (what to show) |
| R4 | deficit | **CONFIRMED** | live-obs: DEEP intel "Unique Customers" (ref_162) and "Active Days" (ref_163) and "Churn Risk" tile (ref_295) rendered with **no value** | A few KPI tiles show a label with a blank/empty value (the number node was absent in the a11y tree). Likely `0`/`undefined` rendering as empty rather than "0" or "—". | Default these to `0`/`—` explicitly so a tile never shows a label with no number. | **FIX-NOW-safe** |
| R5 | correctness | **INFERRED** (live numbers + code) | live-obs CUSTOMER INTELLIGENCE: Whales 760 / Regulars 943 — vs ~105 paid invoices/30d. `custIntel` = `customers.intelligence` (all-time tiers) shown inside a period-scoped revenue dashboard | Spend-tier counts are **all-time** but sit under "DEEP REVENUE INTELLIGENCE" with a period selector → reads as in-period. 760 whales is plainly not a 30d figure. Mixing all-time and period scopes in one section misleads. | Label the Customer Intelligence block "all-time" (it ignores the intel period), or scope it. Confirm `customers.intelligence` tier thresholds against the $2K/$500 labels. | **OPERATOR-DECISION** |
| R6 | staleness/correctness | **CONFIRMED** | `DashboardView.tsx:296` payment pie uses `stats.revenueByPayment`; `invoices.ts:552` `intelligence` ALSO computes `paymentMix` (returned, never consumed) | `intelligence.paymentMix` is **dead returned data** — DashboardView reads `stats.revenueByPayment` for the pie and never touches `intel.paymentMix`. Server does the GROUP BY every intel call for nothing. | Drop `paymentMix` from the `intelligence` return (or consume it and drop the `stats` one). | **FIX-NOW-safe** |
| R7 | correctness | **CONFIRMED** | live-obs PAYMENT METHODS pie = "OTHER 100%". `invoices.create` defaults `paymentMethod:"card"` but ALG-mirrored invoices land as `other` | Pie shows a single "OTHER 100%" slice — uninformative. Root: shopdriver-sourced invoices all carry `paymentMethod='other'` (ALG doesn't pass method). Not a code bug per se, but the chart is noise at 100% one-category. | Hide the pie (or show a note) when one method ≥ ~95%; it's decoration with no signal. | **DEFER** (cosmetic) |
| R8 | consistency | **CONFIRMED** | `DashboardView.tsx:317` BOOKING HEATMAP `XAxis tick fill="#888"` and `:499` REVENUE BY DAY `fill="#888"`; everything else uses `CHART_THEME.axis` | Hardcoded `#888` axis color in 2 charts bypasses the canonical `CHART_THEME.axis` token (off-theme, and won't follow the light/neutral theme toggle that exists in the topbar). | Replace `"#888"` with `CHART_THEME.axis`. | **FIX-NOW-safe** |
| R9 | staleness | **CONFIRMED** | `RevenueSection.tsx:118` `nourOsBridge.shopFloor`; `DashboardView.tsx:757` empty-state text "…from ShopDriver imports, or from Stripe payments" | Minor copy drift: one empty-state says "ShopDriver" while the live brand is **ALG / Auto Labor Guide** (used correctly at `DashboardView.tsx:96`). Two names for the same source across the same page. | Standardize on "Auto Labor Guide (ALG)". | **FIX-NOW-safe** |
| R10 | correctness | **CONFIRMED** | `DashboardView.tsx:37` `monthRevenue = intel?.projections?.monthlyAvg ?? stats?.totalRevenue`; MONTHLY PACE bar | "MONTHLY PACE" mixes a **3-month-avg** (`projections.monthlyAvg`, live $42,563) as if it were *this month's* progress toward the $100K target. Live: "$42,563 / $100,000 · 43%". That's not month-to-date revenue — it's the trailing 3-mo monthly average. Label says "MONTHLY PACE" implying MTD. | Either compute true month-to-date, or rename to "Monthly run-rate vs target" so it's not read as "we've billed $42K this month". | **OPERATOR-DECISION** |
| R11 | consistency | **CONFIRMED** | `DashboardView.tsx` (e.g. `:370` top-customers `formatCents(c.total)`) vs many `formatDollars(...)` tiles | Mixed `formatCents` (divides 100) and `formatDollars` (no divide) across the same view because tRPC returns some fields already-in-dollars (`stats`/`intel` pre-divide server-side at `invoices.ts:336` etc.) and others in cents (`topCustomers.total`, declined `recoverable`). It's correct today but fragile — a wrong helper = silent 100×. The `revenueFormat.ts:9` note even warns not to consolidate the two `formatDollars`. | Document per-field units at the query boundary (or normalize tRPC to always return dollars). No bug now; flag as landmine. | **DEFER** (latent risk) |

**RevenueSection clean points (verified, do NOT touch):** invoice create has the ET-tz
fix (`CreateInvoiceView.tsx:28`) + NaN guards (`:47`); delete uses `confirmDialog` not
native confirm (`InvoiceListView.tsx:164`, iOS-PWA-safe); funnel/service use `??` not `||`
for zero-guard; empty states everywhere; `invoices.update` `wasPaid` defaults false
(Y10 already shipped). No console errors on the live page.

---

## CouponsSection (Customers ▸ Coupons)

| # | Dim | Status | Evidence | Issue | Proposed fix | Class |
|---|-----|--------|----------|-------|--------------|-------|
| C1 | deficit | **CONFIRMED NEW** | `CouponsSection.tsx:19-23` form state has no `maxRedemptions`; `services.ts:43` `create` input accepts `maxRedemptions:z.number().default(0)`; schema `discountValue`/`maxRedemptions`/`currentRedemptions` exist (schema.ts:285-291) | The coupon **redemption cap is not even settable** — the form omits the field entirely, so every coupon is created with `maxRedemptions:0`. This is the *upstream* of Y13: not only is the cap unenforced, the operator can't set it. | Decide: wire a "Max redemptions" input + enforce on redeem, OR drop `maxRedemptions`/`currentRedemptions` from schema+input as dead. (Pairs with Y13.) | **OPERATOR-DECISION** (Y13) |
| C2 | correctness | **CONFIRMED** (refutes a cents-bug worry) | schema.ts:285 `discountValue: int` (dollars); `CouponsSection.tsx:126` renders `$${c.discountValue}` / `${c.discountValue}%` | **No cents bug here** — `discountValue` is stored in whole dollars, so `$20`/`20%` render correctly. (Flagging explicitly so a future sweep doesn't "fix" it into a 100× error.) | None — correct as-is. | — |
| C3 | deficit | **CONFIRMED** | `CouponsSection.tsx:32` `toggleCoupon` exists but there's no `expiresAt`/featured edit after creation; no full edit mutation surfaced (`services.ts:53` `update` supports title/desc/value but UI only sends `isActive`) | Coupons can be toggled active/inactive + deleted, but **not edited** (change value, code, expiry) once created — the only way to fix a typo'd coupon is delete + recreate. The server `update` already supports it; the UI just doesn't expose it. | Add an inline edit (the mutation already accepts the fields). | **DEFER** (nice-to-have) |
| C4 | inconsistency | **CONFIRMED** | `CouponsSection.tsx:161-162` trailing `// ─── Q&A MANAGEMENT ───` comment with nothing after it (file ends) | Dangling section-header comment for code that isn't there (same class as the `SiteHealthSection` dangling-comment cleanup in batch 1). | Delete the orphan comment. | **FIX-NOW-safe** |

**Coupons clean points:** all 3 mutations have `onError` toasts (money-impacting toggle no
longer fails silently); delete is `confirmDialog`-gated; empty state present (live-confirmed
"No coupons yet").

---

## SpecialsSection (Content ▸ Specials)

| # | Dim | Status | Evidence | Issue | Proposed fix | Class |
|---|-----|--------|----------|-------|--------------|-------|
| S1 | deficit/correctness | **CONFIRMED NEW** | `SpecialsSection.tsx:26` reads `specials.getActive`; `specials.ts:13-26` `getActive` filters `isActive=true` **AND** `expiresAt > now` | The admin manager lists **only active, non-expired** specials. There is **no "all/admin" query** → expired or deactivated specials are **invisible and unmanageable** in the admin. The operator can't see history, can't reactivate, can't audit what ran. | Add a `specials.all` (admin) query and show inactive/expired with a status badge (mirror Coupons' active/inactive list). | **OPERATOR-DECISION** |
| S2 | staleness | **CONFIRMED NEW** | `specials.ts:85-90` SEED_SPECIALS dates are `2026-04-01`→`2026-04-30` / `…-05-31`; today is 2026-06-03 | The "SEED SPECIALS" button seeds specials that are **already expired on arrival** (April/May windows). After seeding, `getActive`'s expiry filter immediately hides 5 of 6 → operator clicks Seed, "Seeded 6/6" toast, then sees an empty list. (Live: Specials tab currently shows **zero** specials after the buttons.) | Make seed dates relative (e.g. `startsAt: now`, `expiresAt: now + 30d`) or update the static windows. | **FIX-NOW-safe** |
| S3 | deficit | **CONFIRMED NEW** | `specials.ts` router exposes only `getActive`/`create`/`delete`/`seed` — **no `update`** | Unlike Coupons (toggle) and Loyalty (toggle), specials have **no activate/deactivate or edit** — once created you can only delete. Inconsistent with the rest of the money surface and forces delete+recreate. | Add `specials.update` (toggle `isActive` + edit fields); add a toggle button to the row. | **DEFER** (pairs with S1) |
| S4 | correctness | **CONFIRMED** | `specials.ts:88` seed "Tire Rotation" `discountType:"percent", discountValue:"50"` → `SpecialsSection.tsx:72` renders `50%` | A seeded special advertises **"50% off tire rotation"** (`discountLabel` → "50%"). Likely meant `$50`-ish or a flat rotation price, not half-off. If seeded + active it posts to the public NotificationBar. | Operator to confirm intended discount; fix the seed value. | **OPERATOR-DECISION** |
| S5 | deficit | **CONFIRMED** | `SpecialsSection.tsx` form collects `maxUses` (`:193`), schema has `maxUses`/`currentUses` (schema.ts:2044-45) | Same pattern as coupons Y13: `maxUses` is captured + stored but **no enforcement** of the cap anywhere (no redemption decrement path found). | Enforce on redemption or drop the field. | **DEFER** (mirror Y13) |
| S6 | correctness | **CONFIRMED** (refutes cents-bug worry) | schema.ts:2038 `discountValue: decimal(10,2)` (dollars); `specials.ts:56` stores `String(input.discountValue)`; `SpecialsSection.tsx:72` renders `$${s.discountValue}` | No cents bug — specials `discountValue` is decimal dollars. `$20`/`20%` correct. (Flag so it's not "fixed" later.) | None. | — |

**Specials clean points:** `getActive` is wrapped in try/catch + 5-min cache + graceful
`[]`; delete is `confirmDialog`-gated; create has the typed `Special` row (the old `(s:any)`
was fixed in batch 1); SEED button self-hides once >1 special exists.

---

## LoyaltyAdminSection (Customers ▸ Loyalty)

| # | Dim | Status | Evidence | Issue | Proposed fix | Class |
|---|-----|--------|----------|-------|--------------|-------|
| L1 | correctness | **CONFIRMED** (refutes prior A-loy worry) | schema.ts:534-535 `rewardValue: int` "Discount value in dollars"; `LoyaltyAdminSection.tsx:200` renders `$${r.rewardValue ?? 0} off`; `:99` `$${rewardStats.totalDiscountValue}` | Loyalty reward `$ off` is **correct** (dollars int). The phantom `discountValue` was already removed (batch 1, `A-loy`); current code reads `rewardValue`. No bug. (Flag so it's not regressed.) | None. | — |
| L2 | deficit | **CONFIRMED** | `LoyaltyAdminSection.tsx:64` comment "Hard delete left for a future server mutation; isActive=0 is the practical equivalent" — no delete; `services.ts:408` `updateReward` has no delete | Rewards can only be **deactivated, never deleted** — the catalog accretes forever. Acknowledged in-code as deferred. Low urgency (toggle hides them). | Add a `deleteReward` mutation if catalog clutter becomes real; else leave. | **DEFER** |
| L3 | consistency | **CONFIRMED** | `LoyaltyAdminSection.tsx:65` `toggleReward` uses `ToggleLeft/ToggleRight` icons; CouponsSection uses a `Power` button "ACTIVE/INACTIVE"; SpecialsSection uses nothing | Three money pages express the same active/inactive concept with **three different controls** (toggle icons vs Power pill vs none). Minor non-uniformity. | Standardize on one toggle pattern across coupons/specials/loyalty. | **DEFER** (polish) |
| L4 | deficit | **CONFIRMED** | `LoyaltyAdminSection.tsx:39` `awardPoints` mutation declared but **only `awardPointsByPhone` is wired** to the button (`:129`) | `awardPoints` (by `userId`) is an unused declared mutation in the component — dead local binding (the by-phone variant superseded it per the wave-143 comment). | Remove the unused `awardPoints` binding from the component (keep the router proc — it may have other callers). | **FIX-NOW-safe** (verify no other UI use) |

**Loyalty clean points:** by-phone award fixed the page-1 pagination miss (wave-143);
ROI StatCards correctly hidden at zero rewards (live-confirmed clean empty state);
deactivate is `confirmDialog`-gated; iOS `inputMode` hints present.

---

## MembershipsSection (Nonstop Nick)

| # | Dim | Status | Evidence | Issue | Proposed fix | Class |
|---|-----|--------|----------|-------|--------------|-------|
| M1 | correctness/polish | **CONFIRMED NEW** | `MembershipsSection.tsx:107` renders `m.status.toUpperCase()` for non-active; schema.ts:572 enum `["active","past_due","canceled","incomplete"]` | A non-active member's badge shows the **raw enum** uppercased → e.g. `PAST_DUE` / `INCOMPLETE` (with underscore). Cosmetic but unpolished on the counter card. | Map to friendly labels ("Past due", "Canceled", "Incomplete"). | **FIX-NOW-safe** |
| M2 | deficit | **CONFIRMED** | `MembershipsSection.tsx:27-30` lookup `enabled` requires `searchPhone.length >= 4`; on found+inactive there's no membership-action (reactivate/manage) | Pure lookup + bind-vehicle. If a member is `past_due`, the counter sees the red badge but has **no next action** (no "send payment link", no Stripe portal link). Acceptable for v1 (zero members today) but a dead-end at the counter when it matters. | When `status==='past_due'`, surface a "text payment link" or Stripe-portal action. | **DEFER** (zero members today — YAGNI per file header) |
| M3 | consistency | **CONFIRMED** | `MembershipsSection.tsx:112` "$9.99 tier" / `:116` "Nonstop Nick+"; `memberships.ts:32` plans `$7.99 base / $9.99 plus`; `:78` `repairDiscountPct = plan==='nonstop-nick-plus' ? 15 : 0` | The 15%-off repair banner only renders for the plus tier — correct. But the section header is bare "Nonstop Nick" with no tier/price context; the $7.99/$9.99 split lives only in the router. Minor — the counter may not recall which plan gives the discount. The banner does say "(Nonstop Nick+)", so it's mostly fine. | Optional: show plan name on the member card. | **DEFER** |

**Memberships clean points:** uses real `<input>`s not `window.prompt` (iOS-PWA-safe, per
file header + `nickstire-ios-pwa-primitives`); bind has `onError` toast; honest no-member
empty state (live-confirmed); LIKE-on-last-digits lookup is sensible for a counter.

---

## WalkInCalculatorSection (global drawer)

| # | Dim | Status | Evidence | Issue | Proposed fix | Class |
|---|-----|--------|----------|-------|--------------|-------|
| W1 | correctness | **CONFIRMED + SHARPENED (Y9)** | `WalkInCalculatorSection.tsx:34-35` presets; OHIO_TAX 8% (`:22`), labor $115 (`:23`). Computed: conv oil = parts 2200×2.0=4400 + labor 0.3×115×100=3450 + tax 352 = **8202¢ ($82.02)**; synth oil = 8550+3450+684 = **12684¢ ($126.84)**. Advertised: `services.ts:507,564,592` conv/blend **from $49**, full synth **from $80** | Both oil presets **over-quote vs the public anchor**: conventional preset $82 vs advertised $49 (+67%); synthetic preset $127 vs advertised $80 (+59%). A front-desk person trusting the preset quotes ~double the website. Y9 flagged only conventional ~$82; the synthetic preset is also off. Root: presets bundle 0.3h labor + 2× markup onto a service the site advertises flat. | Re-anchor the two oil presets to the advertised structure ($49 conv / $80 synth as the line total, or strip the labor bundle for oil). Operator owns the real shop pricing. | **OPERATOR-DECISION** (Y9) |
| W2 | deficit | **CONFIRMED NEW** | `WalkInCalculatorSection.tsx:36` preset "Used Tire ($60 each, mount+balance)" parts 2500×2.4=6000¢ + labor 0.7×115×100=8050¢ + tax 480¢ = **$145.30** | The "$60 each" used-tire preset computes a **$145 line for ONE tire** (the $60 is in the label but the math is parts $25 cost × 2.4 = $60 sell + $80.50 labor + tax). Labor of 0.7h ($80) on a single used-tire mount is high and the line total ($145) contradicts the "$60 each" label. | Recheck used-tire labor hours / clarify the preset is per-tire incl. mount. | **OPERATOR-DECISION** |
| W3 | deficit | **CONFIRMED** | `WalkInCalculatorSection.tsx:163` `printQuote` = `window.print()`; `:136` `copyQuote` uses `navigator.clipboard` | `window.print()` and `navigator.clipboard` can both be unreliable inside an iOS standalone PWA (print especially). On the operator's phone the "Print" button may no-op. (Same iOS-PWA class as the suppressed `window.confirm`.) | Verify on-device; if print no-ops, hide it on iOS or fall back to the copy path. | **DEFER** (verify on device) |
| W4 | consistency | **CONFIRMED** | `WalkInCalculatorSection.tsx:53-59` local `formatCents`/`formatDollars` duplicate the ones in `money/revenueFormat.ts:15-21` | Two more copies of the dollar formatters (the codebase already has `formatCents`/`formatDollars`/`formatMoneyShort` elsewhere). Pure dup. | Import from `money/revenueFormat` (or a shared util) — but note this file is a standalone drawer; low priority. | **DEFER** |

**WalkIn clean points:** entirely client-side (no tRPC, no cost); margin math is internally
consistent; `formatCents` rename (was the `formatDollars`-cents collision, fixed backlog #12);
discount clamped 0–100; empty-state prompt present; tax correctly parts-only (Ohio).

---

## Summary

### Counts by dimension (24 findings; excludes the 4 "no-bug, don't-regress" confirmations)
- **Staleness / dead code:** 4 (R6, R9, S2, + C4 dangling comment)
- **Deficit / missing functionality:** 9 (R1, R3, R4, C1, C3, S1, S3, L2, L4, M2, W2, W3 — money-management gaps + over-quotes)
- **Inconsistency / non-uniformity:** 5 (Nav split, R8, R11, L3, S3, M3, W4)
- **Correctness / bugs:** 6 (R2, R5, R7, R10, S4, M1, W1)

### Classification
- **FIX-NOW-safe:** R4, R6, R8, R9, C4, S2, L4, M1 (+ R1, R2 after root-cause)
- **OPERATOR-DECISION:** R3, R5, R10, C1/Y13, S1, S4, W1/Y9, W2
- **DEFER:** R7, R11, C3, S3, S5, L2, L3, M2, M3, W3, W4

### Top 5 highest-value fixes
1. **R1 — MoneyBrief is invisible in prod.** The whole Money Phase 2 narrative (velocity /
   pipeline / "FIRE declined" action) never renders — stuck on the loading shimmer while the
   dashboard loads fine. Highest leverage: it's the operator's at-a-glance money line, dead on
   arrival. (FIX-NOW after root-cause.)
2. **R2 — Two different "Total Revenue" for the same 30d on one screen** ($53,620 vs $54,115
   vs $42,563). Unify the window definition (UTC/local + rolling/calendar). Trust-killer for
   every number on the page. (FIX-NOW-safe.)
3. **W1 / Y9 — WalkIn oil presets quote $82 / $127 vs advertised $49 / $80.** Front desk
   reading the preset literally quotes ~double the website on the highest-traffic service.
   Re-anchor the presets. (OPERATOR-DECISION.)
4. **S1 + S2 — Specials are unmanageable + seed-on-expired.** Admin only lists active+unexpired
   specials (no admin "all"), and the SEED button seeds April/May (already-expired) specials →
   click Seed, see nothing. Add `specials.all` + relative seed dates. (S1 OPERATOR-DECISION,
   S2 FIX-NOW-safe.)
5. **R3 — LABOR/PARTS + SERVICE panels render "0% / 1%" / single "Other" row** because ALG
   imports carry no line-item split. Looks broken. Hide or honestly label these when the split
   data is absent. (OPERATOR-DECISION.)

### Notable "no-bug, do NOT regress" confirmations
- Coupons `discountValue` (int dollars), Specials `discountValue` (decimal dollars), Loyalty
  `rewardValue` (int dollars) all render correctly — **no cents/dollars bug** on any of the
  three. A future "unit fix" sweep must not touch them.
- C1/Y13 + S5: coupon `maxRedemptions` and special `maxUses` are stored-but-unenforced; coupon
  cap isn't even settable in the form. One decision covers all three: wire+enforce, or delete
  the columns.

**Live-drive confirmation:** Revenue, Coupons, Loyalty, Specials, Memberships all rendered on
prod (nickstire.org/admin, operator's authed browser) with **zero console errors**. WalkIn is a
global event-bus drawer (no URL) — audited from code + verified math (deterministic, no live
state). MoneyBrief's stuck-loading (R1) and the dual-revenue-number (R2) were caught live, not
just inferred.
