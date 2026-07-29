# Revenue-automation state matrix

> Wave-0 deliverable of the revenue-truth-correction arc (2026-07-28).
> **Clarity-gated: CLEAR | REVIEWED** — end-of-arc snapshot with claim ledger + verification record at [`REVENUE-AUTOMATION-STATE.2026-07-28.cgd.md`](./REVENUE-AUTOMATION-STATE.2026-07-28.cgd.md). Both Round-B claims resolved 2026-07-28: IG cap is **20/day** (operator; prod policy v8 concurs), J.D. Power 41%/17% **verified** via Business Wire syndication.
> **Epistemic key:** `[VERIFIED]` = confirmed by reading code on 2026-07-28 · `[FIXED <PR>]` = corrected in that PR · `[UNKNOWN-runtime]` = prod flag/last-run state NOT checked — `.env` is not prod config; verify via `cron_log`, `/api/health`, or `railway run` only.
>
> Scope note: this matrix records what each automation's CODE does and which truth defects were found/fixed. It makes **no** claims about production flag state, last run, or measured lift — those columns stay `[UNKNOWN-runtime]` until read from prod.

## The matrix

| Automation | Code exists | Gate (code-level) | Customer contact? | Truth status |
|---|---|---|---|---|
| Missed-call recovery | `[VERIFIED]` `server/cron/jobs/missedCallRecovery.ts` | flag `missed_call_recovery` + env `MISSED_CALL_RECOVERY_SEND=1` (shadow otherwise) | SMS (via shared rails) | **AUDITED 2026-07-28: CLEAN** — pure tested eligibility, shadow-by-default, durable claim-before-send, no invented numbers, shadow preview refuses to quote copy (anti-drift). Audience now also lands in the opportunity queue (`collectMissedCalls`, human call-back framing) |
| Declined-work recovery (5-touch) | `[VERIFIED]` `cron/jobs/declinedWorkRecovery.ts` + `services/declinedRecoverySequence.ts` | `FEATURE_DECLINED_RECOVERY=1` env; without it: dry-run + daily Telegram nag | SMS when flag ON | `[FIXED revenue-truth-correction]` — see below |
| Recovery targeting/scoring | `[VERIFIED]` `services/recoveryTargeting.ts` | used inside the cron above | copy feeds SMS | `[FIXED]` fabricated calibration provenance + price-guarantee copy |
| Pricing intelligence | `[VERIFIED]` `services/pricingIntelligence.ts`, cron `pricing-intelligence` | always-on cron | Telegram (operator only) | `[FIXED]` — was invalid, rewritten as payment-status/collections signal |
| Inventory demand forecast | `[VERIFIED]` `cron/jobs/inventoryDemandForecast.ts` | always-on cron (tier 4) | Telegram (operator only) | `[FIXED]` — reframed as Unmatched Tire Demand Signal |
| Tire inventory intelligence | `[VERIFIED]` `services/dataPipelines.ts` `analyzeTireInventory` | cron `tire-inventory-intelligence` | Telegram (operator only) | `[VERIFIED]` clean — real orders + real Gateway stock |
| Morning brief | `[VERIFIED]` `cron/jobs/morningBrief.ts` | daily cron | Telegram (operator only) | `[FIXED]` — $10K hardcode, cohort-mismatched "conversion", "WALK RATE", invented "recoverable" |
| Daily digest (intelligence report) | `[VERIFIED]` `cron/scheduler.ts` daily-digest block | daily cron | Telegram (operator only) | `[FIXED]` — "walk-away … @ 20% close" language |
| Intelligence engines | `[VERIFIED]` `services/intelligenceEngines.ts` | called by brief/digest/brain | none directly | `[FIXED]` — two invented 20% "recoverable" figures removed; `forecastRevenue` target already dynamic (trailing×1.1) `[VERIFIED]` |
| Cross-sell outreach | `[VERIFIED]` `cron/jobs/crossSellOutreach.ts` | flag `sms_cross_sell_outreach` — **ON in prod `[VERIFIED-runtime]`; ROS-033 histogram gate RETROACTIVELY READ** (it demanded reading before enabling; it was enabled first — see Runtime flag truth) | SMS (live) | **AUDITED 2026-07-28: CLEAN** — honest soft copy ("about due for a check", deliberately not a diagnosis), fail-closed cooldown, closed-loop impression/action rows, recovery double-text excluded by construction. One fix: log printed 0-1 confidence as "%" |
| Review requests | `[VERIFIED]` `routers/reviewRequests.ts` + cron | settings.enabled + flag `sms_review_requests` | SMS | **AUDITED 2026-07-28: CLEAN + COMPLIANT** — no review gating, no incentives, no praise-conditioning (Google/FTC per plan §5); quiet hours 9-19, daily cap, cooldown, claim-before-send, gateway-offline hold. Gap closed: complaint texts now create `review_recovery` opportunities (receive-side service-recovery loop; asks never conditioned on it) |
| Customer psycho-profiler | `[VERIFIED]` `services/customerPsychoProfile.ts` | daily cron | none (writes segments) | behavior-based (visits/decline aggregates), not vehicle-stereotype; its "future enhancement" feeding pickProfile was never wired `[VERIFIED]` — and must now stay unwired unless routed through stated-concern evidence |

## What was wrong, in one line each (all fixed in this arc)

1. **Pricing engine** scored invoice *payment status* as estimate *approval* and recommended ±10-15% price moves — directionally biased toward "lower your prices" whenever collections ran slow. Recommender deleted; module now reports unpaid-invoice concentrations as a collections signal and says so.
2. **Recovery sequence** assigned psychographic profiles from proxies (luxury marque → "time-blocker", brakes → "skeptical", decline-rate → "broke") and its copy claimed unverifiable evidence ("photos of the worn parts") and invented price guarantees ("we'll honor that pricing"). Routing is evidence-only now (default P0 neutral); claims normalized to the verifiable "quote on file".
3. **Tire-demand forecast** presented unmatched estimates as "$X lost because we didn't have them on the shelf — stock these". Causation was invented; now an explicit demand *signal* with a verify-before-ordering instruction.
4. **Morning brief** divided paid invoices by bookings (different cohorts) and called it conversion; computed a "WALK RATE" from paid invoices vs *stale leads*; told the LLM "estimate without invoice = customer WALKED"; and carried a hardcoded $10K/month target (canonical `BUSINESS.revenueTarget.monthly` is 100K and self-describes as a legacy fallback). All replaced with labeled cohort-safe numbers + trailing-pace framing.
5. **Two invented 20% recovery rates** (`recoveryOpportunity`, `recoverableEstimate` — the latter sourced to an uncited "industry standard") flowed into the brief and daily digest as dollar figures. Removed; pools are reported as pools.
6. **Objection coaching** claimed "repair cost typically doubles", a shuttle/loaner service, 7:30 AM early drop-off (hours open 8), "20-30% less than dealership", "24 months warranty", and a stale "400+" review count. Every claim now traces to `shared/business.ts` or was removed.

## Doctrine locks (tests that keep this true)

- `server/services/declinedRecoverySequence.test.ts` — evidence-only routing + banned-claims sweep across all 20 variants
- `server/services/pricingIntelligence.test.ts` — price recommender stays dead + coaching claims trace to canon

## Runtime flag truth (read from prod 2026-07-28, end of arc)

Operator authorized a flag-flip; the read-first pass found **everything already ON** — resolving every `[UNKNOWN-runtime]` above:

| Gate | State | Evidence |
|---|---|---|
| `missed_call_recovery` (DB flag) | **ON** | `feature_flags` read, prod TiDB |
| `sms_cross_sell_outreach` (DB flag) | **ON** | same |
| `service_affinity_v2_compute` (DB flag) | **ON** (newest prediction 2026-07-28 14:47Z — compute is running) | same |
| `FEATURE_DECLINED_RECOVERY` (env) | **=1** | `railway variables`, service MAINnicks-tire-auto |
| `MISSED_CALL_RECOVERY_SEND` (env) | **=1** | same |

**ROS-033 histogram gate, retroactively read** (the file demanded it before enabling; it was enabled anyway, so here is the after-the-fact truth): 29,300 predictions — 28,499 below 0.30, 771 at 0.30-0.49, **30 at 0.50-0.69, zero ≥0.70; only 4 distinct treatment-arm customers clear the 0.5 send threshold.** Volume risk is nil *[basis: 4 eligible customers as of 2026-07-28 · cap 10/run · 30d cooldown — the eligible pool is `[VOLATILE]`, re-check after each affinity recompute]*. The cautionary precedent is real: **cross-sell's entire send history is a 575-text burst across 3 days (2026-05-19 → 05-21) and zero since** `[VERIFIED-runtime]` — dormancy today is a fact, not a property.

**The send-history truth (clarity-gate pass, `sms_messages` read 2026-07-28):** the bad copy did not just sit armed — **590 declined-recovery texts went out between 2026-05-19 and 2026-07-26** `[VERIFIED-runtime]`. Variant ledger: the psychographic P3 "busy/time-blocker" track carried **367** of them (incl. "That quote is still good…" 3d ×88, "we'll keep that quote open" 30d ×60); the legacy `declined_d30` fallback — the one that said **"We'll honor that pricing"** — sent **×46**; P1 price-track ~82+. The P2 track ("photos of the worn parts") did not appear in the top-10 variants — **≤~24 sends if any, not individually verified**. 9 declined-recovery texts also sent on 2026-07-28 itself; whether those carried old or corrected copy depends on send-time vs deploy-time and was not resolved. The #1146 corrections were therefore **fixes to messages customers were actually receiving**, at a verified scale of hundreds.

## Standing rule for future automations

**No recommendation without evidence; no revenue claim without a matched invoice; no rate without a measured outcome; no customer-psychology inference from vehicle/service proxies.** If a number is a prior, label it a prior — in the code comment *and* in the operator-facing message.

## Wave 4 — Revenue Opportunity Queue (shipped 2026-07-28, follow-on PR)

One durable queue (`revenue_opportunities`, migration **0099 — hand-apply required**) consolidating missed-revenue opportunities per REVENUE-OPS-ROADMAP Wave 4. `[VERIFIED]` code paths:

- **Apply:** `pnpm exec tsx scripts/migrations/apply-opportunity-queue.ts` (idempotent; all code degrades to no-op reads until applied — ROS-059 class handled).
- **Service** `server/services/opportunityQueue.ts`: dedup by (source_type, source_id) · roadmap's 12-state machine · append-only receipts · `won` reachable ONLY via `recordOutcome()` with a verified invoice id · consent supremacy (`do_not_contact` from any live state; smsOptOut → consent_ok=0) · transparent ranking (urgency-first, value×quality tiebreak, factors returned).
- **Collectors** (read-only against sources, NEVER contact customers): unresolved ALG estimates ≥$150 (data_quality: inferred) · pending callbacks (data_quality: verified, urgency: critical).
- **Cron** `opportunity-queue-refresh` (tier 3, business hours). **tRPC** `opportunityQueue.top/list/transition/recordOutcome/refresh` (admin-only).
- **Owner Decision Inbox v1** = TOP DECISIONS block in the morning brief (top-5 evidence-backed cards, LLM instructed to lead with them verbatim). React admin panel = next arc.

## Recovery 2.0 (shipped 2026-07-28, second follow-on PR)

Migration **0100 `[VERIFIED-runtime]` — APPLIED to prod** (as was 0099): `alg_estimates` gains `stated_concern`, `stated_concern_source`, `stated_concern_at`, `recovery_holdout` (additive nullable; INFORMATION_SCHEMA-guarded applicator).

- **Evidence routing is now real**: the cron reads `stated_concern` and re-routes the track from the customer's own words (evidence beats legacy sticky profiles). Closed signals (`repaired_elsewhere` / `no_longer_owns` / `not_interested`) STOP the sequence and drop the estimate from queue collection.
- **1-3 adaptive touches** (`allowedTouches`): evidence tracks get 2 targeted touches; P0 gets 2 neutral, a 3rd only when ≥$300 or safety service. 3d/45d retired from sending (columns remain for history).
- **Holdout measurement**: 15% deterministic control (`id % 100 < 15`) assigned at first send-eligibility, never contacted. `services/recoveryLift.ts` reports treated-vs-holdout matched-invoice rates — raw counts, `readable` flag gates on both arms ≥30 rows, no significance theater. tRPC `opportunityQueue.recoveryLift`.
- **Capture paths**: (1) operator capture via Decision Inbox chips (`opportunityQueue.captureStatedConcern`, source `operator` — the correction authority, overwrites freely); (2) **SMS auto-classification `[VERIFIED]` (wired 2026-07-28, follow-on PR)** — `recoveryReplyCapture.captureStatedConcernFromReply` runs as a passive fail-open observer on BOTH inbound webhooks (shop gateway + Twilio). Attribution gate: last outbound to the phone within 7d must carry a `declined_*` variantKey; classify-first short-circuit (no-signal replies cost zero DB work); guarded single-statement UPDATE (`stated_concern IS NULL` — first signal wins, operator never overwritten); **zero changes to reply/send behavior** — it rides alongside `recordSmsReply`, not inside the response engine.
- **Owner Decision Inbox panel** `[VERIFIED]`: `DecisionInboxPanel` leads `/admin` → Today. Call/Spoke/No-answer/Snooze/Lost/DNC (confirmDialog two-tap for destructive) + invoice-gated Won + stated-concern chips.

## DVI evidence-to-approval — drop-off scoped (shipped 2026-07-28)

**~60% already existed** `[VERIFIED]` (`vehicle_inspections` + `inspection_items` with per-item photos/conditions/costs, admin create/publish, public token page) — this arc built only the missing decision loop. Migration **0101 `[VERIFIED-runtime]` APPLIED to prod** (5 additive columns, post-checked).

- **View tracking**: `firstViewedAt` + `viewCount`, beacon fired once per page load (`inspection.recordView`). "Did they open it" is now answerable.
- **Per-item customer decisions**: Approve / Not now / Ask a question on every yellow/red item (`inspection.decideItem`, token-join = the auth, published-only, re-decidable). `customerNote` stores THEIR words verbatim — no AI touches this path.
- **Queue integration**: `collectInspectionDeferrals` — published packets with open (undecided/declined) yellow/red items become `deferred_service` opportunities, `data_quality: verified` (a tech physically saw the part — the strongest evidence class in the queue), red forces urgency `today`, value = summed tech estimates. A `question` decision is engagement, not a deferral (pure summarizer, test-pinned).
- **Scope**: drop-off flow only — inspections are created against bookings by staff. The walk-in lobby keeps the under-car flashlight ritual; no packet flow was added there. *The 41%/17% photo-evidence statistic is J.D. Power's 2025 ASI study, **externally verified 2026-07-28** via the Business Wire syndication ("Among full-service maintenance and repair customers who receive an MPI with photo/video, 41% have the recommended work done… without photo/video, only 17%") — full-service segment confirmed, so the drop-off-only scoping stands.*
- **No sends**: sharing the packet link remains an operator action through existing channels.

## Quote Guard + Promise Ledger (shipped 2026-07-28)

**Quote Quality & Profit Guard** (`services/quoteGuard.ts`, tRPC `quoteGuard.evaluateEstimate`) — every check returns pass/fail/**unknown**, and unknown is the point: **the guard never fabricates a profit number** (test-pinned: `impliedPartsMarginPct` is null unless `estimated_parts_cost` was actually captured). Computable today: amount sanity, same-phone overlapping open estimates, captured-parts margin (labeled parts-only), and tire quotes vs **live Gateway supplier cost** (using `selling_price` — the documented field inversion: it's Nick's COST, `cost_price` is retail `[SNAPSHOT 2026-07 — vendor API semantics; re-sample if D&K changes their payload]`). Labor/calibration checks return unknown with reasons — the checklist doubles as the Wave-5 capture roadmap. No price advice anywhere.

**Customer Promise Ledger** (`customer_promises`, migration **0102 `[VERIFIED-runtime]` APPLIED to prod**; `services/promiseLedger.ts`, tRPC `promises.*`, cron `promise-sweep`) — every promise gets an owner, due time, and auditable outcome. `kept` **requires evidence text** (rejected before any DB work otherwise, test-pinned). Overdue promises escalate ONCE into the Decision Inbox (`promise_overdue`, ≥4h overdue = critical) and rot to `missed` at 48h — the ledger tells the truth about broken promises. **No automated customer sends**: status messages from verified work-order transitions remain a later arc, gated on work-state timestamps being real (per the roadmap's own ordering).

## Operating surfaces (shipped 2026-07-28, final PR of the arc)

`/admin → Today` now carries the full working loop, in order:
1. **Decision Inbox** — top-5 ranked opportunities (all 5 collectors feeding).
2. **Promises panel** — 3-tap logging (type chips · one sentence · due quick-picks), **kept requires evidence**, cancel behind two-tap. Overdue rows go red; the sweep escalates them back into the inbox above.
3. **DVI capture panel** — the audit found the inspection loop had a complete backend and **no inlet** (nothing called `inspection.create`). Now: start check → giant green/yellow/red condition buttons → camera capture (HEIC/iPhone via the existing `uploadPhoto`) → publish → copy customer link. **Sharing the link stays a human action.**

## Operationalization Strike + evening waves (shipped 2026-07-28, #1167-#1176)

The external audit's PR-1..6, executed + the day's cross-app additions. Epistemic keys unchanged.

- **Same-day sales (#1167/#1168):** 8 PM ET post-close ALG probe (evening reason) + session-resume probe (real-touch semantics, auth-attempting throttle — two post-merge P1s fixed same day) + "as of h:mm" freshness label on the Money strip. `[VERIFIED-runtime]` job ticking; maiden 8 PM run = first receipt.
- **Queue integrity (#1171):** snooze is due-aware (topDecisions excludes + counts future-due); `won` requires a MATCH — direct (source-linked invoice) / strong (phone last-10 + postdates opportunity) / manual (explicit override, never counted verified) / rejected; estimate identity join aggregated with ambiguity refusal (2+ phone matches → no linkage, conservative consent); do_not_contact is phone-scoped; collector telemetry = {scanned, inserted, refreshed} and recordsProcessed counts REAL changes only; source reconcilers close resolved rows (matched → won-direct, stated-closed/handled/aged → lost with receipts). Queue cron self-classifies via loopShapeContract.
- **DVI evidence classes (#1171):** `verified` now requires a photo on an open flagged item; typed-only findings = technician_asserted/inferred; unlinked packets labeled; customer Approve copy states the shop confirms before work starts.
- **Promise lifecycle (#1171 + #1174):** keep/cancel/48h-missed close their escalated inbox rows; kept-rate line (made/kept/late/MISSED/open) joins the morning brief — renders only when promises exist.
- **Recovery experiment v3 (#1171, migration 0103 applied + independently verified):** versioned sha256 arm assignment (modulo striping dead, in-flight arms preserved), assignment-anchored ITT-primary + per-protocol-secondary readout; outcomes count only when the matched invoice postdates assignment. Legacy rows excluded from v3.
- **Quote guard truth (#1171):** `quoteRemainderAfterPartsCost` (it was never a margin), tire check labeled a floor check, missingInputs[] surfaced; guard flags now ride every estimate opportunity into the Decision Inbox (below-parts-cost + insane-amount escalate into the reason line).
- **Bridge (#1176):** new `top_decisions` query (NICKSTIRE-QUERY-CONTRACT §7) — statenour's chat decision card reads the SAME topDecisions(5) as the admin panel.
- **Cross-app:** nickstire /api/health feeds statenour's fleet-truth (chat tool + /system/fleet page); ROS-059..063 registry statuses corrected with live receipts (#1170); event taxonomy doc generated (docs/analytics/EVENT-TAXONOMY.md) after the planned "gap-fill" was refuted — 30 events already wired.

## SMS Revenue Agent OS wave (2026-07-29)

One-branch batch closing the SMS-stack audit's four verified holes plus the speed-to-lead gap. `[VERIFIED]` = code + tests on the branch; nothing here is runtime-verified until deployed.

- **Real global SMS kill switch** — `sms_global_pause` flag (inverted PAUSE polarity, `services/smsControl.ts`, 5s fresh-read). `SMS_KILL_SWITCH` env only ever gated the dead Twilio fallback — there was NO way to stop F25e sends without a redeploy. Semantics: **HOLD, not drop** (marketing+followup queue durably; confirmations+internal flow; drain holds too). Unreadable switch fails CLOSED for marketing, OPEN for 1:1 followups. Operator lever: SMS Ops strip (two-tap), audit-logged `sms.global_pause`.
- **Shop-wide 24h volume cap** — rolling count of ALL outbound `sms_messages` rows (every send door persists one) vs `SMS_GLOBAL_DAILY_CAP` (default 200). Refuses (not queues) automated sends over cap. The SMS analog of the #1129 four-doors content governor.
- **Human takeover at the chokepoint** — `isPhoneHumanHeld` now suppresses AUTOMATED sends inside `sendSms` itself; previously only orchestrator inbound events checked, while ~20 crons/routers called `sendSms` directly and could text over a live human. `humanInitiated: true` (operator manual send / approved draft) is exempt — without it the operator's second reply would deadlock on the takeover their first created.
- **Continuous queue rehydration** — `rehydrateQueuedFromDb()` extracted from the boot IIFE and run on the drain timer after each stale-'sending' recovery pass (the recovery was requeueing rows NOTHING in a running process would ever load). Dedup is now **by DB id, before the claim** (the old (phone,body) dedup could strand a claimed row in 'sending'; two identical texts to one number are different obligations). 2-minute claim grace closes the queueForLater dbId-stamp race that continuous rehydration would otherwise introduce.
- **Autonomy ladder** — `services/smsAutonomy.ts`: typed registry declaring level 0-4 / send class / evidence / caps / quiet-hours / opt-out / takeover / fallback for every SMS automation (10 orchestrated event types + direct-sendSms crons + campaign doors). Enforcement: `setRolloutMode` rejects flips above an event type's declared ceiling (`photo_assess_reply` is L1 → live_send is FORBIDDEN until a PR raises the level). Pinned by `smsAutonomyPolicy.test.ts`.
- **Speed-to-lead closure** — `collectStaleLeads()`: uncontacted non-careers/non-callback leads aged 24h–30d become `stale_lead` Decision-Inbox rows (call-first framing, value null unless a real quote was recorded — never invented). Reconciler closes handled rows and ages out >30d, queue-side only. The 2h–24h auto-follow-up cron and 0-2h human window are untouched.
- **Decision Inbox draft bridge** — `services/opportunityDraft.ts` + `opportunityQueue.draftOutreach/sendOutreach`: DETERMINISTIC (no-LLM) evidence-only drafts for stale_lead / unapproved_estimate / deferred_service / missed_call; call-first types (callback / review_recovery / promise_overdue) get NO draft with the reason stated. Operator edits + two-tap approves; send rides the full sendSms gate stack with `humanInitiated`; success receipts as `attempted`. Total banned-claims sweep in `opportunityDraft.test.ts` (no $, no %, no guarantees/warranties/urgency/wait-times/"financing").
- **SMS Ops surface** — `smsOps` router + `SmsOpsStrip` (mounted atop the SMS Operating System admin): pause lever, gateway state, DB queue depth + oldest-queued age, 24h volume vs cap, delivery failures 7d, pending drafts, suppression rollup, autonomy ladder with live rollout modes, and latency metrics (lead→first-contact 30d from real `contactedAt`; inbound→response 7d from `sms_response_jobs` terminal stamps). **queue→sent latency is deliberately NOT reported** — `sms_messages` has no sent-at column; a proxy would fabricate the metric.
- **Escape-hatch accounting** — every non-internal `skipOptOutCheck=true` send is now loudly logged + counted (`optOutCheckSkipped`); behavior unchanged, invisibility ended. `smsStats.queued` gauge now decrements on drain.
- **No migrations. No new env required** (`SMS_GLOBAL_DAILY_CAP` optional). Flag row seeds via existing `seedFlags`.

### Autopilot Wave 1 follow-on (same day, second PR)

Evidence-first audit at [`docs/plans/REVENUE-AUTOPILOT-2-AUDIT.md`](plans/REVENUE-AUTOPILOT-2-AUDIT.md) (capability map + 12 rejected-as-already-built ideas). Shipped: **stale-lead truth fix** (the cron stamped `contacted` BEFORE the send — a blocked/failed follow-up left the lead permanently "contacted"; now claim = `lastFollowUpAt`, contact recorded only on confirmed dispatch) · **channel dedupe** (pending callback / 48h inbound skips the auto-text) · **bounded retry + dead-letter** (migration **0104 hand-apply**: `send_attempts`, `failure_reason`; cap 5, degrade-until-applied) · **per-cycle rehydration** (60s, was 5-min) · **stuck-queue Telegram alert** (healthy-but-stalled >5min, #962 class) · **`smsOps.replayFailed`** (idempotent failed→queued).

Known residual holes (explicitly NOT closed here, documented for the next wave): `scripts/fire-declined-recovery.ts` still POSTs to the Capevace relay directly (zero gates — script-only path); opt-out cache is per-pod with 5-min TTL; `campaignEligiblePhoneSql` still checks only `customers.smsOptOut` (batch counts overstate reach; send-time gate still blocks); takeover has no read-signal or release mechanism.

## Open items this arc did NOT cover

- Runtime verification of legacy flags/last-runs (`FEATURE_DECLINED_RECOVERY` state etc.) — `[UNKNOWN-runtime]`, needs `cron_log`/`railway run`. (Migrations 0099+0100 ARE runtime-verified applied.)
- Missed-call recovery, cross-sell, review-request audits — same truth pass pending.
- Recovery-lift readout is structurally live but `readable=false` until both arms reach 30 rows — do not quote lift numbers before then.
- Auto-captured concerns come from a regex classifier — precision is untested against real reply traffic; the Decision Inbox chips are the correction path if a misclassification surfaces.
