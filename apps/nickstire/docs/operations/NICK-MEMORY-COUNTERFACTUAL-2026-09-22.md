# Nick memory · counterfactual diagnostic · 2026-09-22

**Read-only measurement of which memories can reach Nick's answers at all, and what
would change if each were absent.** Instrument: `pnpm diag:memory-counterfactual`
(`scripts/diagnostics/memory-counterfactual.mjs`, run through `railway run` against the
live store at ~23:35Z, after the 173 health rows were pruned). Operator mandate item 9.

## The answer

**Nine of the ten memories Nick reads on every turn are writer noise.** 498 of the 548
rows in the store cannot influence any answer, whatever they say. The ranking is not the
lever; the writers are, and four of them are now guarded (PR: memory-prompt-junk).

## How a memory reaches the prompt (read from `server/services/nickMemory.ts`)

| Path | Rule | Rows it can ever pick |
|---|---|---|
| `getWarmupContext()` — every turn | `recall(limit 15)` = top 15 by confidence DESC, then lastReinforced DESC; re-sorted by **confidence × uses**; first 10 injected. If non-empty, `getMemoryContext()` is never consulted (`routers/nick/intelligence.ts`). | 10 |
| `smartRecall(query, 5)` — per query | top 50 by the same order, scored keywordOverlap×3 + confidence×2 + uses×0.5 + recency×2; first 5. | 50 |

A row outside the top 50 by confidence is unreachable for every query.

## What the prompt held (548 rows, 4 identity rows)

| # | type · confidence · uses · source | content |
|---|---|---|
| 1 | insight · 100% · **4,904** · statenour_pull | `[statenour] Nick AI has 30 learned memories` |
| 2 | lesson · 100% · **2,517** · feedback_loop | `Alert "proactive" was unknown. Outcome unknown.` |
| 3 | preference · 100% · 2,224 · business_model_seed | `BUSINESS MODEL: Nick's Tire & Auto is FIRST COME FIRST SERVE (FCFS)…` — **the one real memory** |
| 4 | preference · 100% · 392 · statenour_commitments | `[statenour-commitment]  — deadline: tomorrow, status: active` (no text) |
| 5 | preference · 100% · 392 · statenour_commitments | `[statenour-commitment]  — deadline: today, status: active` (no text) |
| 6 | lesson · 100% · 147 · feedback_loop | `Alert "slow_day_push" was unknown. Outcome unknown.` |
| 7-10 | pattern · 100% · 68-77 · capacity_analysis | `Bay utilization at 20:00 / 18:00 / 16:00 / 8:00: 0% (0/0 bays, 0 techs). FULL — consider expanding hours.` |

`uses` is a write counter: a content-hash hit adds one and +0.05 confidence, so a cron
that re-emits the same text every pass climbs to 1.0 and thousands of uses. **Repetition,
not evidence, decides the prompt.** A reading with no bays configured labelled itself
FULL; an alert whose outcome was never known became a "lesson"; the bridge's own
memory-count summary became the most-reinforced fact Nick knows.

## Reach and counterfactual

| Measure | Value |
|---|---|
| Rows that reach the prompt on every turn | 10 |
| Rows reachable only through `smartRecall`'s keyword score | 40 |
| Rows that cannot influence any answer | **498 of 548** |
| Rows whose removal changes the injected set | 10 (the set itself; none outside it move the window) |
| Utility of the 10th row (confidence × uses) | 68.0 |
| Rows one reinforcement (+0.05, +1 use) away from entering | 6 |

Per writer (remove every row that source produced):

| Source | Rows | In prompt | Removing it evicts | Admits |
|---|---|---|---|---|
| capacity_analysis | 14 | 4 | 4 | feedback_loop, vip_detection ×2, daily_score |
| feedback_loop | 5 | 2 | 2 | capacity_analysis ×2 |
| statenour_commitments | 4 | 2 | 2 | capacity_analysis ×2 |
| statenour_pull | 11 | 1 | 1 | capacity_analysis |
| business_model_seed | 1 | 1 | 1 | capacity_analysis |
| revenue_analytics | 132 | 0 | 0 | — |
| daily_score | 78 | 0 | 0 | — |
| daily_digest / invoice_reconciliation / revenue_reconciliation / shopdriver_mirror / auto_analysis | 54 / 48 / 42 / 42 / 38 | 0 | 0 | — |

The 394 analytics summaries (revenue, digest, reconciliation) never reach the prompt:
they enter at 0.7-0.8 and are never reinforced, so the 1.0 rows above outrank them
forever. The identity mechanism (#2529) stops NEW rows of the keyed writers from
multiplying, but does not touch the legacy rows already at 1.0.

## What changed (this PR) and what is the operator's

1. **Guards on the four writers** — `server/services/memoryWriterGuards.ts`:
   no bays configured → no reading; unknown outcome → no lesson; empty text or a
   statement about Nick's own memory store → not remembered. Each is unit-tested on the
   live offender with a positive control. No new row of these shapes can be written.
2. **`scripts/maintenance/prune-junk-memories.mjs`** — dry-run by default, count-verified
   backup table, deletes exactly those four shapes already in the store (they decay from
   1.0 by 0.05 per 30 days and would otherwise hold their seats for over a year).
   **Operator-run** — a production DELETE is never an agent-initiative action:

   ```
   railway run -s MAINnicks-tire-auto -- node scripts/maintenance/prune-junk-memories.mjs
   railway run -s MAINnicks-tire-auto -- node scripts/maintenance/prune-junk-memories.mjs --execute
   ```

3. **The ranking is measured, not changed** (item 11: confidence stays confidence). The
   diagnostic also prints what the prompt would hold if the confidence × uses re-sort
   were dropped (recall's own order: confidence, then most recently reinforced) and if
   uses counted logarithmically. Run it after the prune and decide from the printed sets,
   not from this document.

## What this diagnostic is not

It measures **reachability**: whether a memory can enter the prompt. It does not measure
whether an injected memory changes Nick's wording — that counterfactual needs the same
prompts answered with and without each memory through the live model, which is spend
and is the next step once the prompt holds memories worth testing.

## Reproduce

```
railway run -s MAINnicks-tire-auto -- node scripts/diagnostics/memory-counterfactual.mjs
railway run -s MAINnicks-tire-auto -- node scripts/diagnostics/memory-counterfactual.mjs --json
```
