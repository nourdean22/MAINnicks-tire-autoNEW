# Monster-File Sharding — Execution Plan

Status: **DESIGN COMPLETE, IMPL DEFERRED** (2026-04-22).
Blocker: each file is a ~2–4 hour focused refactor with real regression risk
if done inside a general session. Deserves a dedicated branch.

This doc lays out, per file, exactly what the shard looks like so the actual
refactor is paint-by-numbers when we sit down for it.

---

## Top 8 by line count (2026-04-22)

| LOC | File | Priority |
|---|---|---|
| 1,422 | `client/src/pages/admin/OverviewSection.tsx` | P0 — daily driver |
| 1,368 | `client/src/pages/TireFinder.tsx` | P2 — bundle-critical, but single page |
| 1,291 | `server/routers/gatewayTire.ts` | P0 — largest router, scraping logic |
| 1,207 | `client/src/pages/admin/RevenueSection.tsx` | P1 — weird lazy composition |
| 1,197 | `client/src/pages/admin/CustomersSection.tsx` | P1 — 1000+ row perf |
| 1,172 | `client/src/pages/ServicePage.tsx` | P2 — shared by 88 slugs |
|   973 | `client/src/pages/admin/WorkOrdersSection.tsx` | P2 |
|   966 | `server/routers/advanced.ts` | P1 — bundle router |
|   871 | `server/routers/controlCenter.ts` | P1 |
|   822 | `server/routers/customers.ts` | P2 |
|   777 | `server/routers/shopdriver.ts` | P2 |

---

## OverviewSection.tsx — the P0

**Current structure (lines 1–1,422):**
- Imports + types (lines 1–80)
- `SlaTimer`, `getTimeSince`, `formatCents`, etc helpers (80–200)
- `OverviewSection` default export component (200–1,422):
  - 6 stat cards row
  - Priority queue + SLA widget
  - Revenue pipeline panel
  - Shop pulse (bay status)
  - Activity stream
  - Timeline / heatmap
  - Charts (recharts-heavy)
  - Integration status chips

**Target structure:** `client/src/pages/admin/overview/`
```
overview/
├── index.tsx                    # OverviewSection default export, ~120 LOC
├── StatCards.tsx                # the 6-card top row (~200 LOC)
├── PriorityQueue.tsx            # SLA-colored queue + timer (~200 LOC)
├── RevenuePipeline.tsx          # money-aging panel (~150 LOC)
├── ShopPulse.tsx                # bay status live (~150 LOC)
├── ActivityStream.tsx           # recent events feed (~150 LOC)
├── TimelineHeatmap.tsx          # day-of-week × hour heatmap (~200 LOC)
├── IntegrationChips.tsx         # vendor health strip (~100 LOC)
└── helpers.ts                   # SlaTimer, formatCents, getTimeSince (~80 LOC)
```

**Refactor steps (~2 hr):**
1. Create the folder. Copy `OverviewSection.tsx` to `overview/index.tsx`.
2. Extract each concern into its own file, one at a time, verifying
   typecheck after each. Each file imports the tRPC queries it needs
   independently (React Query deduplicates).
3. `index.tsx` becomes a layout shell that composes the sub-components.
4. Delete the old monolithic file. Update `Admin.tsx` to import from
   the new path: `lazy(() => import("./admin/overview"))`.
5. Verify: pnpm run check, pnpm run test, smoke-test /admin in browser.

**Risks:**
- Shared local state between sub-sections (filters, selected range).
  Solution: lift state to `index.tsx`, pass via props (or small Zustand store
  if it gets hairy).
- Import cycles on `shared.tsx` — avoid by keeping helpers file self-contained.

---

## gatewayTire.ts — the other P0

**Current structure:**
- Auto-invoice function (~100 LOC)
- Auth + session state (~150 LOC)
- Catalog + curated-data constants (`NICKS_PACKAGE`, `POPULAR_SIZES`,
  `TIRE_BRANDS`) (~200 LOC)
- Search cache + helpers (~100 LOC)
- tRPC router with 20+ procedures (~741 LOC)

**Target structure:** `server/integrations/gatewayTire/`
```
gatewayTire/
├── index.ts                     # re-exports the router for routers/index.ts
├── router.ts                    # the tRPC router — ~300 LOC
├── auth.ts                      # session + login + token refresh — ~150 LOC
├── search.ts                    # b2b catalog search + cache — ~200 LOC
├── order.ts                     # order placement + idempotency — ~200 LOC
├── catalog.ts                   # NICKS_PACKAGE, POPULAR_SIZES, TIRE_BRANDS — ~200 LOC
├── invoice.ts                   # autoCreateInvoiceFromTireOrder — ~100 LOC
└── types.ts                     # shared TypeScript interfaces — ~50 LOC
```

**Refactor steps (~3 hr):**
1. Create folder with `types.ts` first — move all interfaces here.
2. Extract `catalog.ts` — pure data constants, zero dep on other parts.
3. Extract `auth.ts` — depends only on fetch + env vars.
4. Extract `search.ts` — depends on auth.
5. Extract `order.ts` — depends on auth + invoice.
6. Extract `invoice.ts` — depends on types + db.
7. `router.ts` imports from all the above, defines procedures.
8. `index.ts` re-exports `gatewayTireRouter` so `routers/index.ts` is unchanged.
9. Delete old `routers/gatewayTire.ts`. Update nothing else.

**Bonus win:** `integrations-v2.test.ts` currently imports the router monolith.
After shard, the test stays green (same public export). Green test = safe refactor.

---

## RevenueSection.tsx — quirky lazy composition

**Current problem:** It's 1,207 LOC that also `lazy()`-imports SpecialsSection,
FinancingSection, WorkOrdersSection, CustomersSection, DispatchSection.
This means loading /admin?tab=revenue also eagerly walks through half the
admin lazy graph to import those modules.

**Target:** `client/src/pages/admin/revenue/`
```
revenue/
├── index.tsx               # section router (tab switcher)
├── RevenueCore.tsx         # the actual revenue panel (~400 LOC)
├── InvoiceTable.tsx        # sortable invoice list (~300 LOC)
├── CreateInvoiceModal.tsx  # the form (~200 LOC)
├── HourHeatmap.tsx         # hour-of-day chart (~150 LOC)
└── helpers.ts              # formatCents etc
```

**Key move:** remove the inline `lazy()` of Specials/Financing/etc. Those are
already top-level Admin.tsx sections — don't re-import them as children here.
The tab bar should just call `setSection()` instead.

---

## customers.ts (router) — ~2 hr

**Target:** `server/routers/customers/`
```
customers/
├── index.ts       # router entry
├── list.ts        # list + filter queries
├── detail.ts      # single-customer fetch with related data
├── export.ts      # CSV export (uses csvSafe)
├── segments.ts    # segment + metrics
├── mutations.ts   # update notes / tags / etc
└── helpers.ts     # local query builders
```

---

## controlCenter.ts — ~2 hr

**Target:** `server/routers/controlCenter/`
```
controlCenter/
├── index.ts         # router entry
├── overview.ts      # the big `getOverview` procedure
├── brief.ts         # getDailyBrief
├── habits.ts        # habit toggles
├── mission.ts       # mission get/set
├── telemetry.ts     # system status + tunnel
├── repo.ts          # getRepoActivity
└── sources.ts       # knowledge-base source status
```

---

## advanced.ts — ~2 hr

**Target:** `server/routers/advanced/`
```
advanced/
├── index.ts      # re-exports jobAssignmentsRouter, invoicesRouter, kpiRouter, portalRouter
├── jobs.ts       # jobAssignmentsRouter
├── invoices.ts   # invoicesRouter
├── kpi.ts        # kpiRouter
└── portal.ts     # portalRouter
```

These are already 4 logical routers bundled in one file — lowest-risk shard.

---

## shopdriver.ts — ~2 hr

**Target:** `server/routers/shopdriver/`
Plus `server/integrations/shopdriver/` for the auth + fetch helpers.

---

## CustomersSection.tsx — 1,197 LOC + virtualization

Already large and slow on > 500 customers. Shard + add virtualization:

**Target:** `client/src/pages/admin/customers/`
```
customers/
├── index.tsx            # entry
├── CustomerTable.tsx    # react-virtual table for 1000+ rows
├── Filters.tsx          # search + segment + date filters
├── BulkActions.tsx      # SMS blast, export, tag
├── CustomerDrawer.tsx   # existing component, move here
└── helpers.ts
```

Dependency to add: `@tanstack/react-virtual` (~6 KB gzip).
Without it, rendering 1k rows in the DOM will always jank — no way around
this with table redesign alone.

---

## TireFinder.tsx + ServicePage.tsx

These are PUBLIC pages. Higher stakes — breakage = customer-facing 500 error.

**TireFinder shard (~2 hr):**
- `public/tirefinder/`: index + VehiclePicker + SizePicker + ResultsGrid +
  helpers. Keeps the URL the same, just splits the file.

**ServicePage shard (~2 hr):**
- Same pattern: `public/service/`: index + Hero + FAQ + PricingBlock +
  RelatedServices + helpers.
- Extra care: this page is shared by 88 service slugs; each lazy chunk
  must stay tree-shakable per slug.

---

## Refactor order (lowest risk first)

1. **advanced.ts** — 4 sub-routers bundled; lowest risk ✅
2. **shopdriver.ts** — isolated domain
3. **controlCenter.ts** — admin only, no public exposure
4. **gatewayTire.ts** — isolated domain; has integration test to catch regressions
5. **customers.ts router** — straightforward
6. **OverviewSection.tsx** — visible admin change, do with preview
7. **RevenueSection.tsx** — weird lazy fix included
8. **CustomersSection.tsx** — adds react-virtual dependency
9. **TireFinder.tsx** — public page, careful
10. **ServicePage.tsx** — public + multi-slug, most careful

**Total budget:** ~20 focused hours = 2 solid days of refactor-only work.
Or two Tasmanian-mode sessions with CI green at every step.

**How to ship safely:** feature branch per shard, merge after typecheck +
tests + a smoke test in Claude Preview. Don't batch the merges.
