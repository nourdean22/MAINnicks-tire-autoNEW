# Cron Inventory — What Runs, When, Why

Every background job that touches the production DB, external APIs,
or SMS/email. Organized by the tier it runs in (`server/cron/scheduler.ts`).

If you add a new job, update this doc in the **same commit**.

**Last regenerated: 2026-05-07 (wave-80) from `server/cron/scheduler.ts` source-of-truth.**

> **Source of truth.** When this doc disagrees with `server/cron/scheduler.ts`,
> the code wins. Regenerate this file from the scheduler when adding/removing
> jobs (the regen pattern: grep `name: "..."` lines under each tier block).

---

## Tier overview

| Tier | Interval | Job count | Purpose |
|---|---|---|---|
| heartbeat | every 5 min | 3 | Critical health checks · DB liveness, ALG mirror health, data accuracy |
| pulse | every 15 min | 11 | Operational pings · vendor health, dashboard sync, abandoned forms, SMS scheduler, SMS gateway health, work-order overdue, revenue pulse |
| hourly | every 2 hours | 25 | Intelligence loop · brain sync, intelligence engines, customer enrichment, drip campaigns, escalations, missed-call recovery |
| daily | every 24 hours | 40 | Long-running analytics + retention · DB backup, engine health, retention sequences, declined-work recovery, intelligence digests, GSC/GBP pipelines |
| briefings | every 12 hours | 6 | Owner-facing summaries · morning brief, daily report, weather intel, weekly strategic |

**Total: 85 registered jobs across 5 tiers.**

---

## heartbeat (5 min)

Critical liveness probes. Failures here are alerted immediately.

| Job | Purpose |
|---|---|
| `self-healing` | Detect + auto-recover from common failures (DB pool, restart spam) |
| `alg-mirror-health` | Detect stale ALG (Auto Labor Guide) mirror data — every revenue number depends on it |
| `data-accuracy-check` | Spot-check critical invariants (e.g. invoices missing customer phone) |

---

## pulse (15 min)

Operational tier. SMS, dashboards, work orders, abandoned forms, vendor health.

| Job | Purpose |
|---|---|
| `vendor-health` | Probe critical vendor APIs (Twilio, Stripe, Resend, etc.) before syncs run |
| `cron-failure-observer` | Detect failed cron runs and alert |
| `sms-gateway-health` | Ping the F25e shop SMS gateway (216-862-0005) — Telegram alert if last-seen > 30min, recovery alert when back. Wave-109. |
| `dashboard-sync` | Sync admin dashboard tiles to fresh data |
| `cloud-camera-snapshots` | Periodic snapshot capture (V380/GeoVision) |
| `abandoned-forms` | Detect partially-filled booking forms and auto-recover |
| `sms-scheduler` | Send queued SMS (review requests, reminders, etc.) |
| `wo-overdue-check` | Flag work orders past their promised completion time |
| `gateway-order-status-poll` | Poll Gateway B2B tire orders for status changes |
| `revenue-pulse` | Live revenue pacing — alert on big jobs or falling behind |
| `statenour-live-sync` | Push fresh data to NOUR OS dashboard at autonicks.com |

---

## hourly (2 hours)

Intelligence loop. The order matters — feedback decay first, then brain
sync, then intelligence engines, then auto-actions, then engagement.

| Job | Purpose |
|---|---|
| `feedback-cycle` | Decay memories, check anomalies, pacing — feeds intelligence quality |
| `pull-from-statenour-brain` | Get fresh brain data before intelligence runs |
| `memory-sync-to-statenour` | Push our memories out to NOUR OS |
| `nick-intelligence` | Analyze with fresh data |
| `nick-auto-actions` | Act on intelligence (auto-route, auto-respond) |
| `auto-labor-guide-sync` | ShopDriver/ALG data sync |
| `customer-segment-refresh` | Recompute segment membership |
| `intelligence-engines-live` | Cross-sell, LTV, lead scoring, attribution — runs BEFORE autopilot |
| `intelligence-autopilot` | Autonomous intelligence — alerts, scoring, pacing |
| `stale-lead-followup` | Re-engage leads after intelligence is fresh |
| `missed-call-recovery` | Follow up unconverted VAPI missed callers via SMS (flag `missed_call_recovery` + env `MISSED_CALL_RECOVERY_SEND=1`; SHADOW otherwise). See `docs/missed-call-recovery.md` |
| `review-requests` | Send review request SMS to recently-completed bookings |
| `promise-risk-check` | Detect WOs about to miss promised time |
| `stale-estimate-alert` | Alert on quoted estimates not converting |
| `predictive-escalation` | Pre-escalate at-risk WOs before they fail |
| `sync-visit-dates` | Update customer lastVisitDate from invoices + WOs |
| `enrich-customer-data` | Merge totalSpent, visitCount, vehicle from all sources |
| `drip-step-processor` | Process multi-step drip campaigns |
| `winback-auto-process` | Auto-send pending winback messages |
| `campaign-auto-retry` | Auto-send review+referral campaign |
| `reminder-queue` | Process due maintenance reminder SMS |
| `callback-escalation` | Re-alert on callbacks stuck >4h |
| `data-analyzers-live` | Chat demand, call attribution, fleet, geography |
| `safety-check` | Operational safety + compliance checks |
| `post-invoice-followup` | 7-day thank-you + review + referral SMS |

### once per shop day (ROS-081)

These four are logically daily but CANNOT live in the 24h daily tier. That
tier's phase is set by process start, so a pod booted outside 07:00-20:59 ET
fires it outside business hours every day and `runTier()` skips every
`businessHoursOnly` job in it — 10 of the 24 possible boot hours starve it.
Prod cron_log 2026-07-29: `opportunity-queue-refresh ran 1 times in 7 days,
expected about 7`. Here the 2h tier gives each ~7 chances to land inside
business hours, and the `oncePerShopDay` flag claims the first and declines
the rest, so the real cadence is once a day — proven per JOB, not inferred
from a tier-level stamp. **Do not move these back to `daily`.**

| Job | Purpose |
|---|---|
| `referral-loop-closer` | Match referred customers to bookings/invoices, SMS both parties |
| `vip-auto-recognition` | Notify new VIP customers (3+ visits, $2000+ spent) |
| `opportunity-queue-refresh` | Consolidate missed-revenue opportunities into the Decision Inbox queue |
| `promise-sweep` | Escalate overdue customer promises; rot to `missed` after 48h |

---

## daily (24 hours)

Long-running analytics, retention, recovery, digests. Heavy work that
shouldn't run more often than daily.

| Job | Purpose |
|---|---|
| `db-backup` | Database backup snapshot |
| `engine-health` | System-wide health audit |
| `alg-overnight-probe` | Deep ALG diagnostic during low-traffic window |
| `cleanup` | Stale data cleanup, log rotation |
| `customer-segmentation` | Full segment recompute |
| `retention-all` | Run all retention drip sequences |
| `cross-sell-outreach` | Proactive SMS from cross-sell intelligence |
| `warranty-alerts` | Alert customers approaching warranty expiration |
| `alg-declined-work-recovery` | ALG-sourced walk-in estimates → SMS follow-ups |
| `declined-work-recovery` | Recover declined estimates via SMS |
| `staff-performance` | Tech utilization + revenue-per-tech metrics |
| `fleet-scoring` | Score fleet customers by health + spend |
| `review-monitor` | Monitor Google reviews, alert on negatives |
| `competitor-monitor` | Track competitor SERP positions |
| `churn-detection` | Detect at-risk customers, auto-enroll in drip |
| `qc-comeback-detection` | Detect repeat visits = possible failed repair |
| `wo-auto-close` | Auto-close stale WOs (picked_up/invoiced >7 days) |
| `estimate-followup` | Auto-follow up on unconverted estimates after 2-3 days |
| `gateway-price-refresh` | Auto-fetch wholesale tire prices from Gateway B2B |
| `invoice-cross-reconciliation` | Match invoices, flag anomalies, daily totals |
| `tire-inventory-intelligence` | Track popular sizes, low-stock alerts |
| `revenue-analytics-pipeline` | Week-over-week, monthly metrics, top services |
| `gbp-auto-post` | Generate + push GBP posts via Telegram |
| `email-campaign-auto` | Auto-send email campaigns via Resend |
| `no-show-detection` | Flag past-date bookings as no-show + follow-up SMS |
| `stale-booking-cleanup` | Auto-cancel 30+ day untouched bookings + rebook SMS |
| `wo-auto-advance` | completed → invoiced when invoice exists |
| `booking-priority-escalation` | 48h+ untouched → high priority |
| `review-auto-draft` | Fetch reviews + generate AI reply drafts |
| `low-stock-alerts` | Telegram when inventory hits reorder threshold |
| `content-auto-gen` | Blog article draft (Wed + Sat, 2×/week) |
| `pricing-intelligence` | Approval rate analysis — raise/lower alerts |
| `alg-auto-discovery` | Probe ShopDriver API for new endpoints |
| `pipelines-auto-run` | GBP reviews + GSC + Instagram — all due pipelines |
| `review-pipeline` | Fetch + analyze Google reviews, alert on negatives |
| `gsc-pipeline` | Google Search Console sync + ranking alerts |
| `full-intelligence-digest` | Compound intelligence report → Telegram |
| `revenue-reconciliation` | End-of-day revenue truth |

---

## briefings (12 hours)

Owner-facing summaries. Morning + evening cadence for daily ops; weekly
ones gate on day-of-week.

| Job | Purpose |
|---|---|
| `nick-morning-brief` | Owner morning brief (Telegram) |
| `daily-report` | End-of-day operational report |
| `weather-intel` | Weather impact on demand (snow → tire surge, etc.) |
| `daily-wins-digest` | Wins of the day |
| `weekly-strategic-insight` | AI strategic brief — fires on Sundays only |
| `chat-faq-pipeline` | Weekly chat question analysis — Sunday only |

---

## How to add a job

1. Create the handler in `server/cron/jobs/<jobName>.ts` (or inline).
2. Register it under the right tier in `server/cron/scheduler.ts`.
3. Add a row to the right table above with the same `name`.
4. Commit all three changes together.

If a job needs an env-flag gate (`CRON_X_ENABLED=true`), use `cronEnabled()`
helper from the scheduler.

---

## Tier skip logic (overrun protection)

Each tier tracks how many consecutive runs hit the budget without finishing.
If a tier overruns its interval for **2 firings in a row** AND its interval
is ≥ 30 min (i.e. hourly/daily/briefings), the next run is skipped to give
the system time to recover. heartbeat + pulse never skip — they're load-bearing.

Source: `server/cron/scheduler.ts:78-83`.
