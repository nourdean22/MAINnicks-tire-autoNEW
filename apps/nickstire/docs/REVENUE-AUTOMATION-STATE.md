# Revenue-automation state matrix

> Wave-0 deliverable of the revenue-truth-correction arc (2026-07-28).
> **Epistemic key:** `[VERIFIED]` = confirmed by reading code on 2026-07-28 · `[FIXED <PR>]` = corrected in that PR · `[UNKNOWN-runtime]` = prod flag/last-run state NOT checked — `.env` is not prod config; verify via `cron_log`, `/api/health`, or `railway run` only.
>
> Scope note: this matrix records what each automation's CODE does and which truth defects were found/fixed. It makes **no** claims about production flag state, last run, or measured lift — those columns stay `[UNKNOWN-runtime]` until read from prod.

## The matrix

| Automation | Code exists | Gate (code-level) | Customer contact? | Truth status |
|---|---|---|---|---|
| Missed-call recovery | `[VERIFIED]` `server/cron/jobs/missedCallRecovery.ts` | not audited this arc | SMS (via shared rails) | not audited this arc |
| Declined-work recovery (5-touch) | `[VERIFIED]` `cron/jobs/declinedWorkRecovery.ts` + `services/declinedRecoverySequence.ts` | `FEATURE_DECLINED_RECOVERY=1` env; without it: dry-run + daily Telegram nag | SMS when flag ON | `[FIXED revenue-truth-correction]` — see below |
| Recovery targeting/scoring | `[VERIFIED]` `services/recoveryTargeting.ts` | used inside the cron above | copy feeds SMS | `[FIXED]` fabricated calibration provenance + price-guarantee copy |
| Pricing intelligence | `[VERIFIED]` `services/pricingIntelligence.ts`, cron `pricing-intelligence` | always-on cron | Telegram (operator only) | `[FIXED]` — was invalid, rewritten as payment-status/collections signal |
| Inventory demand forecast | `[VERIFIED]` `cron/jobs/inventoryDemandForecast.ts` | always-on cron (tier 4) | Telegram (operator only) | `[FIXED]` — reframed as Unmatched Tire Demand Signal |
| Tire inventory intelligence | `[VERIFIED]` `services/dataPipelines.ts` `analyzeTireInventory` | cron `tire-inventory-intelligence` | Telegram (operator only) | `[VERIFIED]` clean — real orders + real Gateway stock |
| Morning brief | `[VERIFIED]` `cron/jobs/morningBrief.ts` | daily cron | Telegram (operator only) | `[FIXED]` — $10K hardcode, cohort-mismatched "conversion", "WALK RATE", invented "recoverable" |
| Daily digest (intelligence report) | `[VERIFIED]` `cron/scheduler.ts` daily-digest block | daily cron | Telegram (operator only) | `[FIXED]` — "walk-away … @ 20% close" language |
| Intelligence engines | `[VERIFIED]` `services/intelligenceEngines.ts` | called by brief/digest/brain | none directly | `[FIXED]` — two invented 20% "recoverable" figures removed; `forecastRevenue` target already dynamic (trailing×1.1) `[VERIFIED]` |
| Cross-sell outreach | code exists (memory: armed-but-idle class) | not audited this arc | SMS potential | not audited this arc |
| Review requests | code exists | not audited this arc | SMS | not audited this arc |
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
- **Capture paths**: operator capture via Decision Inbox chips (`opportunityQueue.captureStatedConcern`, source `operator`) — the ONLY wired path. `classifyDeclineReply()` (pure, inflection-tested) is ready for SMS auto-classification but **deliberately NOT wired** into the live orchestrator; that wire is its own future change with its own review.
- **Owner Decision Inbox panel** `[VERIFIED]`: `DecisionInboxPanel` leads `/admin` → Today. Call/Spoke/No-answer/Snooze/Lost/DNC (confirmDialog two-tap for destructive) + invoice-gated Won + stated-concern chips.

## Open items this arc did NOT cover

- Runtime verification of legacy flags/last-runs (`FEATURE_DECLINED_RECOVERY` state etc.) — `[UNKNOWN-runtime]`, needs `cron_log`/`railway run`. (Migrations 0099+0100 ARE runtime-verified applied.)
- Missed-call recovery, cross-sell, review-request audits — same truth pass pending.
- SMS auto-classification wire (`classifyDeclineReply` → orchestrator inbound path) — deferred by design; see above.
- Recovery-lift readout is structurally live but `readable=false` until both arms reach 30 rows — do not quote lift numbers before then.
