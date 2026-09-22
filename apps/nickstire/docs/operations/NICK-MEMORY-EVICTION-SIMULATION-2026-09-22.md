# Nick's memory store · eviction-policy simulation (2026-09-22)

**Answer first.** The eviction policy is not the lever. Six candidate policies replayed over 30
simulated days against the real 721 rows differ by at most a few percent in what survives, and the
one rule that was ready to ship — an admission floor at the cap — is the one that **hurts**: it
refuses exactly the 24 lowest-confidence entries, which are the conversational ones (`auto_analysis`
0.7, `statenour_alerts` 0.7, `accuracy_check` 0.7). The lever is at the **writers**: machine
analytics summaries enter at 0.9–0.95, about seven rows a day (`shopdriver_mirror`,
`revenue_analytics`, `daily_digest`, `invoice_reconciliation`, `revenue_reconciliation`,
`daily_score`), hold 399 of the 548 non-health rows, and are what `recall()` ranks first — while
statenour's conversational pulls enter at 0.7–0.8 at a quarter of a row a day. Confidence is being
used as importance by the writers; the scalar collapse the operator mandate warns against (item 11)
is already happening at the input, not at eviction.

Instrument: `pnpm diag:memory-eviction` (`scripts/diagnostics/memory-eviction-simulation.mjs`,
read-only: one SELECT, everything else in memory). It replays the production rules verbatim
(`server/services/nickMemory.ts`: evict at ≥ 500 by confidence ASC then last-reinforced ASC, never a
preference; reinforce +0.05 to 1.0; decay 0.05 per 30 days from the original; prune below 0.15 after
90 days; recall by confidence DESC then last-reinforced DESC). Operator mandate 2026-09-22, item 10:
simulate before changing production.

## The store today (after the first full decay run, 20:59Z)

| measure | value |
|---|---|
| rows | 721 (cap 500; eviction is one-in-one-out, so the count never shrinks) |
| preference rows (never evicted) | 5 |
| "System health" rows (bridge cut in #2520) | 173 |
| confidence | 0.70 ×12 · 0.75 ×87 · 0.80 ×94 · 0.85 ×71 · 0.90 ×181 · 0.95 ×229 · 1.00 ×47 |
| by source | self_healing 173 · revenue_analytics 133 · daily_score 80 · daily_digest 54 · invoice_reconciliation 48 · revenue_reconciliation 42 · shopdriver_mirror 42 · auto_analysis 37 · intelligence_autopilot 20 · vip_detection 17 |
| inflow (rows created in the last 30 d; evicted ones invisible, so a lower bound) | 207 = 6.9/day |
| recall top-20 today (what `smartRecall`/warm-up see) | health 0 · capacity_analysis 8 · feedback_loop 3 · statenour_commitments 2 · auto_analysis 2 · one each vip_detection, business_model_seed, statenour_pull, daily_score, intelligence_autopilot |
| recall top-50 today | auto_analysis 15 · capacity_analysis 12 · vip_detection 5 · feedback_loop 3 · daily_score 3 · intelligence_autopilot 3 |

Before the decay run (census 20:23Z) the distribution was 0.85 ×5 · 0.90 ×197 · 0.95 ×209 ·
1.00 ×310; the #2504 page-walk aged 428 rows in its first live pass and moved 263 rows off 1.0.

Inflow by source (entry confidence in brackets): shopdriver_mirror 0.90/day (0.9) ·
revenue_analytics 0.90 (0.95) · daily_digest 0.87 (0.9) · invoice_reconciliation 0.80 (0.9) ·
revenue_reconciliation 0.77 (0.95) · auto_analysis 0.60 (0.7) · intelligence_autopilot 0.47 (0.85) ·
daily_score 0.43 (0.95) · vip_detection 0.20 (0.9) · statenour_pull 0.17 (0.8) · statenour_alerts
0.07 (0.7) · accuracy_check 0.03 (0.7) · service_mix_analysis 0.03 (0.8). `self_healing` set to 0
(bridge cut).

## Thirty simulated days, seed 7

| policy | prepared | size | inserted | refused | new rows surviving | evicted | original rows lost | median age of evicted (d) | evicted by source | at 1.0 | recall top-50 by source | health left |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P0 current | — | 721 | 191 | 0 | 166 of 191 | 191 | 166 | 122 | revenue_analytics 53 · daily_score 51 · auto_analysis 30 · self_healing 15 · service_mix_analysis 9 | 119 | vip_detection 9 · capacity_analysis 8 · accuracy_check 7 · invoice_reconciliation 4 · auto_analysis 4 | 158 |
| P1 admission floor (refuse below the row it would evict) | — | 721 | 164 | **24** | 164 of 164 | 164 | 164 | 131 | daily_score 50 · revenue_analytics 48 · self_healing 15 · auto_analysis 10 · daily_digest 9 | 117 | vip_detection 10 · accuracy_check 8 · auto_analysis 8 · invoice_reconciliation 5 · statenour_commitments 3 | 158 |
| P2 shrink to 500 once, then current | shrank by 221 | 500 | 196 | 0 | 165 of 196 | 196 | **386** | **33** | revenue_analytics 40 · daily_digest 34 · shopdriver_mirror 28 · auto_analysis 20 · invoice_reconciliation 19 | 82 | auto_analysis 12 · vip_detection 11 · capacity_analysis 6 · intelligence_autopilot 4 · statenour_commitments 3 | 147 |
| P3 LRU (least recently reinforced, confidence ignored) | — | 721 | 187 | 0 | 187 of 187 | 187 | 187 | 126 | revenue_analytics 65 · daily_score 53 · self_healing 15 · service_mix_analysis 12 · auto_analysis 9 | 114 | vip_detection 10 · accuracy_check 8 · capacity_analysis 8 · auto_analysis 4 · statenour_commitments 3 | 158 |
| P4 reinforcement cap 0.95, otherwise current | capped 47 rows | 721 | 191 | 0 | 166 of 191 | 191 | 166 | 122 | same as P0 | **0** | same as P0 | 158 |
| P5 per-source share cap 30 % | — | 721 | 191 | 0 | 166 of 191 | 191 | 166 | 122 | same as P0 (the cap never triggers: no inserting source exceeds 30 %) | 119 | same as P0 | 158 |
| P6 prune the 173 health rows first (the operator script), then current | pruned 173 | 548 | 181 | 0 | 160 of 181 | 181 | 333 | 117 | revenue_analytics 54 · daily_score 52 · auto_analysis 28 · daily_digest 13 · service_mix_analysis 9 | 116 | accuracy_check 8 · vip_detection 8 · capacity_analysis 6 · auto_analysis 6 · invoice_reconciliation 4 | 0 |

## What the table says

- **Under every policy the churn is the analytics writers eating their own past output**: the
  evicted rows are four-month-old `revenue_analytics`, `daily_score`, `auto_analysis` summaries,
  ~190 of them in 30 days, one per insert. That is not knowledge Nick needed; it is yesterday's
  report, which already lives in its own tables.
- **P1 (admission floor) is rejected.** It refuses 24 entries, all at 0.7, all from the
  conversational sources. The rule written and validated in tests earlier today (`remember()` at
  the cap admits only what outranks the row it evicts) would have made the one thing the store is
  for — retaining what the operator says — strictly worse. The script stays parked and will not
  ship.
- **P2 (shrink once to 500) is rejected**: it removes 221 rows in one pass and the median age of
  what it evicts is 33 days — it deletes the young conversational rows first, because they carry
  the lowest confidence.
- **P0, P3, P4, P5 are within noise of each other.** The choice of eviction order changes almost
  nothing because the inflow dominates: whatever enters at 0.95 outranks whatever entered at 0.7.
- **P6 (the prune) is capacity hygiene, not prompt quality**: today's top-20 already has zero
  health rows (the decay run demoted them), so pruning changes the size (721 → 548) and the
  headroom, not what Nick reads. Still worth doing; still the operator's DELETE.

## What would change the outcome (recommendations, none shipped here)

1. **One rolling row per report kind at the writers** — the same fix the health bridge got in
   #2504: `revenue_analytics`, `daily_score`, `daily_digest`, `invoice_reconciliation`,
   `revenue_reconciliation`, `shopdriver_mirror` and `service_mix_analysis` should key on a stable
   identity ("Service mix (30d)") and reinforce/update one row, not insert a dated copy every day.
   Inflow drops from ~7/day to ~1/day and the churn stops. Internal change, no customer surface.
2. **Entry confidence for machine summaries is a policy, not a fact.** A revenue digest entering at
   0.95 outranks an operator statement at 0.7 forever. Whether summaries should enter at 0.8 (below
   which conversational knowledge cannot compete today) is the operator's call — it changes what
   Nick forgets (mandate item 11: confidence stays confidence; this is about who sets it).
3. **`recall()` is source-blind.** The prompt asks for knowledge about the operator and the shop;
   the top-50 today is 27 rows of `auto_analysis` + `capacity_analysis`. A source-aware or
   type-aware recall (prefer lessons/preferences/customer over machine `pattern` rows) is a
   retrieval change — auto-propose + shadow tier under the mandate's permission model, measured
   with a counterfactual replay (item 9) before it is enforced.

## Limits of the simulation

The inflow is a lower bound (rows evicted within the window are invisible). Reinforcement is
modelled per row at its historical rate (`uses − 1` over age), never for health rows. Decay runs
once per simulated day; production runs it every hourly pass. One seed (7), 30 days; the ordering
of policies did not change across seeds 1–3 in a spot check. Nothing here touched the database.
