# Appendix E - reading the new signals (2026-10-23)

Belongs after section D of `2026-10-23-brain-usage-map.md` (the manager's usage map, archived by the
brain-hygiene branch). It is a separate file only because that map is not on `main` yet; fold it in when
both have landed. Section A6, pain 2, said the site "cannot see itself below page level". Three writers now
close that gap. This appendix is their reader: the three queries below, and what each number means.

No dashboard and no panel on purpose: there is nothing to design until about 14 days of rows exist.
Until then every query returns NO DATA, which is not zero use.

Labels: FACT = pinned by a test in this repo. INFERRED = follows from the code. NOT CHECKED = said why.

## What is written, and where

| Signal | Writer | Row | Test that pins the shape |
|---|---|---|---|
| Page leave and dwell | `components/brain/page-tracker.tsx` -> `POST /api/brain/page-leave` -> `recordPageLeave` | `AuditEvent`, `eventType = 'page_leave'`, `detail` = path, `payload` = `{ page, dwellMs, capped, reason, hour, timestamp }` | `tests/services/record-page-leave.test.ts` |
| Tab views, including the default tab | `PageTracker` -> `brain.pageTabVisit` -> `recordPageTabVisit` | `AuditEvent`, `eventType = 'page_tab_visit'`, `detail` = path, `payload` = `{ page, tab, hour, timestamp }` | `tests/services/record-page-visit-tab.test.ts`, `tests/components/brain/page-tracker-default-tab.test.tsx` |
| tRPC calls | middleware in `lib/trpc/trpc.ts` -> `lib/trpc/call-telemetry.ts` | `system_metrics`, `metric = 'trpc.call'`, `value` = ms, `source = 'trpc'`, `tags` = `{ procedure, type, ok, code?, batch }` | `tests/trpc/call-telemetry.test.ts` |

`tests/repo/usage-appendix-queries.test.ts` fails if a query below names a key or a value that a writer
no longer stores.

## Query 1 - dwell by route (14 days)

```sql
SELECT detail AS page,
       COUNT(*) AS leaves,
       ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY (payload->>'dwellMs')::numeric) / 1000) AS p50_seconds,
       ROUND(SUM((payload->>'dwellMs')::numeric) / 60000) AS total_minutes,
       COUNT(*) FILTER (WHERE (payload->>'capped')::boolean) AS capped,
       COUNT(*) FILTER (WHERE payload->>'reason' = 'hidden') AS ended_by_hiding
FROM "AuditEvent"
WHERE "eventType" = 'page_leave'
  AND "createdAt" >= now() - interval '14 days'
GROUP BY detail
ORDER BY total_minutes DESC;
```

Meaning: how long a visit to each page lasts, and where the minutes go. `total_minutes` is time on the
page, `p50_seconds` is a typical visit.

- A leave is one foreground stretch. Hiding the tab or locking the phone ends it (`ended_by_hiding`); coming
  back starts a new stretch with its own leave. So leaves can outnumber `page_visit` rows for a page that is
  left open and returned to, and that is expected. INFERRED from `components/brain/page-tracker.tsx`.
- `capped` counts stretches that hit the 4 hour ceiling (a sleeping laptop). Their dwell is stored as
  4 hours, not as the real figure.
- A page with `page_visit` rows and no leaves was closed in a way the browser never reported (a killed
  iOS app). The dwell for those visits is missing, not zero. NOT CHECKED on a real phone yet.
- Opt-out (`nour:no-track` = `1`) writes nothing, for visits and leaves alike.

## Query 2 - tab views by page and tab (14 days)

```sql
SELECT detail AS page,
       payload->>'tab' AS tab,
       COUNT(*) AS views,
       COUNT(DISTINCT date_trunc('day', "createdAt" AT TIME ZONE 'America/New_York')) AS days_seen
FROM "AuditEvent"
WHERE "eventType" = 'page_tab_visit'
  AND "createdAt" >= now() - interval '14 days'
GROUP BY detail, payload->>'tab'
ORDER BY views DESC;
```

Meaning: which tab of `/brain` (memory, review, health) and `/stats` (mastery, goals, body) is actually
shown. Before this change the table had 0 rows ever, because a visit without `?tab=` logged nothing; the
default tab is now logged once per page open, and every tab click after that logs the tab clicked.

- A tab that appears in `days_seen = 1` only was looked at once; read it as "tried", not "used".
- A deep link with a retired key (`?tab=learning`, `?tab=calibration` on `/stats`) is stored under that key,
  not under the tab that shows its section.
- A tab view is not a page open. `page_visit` stays the only open counter.

## Query 3 - tRPC calls, errors and median time by procedure (14 days)

```sql
SELECT tags->>'procedure' AS procedure,
       COUNT(*) AS calls,
       COUNT(*) FILTER (WHERE tags->>'ok' = 'false') AS errors,
       ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY value)) AS p50_ms
FROM system_metrics
WHERE metric = 'trpc.call'
  AND source = 'trpc'
  AND created_at >= now() - interval '14 days'
GROUP BY tags->>'procedure'
ORDER BY calls DESC;
```

Meaning: which procedures the UI really calls, how often they fail, and how long a typical call takes. This
is the first widget-level evidence: a panel whose procedure is never called is a panel nobody opens.

- One row per call, so a polled query counts every poll. Compare procedures that poll with procedures that
  a person triggers by looking at `tags->>'type'` and the call spacing before drawing a conclusion.
- `ok = false` includes UNAUTHORIZED and mutation-locked calls; add `tags->>'code'` to the SELECT to split
  them from real failures.
- `batch` (how many calls shared one HTTP request) is stored for latency questions: a call that waited on a
  slow neighbour in the same batch has the batch's time, not its own.
- Server-side callers that skip HTTP are not batched and record `batch = 1`.
- Why `system_metrics` and not `api_request_logs`: see the header of `lib/trpc/call-telemetry.ts`.
  Retention is 90 days. The daily row volume is NOT CHECKED until the first day of rows exists; if it is
  above about 5,000 a day, sample the polled queries rather than raising retention.

## Proof owed after deploy

1. About 14 days after this lands, run the three queries (read-only) and file the counts by route, by
   tab and by procedure in the next usage map.
2. Before trusting any total: confirm the writers fired at all (query 1, 2 and 3 each return at least one
   row for the day after deploy) and compare the `page_leave` count with the `page_visit` count for the
   same days. A big gap means leaves are being lost, not that visits are short.
