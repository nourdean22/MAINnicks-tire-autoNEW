# Nickstire Query Contract — v11.4 (2026-05-09)

> **This doc is the mirror.** It must match `docs/NICKSTIRE-QUERY-CONTRACT.md`
> in the statenour-os repo byte-for-byte. When adding or changing an endpoint,
> update both files in the same commit.

## Auth

Every bridge endpoint requires the header:

```
X-Statenour-Sync-Key: <STATENOUR_SYNC_KEY>
```

The key lives in `env.STATENOUR_SYNC_KEY` on both rings. Mismatch → 401.
Using `timingSafeEqual` so it's not timing-attackable.

---

## Data-freshness contract (every bridge response)

Every endpoint response includes these fields so statenour can render
an "as of Xm ago" footer on each card:

```json
{
  "generatedAt": "2026-04-22T14:23:45.123Z",
  "dataAsOf":    "2026-04-22T14:08:12.000Z",
  "ageMinutes":  15,
  "staleness":   "recent"
}
```

- `generatedAt` — when THIS response was computed (always now).
- `dataAsOf` — when the underlying ALG mirror last succeeded, null if
  never this session.
- `ageMinutes` — `now() - dataAsOf` in minutes, null if uncollected.
- `staleness` — categorical band:
  - `"live"`        — age < 5min
  - `"recent"`      — age 5–30min
  - `"stale"`       — age 30min–2h
  - `"very_stale"`  — age > 2h (shop-protection probably active)
  - `"uncollected"` — no successful sync yet this process (just booted,
                     OR shop-protection has kept probes idle for hours)

**Important:** these endpoints NEVER trigger a mirror refresh. They are
pure DB reads. If you want fresh data you must hit
`POST /api/trpc/shopdriver.forceSyncNow` (admin auth, NOT statenour-sync
auth) which acknowledges it may kick the shop's ShopDriver session.

---

## 1. GET `/api/bridge/cars-today`

Returns today's shop activity — counts by stage + total paid.

**Request:**
```
GET /api/bridge/cars-today
X-Statenour-Sync-Key: <key>
```

**Response:**
```json
{
  "count": 14,
  "openTickets": 9,
  "avgTicket": 187.50,
  "byStatus": {
    "drop_off": 4,
    "in_progress": 3,
    "ready": 2,
    "paid": 5
  },
  "byPayment": {
    "card":      { "count": 3, "totalDollars": 632.00 },
    "cash":      { "count": 1, "totalDollars": 85.00 },
    "financing": { "count": 1, "totalDollars": 850.00 }
  },
  "generatedAt": "2026-04-22T14:23:45.123Z",
  "dataAsOf":    "2026-04-22T14:08:12.000Z",
  "ageMinutes":  15,
  "staleness":   "recent",
  "source": {
    "bookings": "nickstire.org bookings table (DB-resident)",
    "invoices": "ALG mirror (see dataAsOf for freshness)",
    "note":     "Counts reflect last-synced ALG state, not the live shop ShopDriver screen."
  }
}
```

- `count` — today's total cars touched (bookings + paid invoices)
- `openTickets` — drop_off + in_progress + ready (still in bay)
- `avgTicket` — mean `totalAmount / 100` of today's paid invoices
- `byStatus.paid` — count of invoices with paymentStatus=paid today
- All other `byStatus.*` — bookings filtered by `stage` column
- `byPayment` — today's paid invoices grouped by `paymentMethod` enum
  value (`card | cash | check | financing | other`). Use to show a
  split: card+cash = in-person-paid-today, `financing` = Snap/Acima/
  Koalafi/AFF (mixed). Our Snap dashboard (admin section) is the
  authoritative breakdown of WHICH financing provider.

**Data source:**
`bookings` table (today's `createdAt` or `preferredDate`) +
`invoices` table (today's `invoiceDate`).

---

## 2. GET `/api/bridge/estimates-conversion?range=7d|30d|90d&scope=online|alg`

Lead → estimate → invoice funnel.

**Request:**
```
GET /api/bridge/estimates-conversion?range=30d&scope=alg
X-Statenour-Sync-Key: <key>
```

### scope=online (default) — ONLINE funnel
```json
{
  "range": "30d",
  "given": 127,
  "converted": 52,
  "rate": 40.9,
  "avgTimeToConvertHours": 18.7,
  "byService": [
    { "service": "Brake Service", "given": 24, "converted": 12, "rate": 50.0 },
    { "service": "Oil Change",    "given": 19, "converted": 9,  "rate": 47.4 }
  ],
  "scope": "online",
  "generatedAt": "2026-04-22T14:23:45.123Z"
}
```

- Default range: `30d`. Valid: `7d | 30d | 90d`. Unknown values → 30d.
- `rate` — `converted / given * 100`, rounded to 1 decimal.
- `avgTimeToConvertHours` — average elapsed hours between
  `estimates_log.createdAt` and `invoices.invoiceDate`.
- `byService` — top 10 services by count of estimates in window.
- Source: `estimates_log` JOINed to `invoices` by `invoiceId` — AI estimator
  + customer portal + ShopDriver-synced. This is the ONLINE funnel.

### scope=alg — ALG WALK-IN funnel (declined-work truth)
```json
{
  "range": "30d",
  "given": 84,
  "converted": 61,
  "rate": 72.6,
  "avgTimeToConvertHours": 46.2,
  "declinedCount": 23,
  "declinedValue": 7420.00,
  "topUnmatched": [
    { "name": "SMITH, JOHN", "service": "Front struts + alignment", "amount": 1485.00, "daysOld": 9 },
    { "name": "DOE, JANE", "service": "Brake pads + rotors", "amount": 560.00, "daysOld": 14 }
  ],
  "scope": "alg",
  "generatedAt": "2026-04-22T14:23:45.123Z"
}
```

- **This is the signal Nour cares about**: how many walk-ins with a physical
  ALG quote actually converted into an invoice?
- Source: `alg_estimates` table, synced from ShopDriver Elite via
  `server/services/shopDriverEstimateSync.ts` (shop-protected, pulse-tier).
- `converted` — count where `matched_invoice_id IS NOT NULL`.
- Match heuristic: same `customerPhone` + invoice `totalAmount` within ±10%
  of `estimatedAmount` + invoice date within 30d of the estimate date.
- `declinedCount` / `declinedValue` — the recovery pool. Unmatched rows
  are targeted by the `alg-declined-work-recovery` cron (daily tier) which
  sends 7d + 30d SMS follow-ups when `FEATURE_DECLINED_RECOVERY=1`.
- `topUnmatched` — top 5 unmatched quotes by dollar value in window.
- `dataAsOf` / `staleness` here reflect the **estimate** sync cadence, not
  the invoice mirror.

---

## 3. GET `/api/bridge/estimates-aging?scope=online|alg`

Un-converted estimates aging buckets + stalest record.

**Request:**
```
GET /api/bridge/estimates-aging?scope=alg
X-Statenour-Sync-Key: <key>
```

### scope=online (default)
```json
{
  "total": 43,
  "bucket_lt24h":  8,
  "bucket_1d_3d":  14,
  "bucket_3d_7d":  12,
  "bucket_gt7d":   9,
  "stalest": {
    "id": 812,
    "customer": "Terrence W.",
    "service": "Brake Pads Front + Rotors",
    "days": 23,
    "amount": 395.00
  },
  "scope": "online",
  "generatedAt": "2026-04-22T14:23:45.123Z"
}
```

- Source: `estimates_log WHERE converted = 0` — AI/portal/website.

### scope=alg — ALG WALK-IN aging (declined work)
```json
{
  "total": 23,
  "bucket_lt24h":  2,
  "bucket_1d_3d":  6,
  "bucket_3d_7d":  7,
  "bucket_gt7d":   8,
  "stalest": {
    "id": 41,
    "customer": "SMITH, JOHN",
    "service": "Front struts + alignment",
    "days": 47,
    "amount": 1485.00
  },
  "totalDeclinedValue": 12840.00,
  "scope": "alg",
  "generatedAt": "2026-04-22T14:23:45.123Z"
}
```

- Source: `alg_estimates WHERE matched_invoice_id IS NULL` — walked customers.
- `totalDeclinedValue` — sum of unmatched `estimated_amount` in the last 60d,
  in dollars. This is the live recovery pool.

Bucket cutoffs (both scopes):
- `lt24h` : < 24h
- `1d_3d` : 24–72h
- `3d_7d` : 73–168h
- `gt7d`  : > 168h

---

## 4. GET `/api/bridge/drop-off-ratio?range=7d|30d|90d`

Drop-off vs walk-in split + Uber-out count.

**Request:**
```
GET /api/bridge/drop-off-ratio?range=30d
X-Statenour-Sync-Key: <key>
```

**Response:**
```json
{
  "range": "30d",
  "dropOffs": 87,
  "walkIns": 164,
  "ratio": 34.7,
  "uberBackCount": 19,
  "generatedAt": "2026-04-22T14:23:45.123Z"
}
```

- `dropOffs` — bookings in window where `preferredDate IS NOT NULL` (planned ahead).
- `walkIns` — bookings in window where `preferredDate IS NULL` (same-day).
- `ratio` — `dropOffs / (dropOffs + walkIns) * 100`, rounded to 1 decimal.
- `uberBackCount` — count of `audit_log` entries with `action = 'customer.uber_requested'`
  in window (populated by the /api/uber-code endpoint wiring).

> **Heuristic note:** our data model doesn't yet capture drop-off vs walk-in
> explicitly. The `preferredDate` heuristic is the best proxy until we add a
> dedicated column.

---

## 5. Snap Finance Endpoints

### 5a. POST `/api/snap/application`

Owner-authed proxy — submits application to Snap's API, records locally.

**Request:**
```
POST /api/snap/application
Content-Type: application/json
X-Statenour-Sync-Key: <key>

{
  "customerName": "Jane Driver",
  "customerPhone": "2165550100",
  "customerEmail": "jane@example.com",
  "amount": 850,
  "vehicle": "2019 Honda Civic",
  "service": "Brake pads + rotors, front axle"
}
```

**Response:**
```json
{
  "success": true,
  "localId": "uuid-...",
  "externalApplicationId": "snap-app-12345",
  "status": "pending",
  "proxyUsed": true
}
```

- Required: `customerName`, `customerPhone`. Other fields optional.
- If `SNAP_FINANCE_API_KEY` and `SNAP_FINANCE_MERCHANT_ID` are set,
  proxies to `https://api.snapfinance.com/v1/applications`.
- If not set, `proxyUsed: false` — local record only for admin visibility.
- Both cases: application is logged to `audit_log` with
  `action = 'snap.application_submitted'` for the admin dashboard.

### 5b. POST `/api/snap/webhook`

Receives Snap-side status callbacks.

**Request:**
```
POST /api/snap/webhook
Content-Type: application/json
X-Snap-Signature: <hmac-sha256>

{
  "applicationId": "snap-app-12345",
  "status": "approved",
  "amount": 850,
  "customerName": "Jane Driver"
}
```

**Response:**
```json
{ "success": true }
```

- If `SNAP_FINANCE_WEBHOOK_SECRET` is set, the `X-Snap-Signature` header
  is verified as `hmac-sha256(secret, JSON.stringify(body))`.
- If not set, accepts anonymously for initial rollout (log warning).
- `status = "approved"` + `amount` + `customerName` → also records the
  invoice in our Stripe-style revenue path via
  `services/snapFinanceSync.recordSnapPayment`.
- Any status change is appended to `audit_log` with
  `action = 'snap.application_status_changed'` for the admin dashboard timeline.

---

---

## 6. POST `/api/nour-os/query` — statenour COO actions

A second, **action-style** bridge separate from the `/api/bridge/*` REST
surface above. Statenour-os AI COO ("Nick") calls these to answer Nour's
questions with live data instead of stale 15-min sync dumps.

**Auth:** same `STATENOUR_SYNC_KEY`, but as the `x-sync-key` header
(lowercase, no `X-Statenour-` prefix). Source: `server/routes/nour-os-query.ts`.

**Request shape:**

```http
POST /api/nour-os/query
x-sync-key: <STATENOUR_SYNC_KEY>
Content-Type: application/json

{
  "query": "<action-name>",
  "filters": { ... }
}
```

**Response shape:**

```json
{
  "query": "<action-name>",
  "timestamp": "2026-05-09T01:23:45.000Z",
  "data": { ... }
}
```

If `query` is missing or unknown → 400 with `available: string[]` listing
every registered handler. If `x-sync-key` is missing/wrong → 401.

**Registered actions (alphabetical):**

| Action | Filters | Returns |
|---|---|---|
| `attention_needed` | none | `{ alerts: [{ level, message, count }], totalCritical, totalWarning }` |
| `bookings_status` | none | 7-day status breakdown |
| `bookings_today` | none | Today's bookings (ET-anchored) |
| `callbacks_pending` | none | New callback requests |
| `customer_search` | `term: string` | Top 20 matching customers |
| `feature_flags` | none | All flags + enabled state |
| `gsc_summary` | `from?, to?` (YYYY-MM-DD; default last 30d) | `{ totalClicks, totalImpressions, avgCtr, avgPosition }` (CTR is %, position is float) |
| `gsc_top_queries` | `from?, to?, limit?` (default 30d, top 10, max 50) | `{ queries: [{ query, clicks, impressions, ctr, position }] }` |
| `leads_pipeline` | none | 30-day status breakdown |
| `leads_today` | none | Today's leads (ET-anchored) |
| `leads_urgent` | none | Urgency ≥ 4, status = new |
| `revenue_range` | `from?, to?` | Total + avg ticket for range |
| `revenue_today` | none | Today's revenue (ET-anchored) |
| `shop_pulse` | none | Live snapshot via nickIntelligence |
| `work_orders_active` | none | Open work orders (≠ completed/cancelled) |

**GSC actions (added v11.4, 2026-05-09):** these were added because the
statenour AI COO had no SEO data source and was fabricating round
numbers (1,700 imp / 17 clicks for both 30d AND 90d). Pipeline at
`server/pipelines/gsc-data.ts` already populates `search_performance`
nightly via Google Service Account; the bridge just reads from it.

CTR + position are recomputed from raw click/impression sums (not
average-of-averages) so totals stay accurate when the date range is
wider than one day. Position is impression-weighted.

**Don't:** add actions that mutate or trigger external API calls. This
endpoint is read-only DB access by design. Mirror refreshes go through
the admin UI's `forceSyncNow`, not here.

---

## Notes on ALG / Auto Labor Experts coupling

1. **ALG is still the source of truth for counter activity.** Our
   `invoices` table is a mirror of ALG, populated by
   `server/services/shopDriverMirror.ts`. The mirror only runs when
   Nour is actively on `/admin` (shop-protection from v1.1 — probes
   kick the shop's ShopDriver session). `dataAsOf` on every response
   tells you how fresh the mirror is.

2. **Never poll `/api/bridge/*` faster than 30 seconds** — it's cheap
   DB reads, but spamming adds noise in request logs without ever
   changing the answer (mirror refreshes every 15 min tops, gated).

3. **Don't add bridge endpoints that trigger writes or mirror refresh.**
   If statenour needs a "force sync" button, it should prompt the
   operator to hit the admin UI's `forceSyncNow` button (admin-authed,
   acknowledges the shop-kick cost). Not a bridge concern.

4. **Estimates ≠ ALG quotes.** See `scope: "online"` caveats on
   estimates-conversion + estimates-aging. If the number looks wrong
   vs what Nour sees in ALG, it's because ALG's counter quotes aren't
   in our `estimates_log`.

5. **Financing in `paymentMethod="financing"` is a mixed bag.** Snap +
   Acima + Koalafi + American First Finance all land there. The Snap
   admin dashboard (`/admin` → "Snap Finance") is the single source of
   truth for Snap-specific breakdowns. Other providers don't have
   dedicated dashboards yet.

6. **ALG endpoint surface may have more fields than we use.** There's
   a weekly `alg-auto-discovery` cron that probes ShopDriver's API for
   new/changed endpoints and Telegram-alerts if it finds any. If our
   `byStatus` enum ever looks incomplete, that discovery run is what
   should drive the expansion.

## Versioning

- **v11.1** (2026-04-22) — initial 4 bridge endpoints + Snap Finance wiring.
- **v11.2** (2026-04-22) — every response now carries dataAsOf +
  staleness fields; estimates endpoints explicitly scoped to "online";
  cars-today adds byPayment breakdown; documented ALG coupling caveats
  (section above).
- **v11.3** (2026-04-22) — `scope=alg` option added on `estimates-conversion`
  and `estimates-aging`. Backed by the new `alg_estimates` table and
  `shopDriverEstimateSync.ts` service — exposes walk-in quote conversion
  and the declined-work recovery pool. Own freshness source
  (`getEstimateMirrorFreshness`) independent of the invoice mirror.
- **v11.4** (2026-05-09) — `/api/nour-os/query` action surface documented
  (Section 6). New `gsc_summary` + `gsc_top_queries` actions backing the
  statenour COO so it stops fabricating GSC numbers; reads from the
  `search_performance` table populated by `pipelines/gsc-data.ts`. CTR
  + position recomputed from raw sums (not avg-of-avg) and position is
  impression-weighted for accurate multi-day aggregates.

When adding a new endpoint: bump version, document here + statenour repo,
include the commit hash in the PR description so cross-ring wiring is
traceable.
