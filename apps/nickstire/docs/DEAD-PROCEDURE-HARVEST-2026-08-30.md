# Dead-procedure harvest #1 — 2026-08-30

The dated action from NOUR-ACTION-REQUIRED 4b (probe shipped in #1478, live ~2026-08-16):
collect `[tRPC first-call]` lines from Railway logs after a business cycle, subtract from the
registered census, and name the dead-candidate set. **This is the FIRST harvest.** The probe
window below is ONE day — not the "normal business cycle" the action called for. Treat every
number here as a baseline reading, not a verdict.

## Instrument receipts

- **Probe**: `server/_core/trpc.ts` middleware — one `[tRPC first-call] <type> <path>` log line
  per procedure per process lifetime. In-memory by design; resets on deploy (#1478).
- **Harvested**: `railway logs --service MAINnicks-tire-auto --lines 5000` → 3,574 lines,
  window **2026-08-30T02:05:09Z → 15:03:09Z** (process start 02:05 UTC — probe window =
  exactly this deployment's lifetime so far, ~13h).
- **77 distinct procedures called** (77 first-call lines, zero duplicate emissions → no
  mid-window restarts).
- **Census**: `server/__tests__/proc-census.test.ts` walks the real `appRouter._def.procedures`
  registry → **703 registered procedures** (path + `_def.type`). The registry walk is the true
  denominator; #1478's "163" keyed only no-caller candidates from the client graph, a narrower
  question. Written to `eval-datasets/proc-census.json`.

## The arithmetic (window-honest)

| | count |
|---|---|
| Registered (census) | 703 |
| Served at least once this window | **77** (10.9%) |
| Not served this window | **630** |

**630 is not a delete list.** Three reasons, in force order:

1. **The window is one day.** Weekly/monthly admin surfaces (payroll exports, monthly
   reconciliation, seasonal campaign tools) legitimately show zero calls in 13 hours. The
   action item said "after a normal business cycle" — that is weeks, not hours.
2. **Every procedure is reachable over HTTP by callers outside this repo** — the statenour
   bridge, webhook dispatchers, phone shortcuts, curl (#1478). Grep proves neither liveness
   nor deadness, and neither does one day of logs.
3. **Spot-checks confirm the danger**: `controlCenter.closeDay`, `nickActions.importCustomerCSV`,
   `controlCenter.getDailyBrief`, `shopdriver.forceSyncNow` all sit in the "not served" set —
   each is a known-live-by-design surface that simply wasn't touched in this window.

## Called set (the 77 — for the next harvest's diff)

See `eval-datasets/proc-census.json` for the registry. Called routers this window:
vapi (12 procedures — the voice lane is the busiest surface), contentAdmin (9),
instagramAdmin (9), adminDashboard (3), adminSecurity (3), proposals (4), plus singles
across activity, auth, booking, callback, closedLoop, content, conversion, customerEvents,
dispatch, gatewayTire, instagramStudio, lead, nourOsBridge, opportunityQueue, promises,
revenueAttribution, revenueOps, reviews, serviceReviews, shopStatus, sms, specials,
tireSizeFromVehicle (via voiceAgent), weather, workOrders, callTracking.

## By-router dead-candidate distribution (top)

contentAdmin 70 · dispatch 32 · nickActions 30 · instagramAdmin 25 · customers 21 ·
gatewayTire 20 · shopdriver 18 · invoices 17 · instagramStudio 16 · controlCenter 16 ·
adminDashboard 15 · smsOrchestrator 14 · workOrders 14 · voiceAgent 13 · winback 12 ·
intelligence 12 · booking 11 · inspection 11 · vapi 10 · smsConversations 10 —
tail omitted; full set derivable from census JSON minus the 77.

## Next harvest protocol (repeat, don't reinterpret)

1. Wait for a multi-week window (or at minimum: a week containing a full admin workload —
   reconcile day, content-publish day, booking-heavy day).
2. Re-run the harvest: `railway logs --service MAINnicks-tire-auto --lines <max>` →
   filter `[tRPC first-call]` → distinct.
3. Diff against this file's 77. The intersection of "not served" across N harvests with
   non-overlapping windows is the candidate set that starts to mean something.
4. Only then: per-procedure external-caller audit before ANY deletion. The #1478 lesson
   stands — this repo was burned in both directions the same week (vapi routes read
   live and were dead; `nourOsQuote` read dangerous and was 500ing).

## Incident found during the harvest (separate fix, shipped)

The statenour-side log pull surfaced `prisma.brainMemory.upsert` failing for EVERY customer
in the daily preferences recompute — TiDB int ids hitting the String key column. Root cause,
fix, and canary tests shipped in #2032 (commit 2 of the wave). Preferences had never
persisted since the 2026-07-10 phone-keyed bridge rewrite.