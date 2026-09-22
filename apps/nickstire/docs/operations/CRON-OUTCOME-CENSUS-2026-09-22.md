# Cron outcome census · eligibility → attempt → outcome for all 119 jobs (2026-09-22 ~21:15Z)

**Answer first.** Every tier is running again (hourly and briefings fired at boot after #2516),
and of the 119 scheduled jobs **68 produced an outcome in the last 7 days, 48 only attempted
(every completed run recorded zero), 2 are disabled on purpose, 1 is env-skipped.** Read
lane by lane, the 48 split into idle-by-design with a stated reason (most), five **silent
zeros** whose details are blank, and one **live incident: the SMS gateway phone has been offline
since 2026-09-22 ~04:38Z** (Capevace cloud intermittently unreachable since 2026-09-21 02:05Z),
which holds review requests and win-back sends and, with Twilio deliberately not configured,
queues every other outbound customer text. That one is the operator's: it is a physical device.

Instrument: `pnpm diag:cron-census [--days 7] [--only ATTEMPTED_ONLY,SKIPPED]`
(`scripts/diagnostics/cron-outcome-census.mjs`, read-only: `cron_log` + `cron_tier_skip_state`,
tier ownership and `enabled: false` read from the scheduler source because a disabled job leaves
**no** `cron_log` row). Operator mandate 2026-09-22 item 14: "completed + 0 is not evidence".

**Horizon.** `cron_log` is trimmed by the cleanup job; the oldest row is 2026-09-15. "Never" in
this census means "never within the eight days the table still holds". Nothing older is knowable
from it — the ledger and per-lane tables are where older outcomes live.

## Verdicts

| verdict | jobs | meaning |
|---|---|---|
| OUTCOME_SEEN | 68 | at least one completed run with `records_processed > 0` in 7 d |
| ATTEMPTED_ONLY | 48 | ran, every completed run recorded zero — idle, held, or a silent zero (below) |
| DISABLED | 2 | `campaign-resume`, `sms-learning-digest` — `enabled: false` staged crons (promotion is a one-line edit each); they never write a `cron_log` row, so without the source read they look identical to a job that vanished |
| SKIPPED | 1 | `weather-intel` — `skipped · requiresEnv:OPENWEATHER_API_KEY`, the #2510 gate seen live |
| FAILING · NEVER_RAN | 0 | — |

Tier passes at census time: heartbeat 0 h · pulse 0 h · hourly 0 h · briefings 0 h · daily 13 h.

## The incident — SMS gateway offline

| fact | evidence (`sms-gateway-health`, pulse tier, every 15 min) |
|---|---|
| state now | `OFFLINE — 1234m since last check-in` (21:12Z) → last check-in ≈ 2026-09-22 04:38Z |
| first offline run | 2026-09-21 02:05Z; 95 offline runs in the last 2 days |
| cloud API | `Capevace unreachable: The operation was aborted due to timeout` interleaved (18:17Z, 18:47Z, 20:38Z) |
| held lanes | `review-requests` and `winback-auto-process`: `gateway offline — held pending` on their last 6–7 runs (they hold rather than claim, so nothing is lost) |
| every other outbound text | `sms.ts` routes through the gateway; the header records "Twilio not set up" (directive 2026-06), so sends queue for later — the stuck-queue alert path exists (`shouldAlertStuckQueue`) |
| alerting | the health monitor pages Telegram once per offline incident and re-arms when the gateway returns |

**BLOCKED_ON_OPERATOR.** ACTION: bring the gateway phone back online (power, network, the
relay app). WHY: ~80 % of customer-facing flows send through it and there is no fallback carrier.
READY: nothing to deploy. VERIFY: `sms-gateway-health` details read `online — last seen Nm ago`
and `review-requests` / `winback-auto-process` stop saying `held pending`. AFTER: held lanes drain
on their next hourly pass; queued texts send inside the sending window.

## Customer-facing lanes with no outcome in the retained window

From the 60-day probe (which, given the horizon, is the same eight days):

| lane | runs | what the details say | reading |
|---|---|---|---|
| review-requests | 37 | `sent 0, failed 0` ×21 · outside 9–19 window ×10 · gateway held ×6 | in-window runs found nothing to send — the queue feeder is the question, not the sender |
| winback-auto-process | 37 | `No pending winback sends` ×30 · gateway held ×7 | no candidates queued in eight days |
| reminder-queue | 37 | `0 reminders sent` ×37 | no denominator — cannot tell "nothing due" from "nothing queued" |
| followup-cadence | 37 | `No completed bookings in window` ×19 · outside 9–18 ×18 | bookings table empty for the window (walk-in shop) |
| confirmation-calls | 72 | outside 15–18 window (every shown bucket) | in-window runs: `No bookings for <tomorrow>` |
| voice-recovery | 72 | `No estimates eligible` ×15 · outside 10–17 ×57 | after #2497; the 110 burned rows still await the operator's release script |
| campaign-auto-retry | 37 | `All customers texted` ×37 | idle by design |
| referral-loop-closer · declined-work-recovery · unpaid-invoice-recovery · no-show-detection · qc-comeback-detection · promise-sweep | 7–8 each | a stated zero each (`No referral matches`, `0 unrecovered ($0)`, `No unpaid invoices eligible (4 withheld as non-customer)`, `No no-shows`, `0 potential comebacks`, `no open promises`) | idle by design, each with a reason |
| email-campaign-auto | 7 | `0 emails sent (retention-90day)` | no denominator |

**Silent zeros (blank details, zero records, every run):** `sms-scheduler` (462 runs),
`abandoned-forms` (462), `customer-segment-refresh` (35), `customer-segmentation` (6),
`warranty-alerts` (6). #2514 makes the last three say why; `sms-scheduler` and `abandoned-forms`
still need the same treatment. `cloud-camera-snapshots` runs 700 times a week to report
`Fetched 0 devices, no updates` — a pulse job polling a device list that is empty; gate it on the
list being non-empty or move it to the hourly tier.

## What "completed + 0" hid, and the rule

A checker that reports `All data clean` 2,046 times a week (`data-accuracy-check`, heartbeat)
is indistinguishable from one that checked nothing: the details carry no denominator. The rule
this census enforces going forward is the one #2514 started: **a zero-record run states what it
examined and why it did nothing** (`0 issues in N rows`, `no bookings for 2026-09-23`,
`flag X off`), so the next census can grade "measured zero" apart from "unmeasured".

## Not done here

- No job was enabled, disabled, re-tiered or re-windowed; every change named above is a proposal.
- The gateway incident is reported, not remediated — it is a phone.
- `appointment-reminders` and `estimate-followup` appear in older ledger rows but have no
  `cron_log` rows and no scheduler entry under those names; the ledger rows should be reconciled
  against `getJobCadences()` (a follow-up, not done here).
