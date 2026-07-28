# Revenue-automation state matrix

> Wave-0 deliverable of the revenue-truth-correction arc (2026-07-28).
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
| Cross-sell outreach | `[VERIFIED]` `cron/jobs/crossSellOutreach.ts` | flag `sms_cross_sell_outreach` — **ON in prod `[VERIFIED-runtime]`; ROS-033 histogram gate SATISFIED** (see Runtime flag truth below) | SMS (live) | **AUDITED 2026-07-28: CLEAN** — honest soft copy ("about due for a check", deliberately not a diagnosis), fail-closed cooldown, closed-loop impression/action rows, recovery double-text excluded by construction. One fix: log printed 0-1 confidence as "%" |
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

**ROS-033 histogram gate, finally read** (the file demanded it before enabling; it was enabled anyway, so here is the after-the-fact truth): 29,300 predictions — 28,499 below 0.30, 771 at 0.30-0.49, **30 at 0.50-0.69, zero ≥0.70; only 4 distinct treatment-arm customers clear the 0.5 send threshold.** Volume risk is nil (cap 10/run, 30d cooldown, 4 eligible humans); no cap change needed. The flag being ON is safe — and nearly dormant.

**The uncomfortable implication:** all three SMS channels were LIVE before today. The psychographic routing, the "photos of the worn parts" claim, and "we'll honor that pricing" were **live-sending until #1146 merged** — the truth corrections were fixes to production behavior, not preventative hardening. Today's deploy carries the corrected copy + Recovery 2.0 policy into those live channels.

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
- **Scope**: drop-off flow only — inspections are created against bookings by staff. The walk-in lobby keeps the under-car flashlight ritual; no packet flow was added there (J.D. Power's 41%/17% evidence is full-service-repair, not walk-in tire).
- **No sends**: sharing the packet link remains an operator action through existing channels.

## Quote Guard + Promise Ledger (shipped 2026-07-28)

**Quote Quality & Profit Guard** (`services/quoteGuard.ts`, tRPC `quoteGuard.evaluateEstimate`) — every check returns pass/fail/**unknown**, and unknown is the point: **the guard never fabricates a profit number** (test-pinned: `impliedPartsMarginPct` is null unless `estimated_parts_cost` was actually captured). Computable today: amount sanity, same-phone overlapping open estimates, captured-parts margin (labeled parts-only), and tire quotes vs **live Gateway supplier cost** (using `selling_price` — the documented field inversion: it's Nick's COST, `cost_price` is retail). Labor/calibration checks return unknown with reasons — the checklist doubles as the Wave-5 capture roadmap. No price advice anywhere.

**Customer Promise Ledger** (`customer_promises`, migration **0102 `[VERIFIED-runtime]` APPLIED to prod**; `services/promiseLedger.ts`, tRPC `promises.*`, cron `promise-sweep`) — every promise gets an owner, due time, and auditable outcome. `kept` **requires evidence text** (rejected before any DB work otherwise, test-pinned). Overdue promises escalate ONCE into the Decision Inbox (`promise_overdue`, ≥4h overdue = critical) and rot to `missed` at 48h — the ledger tells the truth about broken promises. **No automated customer sends**: status messages from verified work-order transitions remain a later arc, gated on work-state timestamps being real (per the roadmap's own ordering).

## Operating surfaces (shipped 2026-07-28, final PR of the arc)

`/admin → Today` now carries the full working loop, in order:
1. **Decision Inbox** — top-5 ranked opportunities (all 5 collectors feeding).
2. **Promises panel** — 3-tap logging (type chips · one sentence · due quick-picks), **kept requires evidence**, cancel behind two-tap. Overdue rows go red; the sweep escalates them back into the inbox above.
3. **DVI capture panel** — the audit found the inspection loop had a complete backend and **no inlet** (nothing called `inspection.create`). Now: start check → giant green/yellow/red condition buttons → camera capture (HEIC/iPhone via the existing `uploadPhoto`) → publish → copy customer link. **Sharing the link stays a human action.**

## Open items this arc did NOT cover

- Runtime verification of legacy flags/last-runs (`FEATURE_DECLINED_RECOVERY` state etc.) — `[UNKNOWN-runtime]`, needs `cron_log`/`railway run`. (Migrations 0099+0100 ARE runtime-verified applied.)
- Missed-call recovery, cross-sell, review-request audits — same truth pass pending.
- Recovery-lift readout is structurally live but `readable=false` until both arms reach 30 rows — do not quote lift numbers before then.
- Auto-captured concerns come from a regex classifier — precision is untested against real reply traffic; the Decision Inbox chips are the correction path if a misclassification surfaces.
