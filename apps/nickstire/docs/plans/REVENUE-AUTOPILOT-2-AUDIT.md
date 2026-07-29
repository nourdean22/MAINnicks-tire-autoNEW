# Revenue Autopilot 2 — Evidence-First Audit (Phase 0)

**Date:** 2026-07-29 · **Audited against:** `main` @ `0b6af704a` (includes PR #1190, the SMS Revenue Agent OS wave merged earlier today) · **Method:** three parallel read-only code audits of the SMS stack, lead lifecycle, opportunity queue, reply engine, metrics, and admin surfaces + direct reads of the orchestrator, queue, cron, and schema files.

**Epistemic key:** `[VERIFIED]` = read in code this session · `[VERIFIED-test]` = pinned by a test · `[UNKNOWN-runtime]` = prod state not read.

---

## 1 · Existing capability map (what the mission asks for vs what main already has)

| Mission phase | Capability | Where it lives | Status |
|---|---|---|---|
| P1 queue | Durable outbound queue, atomic claim, stale-`sending` recovery (10min→queued, 48h→failed), gateway-offline hold, quiet-hours hold | `server/sms.ts` | `[VERIFIED]` shipped (48h rule = time-bounded dead-letter) |
| P1 queue | **Continuous** rehydration (boot + timer), dedup by DB id before claim, 2-min claim grace | `server/sms.ts` `rehydrateQueuedFromDb` | `[VERIFIED-test]` shipped **today** (#1190) |
| P1 queue | Ambiguous-timeout vs safe-retry discrimination (`timedOut`/`uncertain`, never Twilio-fallback on timeout) | `sms.ts` gateway result handling | `[VERIFIED]` existing |
| P1 queue | Queue depth, oldest age, failures, gateway health, suppression rollup surfaced | `routers/smsOps.ts` + `SmsOpsStrip` | `[VERIFIED]` shipped today (#1190) |
| P1 queue | Delivery receipts reconciliation | `routes/webhooks/smsGateway.ts` (sms:delivered / sms:failed update by gateway messageId) + `handleDeliveryStatus` | `[VERIFIED]` existing |
| P1 lead | 2–24h auto follow-up (flag-gated, careers-excluded, opt-out-filtered, at-most-once claim) | `cron/jobs/staleLeadFollowup.ts` | `[VERIFIED]` existing — **with the truth defect below** |
| P1 lead | 24h–30d leads → Decision Inbox (`collectStaleLeads`), >30d age-out, lead rows never mutated by queue | `services/opportunityQueue.ts` | `[VERIFIED-test]` shipped today (#1190) |
| P1 lead | Lead→first-contact + inbound→response latency metrics | `smsOps.latencyMetrics` | `[VERIFIED]` shipped today (#1190) |
| P3/P4 | Global pause (HOLD semantics) · shop-wide 24h cap · takeover at chokepoint · autonomy ladder w/ ceiling enforcement · deterministic draft bridge w/ operator two-tap | `services/smsControl.ts` · `smsAutonomy.ts` · `opportunityDraft.ts` | `[VERIFIED-test]` shipped today (#1190) |
| P3 | STOP/opt-out fail-closed 3-source index · quiet hours · per-phone caps · human takeover (60min window) | `sms.ts` · `humanTakeover.ts` | `[VERIFIED-test]` existing (ROS-025 lineage) |
| P4 | Single AI decision service w/ typed outputs, rollout modes off/shadow/draft_only/live_send per event type, human review queue w/ approve-edit-send | `services/smsOrchestrator.ts` + router | `[VERIFIED]` existing |
| P5 | Opportunity queue: 12-state machine, receipts, won-requires-invoice, consent supremacy, due-aware snooze, deterministic urgency-first ranking, 7 collectors (estimates, callbacks, missed calls, DVI deferrals, complaints, promise-overdue, stale leads) | `services/opportunityQueue.ts` | `[VERIFIED]` existing + today |
| P6 | Variant instrumentation (`selectVariant`, replyCount/firstReplyAt/conversion), recovery holdout v3 (sha256 arm, ITT-primary), matched-invoice-only `won`, evaluation corpus exporter (nickgpt drafts + operator edits/ratings) | `smsInstrumentation.ts` · `recoveryLift.ts` · `smsLearningEngine.ts` | `[VERIFIED]` existing |
| P7 | Weather integration, GBP publisher, Meta CAPI, GSC pipeline, ShopDriver sync, Gateway Tire supplier client | various `services/` + `packages/` | `[VERIFIED]` existing |
| OpEx | Decision Inbox (top-5, evidence, receipts, invoice-gated Won, stated-concern chips, draft bridge) · morning brief TOP DECISIONS · statenour `top_decisions` bridge query | `DecisionInboxPanel.tsx` · `morningBrief.ts` · bridge contract §7 | `[VERIFIED]` existing + today |

## 2 · Verified defects/limitations → Wave-1 corrections (this PR)

| # | Defect (proven) | Location | Consequence | Smallest correction | Risk / rollback | Verification |
|---|---|---|---|---|---|---|
| W1-1 | **Leads are stamped `contacted` BEFORE any contact.** The at-most-once claim flips `status='contacted', contacted=1, contactedAt=NOW()` pre-send; a blocked/failed/drafted orchestration (flag off, opt-out, gateway down) leaves the lead permanently recorded as contacted. | `cron/jobs/staleLeadFollowup.ts:79-90` | Lead falls out of EVERY recovery rail while never contacted (contacted=1 excludes it from `collectStaleLeads`); latency metric counts fictional contacts; admin shows a contact that never happened. | Claim via `lastFollowUpAt IS NULL` stamp (atomicity preserved); flip to `contacted` ONLY on `sent`/`queued` result. Un-contacted claimed leads stay `new` → surfaced by the 24h collector. | Low — same at-most-once guarantee, one cron. Rollback: revert file. | `staleLeadTruth.test.ts` (blocked → stays new; sent → contacted; claim excludes already-stamped) |
| W1-2 | **Unbounded retry, no attempt-count dead-letter.** A permanently-failing send cycles sending→(10min)→queued→retry forever until the 48h time-bound fails it; no failure_reason anywhere. | `sms.ts` drain + recovery cycle | Up to ~190 doomed attempts/row over 48h; failure cause invisible. | Migration **0104** (additive `send_attempts`, `failure_reason` on sms_messages, hand-apply) + drain increments attempts on definitive failure, dead-letters at 5 (`max_retries_exceeded`); 48h rule stamps `stale_sending_expired`. Degrades to current behavior until column applied (ROS-059 class). | Additive nullable columns; rollback: revert (columns orphan harmlessly). | `smsRetryDeadLetter.test.ts` |
| W1-3 | **Rehydration cadence (5min) > drain cadence (60s)** — a row queued mid-run waits up to ~6min. | `sms.ts` timer | Mission DoD wants due-queued <5min while healthy. | Rehydrate every drain cycle (1 cheap SELECT/min); stale recovery stays 5-min throttled. | Negligible. | wiring-pin update in `smsSendingRecovery.test.ts` |
| W1-4 | **No alert when the gateway is healthy but due rows sit queued** — the #962-class silent-stall detector doesn't exist (136 messages sat for weeks). | — | Silent delivery stall until an operator looks. | `checkStuckQueueAlert` in the drain timer: healthy gateway + in-hours + not paused + DB rows queued >5min → Telegram, transition-only + 60-min re-alert throttle. | Alert-only. | `smsStuckQueueAlert.test.ts` (pure predicate) |
| W1-5 | **No admin replay for failed/dead-lettered rows.** | — | A dead-lettered message is unrecoverable without SQL. | `smsOps.replayFailed(id)`: atomic `failed→queued`, resets attempts, audit-logged; continuous rehydrate delivers. Idempotent (second call = no-op, 0 rows). | Admin-only mutation. | `smsOps replay` test |
| W1-6 | **Stale-lead cron doesn't dedupe against parallel channels** — texts a lead who already has a pending callback or an active inbound conversation. | `staleLeadFollowup.ts` | Double-contact; talks over an active thread. | Pre-send guards: skip if phone has `callback_requests.status='new'` or inbound SMS within 48h (conversation join); skipped leads stay `new` (collector surfaces them). | Read-only guards. | `staleLeadTruth.test.ts` cases |

## 3 · Ideas REJECTED because the repository already supports them

1. **"Replace startup-only rehydration"** — already replaced in #1190 (today); Wave 1 only tightens cadence (W1-3).
2. **A new SMS platform / second orchestrator / new intent router / new reply planner / new catalog** — `smsOrchestrator.ts` (1,878 LOC) + Router V2 + planner playbooks + catalog exist and are test-pinned.
3. **A new opportunity queue or CRM** — `revenue_opportunities` (12-state, receipts, invoice-gated won) exists; mission P5 = collectors only.
4. **A new Decision Inbox** — panel + ranking + bridge exist; today's wave added channel/risk/draft affordances.
5. **A new consent store for STOP/DNC** — 3-source fail-closed index + `sms_preferences` + queue-level consent supremacy exist. (Purpose-scoped consent LEDGER remains a real later-wave gap — but the global override the mission demands already works.)
6. **An outbound governor built from scratch** — the chokepoint now IS a governor (opt-out, caps global+per-phone, quiet hours, pause, takeover, gateway); a structured-verdict wrapper is a later-wave refactor, not a rebuild.
7. **"One bounded customer-texting action"** — `opportunityQueue.sendOutreach` (operator two-tap, identity from the queue row, full gates, permanent receipt) shipped today; the statenour/Telegram exposure is a later wave that must reuse it.
8. **Queue depth/age/failure observability** — `smsOps.opsStatus` shipped today.
9. **Holdout randomization at eligibility time** — recovery experiment v3 (#1171, migration 0103) already does versioned sha256 assignment-anchored ITT.
10. **"Remove modeled value from reports"** — the 2026-07-28 revenue-truth arc already purged invented rates/targets; standing rule in REVENUE-AUTOMATION-STATE.md.
11. **Weather adapter** — `weatherIntelligence` exists (NWS-based); P7 items are adapter EVALUATIONS, not new builds.
12. **VAPI context in replies** — `loadCustomerContext` already carries last-call gist into drafts (#988).

## 4 · Explicitly deferred (real gaps, NOT in Wave 1 — need their own waves)

- **P2 identity graph** — ~~real gap~~ **RESOLVED BY EVIDENCE, Wave 4 (2026-07-29).** The mission-mandated dry-run ran first (`scripts/identity-dryrun-report.ts`, read-only prod scan): **1,943 distinct customer phones → 1,942 resolved (99.9%), 0 ambiguous, 1 conflicted — and the single conflict is the operator's own test phone** (names "nourdean" vs "nick"). Unresolved pool (lead/booking phones with no customer row, 180d): 4. At this collision scale a STORED link graph with manual merge/undo is unjustified engineering. What shipped instead (the right-sized whole): `services/identityResolution.ts` — the mission's 4-verdict vocabulary (`resolved|ambiguous|unresolved|conflicted`, conflict = recent self-declared lead/booking name disagrees with the customer record) computed on read from the existing source tables (every source id already preserved in place), surfaced on `draftOutreach` risk reasons, and **ENFORCED at `sendOpportunityDraft`**: ambiguous/conflicted/unreadable → refuse (call instead); unresolved (normal lead) → allowed, greeting uses the person's own submitted name. Incumbents kept authoritative in place: `loadCustomerContext`'s refusal semantics (inbound path) and `resolveEstimateIdentity` (estimate collector). Re-run the dry-run if the customer base grows ~10× or a real household-sharing pattern appears — THAT is the v2 trigger, not speculation.
- **P3 purpose-scoped consent ledger** (terms-version hashes, proof URIs) — real gap beyond global STOP.
- **P4 statenour/Telegram `send_customer_sms`** — must wrap `sendOutreach`/orchestrator; bridge-auth surface; own wave.
- **P5 additional collectors** (no-shows, abandoned forms, tire-inventory waits, financing-interest, warranty) — pattern is established; add after Wave-1 truth fixes so they inherit honest lead states.
- **P6 touch-level journey record + eval regressions** — real gap (variant instrumentation is per-message, not per-journey).
- **P7 NHTSA vPIC/recalls, Google Ads offline conversions, MOTOR pilot, Gateway Tire official-feed evaluation** — all absent; adapter pattern + UPSTREAMS.md dispositions required first.
- **Exception brief** — morning brief exists; the exception-only reframe is an operator-experience wave.

## 5 · Wave-1 rollout & operator actions

- **Migration 0104 is hand-apply** (operator): `pnpm exec tsx scripts/migrations/apply-sms-send-attempts.ts` — additive, INFORMATION_SCHEMA-guarded, post-checked. ALL Wave-1 code degrades gracefully until applied (attempt-bounding inactive; 48h time-bound still terminal).
- No live-send behavior changes: the stale-lead cron sends exactly what it sent before (same flag, same window, same copy) — it just stops lying about outcomes and stops double-contacting.
- Rollback: revert the squash commit; 0104 columns orphan harmlessly.
