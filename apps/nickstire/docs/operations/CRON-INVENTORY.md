# Cron Inventory — What Runs, When, Why

Every background job in `server/cron/scheduler.ts` (tiered scheduler) and the
HTTP-triggerable registry in `server/cron/index.ts`. **This file is generated** from
those two sources — `server/cron/cronInventoryParity.test.ts` fails when they drift.

**Last regenerated: 2026-10-10 by `scripts/gen-cron-inventory.mts`.**

> The code is the source of truth. To add or change a job, edit the scheduler and
> re-run the generator in the same commit; write the job's purpose in the last column.

<!-- generated:begin — do not edit by hand; run pnpm exec tsx scripts/gen-cron-inventory.mts -->

## Tier overview

| Tier | Interval | Jobs (scheduled / staged) |
|---|---|---|
| heartbeat | every 5m | 4 / 2 |
| pulse | every 15m | 23 / 0 |
| hourly | every 2h | 37 / 1 |
| daily | every 1d | 53 / 0 |
| briefings | every 12h | 6 / 0 |

**Total: 126 tiered jobs (123 scheduled automatically, 3 staged off the scheduler) + 6 HTTP-only registry jobs.**

## heartbeat (every 5m)

| Job | Business hours only | Once per shop day | Scheduled | Purpose |
|---|---|---|---|---|
| `alg-mirror-health` | yes | no | yes | — |
| `camera-health-alert-selftest` | no | no | **STAGED — HTTP trigger only** | — |
| `camera-health-alerts` | no | no | yes | — |
| `campaign-resume` | no | no | **STAGED — HTTP trigger only** | — |
| `data-accuracy-check` | no | no | yes | — |
| `self-healing` | no | no | yes | Detect + auto-recover from common failures (DB pool, restart spam) |

## pulse (every 15m)

| Job | Business hours only | Once per shop day | Scheduled | Purpose |
|---|---|---|---|---|
| `abandoned-forms` | yes | no | yes | Detect partially-filled booking forms and auto-recover |
| `alg-evening-probe` | no | no | yes | — |
| `alg-overnight-probe` | no | no | yes | — |
| `cloud-camera-snapshots` | no | no | yes | — |
| `cron-failure-observer` | no | no | yes | — |
| `daily-reel-post` | no | no | yes | — |
| `dashboard-sync` | no | no | yes | Sync admin dashboard tiles to fresh data |
| `gateway-order-status-poll` | yes | no | yes | — |
| `higgsfield-session-keepalive` | no | no | yes | — |
| `ig-autopost` | no | no | yes | — |
| `obligation-mirror` | yes | no | yes | — |
| `orchestration-status-reconcile` | no | no | yes | — |
| `overdue-reply-alert` | yes | no | yes | — |
| `proposal-orphan-sweep` | no | no | yes | — |
| `reel-comment-responder` | no | no | yes | — |
| `reel-pipeline` | no | no | yes | — |
| `revenue-pulse` | yes | no | yes | — |
| `scheduled-posts` | no | no | yes | — |
| `sms-gateway-health` | no | no | yes | — |
| `sms-scheduler` | yes | no | yes | Send queued SMS (review requests, reminders, etc.) |
| `statenour-live-sync` | no | no | yes | — |
| `vendor-health` | no | no | yes | Probe critical vendor APIs (Twilio, Stripe, Resend, etc.) before syncs run |
| `wo-overdue-check` | yes | no | yes | — |

## hourly (every 2h)

| Job | Business hours only | Once per shop day | Scheduled | Purpose |
|---|---|---|---|---|
| `callback-escalation` | yes | no | yes | — |
| `campaign-auto-retry` | yes | no | yes | — |
| `confirmation-calls` | no | no | yes | — |
| `content-reserve-replenish` | no | no | yes | — |
| `customer-segment-refresh` | yes | no | yes | — |
| `data-analyzers-live` | yes | no | yes | — |
| `drip-step-processor` | yes | no | yes | — |
| `enrich-customer-data` | no | no | yes | — |
| `feedback-cycle` | no | no | yes | — |
| `followup-cadence` | yes | no | yes | — |
| `intelligence-autopilot` | yes | no | yes | — |
| `intelligence-engines-live` | yes | no | yes | — |
| `kpi-snapshot` | no | yes | yes | Writes one `kpi_snapshots` row per completed shop week (revenue, paid jobs, new customers, avg ticket, lead conversion, review requests/received) so `kpi.history` has data; idempotent per week. Added 2026-09-01 (audit F-4). |
| `memory-sync-to-statenour` | no | no | yes | — |
| `missed-call-recovery` | yes | no | yes | — |
| `nick-auto-actions` | yes | no | yes | — |
| `nick-intelligence` | yes | no | yes | Analyze with fresh data |
| `opportunity-queue-refresh` | yes | yes | yes | — |
| `post-invoice-followup` | yes | no | yes | — |
| `predictive-escalation` | yes | no | yes | — |
| `promise-risk-check` | yes | no | yes | — |
| `promise-sweep` | yes | yes | yes | — |
| `pull-from-statenour-brain` | no | no | yes | — |
| `referral-loop-closer` | yes | yes | yes | — |
| `reminder-queue` | yes | no | yes | — |
| `review-reminder-drafts` | yes | no | yes | Q-39: draft (never send) one day-13 review reminder per unclicked request, with a 15% no-contact control; off until flagged |
| `review-requests` | yes | no | yes | Send review request SMS to recently-completed bookings |
| `safety-check` | no | no | yes | — |
| `service-affinity-compute` | no | no | yes | — |
| `sms-learning-digest` | no | yes | **STAGED — HTTP trigger only** | — |
| `stale-estimate-alert` | yes | no | yes | — |
| `stale-lead-followup` | yes | no | yes | Re-engage leads after intelligence is fresh |
| `sync-visit-dates` | no | no | yes | — |
| `vip-auto-recognition` | yes | yes | yes | — |
| `voice-recovery` | no | no | yes | — |
| `weekly-gsc-digest` | no | yes | yes | Monday Telegram push: official 28-day GSC totals vs prior 28 days, top queries/pages, CTR opportunities + 7-day ranking moves from the search_performance mirror (labels the mirror empty/stale rather than "none"); fails closed without an official total |
| `weekly-revenue-digest` | no | yes | yes | — |
| `winback-auto-process` | yes | no | yes | — |

## daily (every 1d)

| Job | Business hours only | Once per shop day | Scheduled | Purpose |
|---|---|---|---|---|
| `agentic-auditor` | no | no | yes | — |
| `alg-auto-discovery` | no | no | yes | — |
| `alg-declined-work-recovery` | no | no | yes | — |
| `booking-priority-escalation` | no | no | yes | — |
| `churn-detection` | no | no | yes | — |
| `cleanup` | no | no | yes | Stale data cleanup, log rotation |
| `closed-loop-measure` | no | no | yes | — |
| `competitor-monitor` | no | no | yes | Track competitor SERP positions |
| `content-auto-gen` | no | no | yes | — |
| `content-experiment-resolve` | no | no | yes | — |
| `cron-skip-watchdog` | no | no | yes | — |
| `customer-segmentation` | no | no | yes | Full segment recompute |
| `db-backup` | no | no | yes | — |
| `declined-work-recovery` | no | no | yes | Recover declined estimates via SMS |
| `email-campaign-auto` | no | no | yes | — |
| `engine-health` | no | no | yes | — |
| `estimate-invoice-match` | no | no | yes | — |
| `fleet-scoring` | no | no | yes | Score fleet customers by health + spend |
| `full-intelligence-digest` | no | no | yes | — |
| `gateway-price-refresh` | no | no | yes | — |
| `gbp-auto-post` | no | no | yes | — |
| `gsc-pipeline` | no | no | yes | — |
| `inventory-demand-forecast` | no | no | yes | — |
| `invoice-cross-reconciliation` | no | no | yes | — |
| `low-stock-alerts` | no | no | yes | — |
| `monte-carlo-forecast` | no | no | yes | — |
| `nhtsa-warranty-ingest` | no | no | yes | Q-50 2a (ADR-0021): downloads NHTSA's public manufacturer-communications zips and upserts only warranty-extension rows into `nhtsa_mfr_warranty_comms`/`_products`. Sends nothing. Flag `nhtsa_warranty_ingest` (default OFF); migration 0138; Sunday = every chunk. Last in the tier on purpose. |
| `no-show-detection` | no | no | yes | — |
| `pipelines-auto-run` | no | no | yes | — |
| `plate-retention-scrub` | no | no | yes | Nulls plate text on `vehicle_visits` rows past the 30-day ADR-0017 window, sparing EXACT customer matches. Reads nothing until a plate recogniser is wired. |
| `prediction-outcomes-resolve` | no | no | yes | — |
| `pricing-intelligence` | no | no | yes | — |
| `prompt-evolution-weekly` | no | no | yes | — |
| `psycho-profile-refresh` | no | no | yes | — |
| `qc-comeback-detection` | no | no | yes | — |
| `retention-all` | no | no | yes | — |
| `revenue-analytics-pipeline` | no | no | yes | — |
| `revenue-reconciliation` | no | no | yes | — |
| `review-auto-draft` | no | no | yes | — |
| `review-monitor` | no | no | yes | Monitor Google reviews, alert on negatives |
| `review-pipeline` | no | no | yes | — |
| `seo-forensic` | no | no | yes | — |
| `staff-performance` | no | no | yes | Tech utilization + revenue-per-tech metrics |
| `stale-booking-cleanup` | no | no | yes | — |
| `tire-inventory-intelligence` | no | no | yes | — |
| `unpaid-invoice-recovery` | no | no | yes | — |
| `vapi-call-eval` | no | no | yes | — |
| `vapi-harness` | no | no | yes | — |
| `vapi-latency-sync` | no | no | yes | — |
| `warranty-alerts` | no | no | yes | Alert customers approaching warranty expiration |
| `web-experiment-resolve` | no | no | yes | — |
| `wo-auto-advance` | no | no | yes | — |
| `wo-auto-close` | no | no | yes | — |

## briefings (every 12h)

| Job | Business hours only | Once per shop day | Scheduled | Purpose |
|---|---|---|---|---|
| `chat-faq-pipeline` | no | no | yes | — |
| `daily-report` | no | no | yes | End-of-day operational report |
| `daily-wins-digest` | no | no | yes | — |
| `nick-morning-brief` | no | no | yes | Owner morning brief (Telegram) |
| `weather-intel` | no | no | yes | Weather impact on demand (snow → tire surge, etc.) |
| `weekly-strategic-insight` | no | no | yes | — |

## HTTP-only registry jobs (`server/cron/index.ts`)

Runnable via `POST /api/admin/run-staged-cron` / `runJobByName`; not on a tier.

| Job | Enabled | Purpose |
|---|---|---|
| `retention-14day` | yes | — |
| `retention-180day` | yes | — |
| `retention-365day` | yes | — |
| `retention-7day` | yes | — |
| `retention-90day` | yes | — |
| `statenour-sync` | yes | — |

<!-- generated:end -->

## How skip logic works

- `businessHoursOnly`: the tier runner skips the job outside shop hours (America/New_York).
- `oncePerShopDay`: the job runs at most once per shop day; a completed `cron_log` row for today suppresses it.
- Staged jobs keep their tier metadata for cadence display but are never fired by the scheduler.
- A handler that THROWS is recorded `failed` in `cron_log` and counts toward the observer's failure streak; a handler that returns is `completed` — so a job must throw on failure, never return `Failed: …` in details (2026-09-01 audit, F-9).
