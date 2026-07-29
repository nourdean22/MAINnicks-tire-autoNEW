# Apple Health → statenour sync (H3 · 2026-07-28)

**Bridge choice:** Health Auto Export (App Store app) posting **directly
from the iPhone to your own endpoint** — no third-party server ever
holds the data. A native Swift bridge stays a WATCH-class work package;
build it only if HAE's limits actually bite.

## One-time setup (operator, ~30 min)

1. **Set the token on Railway** (statenour-web service):
   `HEALTH_INGEST_TOKEN` = a long random string (e.g. `openssl rand -hex 32`).
   The route fails CLOSED (503) until this exists. Rotating the value
   revokes the device instantly. Never commit it.
2. **Install Health Auto Export** on the iPhone; grant it the Health
   read permissions you actually want (start small: sleep, steps,
   weight, body fat, resting heart rate, HRV, workouts).
3. **Create a REST API export** in HAE:
   - URL: `https://bdnick.info/api/integrations/apple-health/v1/hae`
   - Method: POST · Format: **JSON** (required — CSV is rejected)
   - Header: `Authorization: Bearer <HEALTH_INGEST_TOKEN>`
   - Aggregation: days is fine for scalars; sleep comes through
     `sleep_analysis` either way.
   - Verify HAE's current export-config UI on install — field names in
     this runbook match its long-stable JSON shape, but the app updates.
4. **Create an HAE automation**: daily (e.g. 9:00 AM) + optionally a
   second evening run. Every push is idempotent — the batchId is a hash
   of the payload, and per-sample IDs are deterministic, so retries and
   overlapping windows dedupe at the database constraint.
5. **Backfill**: run manual exports for last 30 days first, then longer
   ranges if wanted. Same idempotency applies.

## Smoke test

```bash
curl -s -X POST "https://bdnick.info/api/integrations/apple-health/v1/hae" -H "Authorization: Bearer $HEALTH_INGEST_TOKEN" -H "Content-Type: application/json" -d '{"data":{"metrics":[{"name":"step_count","units":"count","data":[{"date":"2026-07-28 09:00:00 -0400","qty":1234}]}]}}'
```

Expect `201` with a receipt (`accepted: 1` first run, `replayed: true`
on the identical re-run). `401` = token mismatch · `503` = env unset ·
`422` = payload shape unrecognized (check JSON format + metric selection).

## What happens on ingest

Raw samples land in `health_samples` (provenance + dedupe), a receipt
in `health_ingest_batches`, and the summarizer patches **BodyTracking**
for each touched ET day — **fill-nulls only: your manual entries always
win**. From there the existing consumers light up with zero new wiring:
the sleep/fitness/mental-health analyzers, the MODE → RECOVERY trigger
(sleep < 6h), the morning brief's body-state adaptation, and Nick's
`getHealthToday` / `getSleepTrend` / `getBodyData` tools.

## Shortcuts fallback (no HAE)

An Apple Shortcut can read a metric (e.g. today's sleep) and POST the
canonical shape to `/api/integrations/apple-health/v1/batches`:

```json
{"schemaVersion":1,"batchId":"shortcut-<date>-sleep","samples":[{"type":"sleep_asleep_hours","startAt":"<ISO>","value":6.2,"unit":"hr"}]}
```

Fewer metric types, zero dependencies. Same auth header.

## Privacy posture

Health values never appear in request logs (counts + metric names
only) · no health data enters analytics events · Nick reads health via
scoped tools per-question, never into permanent memory (memory-gateway
doctrine) · deleting is `DELETE FROM health_samples` + rotating the
token — samples are the only raw store.

## Deferred (blueprint WPs)

Trends page · transparent recovery score · medication/symptom tables ·
resting-HR/HRV columns on BodyTracking (when a consumer needs them) ·
native Swift bridge · clinical records (never-for-now).
