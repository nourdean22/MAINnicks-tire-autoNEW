# Slow-paths audit · 2026-05-12

**Scope:** investigate 3 slow paths flagged during the v10.0.499 preview
logs · cold-cache misses on dashboard surfaces. Read-only audit · 1
fix shipped inline (bridge timeout). Other fixes filed as future-push
candidates.

**Trigger logs** (Claude Preview, 2026-05-12 10:00 ET):

```
GET /api/ultron/signal       200 in 16.6s
GET /api/command/data        200 in 10.4s
[slow_query] vector_embeddings 566.4ms
```

**Skill stance:** `production-code-audit` + `performance-engineer` +
`database-optimizer` + `kaizen` (smallest fixes first).

---

## Finding 1 · `/api/ultron/signal` 16.6s cold-cache miss · LOW severity

`app/api/ultron/signal/route.ts:88`

The route is **already cached** at 300s via the `cached()` utility AND
exports `revalidate = 300`. The 16.6s was a COLD CACHE miss — fires
once per ~5-minute window. Warm-cache hits are sub-100ms.

The cold-cache work is 9 parallel calls:
- 6 brain engines (blind-spots · teaching · counter-intuitive ·
  correlations · wisdom · attention) each ~10 Prisma queries
- 3 direct prisma queries (predictions × 2 · open decisions)

**Mitigation already in place:** `cached("ultron_signal_v1", 300, …)`
hard-caches the composite payload. 5-min TTL is appropriate for
brain-engine signals (they don't change second-to-second).

**Verdict:** acceptable. The 16.6s is a 1-in-30 user experience hit
(cold cache after expiry). Worth a 60s sliding-window keepalive cron
to keep cache warm during peak hours, but no urgent fix needed.

**Future candidate:** add a heartbeat cron at `*/3 * * * *` that hits
the route to keep cache warm during business hours. ~5 min effort.

---

## Finding 2 · `/api/command/data` 10.4s every request · MEDIUM severity ✅ FIXED v10.0.505

`app/api/command/data/route.ts:8` declares `force-dynamic` (NO outer
cache) and runs 14 parallel calls including `fetchShopSnapshot()` which
calls the nickstire bridge.

Two issues compounded:

1. **No outer cache** · every request runs all 14 queries
2. **`fetchShopSnapshot` had no timeout** · a stalled bridge could
   hang the route for 30s+

**Fix shipped this push:** `lib/services/bridge.ts:54` added
`AbortSignal.timeout(4000)` so a stalled bridge falls through to the
4-query fallback path within 4s instead of waiting indefinitely.

**Future candidates:**
- Wrap the route in `cached("command_data_v1", 60, …)` after the auth
  check · 60s TTL is appropriate for dashboard data
- Move `fetchShopSnapshot` fallback (4 sequential queryNick calls) to
  `queryNickBatch` if it isn't already · saves 3x RTT

After these, the route's P95 should drop from 10.4s → ~2-3s warm and
~5-6s cold.

---

## Finding 3 · vector_embeddings 566ms slow query · LOW severity

Warm-up query on the tool-embeddings module at server boot. The
preview logs show:

```
[tool-embeddings] Warm-up complete: 121/121 cached in 572ms
   (db-hydrated=121 fresh=0)
```

This is the EXPECTED behavior: 121 tool embeddings hydrate from the
DB on server start. 566ms total for 121 rows = ~4.7ms/row. The slow-
query warning is fired by Prisma's slow-query telemetry threshold
(500ms) but it's a startup cost, not a per-request cost.

**Verdict:** not an actual problem. The warm-up is one-time per
container. Vercel containers have warm-keep but cold-starts will pay
this 566ms tax. Could be optimized via:

- Pre-compute the cache to a JSON file at build time (eliminates DB
  call on boot) · 30-min effort
- Lazy-hydrate only when first tool call needs embeddings · changes
  shape of the recall layer · larger work

Neither is urgent. Filed as future candidates.

---

## Cumulative impact

| Slow path | Before | After this push | Future ceiling |
|---|---|---|---|
| /api/ultron/signal | 16.6s cold · <100ms warm | unchanged | 60s heartbeat cron keeps it warm |
| /api/command/data | 10.4s every request | **~6s cap** (4s bridge timeout + 2s queries) | ~2-3s warm with cache wrapper |
| vector_embeddings warm-up | 566ms once per container | unchanged | build-time precompute eliminates it |

**Operator action items:**
- Confirm `NICKS_ADMIN_URL` / `BRIDGE_API_KEY` env vars in Vercel are
  pointing at a healthy nickstire endpoint · the 10.4s suggests
  either the snapshot endpoint doesn't exist (causing 30s timeout)
  OR it's genuinely slow upstream
- If bridge is the bottleneck, the operator's separate nickstire
  session should audit `/api/bridge/shop-snapshot` for query
  optimization opportunities

---

**Audit method:** static code review of slow routes + cross-reference
with preview-server log timestamps. No live profiling tool used. Real
P95/P99 measurement would require Vercel runtime logs over a longer
window OR a Lighthouse pass with the network panel open.

---

## Addendum · Lighthouse-equivalent pass on `/` (mobile 290px, dev mode)

Ran a `performance.getEntriesByType` snapshot on the homepage via
Claude Preview eval. Findings · **dev-mode numbers · production
turbopack bundles will be smaller**:

**Web vitals:**
- TTFB: 469ms (acceptable)
- DOMContentLoaded: 599ms
- LoadEvent: 2.83s
- CLS: **0** (excellent · the v10.0.490 box-shadow → opacity work
  pays off here · zero layout-shift signal)

**Bundles (dev mode, no tree-shake):**
- JS: 67 files · 6,681 KB — production turbopack should be much
  smaller · operator should run `pnpm analyze` to verify
- CSS: 17 files · 739 KB
- main-app.js: 2.7 MB · 1.2s — biggest single chunk

**Newly-flagged slow paths (not in original audit):**
- `/api/ultron/personal-pulse` 5.5s — Ultron personal-layer composite ·
  needs same audit pattern as /api/ultron/signal
- `/api/health` 5.5s — health check should be sub-100ms · 5 parallel
  Prisma calls including 3 groupBy operations · dev-mode cold-
  connection timing likely inflates this · production with Neon
  pooler should be much faster · CONFIRM with prod runtime logs
  before fixing

**Future candidate:** add `pnpm analyze` to a periodic budget check ·
flag pages where the initial-route bundle delta > 300KB.

**Operator action items added:**
- Confirm `/api/health` is sub-200ms in production (Vercel runtime
  logs) · if it's truly 5s in prod, add the same cache wrapper as
  /api/command/data
- Same for `/api/ultron/personal-pulse`
