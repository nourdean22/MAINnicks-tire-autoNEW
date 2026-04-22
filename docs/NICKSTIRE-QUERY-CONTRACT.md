# Nickstire Query Contract — v11.1 (2026-04-22)

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
  "generatedAt": "2026-04-22T14:23:45.123Z"
}
```

- `count` — today's total cars touched (bookings + paid invoices)
- `openTickets` — drop_off + in_progress + ready (still in bay)
- `avgTicket` — mean `totalAmount / 100` of today's paid invoices
- `byStatus.paid` — count of invoices with paymentStatus=paid today
- All other `byStatus.*` — bookings filtered by `stage` column

**Data source:**
`bookings` table (today's `createdAt` or `preferredDate`) +
`invoices` table (today's `invoiceDate`).

---

## 2. GET `/api/bridge/estimates-conversion?range=7d|30d|90d`

Lead → estimate → invoice funnel.

**Request:**
```
GET /api/bridge/estimates-conversion?range=30d
X-Statenour-Sync-Key: <key>
```

**Response:**
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
  "generatedAt": "2026-04-22T14:23:45.123Z"
}
```

- Default range: `30d`. Valid: `7d | 30d | 90d`. Unknown values → 30d.
- `rate` — `converted / given * 100`, rounded to 1 decimal.
- `avgTimeToConvertHours` — average elapsed hours between
  `estimates_log.createdAt` and `invoices.invoiceDate`.
- `byService` — top 10 services by count of estimates in window.

**Data source:** `estimates_log` table JOINed to `invoices` by `invoiceId`.

---

## 3. GET `/api/bridge/estimates-aging`

Un-converted estimates aging buckets + stalest record.

**Request:**
```
GET /api/bridge/estimates-aging
X-Statenour-Sync-Key: <key>
```

**Response:**
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
  "generatedAt": "2026-04-22T14:23:45.123Z"
}
```

- Only counts rows where `converted = 0`.
- Buckets by hours-since-createdAt:
  - `lt24h` : < 24
  - `1d_3d` : 24–72
  - `3d_7d` : 73–168
  - `gt7d`  : > 168
- `stalest` — oldest un-converted estimate (null if no un-converted estimates).

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

## Versioning

- **v11.1** (2026-04-22) — initial 4 bridge endpoints + Snap Finance wiring.

When adding a new endpoint: bump version, document here + statenour repo,
include the commit hash in the PR description so cross-ring wiring is
traceable.
