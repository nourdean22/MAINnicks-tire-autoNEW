# Service Affinity v2 · Design Plan

**Date:** 2026-05-24
**Context:** Companion to `2026-05-24-intelligence-dispersal-plan.md` · operator-flagged Service Affinity as needing **extra attention** because it's the highest-$ leverage signal in the business (cross-sell prediction · 30-50% LTV lift potential if done well).

**Scope:** design plan only · no execution this session.

**Skills applied:** `/clarity-gate` · `/infinite-gratitude` (3 parallel research agents) · `/similarity-search-patterns` · `/using-superpowers` · `/research-synthesis`.

---

## 1 · Ground truth · what's actually shipped today

### 1.1 · The current `intelligence.serviceAffinity` query — honest audit

The audit agent (read-only trace of pipeline end-to-end) returned this:

**Pipeline:**
- Client: `CustomersTab.tsx:13` → `trpc.intelligence.serviceAffinity.useQuery()` · 120s refetch
- Router: `server/routers/intelligence.ts:157` → `buildServiceAffinityMap()` · no input, no cache, recompute each call
- Service: `server/services/engines/customer.ts:120-173`
- DB: reads `invoices` (24mo · customer + service text) + `customers` (id + name + totalVisits ≥ 2) · NO joins · NO vehicle/mileage/declined-work data
- UI: 6-row MiniTable · `name | top 3 services CSV | predicted next` · no click handler · no SMS pre-fill · no deep link · pure read-only chrome

**Algorithm (honest assessment):**
- Stage 1: regex-categorize each invoice into 10 service buckets (brakes/tires/oil/suspension/engine/electrical/exhaust/cooling/transmission/diagnostic)
- Stage 2: per customer · sort their bucket counts → top 3 = topServices · `predictedNext` = **the most globally popular category the customer hasn't yet had**

**The brutal truth:** this isn't a prediction. It's a complement-by-global-popularity recommender. A customer who's had tires + oil + brakes gets predicted "suspension" because suspension is #4 overall in the shop's invoice history — not because anything about THEM suggests they need it.

**Failure mode:** every customer's predicted-next biases toward Nick's most-frequent service. Operator-actionability ≈ 0.

**Data being IGNORED** (the killer findings):
- `customers.vehicleMake / vehicleModel / vehicleYear` — most-predictive signal · unused
- `customers.lastVisitDate / firstVisitDate` — no recency or tenure weighting
- `customer_metrics.declinedValue / declinedCount` — built last wave · unused
- **`alg_estimates.serviceDescription`** — $321K of "customer literally said no to THIS exact service last time" · best possible signal · zero consultation
- `customers.psycho_profile` (wave 181.46) — segment data · not joined
- Seasonality — tire-swap months · A/C · snow · ignored

### 1.2 · The downstream cross-sell infra THAT ALREADY EXISTS

The similarity-search agent caught this critical fact:

**`server/cron/jobs/crossSellOutreach.ts:36`** · `processCrossSellOutreach()` is production-live and gated behind `sms_cross_sell_outreach` feature flag (currently OFF).

It does ALL of this end-to-end:
- Reads `generateCrossSellRecommendations()`
- Filters `urgency = overdue|upcoming`
- TCPA opt-out check
- 30-day cooldown via `variantKey='cross_sell'` JOIN
- Max 10 sends/run · 1.5s rate-limit
- Routes via F25e (`{ via: "shop" }`)
- Logs via `logOutboundSms` + `dispatch("campaign_sent")` event-bus

**This means:** the v2 build isn't "build a new cross-sell system." It's "(a) replace the bad heuristic feeding it, (b) instrument outcomes, (c) flip the flag."

### 1.3 · Closed-loop infra also already exists

- Statenour `lib/brain/suggestion-loop.ts:197` — production-live supervised-signal loop tracking `acted | dismissed | modified | deferred` events with confidence weighting + operator-state snapshot
- Nickstire `wave_metrics` + `closedLoop.ts:33` `MetricResolver` registry — Tier-A closed-loop framework with `lifted|no_lift|regression` status + 14-day windows
- Statenour suggestion-loop `SuggestionKind` enum already includes `"sms"` — adding `"service-affinity"` is a one-line enum extension

---

## 2 · v2 architecture · 3 layers

### 2.1 · MODEL layer (prediction quality)

**Throw out** the global-popularity complement logic at `customer.ts:144-152, 165`.

**Replace with** a weighted-signal score across 4 inputs (mirrors `recoveryScore` pattern from DeclinedEstimatesSection · proven heuristic shape):

```
predictedNext(customer) = argmax over 10 service buckets of:
    α · vehicleAgeMileageDue(bucket, customer.vehicle)
  + β · declinedRecall(bucket, customer.alg_estimates)
  + γ · recencyDecay(bucket, customer.lastVisit)
  + δ · seasonalDemand(bucket, currentMonth)
  − ε · alreadyHadRecently(bucket, customer.invoices)

with confidence = sample_size_weight × signal_strength
```

**Why this beats v1 by an order of magnitude:**
- Vehicle-age + last-visit recency → real mileage-proxy for service-due
- Declined-recall → the customer's own walk-aways are the best "what they need" signal
- Seasonal overlay → tire-shop reality (snow tires in fall · A/C in summer)
- Sample-size weighting → confidence calibrated to data thickness · low-data customers get low-confidence predictions (or hidden entirely)

**What stays from v1:** the 10-bucket service taxonomy at `engines/shared.ts:37-52`. It's crude but stable. v2 outputs the same vocabulary so the surface contract doesn't break.

**What we DON'T build:** ML / collaborative filtering / embeddings. Per skill agent's honest assessment + Karpathy "simplest thing that works" — at Nick's data scale (single shop · ~few thousand customers) a weighted-signal heuristic beats ML on bias + maintainability + cold-start. ML waits for ≥6 months of outcome data anyway (chicken-and-egg).

### 2.2 · SURFACE layer (operator UX)

Three surfaces · stolen from already-shipped patterns:

**A. Nickstire admin · `/admin/customers` page roster column**
- Mirror DeclinedEstimatesSection pattern exactly (already operator-trained on it)
- Score-sorted card list · 🔥 SCORE badge · GOING COLD / HOT LEAD buckets
- BULK SELECT TOP 10 / 25 → SEND `next_service_due` SMS
- Per-row actions: CALL · SMS · MARK CONTACTED · DISMISS
- Top of page: loss-aversion banner ("$X in predicted-cross-sell revenue across N customers due this week")
- Per-row "why this" reason line ("Predicted: alignment · because vehicle is 2018+ and last tire visit was 4mo ago")
- "Snooze 7d" escape hatch on each row (writes to suggestion-loop)

**B. Nickstire CustomerDrawer + statenour `/customer-360/[id]`**
- `PredictedNextServiceTile` slotted between Stats grid and Quick Actions
- Single primary CTA · one-tap "Send next-service SMS"
- Confidence badge + reason · trust-calibrator skill pattern
- Already has the slot waiting · just need the component

**C. Statenour `/brain` pattern card · cross-customer rollup**
- Rollup view: "Service Affinity surfaced N predictions this week · X% acted · Y% booked"
- PatternCard wrapper at `components/brain/pattern-card.tsx:43`
- Connects to `prediction-streaks-card.tsx:42` for model-calibration display (hit-rate · streak)
- This is the "the system is noticing" surface · operator-facing intelligence summary

**Visual stance** · DFII ≥ 8 · editorial-minimalist · no AI-slop · trust the color · no constant pulse animations · single primary CTA per surface · escape hatches visible.

### 2.3 · CLOSED LOOP layer (the real moat)

This is where the actual leverage lives. Right now we generate ZERO exhaust on prediction quality.

**4 new schema tables on nickstire side:**

```sql
-- 1. Every prediction we make · who · what · how confident · why
CREATE TABLE service_affinity_predictions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  customer_id BIGINT NOT NULL,
  predicted_service VARCHAR(64) NOT NULL,
  confidence DECIMAL(5,4) NOT NULL,
  features_json JSON NOT NULL,
  model_version VARCHAR(32) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_customer_created (customer_id, created_at DESC),
  INDEX idx_model_created (model_version, created_at)
);

-- 2. When the prediction was actually shown (impression log)
CREATE TABLE prediction_impressions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  prediction_id BIGINT NOT NULL,
  shown_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  surface VARCHAR(64) NOT NULL,  -- 'admin_roster' | 'customer_drawer' | 'sms_queue'
  operator_id VARCHAR(64),
  INDEX idx_prediction (prediction_id, shown_at)
);

-- 3. Operator action (or inaction)
CREATE TABLE prediction_actions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  prediction_id BIGINT NOT NULL,
  action VARCHAR(32) NOT NULL,  -- 'sms_sent' | 'dismissed' | 'snoozed' | 'called'
  acted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  operator_id VARCHAR(64),
  INDEX idx_prediction (prediction_id, acted_at),
  INDEX idx_action_acted (action, acted_at)
);

-- 4. Did the prediction pan out? (linked to invoice if booked)
CREATE TABLE prediction_outcomes (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  prediction_id BIGINT NOT NULL,
  invoice_id BIGINT,
  matched TINYINT(1) NOT NULL,  -- did the booked service match the prediction?
  resolved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  window_days INT NOT NULL,  -- how long after prediction was outcome observed
  INDEX idx_prediction (prediction_id),
  INDEX idx_resolved (resolved_at)
);
```

**Statenour suggestion-loop integration:**
- Add `"service-affinity"` to the `SuggestionKind` enum at `lib/brain/suggestion-loop.ts:50` (1-line change)
- Mirror nickstire predictions into statenour via existing bridge contract
- Reuse `trackSuggestionAction()` + `recordSuggestionOutcome()` — zero new infrastructure

**Wave-metrics resolver:**
- Register `service_affinity_acted_to_revenue_14d` resolver in `closedLoop.ts:33` MetricResolver registry
- 14-day baseline: track revenue from prediction-acted customers vs hold-out group
- Auto-surfaces in Today page's `WaveMetricWins` tile (already shipped!)

**A/B test from day one:**
- 50/50 random hold-out on high-confidence predictions
- Treatment: SMS sent · Control: prediction logged but no SMS
- 14-day outcome window
- MDE ≈ 10pp at 80% power with ~289 customers (real cohort size per memory)
- Weekly cron computes lift · publishes to `/api/system/affinity-evaluation` JSON endpoint

---

## 3 · Existing infra inventory · what to extend vs build new

### 3.1 · Extend (already shipped · just touch lightly)

| Need | Extension target | LOC |
|---|---|---|
| Per-prediction "send SMS" CTA | `crossSellOutreach.ts` cron · already production-gated | ~30 LOC |
| SMS template | `shared/sms-templates.ts:33` · add `next_service_due` entry | ~10 LOC |
| Closed-loop event tracking | `lib/brain/suggestion-loop.ts:50` enum + bridge wire | ~5 LOC + bridge action |
| Wave-metrics resolver | `closedLoop.ts:33` registry + 14-day baseline | ~50 LOC |
| Today page surface | `WaveMetricWins.tsx:48` auto-renders new resolver | 0 LOC (just register) |
| Customer drawer tile | `CustomerDrawer.tsx:122-149` between Stats + Quick Actions | ~80 LOC |
| Statenour customer-360 tile | `/customer-360/[id]/page.tsx:213` slot | ~60 LOC |
| Statenour brain pattern card | `components/brain/pattern-card.tsx:43` wrapper | ~40 LOC |
| Roster surface | Mirror `DeclinedEstimatesSection.tsx` pattern | ~200 LOC (mostly copy)|

### 3.2 · Build new (the actual delta)

| Need | New asset | LOC |
|---|---|---|
| Better prediction algorithm | `server/services/engines/customer.ts` rewrite of `buildServiceAffinityMap()` | ~200 LOC |
| 4 new schema tables | `drizzle/00XX_service_affinity_v2.sql` migration | ~80 LOC SQL |
| Prediction generation cron | `server/cron/jobs/serviceAffinityCompute.ts` · runs every 6h | ~150 LOC |
| Outcome resolver cron | `server/cron/jobs/serviceAffinityOutcomes.ts` · runs daily · links predictions to subsequent invoices | ~120 LOC |
| Per-prediction SMS endpoint | `server/routers/serviceAffinity.ts` · sendSms · dismiss · snooze | ~150 LOC |
| A/B test hold-out logic | inside the compute cron · stable hash → 50/50 split | ~30 LOC |
| Weekly lift evaluation cron | `server/cron/jobs/serviceAffinityLiftEval.ts` | ~120 LOC |

**Net build size:** ~850 LOC new + ~480 LOC extending existing surfaces = **~1330 LOC for full v2**.

Compare to v1: ~80 LOC of brain-dead heuristic + 0 instrumentation + 0 actionability + 0 outcome tracking. v2 is genuinely a different system.

---

## 4 · Implementation waves (proposed)

### Wave 1 · Model + Schema (~1-2 sessions)
1. Ship 4 new schema migrations (`drizzle/00XX_service_affinity_v2.sql`)
2. Apply to prod TiDB
3. Rewrite `buildServiceAffinityMap()` with 4-signal weighted score
4. Add `serviceAffinityCompute` cron · stores predictions in new table
5. Bake A/B hold-out into compute (no surface yet · just measurement infrastructure)

**Outcome:** predictions are computed + stored + treatment/control marked. No operator surface yet. Pure measurement.

### Wave 2 · Closed-loop instrumentation (~1 session)
1. `serviceAffinityOutcomes` cron · daily · links predictions to subsequent matching invoices
2. Register `service_affinity_acted_to_revenue_14d` resolver
3. Add `"service-affinity"` to statenour SuggestionKind enum + bridge wire
4. Statenour `/brain` pattern card · cross-customer rollup view
5. Today page auto-surfaces the wave-metric

**Outcome:** every prediction is now tracked end-to-end. Even with zero operator action, after 14 days we know prediction accuracy.

### Wave 3 · Operator surfaces (~2 sessions)
1. Build new Customers page roster surface (mirror DeclinedEstimates pattern)
2. Add `PredictedNextServiceTile` to nickstire CustomerDrawer
3. Add same tile to statenour `/customer-360/[id]`
4. Wire `serviceAffinity.sendSms` mutation with confirmDialog gate
5. Wire snooze + dismiss → suggestion-loop
6. Wire MessageCustomerLink for F25e routing

**Outcome:** operator can now act on predictions from 3 surfaces. Each action is logged. Each outcome is tracked.

### Wave 4 · Cross-sell cron + flag flip (~1 session)
1. Update `crossSellOutreach.ts` to consume v2 predictions
2. Add `sms_cross_sell_outreach` flag to admin Settings UI for one-click flip
3. Operator runbook update
4. **Flip the flag** with monitoring on

**Outcome:** autonomous cross-sell SMS pipeline is live. Predictions → SMS → outcome → measurement closes the loop end-to-end.

### Wave 5 (deferred · model upgrade) · learned model · ≥6mo after Wave 4 ships
1. With 6 months of outcome data + A/B test results, evaluate if a learned model (lightweight gradient boost · ranking) outperforms the heuristic
2. Only build ML if data shows the heuristic is leaving ≥5pp of conversion on the table

---

## 5 · Risks + open questions

1. **Schema-add discipline** · 4 new tables is significant. Operator's CLAUDE.md says migrations are hand-applied. Need clean staging before applying to prod TiDB.

2. **Bridge bandwidth** · Statenour pulling per-customer predictions on demand may strain the bridge contract. May need to batch via BrainMemory cache + cron-sync rather than live-pull.

3. **SMS cap risk** · Cross-sell cron has 10/run cap but the predictions table could grow large. Need a per-customer cooldown that's stricter than the 30d global one (avoid over-pinging same customer about different predicted services).

4. **Operator workload** · Today's operator pattern is to triage Declined Work · Outreach · Voice. Adding "Service Affinity roster" is a 4th queue. Risk of operator fatigue · may need to AUTO-fire only the highest-confidence predictions via cron and surface only the lower-confidence ones for operator review.

5. **Confidence calibration is hard** · Sample-size weighting matters most for cold-start customers. Need a holdback for n<3 visits (predict nothing rather than predict garbage).

6. **The cross-sell template** · `next_service_due` SMS template still needs writing. The phrasing matters · sequence-psychologist skill says one-emotional-job-per-message. Tires-due = different tone than brakes-overdue. May need 5-10 templates not 1.

---

## 6 · The first-move that doesn't require new code

Per operator's "go look for cool shit" mandate + Elon's "delete before adding":

**Before Wave 1, the operator could do this right now in <30 min:**

1. Flip `sms_cross_sell_outreach` flag ON in Settings → ShopDriver tab (the panel we built last week surfaces this)
2. Watch the existing cron run for 7 days
3. Pull `intelligence.serviceAffinity` predictions manually + grade 10 of them as good/bad/garbage
4. Use that grade to decide whether v2 is worth the build or whether the current heuristic is "fine for now"

**This is the karpathy "verify-before-build" move.** The v2 design above is the path IF the v1 audit confirms the heuristic is as bad as the audit agent claims. The single highest-confidence finding from the agents is "v1 predictions are decorative · ignored · no closed loop." But the operator should verify that personally before greenlighting 5 waves of work.

---

## 7 · Open operator decisions for v2 execution

When the operator says "execute service affinity v2":

1. **Wave order confirm** · Wave 1 (model + schema) before Wave 2 (closed loop) before Wave 3 (operator surfaces)? Or accept slower-but-safer "land in shadow mode for 30 days before exposing any operator surface"?
2. **Auto-fire vs operator-review split** · what confidence threshold cuts the auto-cron from the operator-roster?
3. **SMS template count** · 1 generic template, OR 5-10 per-service-category templates with sequence-psychologist tone variation?
4. **Statenour role** · is statenour `/brain` the canonical home for cross-customer rollup, OR does that also live as a nickstire dashboard tile?

---

## 8 · Source agents (verification record)

- **Skill mining agent** · scanned ~30 skills across `C:\Users\nourd\.claude\skills\` · flagged 4 skill clusters · honest about MODEL-layer gap
- **Similarity-search agent** · inventoried both repos for prediction-display + closed-loop + cross-sell infra · caught the `sms_cross_sell_outreach` flag fact
- **Implementation audit agent** · traced current `serviceAffinity` end-to-end · concluded "decorative · zero actionability"

All findings spot-checked against actual file content before inclusion. File:line references throughout for grounding.
