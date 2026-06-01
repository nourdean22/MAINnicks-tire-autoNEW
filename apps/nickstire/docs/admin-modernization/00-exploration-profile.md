# Nickstire Admin — Exploration Profile (foundation for modernization)

> Generated 2026-06-01 in worktree `nickstire/admin-modernize` (off origin/main `1ee0f765`).
> **Clarity-gate tags:** `[V]` = VERIFIED from schema/code (file:line) · `[I]` = INFERRED (agent judgment) · `[PLP]` = PRIOR-LIVE-PROFILE (2026-06-01 prod TiDB pass; not re-verifiable from code).
> Method: two read-only code-explorer passes (data model + admin UI) over the isolated worktree.

## Overview
- **Data layer:** ~80 tables, TiDB/MySQL via Drizzle, 63 migrations. Single source of truth = `drizzle/schema.ts` (3,145 lines). `[V]`
- **Server layer:** ~66 tRPC routers registered; `intelligence.ts` exposes **50 analytics procedures** — but ~40 have **no calling UI** since the admin Intelligence section was retired + dispersed to statenour. `[I]`
- **Admin UI:** 2 routes (`/admin` shell + `/admin/content` — a **duplicate** surface). Sidebar = 6 sections (Today · Customers · Outreach · Money · Voice · Settings); +6 hidden URL-reachable sections. `[V App.tsx:240-241, shared.tsx:127-143]`
- **Operator context:** runs the admin **from a phone** — mobile is a first-class constraint, not an afterthought.

## The big structural theme: IDENTITY FRAGMENTATION
The single deepest issue cutting across data + surfaces — **there is no canonical customer identity**:
- `customers.id` is INT, but `vehicles.customerId` / `workOrders.customerId` / `warranties.customerId` are VARCHAR(36), and `serviceAffinityPredictions.customerId` is BIGINT — **type-mismatched joins, all soft (no FK constraints anywhere)**. `[V schema.ts:950 vs 1879/1907/2441]`
- Two parallel identity systems: `users` (portal/OAuth, holds loyalty) vs `customers` (ShopDriver imports, holds retention) — **no link between them**. `[I]`
- **Phone is the de-facto join key but is unnormalized**: 3 column sizes (varchar 20/30/10), and `[PLP]` 28% of conversation phones are `+1…` not 10-digit → 31 duplicate conversations.
- **Dual opt-out signals** that can diverge: `customers.smsOptOut` (INT) vs `smsPreferences.optedOut` (BOOL). `[V schema.ts:991, 1779]`

→ Any admin redesign that shows "a customer" is building on sand until identity is unified.

## Data-quality issues — ranked (the ones that matter)
1. **CRITICAL — ghost table `drip_enrollments`**: exists in prod via inline `CREATE TABLE` in `dripProcessor.ts:29`, **not in schema.ts** → invisible to Drizzle/migrations. `[V]`
2. **CRITICAL — `smsMessages.status='failed'` mislabels ~84% of rows** `[PLP]`: `logOutboundSms` writes `failed` for no-SID/queued sends; `twilioSid` is nullable, no constraint. Reporting is unreliable. `[V schema.ts:821,828]`
3. **CRITICAL — dual opt-out** (above) — a send path checking only one table can text opted-out customers. `[V]`
4. **HIGH — ~33% duplicate `smsMessages` rows** `[PLP]`: `idx_sms_msg_twilio_sid` is a plain INDEX, not UNIQUE → no DB-level insert-or-fail; dedup is app-layer + races. `[V schema.ts:849-861]`
5. **HIGH — phone format chaos** (above) → missed joins, dup conversations. Generated-column index DEFERRED (TiDB config). `[V migration 0046]`
6. **HIGH — customer-id type mismatch** across the "BACKEND-5" tables (above). `[V]`
7. **HIGH — 15 stuck `status='sending'` rows** `[PLP]`: no TTL/cleanup sweep for crashed in-flight claims. `[I]`
8. **HIGH — missing unique indexes** on `cronAlertsFired (alertKey,firedFor)` and `voiceFollowups (bookingId,touch)` — dedup/at-most-once guarantees documented but not in the Drizzle schema. `[V schema.ts:2304-2313, 3127 vs 3134-3144]`
9. **MEDIUM** — dates stored as varchar(10) in 5 tables; JSON blobs hiding structure (`chatSessions.messagesJson` = whole conversation); camelCase/snake_case mixed (worst: `technicians`); redundant table pairs (`coupons`↔`specials`, `otpCodes`↔`portalSessions`, `reviewReplies`↔`reviewPipeline`, `communicationLog`↔`smsMessages`). `[V]`
10. **LOW** — `referrals` has no phone indexes; `smsCampaignSends.phone` varchar(20) vs varchar(30) elsewhere. `[V]`

## Admin surface issues — ranked
**P0 structural:**
- `/admin/content` (`AdminContent.tsx`) is a **duplicate** of ContentSection's Manager tab — separate route, separate auth gate, same data. Kill it. `[V]`
- **God-files**: `VoiceReceptionistSection` 1,678 ln · `RevenueSection` 1,593 ln (RevenueContent ~800 ln inline) · `CustomersSection` 1,495 ln · `shared.tsx` 1,265 ln (nav+types+primitives+hooks+utils all in one). `[V line counts]`
- **40+ dead intelligence procedures** — live DB-query handlers with zero UI consumer. Wire to statenour /scoreboard or delete. `[I]`
- `commandCenter` (433 ln for 2 links + a status dot) + commented-out `IntelligenceSection` import = zombie weight. `[I/V Admin.tsx:43-49]`

**P1 mobile (phone operator — high weight):**
- Money (5 tabs) + Outreach (6 tabs) tab-bars overflow at 375px with no overflow indicator → horizontal-scroll roulette. `[I/V shared.tsx:800]`
- Money Revenue tab nests TWO `TabBar`s (outer 5 + inner DASHBOARD/INVOICES/NEW) = stacked scroll surfaces. `[V RevenueSection.tsx:90,179-189]`
- Priority-queue action icons are ~24px touch targets (< 44pt iOS min). `[V OverviewSection.tsx:740]`

**P2 inconsistency:** `text-purple-400` used on Revenue Conversion KPI + CustomerDrawer chat type — **violates the documented 3-color palette ban** `[V RevenueSection.tsx:286, CustomerDrawer.tsx:29, shared.tsx:62-75]`; CallTracking hardcodes a tooltip style instead of `CHART_THEME.tooltip`; two patterns for customer detail (inline expand vs `CustomerDrawer`).

## Highest-leverage modernization targets (from the maps)
1. Kill `/admin/content` duplicate (1-hr, zero UX change). `[I]`
2. Extract `RevenueContent` from the 1,593-ln god-file. `[I]`
3. Split `shared.tsx` into types/constants/hooks/primitives/insight. `[I]`
4. Money 5→4 tabs (merge Shop Pulse + Shop Status). `[I]`
5. Audit/prune the 40+ orphan intelligence procedures. `[I]`
6. (Data) Unify customer identity + normalize phones + add the missing unique constraints + promote the ghost table. `[I]`

## The 3 fronts (systems → front)
1. **Data integrity (systems):** canonical customer identity, phone normalization, dedup constraints, ghost-table promotion, opt-out consolidation, status-enum honesty.
2. **Server/API (middle):** prune dead intelligence procedures, consolidate redundant routers, bundle the 11 Today queries, single source for opt-out/identity.
3. **Admin UI (front):** kill duplicates/zombies, split god-files, mobile-first tab/touch fixes, palette compliance, one customer-detail pattern.

## Recommended next step
Move into the **brainstorming** flow (worktree is ready) to validate scope + sequencing across the 3 fronts before any code. Open questions for the operator: which front is the priority, how aggressive on the identity migration (high-risk), and what "modernized" means visually (the Euclid-Grit aesthetic already exists for the public site — does the admin adopt it?).
