# Code-Underneath Audit — Cron + tRPC Business Logic

**Scope:** the logic BENEATH the admin UI — `server/cron/**` (scheduler + jobs) and the tRPC routers' business logic (`admin.ts`, `advanced/invoices.ts`, `customers.ts`, `winback.ts`, `services.ts`, `specials.ts`, `campaigns.ts`, the SMS send path `sms.ts`).
**Stance:** kaizen · clarity-gate · silent-failure-hunter. Read-only — no files modified.
**Date:** 2026-06-03. **Verdict:** the SMS/cron core is *unusually* well-hardened (at-most-once claims, durable rate-limit, opt-out preload, gateway hold-and-deliver, PII redaction — all from prior wave audits). The remaining defects are mostly **staleness** (writes-nobody-resets, reads-different-from-writes) and **metric inconsistency** (the same number computed paid-only in one place, all-invoices in another), plus **two genuine bugs that reach real customers**.

---

## TL;DR — Top 10 by leverage

| # | Sev | Class | One-liner | Location |
|---|-----|-------|-----------|----------|
| 1 | HIGH | SILENT-FAILURE / SCHEDULING | `confirmation-calls` + `voice-recovery` crons are registered ONLY in `registerAllJobs()`, which **never runs** (only the tiered scheduler boots) → they NEVER fire on a timer. Flipping their feature flags does nothing. Invisible to the failure observer (no rows logged). | `cron/index.ts:414,423` vs `cron/scheduler.ts` (absent) |
| 2 | HIGH | CORRECTNESS (customer-facing) | Win-back SMS ship with **literal unreplaced `{lastService}` / `{vehicleInfo}`** merge tags. Only `{firstName}` is substituted anywhere; the processor never replaces the other two. Every lapsed/dormant/lost/vip/declined template uses them. | `winback.ts:340,387` + `services/winbackProcessor.ts` (no substitution) |
| 3 | MED-HIGH | STALENESS (revenue) | `customers.lastRetentionTier` is set to `tier.days` but **never reset on a new visit**. Once a customer hits D365, they can NEVER receive any retention SMS again — even after returning years later. Retention funnel silently shrinks as the base matures. | `cron/jobs/retentionSequences.ts:280` (only writer) |
| 4 | MED | CORRECTNESS | `autoAdvanceWorkOrders` flips `completed`→`invoiced` purely on **24h elapsed, with NO check that an invoice exists** (comment admits "can't join"). The `invoiced` status becomes meaningless; `wo-auto-close` then closes them. WOs progress to closed with zero billing event. | `cron/jobs/crudAutomation.ts:268-324` |
| 5 | MED | CONSISTENCY (the "two ways" smell) | "Total revenue" is computed **paid-only** in `invoices.stats`/`intelligence.overview`/`sectionInsight.revenue` but **all-invoices** (paid+pending+partial+refunded) in `customers.advancedStats`, `admin.drilldown.revenue_today`, `admin.todaysBrief`, `dashboardSync`. Same KPI, different numbers, never reconcile. | see §C |
| 6 | MED | CORRECTNESS | `invoices.intelligence.laborPct/partsPct` divide **all-invoices** labor/parts (query 2) by **paid-only** revenue (`overview.rev`). With pending invoices carrying labor/parts, the % can exceed 100 / be nonsensical. | `advanced/invoices.ts:579-580` |
| 7 | MED | STALENESS / SILENT-GAP | Overnight leads fall through `staleLeadFollowup`: it only contacts leads aged **2–6h**. A lead created overnight is >6h old by 8am ET (when the job first runs) and never gets the speed-to-lead nudge. | `cron/jobs/staleLeadFollowup.ts:28-39` |
| 8 | MED | OBSERVABILITY GAP | The cron failure observer detects only jobs that **ran and failed** (2+ consecutive `status='failed'`). A job that stopped scheduling entirely (e.g. #1) logs nothing → invisible. "Silent not-running" is the one failure mode it can't see. | `cron/observer.ts:51-98` |
| 8b | LOW-MED | CONSISTENCY (dup logic) | `smsRouter.gatewayHealth` reads `devices[0]` — the exact blind-index bug the health-monitor cron explicitly fixed (pick freshest/configured device). Admin card can show the wrong/stale phone's status. | `services.ts:503` vs `smsGatewayHealthMonitor.ts:75-82` |
| 9 | LOW-MED | SILENT-SKIP | `customers.retryCampaign` filters `phone LIKE '+1%'`, but campaigns/most code normalize to bare 10-digit. Any customer stored without the `+1` prefix is silently excluded from the review/referral campaign. | `customers.ts:625` |
| 10 | LOW | RATE-LIMIT ORDERING | `sendSms` runs `checkDailyLimit` (which **increments** the durable counter) BEFORE the opt-out check and BEFORE the outside-hours / gateway-offline **queue** branches. A queued or opted-out message still consumes a daily-cap slot at enqueue time; the later `_forceImmediate` drain skips the check, so the slot is "spent" but the send is deferred. Accounting drift, not a double-send. | `sms.ts:1040-1098` |

**Single highest-leverage fix:** **#1** — wire `confirmation-calls` and `voice-recovery` into the tiered scheduler's daily tier (next to `followup-cadence`, which IS wired). Right now the operator can set `FEATURE_CONFIRMATION_CALLS=1` / `FEATURE_VOICE_RECOVERY=1` and nothing happens — the entire post-D30 voice-recovery pipeline ($321K declined pool's last-touch closer) and tomorrow's-booking confirmation calls are dead code on a timer basis, reachable only by a manual HTTP trigger. It's also the most dangerous kind of dead: silent, flag-gated, and invisible to all monitoring.

---

## A. CRON LAYER

### A.1 Scheduling / wiring

| Finding | file:line | Class | Conf | Sev |
|---|---|---|---|---|
| **`confirmation-calls` + `voice-recovery` never fire on a timer.** Boot calls only `startTieredScheduler()` (`_core/index.ts:282`). `startAllJobs()` is never called AND no-ops if it were (`cron/index.ts:44-51`). Both jobs exist ONLY in `registerAllJobs()` (`index.ts:414,423`), absent from every tier in `scheduler.ts`. Reachable only via `runJobByName` HTTP trigger (`bridge-routes.ts:640`). | `cron/index.ts:414,423` | SILENT-FAILURE / SCHEDULING | CONFIRMED | HIGH |
| `followup-cadence` is correctly double-listed (registerAllJobs **and** hourly tier `scheduler.ts:844`) → it DOES fire. Good — confirms the pattern the two above are missing. | `scheduler.ts:844` | (not a bug) | CONFIRMED | — |
| `registerAllJobs()` intervals are **dead config**: the whole `index.ts` setInterval path is fallback-only and never runs, and the file reads as if it schedules things it does not. **CORRECTED 2026-08-23** - this row used to end "every job in it duplicates a tiered job EXCEPT the two above". That completeness clause was FALSE, and it is why the class stopped being swept after the two named crons were fixed. Measured against `origin/main`: **33 registry jobs, 8 absent from every tier by name.** Six are name mismatches with real coverage (5x `retention-*` -> `retention-all`; `statenour-sync` -> `statenour-live-sync`), verified by reading both handlers. **Two were genuinely dead** - `campaign-resume` and `sms-learning-digest` - and production `cron_log` confirmed it: ZERO rows all-time for both, against control jobs in the same table at 2,344 / 799 / 38 runs. Base rate: 2/33 (6%) truly unwired, 8/33 (24%) trip a naive name check. Both wired in #1805. This row is now backed by `pnpm lint:cron-wiring`, which runs in CI on every nickstire PR, and by the same comparison inside `cronControlPlane.test.ts` which `pnpm test` (and therefore `verify`) executes locally. A ninth stranded cron fails a gate instead of waiting for the next audit. It is deliberately NOT a 15th `verify` link: that would drift the canary-gated counts in `docs/agent-audit/CONTROL-CANARY-COVERAGE.md`, which a concurrent session owns. | `cron/index.ts` registry vs `cron/scheduler.ts` tiers | DEAD (config) | CORRECTED | LOW |

### A.2 Staleness (writes-nobody-resets / reads≠writes)

| Finding | file:line | Class | Conf | Sev |
|---|---|---|---|---|
| **`lastRetentionTier` never reset on new visit.** Grep-verified: only writer is `retentionSequences.ts:280` (sets `=tier.days`); the enrich crons update `lastVisitDate` but not this. Eligibility is `lastRetentionTier < tier.days`, so a customer who reached D365 is permanently ineligible for ALL tiers on any future lifecycle. Returning customers get zero retention touches. | `retentionSequences.ts:178-200,280` | STALENESS | CONFIRMED | MED-HIGH |
| `autoAdvanceWorkOrders`: `completed`→`invoiced` on 24h-elapsed with no invoice-existence check (the join is impossible — invoices have no `workOrderId`). The `invoiced` WO status is decoupled from real billing; downstream `wo-auto-close` then closes them. A WO can read "invoiced/closed" having never been billed. | `crudAutomation.ts:268-324` | CORRECTNESS / STALENESS | CONFIRMED | MED |
| `notifyNewVips`: the bulk `customer_metrics.isVip=1` UPDATE (line 593) flips ALL qualifying customers, decoupled from who was actually SMS'd (opted-out/cooldown rows are skipped for SMS but still flagged VIP). Arguably correct (flag = status, not notification), but the VIP flag and the VIP welcome SMS can diverge silently. | `crudAutomation.ts:587-595` | (by-design, note) | CONFIRMED | LOW |

### A.3 Silent failures / gaps

| Finding | file:line | Class | Conf | Sev |
|---|---|---|---|---|
| Overnight leads never get the speed-to-lead nudge: `staleLeadFollowup` window is leads aged 2–6h AND business-hours-only (8–18 ET). A lead created 22:00 ET is >6h old by the 08:00 run → falls out of the window forever. | `staleLeadFollowup.ts:16,28-39` | SILENT-GAP | CONFIRMED | MED |
| The failure observer only sees `status='failed'` streaks — blind to "stopped running" (see #1) and to a fail/skip/fail interleave (streak resets on the non-failed head). `cron-skip-watchdog` covers env-skips but not unwired jobs. | `observer.ts:51-98` | OBSERVABILITY GAP | CONFIRMED | MED |
| `detectNoShows` / `autoCleanStaleBookings` overlap on old past-preferred-date `new` bookings, BUT no-show runs first in the daily tier and stamps an adminNote that stale-cleanup skips (`crudAutomation.ts:155`). Double-SMS correctly prevented. | `crudAutomation.ts:85,155` | (verified safe) | CONFIRMED | — |

### A.4 Things that LOOK wrong but are correct-by-design (verified, do NOT "fix")

- **Cross-sell cooldown ABORTS on DB error** (`crossSellOutreach.ts:204`) — intentional TCPA-protective fail-closed. Correct.
- **At-most-once "claim before send"** across retention / declined-recovery / followup-cadence / winback / stale-lead / campaigns / crud — stamps the marker BEFORE the send so a crash-after-send can't re-text. Looks like "marks sent before it's sent" but is the correct safety trade (miss-one beats double-send). Verified consistent everywhere.
- **Declined-recovery `TOUCH_ORDER = [30d,14d,7d,45d,3d]`** sends the highest-eligible touch first, one per estimate per run. A backfilled 30-day-old estimate's FIRST contact is the "it's been a month" copy — slightly odd, not a bug.
- **`sms.ts` non-OK-HTTP / timeout = NO Twilio fallback** (`sms.ts:1135,1155`) — ambiguous-delivery guard against double-send. Correct (hard-won, the 003afc8b regression).
- **`recordsProcessed` returned on the DRY-RUN path** of declined-recovery (`declinedWorkRecovery.ts:202`) reports *eligible* count, not *sent* — intentional so the Telegram money-on-the-table alert has a number.
- Schema columns for the 5×3 recovery sequence + voice-recovery (`followUp{3,14,45}d*`, `recoveryProfile`, `voiceRecovery*`) all EXIST (`schema.ts:1358-1395`) → those crons are functional, not silent-no-ops.

---

## B. tRPC ROUTER LAYER

### B.1 Customer-facing bugs

| Finding | file:line | Class | Conf | Sev |
|---|---|---|---|---|
| **Win-back `{lastService}`/`{vehicleInfo}` never substituted.** `winback.activate` persists `personalizedBody` replacing only `{firstName}` (line 387); `preview` same (line 340); `services/winbackProcessor.ts` grep = ZERO references to either token. Templates for lapsed/dormant/lost/vip/declined/recent all use them → customers receive literal "your {vehicleInfo}". | `winback.ts:340,387` | CORRECTNESS | CONFIRMED | HIGH |

### B.2 Metric inconsistency (the operator's "same metric, two ways")

| Finding | file:line | Class | Conf | Sev |
|---|---|---|---|---|
| **Paid-only vs all-invoices revenue split.** Paid-only: `invoices.stats` (`invoices.ts:338`), `invoices.intelligence.overview`+`mtd` (`:444,538`), `admin.sectionInsight.revenue` (`admin.ts:845`). All-invoices (no paymentStatus filter): `customers.advancedStats` revenueSummary/topSpenders/monthlyTrend/serviceBreakdown (`customers.ts:253-315`), `admin.drilldown.revenue_today` (`admin.ts:212`), `admin.todaysBrief` walk-aways aside the revenue card, `dashboardSync` todayRevenue (`dashboardSync.ts:48`). The same "revenue" reconciles to different totals depending on which card you open. | see cells | CONSISTENCY | CONFIRMED | MED |
| `invoices.intelligence.laborPct/partsPct` = labor/parts (ALL invoices, query 2) ÷ revenue (PAID only, `overview.rev`). Mixed denominators → pct can exceed 100 when pending invoices carry labor/parts. The code comment says query 2 is "intentionally left all-invoices" but doesn't reconcile the ratio. | `invoices.ts:448-456,579-580` | CORRECTNESS | CONFIRMED | MED |
| `customers.stats.totalRevenue` sums `customers.totalSpent` (a denormalized field maintained by enrich crons), while `invoices.stats` sums the invoices table live. Two independent "total revenue" sources that drift whenever enrich lags. | `customers.ts:214-219` | CONSISTENCY | INFERRED | LOW |
| `campaigns.getSegmentCustomers` ("recent"/"lapsed") filters `LENGTH(phone)>=10 AND smsOptOut=0` with no `+1` requirement, whereas `customers.retryCampaign` requires `phone LIKE '+1%'`. The "same" segment yields different target sets across the two send paths. | `campaigns.ts:55` vs `customers.ts:625` | CONSISTENCY | CONFIRMED | LOW |

### B.3 Silent-skip / dup-logic

| Finding | file:line | Class | Conf | Sev |
|---|---|---|---|---|
| `customers.retryCampaign` `phone LIKE '+1%'` silently drops every 10-digit-stored customer from the review/referral campaign (see B.2 for the format mismatch). | `customers.ts:625` | SILENT-SKIP | CONFIRMED | LOW-MED |
| `smsRouter.gatewayHealth` uses `devices[0]` (`services.ts:503`) — the blind-index bug `smsGatewayHealthMonitor.ts:75-82` explicitly fixed (prefer `SHOP_SMS_GATEWAY_DEVICE_ID`, else freshest by `lastSeen`). Admin "gateway online?" card can read a stale test phone instead of the F25e. | `services.ts:503` | DUP-LOGIC / CORRECTNESS | CONFIRMED | LOW-MED |
| `winback.processPending` claims `pending`→`sent` before send; if `sendSms` returns `{queued:true}` (gateway offline) the row stays `sent` with null sid and `sentCount` increments for a not-yet-delivered message. Same pattern in `campaigns.processCampaignSends` if the gateway drops mid-batch (the top-of-fn reachability gate only covers batch start). Accounting drift; delivery still happens via the durable queue. | `winback.ts:474-488`, `campaigns.ts:355-368` | CORRECTNESS (accounting) | CONFIRMED | LOW |

### B.4 Known-deferred / pre-existing (confirmed still open, NOT re-litigated)

| Finding | file:line | Note |
|---|---|---|
| Coupon `maxRedemptions` cap accepted but never enforced (matches MEMORY "Y13"). `specials.maxUses` same — stored, never decremented/checked. | `services.ts:43`, `specials.ts:52` | DEFERRED |
| `winback` "declined" + "tire_customer" segments retired correctly (templates left in `WINBACK_TEMPLATES` but unreachable via the enum). The `declined` template still carries `{lastService}` so if ever re-enabled it'd inherit bug B.1. | `winback.ts:74-93,160-171` | dead-but-latent |

### B.5 Verified-correct router behavior (do NOT flag)

- All audited routers are `adminProcedure`-gated except the deliberately-public `callTracking.logCall` / `customerEvents.log` (IP-rate-limited because `logCall` triggers review-SMS — `admin.ts:1299`). No missing-authorization findings.
- LIKE-wildcard escaping present on every search input (`invoices.list:78`, `customers.list:100`). `sql.raw` interpolations are zod-int-bounded (`days/months` 1..3650). No injection found.
- PII tail-redaction consistent across drilldown/intake/exports (`csvSafe`, `•••${tail}`).
- `campaigns` dead pause/resume/cancel/update mutations already deleted (wave-187) with a correct rationale (wrote enum values the schema rejects).
- `bulkFollowUp` / `runDeclinedRecoveryNow` honor SMS_KILL_SWITCH + opt-out + cooldown via `sendSms`. Correct.
- The SMS double-log dedup (`skipPersist` + `logOutboundSms` sole-writer, queued-path skip) is correct across retention/cross-sell/declined-recovery — the operator's earlier "double-log" fix holds; verified not regressed.

---

## C. The paid-vs-all-invoices map (for a single reconciliation pass, if desired)

PAID-ONLY (honest realized revenue):
- `advanced/invoices.ts` → `stats` (:338), `intelligence.overview` (:444), `intelligence.mtd` (:538), `tireSalesReport` (:247), `topCustomers` (:393)
- `admin.ts` → `sectionInsight.revenue` (:845)

ALL-INVOICES (paid+pending+partial+refunded):
- `advanced/invoices.ts` → `intelligence` labor/parts (query 2, :455), monthlyTrend (:458), serviceBreakdown (:488), topDays/dayOfWeek/weekly/velocity (these are activity views, arguably fine)
- `customers.ts` → `advancedStats` ALL sub-queries (:253-315)
- `admin.ts` → `drilldown.revenue_today`/`jobs_closed_today` (:212), `todaysBrief` (the revenue-adjacent cards)
- `cron/jobs/dashboardSync.ts` → todayRevenue (:48)

Recommendation (not implemented — audit only): decide ONE rule ("realized revenue = paid; pipeline = all") and make every headline-revenue surface paid-only, leaving activity/velocity views explicitly labeled as all-invoice. The labor/parts ratio (B.2) must use a consistent denominator.

---

## Counts

- **Cron files read in full:** scheduler.ts, index.ts, observer.ts, crossSellOutreach, retentionSequences, declinedWorkRecovery, followupCadence, voiceRecovery, confirmationCalls, crudAutomation, customerSegmentation, staleLeadFollowup, dashboardSync, smsGatewayHealthMonitor (+ sms.ts send core).
- **Routers read in full:** admin.ts (1550), advanced/invoices.ts (988), customers.ts (1053), winback.ts (513), services.ts (524), specials.ts (124), campaigns.ts (530).
- **Findings:** 2 HIGH · 6 MED / MED-HIGH · 5 LOW–LOW-MED actionable · ~6 verified-correct-by-design (left alone) · 2 known-deferred re-confirmed.
- **Distribution:** SILENT-FAILURE ×2 · CORRECTNESS ×4 · STALENESS ×2 · CONSISTENCY ×4 · DEAD ×1 · SECURITY ×0 (none found — the surface is clean on authz/injection/PII).
