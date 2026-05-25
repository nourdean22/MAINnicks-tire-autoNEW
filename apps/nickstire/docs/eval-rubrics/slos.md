# SLI / SLO Definitions

**Skill port:** B2 · slo-implementation + observability-engineer
**Applies to:** every production endpoint (nickstire.org + nickstire API + statenour-web + Ollama backup + SMS gateway + VAPI webhook + Stripe webhook).
**Authored:** 2026-05-26.

## Why this doc exists

Today `/api/health` returns "degraded" / "down" but there are no SLOs (service-level objectives) defined. "Degraded" is operator-judgment · not a measurable contract. SLOs make the contract explicit · alerts fire when contracts break · observability gets meaning.

## SLO conventions

- **SLI** = Service Level Indicator · the metric (latency, error rate, availability)
- **SLO** = Service Level Objective · the target (99% < 500ms)
- **Error budget** = 100% − SLO % · how much breach is allowed per period
- **Period** = rolling window (typically 28 days)

## Tier-S SLOs · revenue-critical paths

### `placeOrder` mutation (tRPC)

| SLI | SLO | Period |
|---|---|---|
| Success rate (no 5xx, no zod failure) | 99.5% | 28d |
| p95 latency | < 800ms | 28d |
| p99 latency | < 1500ms | 28d |
| Idempotency-key dedup correctness | 100% | always |

Why · this is the money endpoint. Wave B added price-floor protection but the endpoint itself still has to be fast + reliable. If error budget burns in <3 days · operator gets paged.

### `confirmCheckout` + `/api/webhooks/stripe`

| SLI | SLO | Period |
|---|---|---|
| Webhook signature verification rate | 100% | always |
| Payment finalization within 60s of Stripe event | 99.9% | 28d |
| Half-config detection (Wave D #113) firing rate | always (if env mis-set) | always |

### VAPI webhook (`/routes/webhooks/vapi`)

| SLI | SLO | Period |
|---|---|---|
| Webhook 200-response rate | 99.9% | 28d |
| Tool-call dispatch within 1500ms (voice latency budget) | 99% | 28d |
| Transcript field present on end-of-call (Wave E.1 #106 fix) | 99% | 28d |
| `convertedToLead` flag correctness (Wave E.1 #107) | 100% | always |

## Tier-A SLOs · customer-facing read paths

### `gatewayTire.publicSearch` (tire search on /tires)

| SLI | SLO | Period |
|---|---|---|
| Returns results (>0 tires) when D&K is up | 99% | 28d |
| p95 latency | < 1500ms | 28d |
| Cache hit rate when pipeline cron healthy | > 60% | 28d |
| $0 tire filter active (Wave B #152) | always | always |

### `nickstire.org/` homepage (Vite SPA)

| SLI | SLO | Period |
|---|---|---|
| HTTP 200 | 99.9% | 28d |
| Asset references resolve (post Wave M defensive 404) | 100% | always |
| First Contentful Paint (PSI mobile) | < 4.5s | 28d |
| Largest Contentful Paint (PSI mobile) | < 6.5s | 28d |

## Tier-B SLOs · operator-facing surfaces

### Admin app (`/admin`)

| SLI | SLO | Period |
|---|---|---|
| Auth + load time | < 3s | 28d |
| MorningBrief load time | < 2s | 28d |
| tRPC call success rate | 99.5% | 28d |

### statenour `/scoreboard` `NickHealthSection`

| SLI | SLO | Period |
|---|---|---|
| Bridge call success rate (`master_report`) | 99% | 28d |
| Polling refresh within 130s of last update | 99% | 28d |
| Health score numeric range [0-100] | always | always |

## Tier-C SLOs · background crons

### `service-affinity-compute` (post Wave C · hourly tier)

| SLI | SLO | Period |
|---|---|---|
| Run completion within tier interval (2h) | 95% | 28d |
| Writes ≥1 row to `service_affinity_predictions` per tick | 95% | 28d |
| A/B arm split within 45/55 | 99% | 28d |

### `cross-sell-outreach` (post Wave C · hourly tier · businessHoursOnly)

| SLI | SLO | Period |
|---|---|---|
| Sends ≤ MAX_SMS_PER_RUN (10) per tick | 100% | always |
| Cooldown lookup success rate (Wave C #101 abort fix) | 99% | 28d |
| Customer opt-out compliance | 100% | always |

### `gateway-price-refresh` (4×/day)

| SLI | SLO | Period |
|---|---|---|
| Successful D&K API call rate | 95% | 28d |
| Cache population (rows in `gateway_prices` after run) | always > 50 rows | always |
| Stale-data alert (run within 24h of last success) | 99% | 28d |

## Error budget · what to do when it burns

| Burn rate | Operator action |
|---|---|
| 0% used (no breaches in 28d) | Ship features faster · over-allocated reliability budget |
| <25% used | Normal · monitor weekly |
| 25-50% used | Slow new feature ships · investigate top breach cause |
| 50-75% used | Halt risky feature ships · fix breach class · review postmortem template (Wave T B1) |
| >75% used | Halt ALL ships except reliability fixes · escalate · postmortem each breach |
| 100% burned (budget exhausted) | All ships through release-only-after-fix · monthly SLO review |

## Implementation plan (queued)

1. Add structured logging to surface SLI metrics · most SLIs are derivable from existing log lines OR from `cron_log` / `wave_metrics` tables
2. Build `/api/system/slo-status` endpoint · returns current 28d burn rate per SLO
3. Wire to operator's Telegram digest · daily summary of SLO state
4. Alert on burn rate > 50% via Telegram (loud) · burn rate > 75% via SMS to operator (loudest)

## Anti-patterns

### "100% SLO"

Means you have no error budget · means you can't ship at all · means the SLO is wrong. Real SLOs are <100% by definition.

### "Latency SLO without percentile"

"Latency < 500ms" means what · avg, median, p95, p99? Always state the percentile. Avg latency is useless · p95 is the operator experience · p99 is the worst customer experience.

### "Alert on every breach"

Alert on BURN RATE, not on individual breaches. A single slow request isn't an emergency · 50% of error budget consumed in 3 days is.

### "SLO without a customer story"

"99.9% of `improve-agent` cron success" · who cares? Improve-agent is internal. Tier-C SLOs are for internal monitoring · the operator-facing SLOs (Tier S/A) are where the alerting lives.

## Skill-port lineage

B2 from the audit's Round 2. Companion to:
- Wave T · postmortem template (B1) · postmortems are triggered by SLO breaches
- Wave V · autonomous-action tiers (operator-action threshold tiers map to burn-rate tiers)
- Wave R · voice-agent eval rubric (VAPI SLOs feed the eval score)
- A6 · claude-api budget (Anthropic API cost SLOs · see claude-monitor.md)

Future · build a per-SLO dashboard panel on /admin or /scoreboard · each tile shows current burn rate + days-to-budget-exhaustion.
