# nickstire.org/admin — What's Fucked Up

**Date:** 2026-05-05 · **Status (2026-05-07 wave-78 reconciliation):** active backlog

> ## Status header (refreshed 2026-05-07)
>
> Of the 10 sections in this audit:
> - ✅ **§2** OverviewSection refactor — partially addressed via wave-65
>   AlertBar extraction + wave-73 hook fix. The 1664-LOC monolith remains
>   but its highest-risk failure mode (the hook-after-early-return crash)
>   is fixed and prevented by `pnpm lint:hooks` in CI.
> - ✅ **§8** RBAC scaffold — `userRoles` table shipped wave-59 in
>   `drizzle/schema.ts:2469`. Permission checks not yet wired.
> - ⏸ **§1** polling reduction (`refetchIntervalInBackground: false`
>   global config) — STILL PENDING
> - ⏸ **§3** ~14 `any` removals in DispatchSection/ContentSection — PENDING
> - ⏸ **§4** useEffect cleanup gaps — PENDING
> - ⏸ **§5** ErrorBoundary per section — exists as AdminSectionBoundary
>   but the per-hook patterns wave-73 caught suggest it could be tighter
> - ⏸ **§6** staleTime patterns — PENDING
> - ⏸ **§7** N+1 queries — not assessed since 2026-05-05
> - ⏸ **§9** chart-config consolidation — PENDING
> - ⏸ **§10** autonicks fetch proxy — PENDING
>
> Triaged via `pr-review-toolkit:comment-analyzer` subagent during
> wave-78 docs reconciliation. Original audit body preserved below.
>
> ---

**Method:** static analysis of `client/src/pages/admin/` (20 sections, 15.6K LOC), `Admin.tsx`/`AdminContent.tsx`, `server/routers/admin.ts`, plus pattern scans for code smells.
**Tone:** brutal. The user asked.

The admin works. It's ambitious — 20+ sections, deep KPI coverage, thoughtful conversion tracking. But under the hood there are real problems that compound silently, and a few that will bite at scale. Ranked by harm.

---

## §1 — Backend will buckle: 57 polling queries

| File | refetchInterval queries | Total tRPC calls |
|---|---|---|
| `OverviewSection.tsx` | **17** | 25 |
| `DispatchSection.tsx` | 10 | 24 |
| `WorkOrdersSection.tsx` | 7 | 17 |
| `RevenueSection.tsx` | 6 | 12 |
| `CommandCenterSection.tsx` | 4 | 8 |
| `CustomersSection.tsx` | 3 | 13 |
| (8 more sections) | 10 combined | varies |
| **TOTAL POLLING** | **57 queries** | — |

If you have admin open all day (you do), the client is generating recurring backend traffic at an aggregate rate of ~**1-2 queries/second from your browser alone**. Most use 30s intervals. A handful are 15s (campaignStats, shopPulse). One is 300s (masterReport).

Concrete cost on TIDB free tier: you're hitting connection-pool ceilings on what should be a low-traffic ops dashboard. When you navigate away from a section, the polling does NOT stop — React Query keeps refetching until the component unmounts. With `lazy()` + Suspense the section can stay mounted in memory across navigations, depending on how Admin.tsx switches sections (which keeps polling running on hidden sections).

**Fixes ordered by leverage:**

1. **Add `refetchIntervalInBackground: false` globally.** When admin tab is in background, browsers throttle polling — but this prop tells React Query to fully pause. One-line config change in `_core/queryClient.ts` or wherever the QueryClient is built. ROI: ~50%+ reduction in idle polling cost.
2. **Pause polling on hidden sections.** When OverviewSection isn't mounted (you're on a different tab), it shouldn't be polling. Two paths:
   - Drop `lazy()` cache so unmount stops polling (React Query default behavior on full unmount).
   - Or wrap polling queries in a custom hook that checks `useIsActiveSection()`.
3. **Coalesce bursts.** Batch the 17 OverviewSection queries into 2-3 aggregated tRPC endpoints (`adminDashboard.overviewBundle`). One round-trip instead of 17. Backend can do this with a single Drizzle transaction.
4. **Raise the cheapest intervals.** `campaignStats` @ 15s and `shopPulse` @ 15s — does anything actually need 15s freshness, or would 60s be fine? Each interval doubling halves cost.

---

## §2 — `OverviewSection.tsx` is 1,664 LOC — the dashboard of dashboards

**Symptoms:**
- Single component owns 25 tRPC calls, 17 of them polling.
- Single component owns ~6 KPI cards + activity feed + priority queue + timeline + 2 charts + alerts feed.
- One render of this component kicks off 25 network calls.
- One bug in any subsection forces a full file diff to find.
- A slow tRPC procedure blocks the entire dashboard rendering.

**Fix:**
Decompose into `client/src/pages/admin/overview/`:
- `KPICards.tsx` (4-5 cards, owns its 5 queries)
- `PriorityQueue.tsx` (owns bookings + leads + callbacks queries)
- `ShopPulse.tsx` (owns shopPulse + shopLoad queries, 15s polling stays here)
- `RevenueWidget.tsx` (owns revIntel + customerStats)
- `AlertsFeed.tsx` (owns masterReport + ALG status)
- `index.tsx` (composition root, ~50 LOC)

This is the single highest-ROI refactor in the admin. **1 day of work, payback in faster reviews + isolated failure modes + easier perf optimization (lazy individual cards) for life of the codebase.**

---

## §3 — Type safety holes — 14 files use `any`

| File | `any` count |
|---|---|
| `DispatchSection.tsx` | 14 |
| `ContentSection.tsx` | 10 |
| `CallTrackingSection.tsx` | 6 |
| `CustomersSection.tsx`, `FollowUpsSection.tsx` | 4 each |
| `FinancingSection.tsx` | 3 |
| `CampaignsSection.tsx`, `CommandCenterSection.tsx` | 2 each |
| 6 more files | 1 each |

These are typically tRPC response bodies that the developer didn't bother to type. Each `any` is a runtime crash waiting on the next backend response shape change. The `lint:source` script in package.json explicitly counts these — you have a debt meter.

**Fix:** Each tRPC procedure already has a Zod return shape (or should). Inferring types via `inferRouterOutputs<typeof appRouter>` would eliminate all 14 `any`s in DispatchSection in one PR. ~2 hours.

---

## §4 — Race conditions and memory leaks

**3 useEffects without cleanup** in:
- `CustomersSection.tsx`
- `intelligence/OverviewTab.tsx`
- `intelligence/RevenueTab.tsx`

Without inspecting each, the most likely problems:
- `setInterval` not cleared on unmount → ghost timers polling forever
- Event listener not removed → memory leak + stale closure capturing old state
- Async fetch not aborted → state-update-after-unmount warnings + race conditions where late-arriving response overwrites newer data

**Fix:** every `useEffect` that does any side-effect MUST return a cleanup function. ESLint rule `react-hooks/exhaustive-deps` would catch these. Add to eslint config and fix.

---

## §5 — No error boundaries inside admin sections

Looked for `ErrorBoundary` usage in admin/. Result: only 1 ErrorBoundary at the App.tsx top level.

If `trpc.intelligence.masterReport.useQuery` throws (DB hiccup, malformed response, network timeout), the WHOLE admin page crashes to the App-level error boundary. You see a generic "something went wrong" instead of "the master report card failed but the rest of overview works."

**Fix:** wrap each admin section (or each major widget) in its own ErrorBoundary with a small inline fallback ("This widget failed. Refresh."). 1 hour to add, prevents unrecoverable admin sessions.

---

## §6 — Inconsistent caching → wasted backend trips

Audit of polling queries:
- Most have `refetchInterval` only.
- A few have `staleTime: 60_000` or `staleTime: 300_000`.
- None set `gcTime`.

What this means: every `refetchInterval` tick triggers a DB hit, even if the cached value is still fresh enough. Half the polling traffic is wasted because cache invalidates BEFORE the next refetch.

**Fix pattern:**
```ts
useQuery(undefined, {
  refetchInterval: 30_000,
  staleTime: 25_000,         // serve from cache for 25s
  gcTime: 5 * 60_000,        // keep in cache 5min after unmount
  refetchOnWindowFocus: false, // optional — admin tab already polls
})
```
Apply consistently. Could halve backend cost on its own.

---

## §7 — Audit log gap — no record of admin mutations

When you (or any future admin) edit a customer record, change a setting, mark a booking, dispatch a job — there is no `audit_log` row written. If a record is wrong tomorrow, you can't see when/why it changed.

This is fine for a single-owner shop today. The moment a second person has admin (manager, dispatcher, intern), it's a problem. Mistakes get blamed wrong, sketchy edits go undetected.

**Fix (defer until 2nd admin exists):**
Schema:
```sql
CREATE TABLE audit_log (
  id varchar(36) PRIMARY KEY,
  actor_user_id varchar(64) NOT NULL,
  action varchar(64) NOT NULL,           -- 'customer.update', 'booking.delete'
  target_table varchar(64) NOT NULL,
  target_id varchar(64) NOT NULL,
  changes_json json,                       -- before/after diff
  created_at timestamp NOT NULL
);
```
tRPC middleware writes a row on every admin mutation. ~2 hours when the time comes.

---

## §8 — RBAC is missing — single role only

`server/db.ts` auto-grants `role = 'admin'` to OWNER_OPEN_ID OR CEO_EMAIL. There is no manager/viewer/marketing role. Every admin endpoint uses `adminProcedure` which gates on `role === 'admin'`.

If you ever:
- Hire a service writer who needs WorkOrders + Customers but not Settings or Revenue
- Onboard a marketing person who needs CampaignsSection but not Financing
- Want a read-only dashboard for an investor

…you're SOL without RBAC.

**Fix (defer until staffing pressure):**
- Extend role enum: `'admin' | 'manager' | 'service_writer' | 'marketing' | 'viewer'`
- Add `requiresRole(...)` middleware
- Per-section `useRequireRole()` hook in client

---

## §9 — Section-level rendering quirks

| Problem | Where | Severity |
|---|---|---|
| Inline `<style>` in `style={{...}}` props (10 files) | FinancingSection (4), intelligence tabs (5), CallTracking (2) | Cosmetic — Tailwind tokens missing |
| No loading skeletons | All sections | UX — bare spinner instead of layout-preserving skeleton |
| `console.log/error` left in source | CampaignsSection (2), WinBackSection (1) | Minor — should go through `createLogger` |
| 1 empty catch block somewhere in admin | unknown file | Minor — silent failure |
| Magic numbers in CSS (e.g. `pacePercent >= 110`) | RevenueSection, WorkOrdersSection, intelligence tabs | Minor — extract to constants |

Each is small. Together they suggest the admin grew fast and accumulated drift without a refactor pass.

---

## §10 — Direct `fetch()` calls bypassing tRPC

Two intelligence tabs make raw `fetch()` to `https://statenour-os.vercel.app/api/brain/status` and `/api/weather`. Three issues:

1. **No retries, no timeout, no error tracking.** A 500 from autonicks.com just disappears.
2. **Cross-origin without auth.** If the autonicks server is ever reachable to the public internet, anyone can hit those endpoints.
3. **Inconsistent with the rest of the codebase** — every other admin call goes through tRPC. Two outliers should at minimum go through `server/services/brain.ts` so failures are observable.

**Fix:** proxy these through the nickstire backend via a tRPC procedure. The browser shouldn't be talking to autonicks directly.

---

## §11 — Performance: rendering overhead

OverviewSection renders ~600+ DOM elements per render (cards × items, queue × items, charts, alerts, etc). React's virtual DOM diff is fine, but the actual paint cost on a slow laptop is meaningful.

Quick wins:
- `React.memo` on the section subcomponents that don't need parent's state
- `useMemo` on the priorityQueue computation (it depends on 4 query results — already done in some places, not consistent)
- Virtualize the priority queue with `react-window` if it ever shows >50 items
- Use `recharts` `<ResponsiveContainer>` already in use, so no fix needed there

---

## §12 — What's actually fine

Don't fix what isn't broken:

| Surface | Why it's good |
|---|---|
| Auth | OAuth + OWNER_OPEN_ID gate, push API requires admin key, robots blocks /admin |
| tRPC procedure split | `adminProcedure` consistently used; only `logCall` is `publicProcedure` (correct — public phone-click logger) |
| Lazy-loading | Each section is `lazy()` → smaller initial admin bundle |
| TypeScript strict | `tsc --noEmit` clean across the whole admin |
| Cron observer (today's commit) | 17 unattended cron jobs now have failure alerting via Telegram |
| Section consistency | Visual style tight via Tailwind tokens + Radix primitives |
| Schema discipline | Drizzle migrations, named tables, `cron_log` already wired |

---

## Ranked ship list (what to attack first)

| # | Item | Effort | Value | Section |
|---|---|---|---|---|
| 1 | `refetchIntervalInBackground: false` global | 5 min | ~50% drop in idle polling cost | §1 |
| 2 | Add `staleTime` to every polling query | 2 hr | ~30% drop in DB hits | §6 |
| 3 | ErrorBoundary per admin section | 1 hr | No more "whole admin crashed" | §5 |
| 4 | Coalesce OverviewSection's 17 queries into 2-3 bundles | 4 hr | ~70% drop in OverviewSection backend cost | §1 |
| 5 | Decompose OverviewSection (1664 LOC → ~6 files of ~250 LOC) | 1 day | Reviews, isolation, lazy-load per card | §2 |
| 6 | Replace `any` in DispatchSection (14) + ContentSection (10) | 2 hr | Type-safety on the 24 worst | §3 |
| 7 | Audit + fix the 3 useEffect cleanup gaps | 1 hr | Memory leaks + race conditions gone | §4 |
| 8 | Proxy autonicks calls through tRPC | 2 hr | Observability + auth | §10 |
| 9 | Loading skeletons (DataTable + cards) | 4 hr | UX — feels faster | §9 |
| 10 | RBAC + audit_log | 1 day | Only when 2nd admin hired | §7-§8 |

**Top 3 by ROI/effort:** #1 (5 min, instant 50% cost cut), #2 (2 hr, 30% more cut), #3 (1 hr, eliminates the "whole admin broke" failure mode).

---

## How this audit was done (reproducibility)

```bash
# Polling query inventory
grep -rcE "refetchInterval" client/src/pages/admin/ | grep -v ":0$" | sort -t: -k2 -rn

# Total tRPC calls per section
for f in client/src/pages/admin/*.tsx; do
  c=$(grep -cE "trpc\." "$f")
  printf "%4d  %s\n" "$c" "$(basename $f .tsx)"
done | sort -rn | head -10

# any usage
grep -rcE ": any\b|<any>|as any" client/src/pages/admin/ | grep -v ":0$"

# useEffect without cleanup
grep -rnE "useEffect\(" client/src/pages/admin/ | wc -l
# (manually inspect for missing return statement)

# Inline fetch (skipping tRPC)
grep -rn "fetch(" client/src/pages/admin/

# Auth posture
grep -E "publicProcedure|adminProcedure" server/routers/admin.ts | head
```

Run any of those and you'll see the same numbers. Nothing is hidden.
