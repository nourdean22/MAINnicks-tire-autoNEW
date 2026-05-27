# VAPI Baseline · 2026-05-26 EOD

> **⚠ READ FIRST · framing correction added 2026-05-26 EOD+**
>
> The original draft of this doc framed the 34% escalation rate as a
> failure mode. **That framing is wrong for this business.** Tire stock
> verification requires a human physically walking the rack · the AI
> cannot truthfully confirm stock from a database. Live transfer
> (`assistant-forwarded-call`) is the **designed success path** during
> open hours, not a punt.
>
> The real failure signal is `outcome=lost` (41.4%) — caller dropped /
> Nick lost them before either booking OR escalating.
>
> The real success metric (yet to be instrumented) is *warm-transfer-
> connect rate* — % of forwarded calls where the human actually picked
> up + completed the call. We don't track this yet · `voice_call_states`
> logs `forwarded` events but nothing confirms the human side. **That's
> the next observability gap to close** (queue: task #3 + a new resolver
> in `closedLoop.ts`).
>
> Treat the numbers below as ACCURATE; treat the "what counts as a win"
> section as REVISED — see "Revised win thresholds (post-framing-fix)"
> at the bottom of this doc.

**Captured:** 2026-05-26 22:00 ET via authenticated admin tRPC
(`vapi.recentCalls` + `adminDashboard.drilldown`)
**Sample window:** 100 most-recent inbound calls · 2026-05-22 18:23 ET →
2026-05-26 18:27 ET (≈4 days, every call answered by Nick)
**Why this exists:** Lock the pre-fix conversion + escalation rates so the
next round of VAPI prompt tuning is measurable. Without this snapshot,
every "we improved Nick" change is a vibe check. Tied to task #79 + the
deferred queue #75-77 (eval cron alarms).

## Headline numbers

| Window | Calls | Booked | Lost | Escalated | Info-given | **Book %** | **Esc %** | **Lost %** |
|---|---|---|---|---|---|---|---|---|
| **Today** (05/26) | 30 | 1 | 12 | 11 | 6 | **3.3%** | 36.7% | 40.0% |
| Last 4 days (sample) | 99 | 6 | 41 | 34 | 18 | **6.1%** | 34.3% | 41.4% |

**Conversion of every 100 inbound calls in the sample window:**
- 6 booked
- 41 lost (silence, drop, incomplete info)
- 34 escalated to human
- 18 given information but no booking close
- 1 unaccounted

**Total non-conversion = ~94%.** Volume looks healthy (≈30/day) but the
funnel is leaking from every joint.

## Daily trend

| Date (ET) | Total | Booked | Lost | Escalated | Info | Book% |
|---|---|---|---|---|---|---|
| 05/22 | 1 | 0 | 0 | 1 | 0 | 0.0% |
| 05/23 | 20 | 2 | 11 | 3 | 4 | 10.0% |
| 05/24 | 17 | 1 | 7 | 8 | 1 | 5.9% |
| 05/25 | 31 | 2 | 11 | 11 | 7 | 6.5% |
| 05/26 | 30 | 1 | 12 | 11 | 6 | **3.3%** ↓ |

Book rate has declined every day since 05/23. Escalation rate has climbed
3 → 8 → 11 → 11 — Nick is punting more, closing less.

## End-reason distribution (last 100 calls, raw from VAPI API)

| Reason | Count | Notes |
|---|---|---|
| `customer-ended-call` | 60 | Customer hung up (could be a win or a quit) |
| `assistant-forwarded-call` | 34 | **Maps 1:1 with `outcome=escalated`** (sanity check ✓) |
| `silence-timed-out` | 3 | Caller went silent · Nick timed out |
| `assistant-ended-call` | 1 | Nick closed the call |
| `assistant-said-end-call-phrase` | 1 | Nick used a goodbye phrase |
| `call.ringing.sip-inbound-caller-hungup-before-call-connect` | 1 | Pre-connect drop |

## Eval-cron status · NOT GRADING

**0 of 30 calls from today are eval-graded.** `vapi_call_logs.evalScore` is
NULL for every today's call. The nightly eval cron (`vapiCallEval.ts`)
either hasn't fired or is silently failing.

This invalidates `vapi_avg_eval_score_14d` as a live signal — the resolver
in `lib/services/closedLoop.ts` filters by `eval_at IS NOT NULL` so a
broken cron means the metric returns the dwindling tail of older grades
without anyone noticing. Listed in queue items #75-77 as part of the
silent-failure detection work — those alarms would have caught this.

## Other observability bugs discovered while capturing this baseline

| Bug | Impact | Severity |
|---|---|---|
| `vapi_call_logs.durationSeconds` = 0 for **every** today's call | Eval cron is grading talkativeness blind; intake_today dashboard shows "0s" for every call | **HIGH** — webhook isn't writing duration on `end-of-call-report` |
| `vapi.todayMetrics` returns `total: 0` despite 30 real calls today | Direct VAPI API fetch is broken (likely API key issue or timezone bug — uses UTC `startOfDay`) | MEDIUM — silently wrong dashboard widget |
| `vapi.recentCalls` strips `aiSummary` / `evalScore` / `evalOutcome` / `phoneNumber` from response | Admin can't see grade or transcript summary without separate query | LOW — UI gap, data is in DB |

## Baselines locked (for 14-day measurement)

The 4 baselines `seedWaveBaselines()` would have written if called today:

| metric_key | value at 2026-05-26 EOD | source |
|---|---|---|
| `vapi_convert_rate_14d` | **6.1%** (6/99 sample) | structuredData.outcome="booked" / total in 14d window |
| `vapi_avg_eval_score_14d` | **NULL** (eval cron not running today) | AVG(eval_score) WHERE eval_at >= NOW()-14d |
| `declined_recovery_rate_14d` | (not VAPI · separate baseline) | alg_estimates · matched_invoice_id |
| `tire_size_impressions_14d` | (not VAPI · separate baseline) | GSC impressions on /tires/* |

Two new metrics this baseline recommends adding (queue items #75-77):

| Proposed metric_key | value at 2026-05-26 EOD |
|---|---|
| `vapi_escalation_rate_14d` | **34.3%** (34/99) — fires `system-alert` if > 40% |
| `vapi_lost_rate_14d` | **41.4%** (41/99) — fires `system-alert` if > 50% |

## What counts as a "win" 14 days from now

Any prompt or process change shipped between now and 2026-06-09 must move
**at least ONE** of these by the noted threshold or it's noise:

- Booking rate · **6.1% → ≥ 7.6%** (+1.5pp · ~50% relative lift)
- Escalation rate · **34.3% → ≤ 29.0%** (-5pp · -15% relative)
- Lost rate · **41.4% → ≤ 36.4%** (-5pp · -12% relative)

If after 14 days NONE of those moved, the prompt iterations aren't working
and the next move is structural (different model · different tool set ·
different escalation policy) — not another prompt tweak.

## The brutal truth

The economy of this is:
- ≈ 30 calls / day = 900 calls / month
- At 6.1% book rate = ~55 bookings / month from inbound voice
- If we lifted book rate to 12% (still bad in absolute terms, ~2× current) = ~110 bookings / month
- At ≈ $525 avg ticket (per `dashStats.shopFloor.avgTicket` shown in dashboard banner today) = **+$28,875 / month in shop revenue**

The 12 lost calls per day at $525 avg ticket = $189,000 / month walking
away from the phone alone — much of it recoverable (e.g. the customer
who said "Hello?" repeatedly and dropped — Nick's silence handling failed
there). Even halving the lost rate is six figures annual.

This is why fixing Nick > shipping the next feature.

## Recommended next moves (priority order)

1. **Fix the duration-sync webhook bug.** Without `durationSeconds`, the
   eval cron is grading shadows. (HIGH severity item above.)
2. **Find out why the eval cron didn't grade today's 30 calls.** Run it
   manually, look at the failure path. (Could be a timezone bug in
   `eval_at` window, could be the cron just hasn't fired yet, could be
   silent.)
3. **Ship the queue items #75-77** so we stop discovering these silent
   failures by hand-drilling tRPC calls.
4. **Read all 12 lost-call transcripts from today** and label each as
   "Nick fumbled" vs "honest loss". The 4:42pm booking is the only
   conversion · find the pattern.
5. **Then ship a prompt change** and use the thresholds above to verify
   lift in 14 days.

---

## Revised win thresholds (post-framing-fix · 2026-05-26 EOD+)

The original "what counts as a win" section above scored *reducing
escalation* as a goal. After the operator clarified that **tire stock
verification requires a live human walking the rack**, that framing is
wrong. The real win conditions:

| Metric | Today | 14-day target | Why |
|---|---|---|---|
| **Lost rate** | 41.4% | ≤ 30% (-11pp) | Real failure mode. Caller dropped before either booking OR escalating. |
| **Warm-transfer-connect rate** | UNKNOWN (not instrumented) | Instrument first · then ≥ 85% | The actual success metric for tire calls during open hours. % of `assistant-forwarded-call` events where a human-call activity is logged within 60s on the forwarded number. |
| **Same-day booking rate** | UNKNOWN (mixed signal) | Instrument first | True conversion = `outcome=booked` (AI-side) + work_orders / invoices created within 24h on the caller's phone number (human-side). Without this we can't see post-transfer wins. |
| Booking rate (AI-side `outcome=booked`) | 3.3% | Hold ≥ 3% | Side-metric only. Most tire bookings should land on the human side after transfer. |
| Escalation rate (`assistant-forwarded-call`) | 34.3% | HOLD or RISE during open hours | Was incorrectly listed as a reduction target. For tire calls during business hours this IS the success path. |

The original framing's "escalation rate ≤ 29%" target is **canceled**.
Replacing it with the warm-transfer-connect-rate target above (after
instrumentation).

## Revised recommended next moves (priority order)

1. **Instrument warm-transfer-connect-rate.** This is the single
   missing observability piece that makes every other VAPI metric
   measurable. New resolver in `lib/services/closedLoop.ts`:
   ```ts
   warm_transfer_connect_rate_14d: async () => {
     // numerator: count `assistant-forwarded-call` end-reasons in vapi_call_logs
     //            where the same phone number has a successful inbound human-call
     //            within 60s (use voice_call_states or call_events as the proxy)
     // denominator: total `assistant-forwarded-call` end-reasons in vapi_call_logs
     // Filter both to last 14d.
   }
   ```
2. **Fix duration-sync webhook bug** (was item #1 pre-correction · still
   matters because the eval cron grades blind without it).
3. **Repair eval-cron firing** for today's calls (0/30 graded).
4. **Then read transcripts** of the 12 "lost" calls — that's where the
   real fix lives.
5. **Then ship #75-77 alarms.**

---

*Baseline numbers above remain accurate · the framing-correction only
changes which numbers are interpreted as "needs improvement" vs
"already-by-design". Original sections preserved intentionally so the
post-correction reader sees the reasoning evolution.*
