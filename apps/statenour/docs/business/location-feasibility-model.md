# Second-Location Feasibility Model

v10.0.526 · Arc C · Feature 7 · operator runbook

This is the decision-support model for evaluating a second shop. It does
NOT make the call · the operator does. The model surfaces a score, a
tier, and the dimensions driving each so the operator can move fast
without reinventing the spreadsheet every time.

The model is intentionally light on automatic data ingestion. The
algorithm + the API + the chat tool all exist today. The data sources
(foot-traffic API · review scrape · zoning portal · drive-time
matrix) are operator-future-gated · pick vendors when ready, drop the
measurements into the candidate file, and the ranker takes over.

## The 5 dimensions

| Dimension | Input | Direction | Weight |
| --- | --- | --- | --- |
| `footTrafficPercentile` | 0-100 percentile vs the metro baseline | higher = better | 0.30 |
| `reviewDensity` | reviews per nearby competitor (log-saturated past ~20) | higher = better | 0.20 |
| `competitorCluster` | count of auto-repair shops within 2 miles | LOWER = better | 0.20 |
| `driveTimeToHomeMinutes` | minutes from Euclid HQ · capped at 60 | LOWER = better | 0.15 |
| `zoningFriction` | 0-100 estimate of municipal hassle | LOWER = better | 0.15 |

Weights sum to 1.0. They're tunable in `lib/services/location-feasibility.ts`
via `DEFAULT_WEIGHTS`. A future weight-tuner cron could fit them to
realized-revenue from the first second-location · for now they reflect
the operator's stated priors (foot traffic dominates · supervision
reach + municipal friction matter but matter less than market quality).

Any dimension can be omitted. Missing dimensions are scored neutrally
(0.5 raw) AND surface a warning in the response so the operator knows
what's still pending collection.

## Tier interpretation

| Tier | Range | Action |
| --- | --- | --- |
| A | 85-100 | Ship · proceed to financial diligence + lease negotiation |
| B | 70-84  | Strong · site visit + operator interview before commit |
| C | 50-69  | Marginal · 2+ dimensions need to improve · also where the "no-data baseline" lands |
| D | 35-49  | Weak · multiple red flags · deprioritize |
| F | 0-34   | Don't · or revisit input parameters |

The no-data baseline (zero dimensions provided) → 50 → tier C. That's
intentional: "we know nothing about this address" should NOT look the
same as "we measured and it's bad." The warning string tells the
operator which dimensions still need to be collected.

## How to invoke

### Chat tool

In any chat, ask Nick to score a candidate:

> Score 2840 Lakeshore Blvd Cleveland. Foot traffic 80th percentile,
> review density 14, 4 competitors within 2 miles, 12 minute drive,
> zoning friction 25.

Nick will call `scoreLocation` and reply with the tier, the strongest +
weakest dimensions, and operator-readable reasoning. Pruner triggers:
"score this location" · "evaluate Cleveland address" · "second location"
· "expansion address" · "rank these addresses" · "feasibility of <addr>".

### API · single address

```
GET /api/business/location-score?address=ENCODED_ADDRESS
    &footTrafficPercentile=80
    &reviewDensity=14
    &competitorCluster=4
    &driveTimeToHomeMinutes=12
    &zoningFriction=25
```

Owner-gated. All params except `address` are optional.

### API · batch + rank

```
POST /api/business/location-score
Content-Type: application/json

{
  "candidates": [
    { "address": "X", "footTrafficPercentile": 80, "competitorCluster": 4 },
    { "address": "Y", "footTrafficPercentile": 60, "competitorCluster": 1 }
  ]
}
```

Returns the scored candidates sorted by `normalizedScore` desc. Does
NOT persist · the monthly cron is the persistence path.

### API · monthly ranking read

```
GET /api/business/location-ranking          # current ET month
GET /api/business/location-ranking?month=2026-08
```

Returns the latest persisted top-20 from
`BrainMemory(category="location_ranking", key="monthly_YYYY-MM")`.
Owner-gated.

### Monthly cron

`monthly-location-rank` is folded into `mega-evening`. It gates on
1st-of-ET-month internally · the other 30 days it returns a cheap
no-op. To enable, drop a JSON file at
`data/location-candidates.json` with this shape:

```json
{
  "candidates": [
    {
      "address": "2840 Lakeshore Blvd, Cleveland OH",
      "footTrafficPercentile": 82,
      "reviewDensity": 14,
      "competitorCluster": 4,
      "driveTimeToHomeMinutes": 12,
      "zoningFriction": 25
    },
    {
      "address": "Another candidate",
      "footTrafficPercentile": 65,
      "competitorCluster": 2
    }
  ]
}
```

If the file is missing the cron returns a structured `candidate_file_missing`
no-op with the path · the cron dashboard stays green while the feature
is dormant. Re-runs in the same ET month UPDATE the existing
BrainMemory row (one row per month · stable handle).

## Data sources · future-gated

The operator selects the vendors. Some sensible defaults, costed
roughly:

- **Foot traffic** · Placer.ai (paid · per-location) or SafeGraph (paid)
  or Google Popular Times scrape (free, lossy)
- **Review density** · Google Places API (paid per call) +
  competitor-list scrape via Yelp Fusion (free tier)
- **Competitor cluster** · same Google Places call · count auto-repair
  + tire-shop categories within 2mi
- **Drive time** · Google Distance Matrix (paid · cheap) from
  candidate to 4500 East 49th St, Cleveland OH 44125
- **Zoning friction** · municipal portal scrape (city-specific · slow)
  or operator manual scoring after a 30-second portal check

No fetcher exists in this commit. When the operator picks vendors, add
the fetcher in `lib/services/location-feasibility-fetch.ts` (new file)
and call it from the cron BEFORE invoking `rankCandidates`. The scorer
itself does not change.

## Files

- `lib/services/location-feasibility.ts` · pure scorer + tier mapper
- `lib/services/location-rank.ts` · ranker + BrainMemory persistence
- `app/api/business/location-score/route.ts` · GET single + POST batch
- `app/api/business/location-ranking/route.ts` · GET persisted monthly
- `app/api/cron/monthly-location-rank/route.ts` · 1st-of-month cron
- `tests/services/location-feasibility.test.ts` · pure-function tests
- `data/location-candidates.json` · operator-curated · NOT committed
  with data · template lives above

## Why this shape

- The math is a PURE FUNCTION · trivial to unit-test, no flakiness,
  no DB · the day vendor data arrives, only the fetcher changes.
- BrainMemory categories (`location_ranking`) avoid a new table.
  The model has ONE downstream consumer · the operator's monthly
  decision · a key-value persistence is the right size.
- The chat tool surfaces the scorer in conversation so the operator
  can play with addresses without leaving chat.
- The cron's 1st-of-month gate keeps the mega-evening fan-out cheap
  on non-ranking days · the gate is inside the handler, not the
  schedule, so re-runs/backfills are trivial.
