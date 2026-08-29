# Posting schedule: what the data actually supports

**Measured 2026-08-28. Verdict: the data does NOT support a derived posting schedule. None is implemented.**

An unfounded posting time is folklore with a cron attached. This file records the
measurement so the question is not re-opened from a listicle.

## What exists

| Source | What it gives | Coverage |
|---|---|---|
| Instagram Graph API `/{ig-user}/media?fields=timestamp` | publish time for **every** post | **630 / 630 (100%)** |
| `ig_metric_snapshots` (TiDB) | views / reach / likes / saved / shares per post | **93 distinct posts, 750 rows** |
| `ig_autopost_log` | 445 rows, `slotDate` is `varchar(10)` — **date only, no hour** | n/a for hour-of-day |

`ig_metric_snapshots` has **no publish-time column** — `capturedAt` is when the
snapshot cron ran, not when the post went out. Publish time has to come from the
Graph API. That join works cleanly: **all 93 measured posts matched a publish
timestamp, 0 unjoinable.**

## Why a schedule still cannot be derived

Performance covers **93 of 630 posts = 14.8%**. Distribution of those 93 across
Eastern-time publish hours:

```
hour: 6  7  8  9 10 11 12 13 14 15 17 18 20
n:    1  5 22  5  4  1  1 19 12  2  1  1 19
```

- **13 of 24 hours have any measured post at all.** Eleven hours have **zero**.
- **Median n per hour = 4.**
- Only **4 hours reach n >= 10**: 08:00 (22), 13:00 (19), 20:00 (19), 14:00 (12).
- An hour x day-of-week schedule needs 168 buckets. There are 93 measured posts.
  That is not a thin sample, it is fewer observations than buckets.

Ranking 13 candidate hours on a median of 4 observations, with 11 hours
abstaining, produces a confident-looking number with nothing behind it. The four
hours that clear n >= 10 hold 72 of the 93 posts, so even the best-supported
comparison is between four buckets of 12-22 — and it is **confounded**: posting
is heavily concentrated at 06:00-08:00 ET (92 + 121 + 83 = 296 of 630 posts),
so hour is entangled with whatever was being posted in that era. Nothing here was
randomised.

## What would change the verdict

1. **Widen metric coverage.** The snapshot cron reaches 14.8% of posts. At even
   coverage of 630 posts across 24 hours the median bucket would be ~26.
2. **Then re-run this measurement**, and only claim an hour when its bucket
   carries a real sample — state `n` beside any hour that gets recommended.

Until then `POST_HOUR_ET` stays a fixed operator choice, which is honest: a
constant nobody mistakes for evidence beats a ranking that looks derived.

## Sample sizes, stated

Every ratio above is inside a filtered population and is quoted with its
denominator: 93/630 measured (14.8%), 93 posts across 13 populated hours
(median 4), 4 hours at n >= 10, 296/630 posts published 06:00-08:00 ET.
