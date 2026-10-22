# Insight engines: built vs working (2026-10-22)

Read-only audit of the 15 "insight" engines in StateNour, asked for by Nour on 2026-10-21 ("make my
assistant more insightful, the brain more organized, diagnose blind spots"). Every production number
below comes from SELECT-only queries against Neon (project `spring-art-47050555`, default branch) run
on 2026-10-22 between 02:30 and 03:30 UTC. Code references are against `origin/main` 8448c16a9.

No personal content is quoted here on purpose: the contradiction and blind-spot rows describe Nour's
private life. Only counts, categories and shapes appear.

## Answer first

1. **The best insight Nick produces never reaches Nour.** The nightly thinking engine writes
   "you said X, the record shows Y" rows to the `contradictions` table: 631 ever, 52 in the last 14
   days, 76 open now. All 555 closed ones were closed by the 30-day auto-expiry. Zero were closed by
   Nour. Chat, the morning brief and every page read a *different*, empty contradiction source.
2. **The chat "Contradiction Alert" and the contradiction nudge read an empty table.** The
   contradiction surfacer has written 0 `BrainMemory(category="contradiction")` rows, ever. Its
   chat injector would also need cosine >= 0.7 to fire; in this embedding space the best match for a
   recent chat message against 40 analysis-style memories has p95 0.482 and max 0.576 (measured below).
3. **Blind spots are 93% duplicates.** 208 of 224 live `blind_spot` rows have a near-twin
   (cosine distance < 0.05) in the same category. Most are copies minted on 2026-08-16 before the
   2026-08-22 key fix, they never expire, and `blind_spot` is in the recall whitelist. In practice
   recall stopped picking them: 12 of the 216 stale rows were ever recalled, the last on 2026-09-06.
4. **28 of 29 decision replays are past their review date** (oldest due 2026-04-25) and none was
   ever reviewed. 229 `decision_log` memories carry no review date at all. No new replay since 09-28.
5. **59% of live brain rows are telemetry, not memories.** 25,922 of 43,806 live rows sit in the
   repo's own telemetry denylist (`lib/brain/embedding-policy.ts`: graph edges, XP events, drift
   scores, judge rows). Of the 17,884 rows that are memories, 13,516 (76%) were never seen again
   after they were written.

## Engine table

Classification vocabulary from `NOUR-COMMAND.md`. "14d" = 2026-10-08 to 2026-10-22.
Cron receipts are `cron_job_logs` rows (`status IN (success, partial)` counted as ran).

| # | Engine | Caller (scheduled or called) | Ran in 14d, and output | Reaches Nour? | Class |
|---|---|---|---|---|---|
| 1 | `lib/brain/blind-spot-detector.ts` + `blind-spot-identity.ts` | `app/api/cron/brain-intelligence/route.ts:189` (folded into mega-evening); also `getBlindSpots` tool (`lib/ai/tools/brain.ts`), `lib/services/chat-lane-check.ts:113` | brain-intelligence 14 success. `blind_spot`: 5 new, 224 live, 208/224 near-duplicates; content is a mirror of overdue tasks/commitments | Recall whitelist (`lib/brain/memory-recall.ts:103`), Discover tab (5 verdicts ever), tool on demand. The nudge source labelled `blind_spot` reads `hq_pin_candidate`, which has no writer and 0 rows | LIVE + UNPROVEN, polluted |
| 2 | `lib/brain/contradiction-surfacer.ts` | `lib/brain/importance-scorer.ts:311` on decision/preference/commitment turns; `lib/services/brain/save.ts:383`; `memory-contradiction-shadow.ts` | 0 `contradiction` rows ever (all-time count) | Readers exist (chat injector, nudge count, narrator, journal, operator brief) but all read an empty set | BROKEN (wired, never produced). STRONG INFERENCE on cause: input starvation (its own 2026-08-06 note, `contradiction-surfacer.ts:274`), and since 2026-09-22 its only input category `chat_importance` is on the embedding denylist (44 of 55 live rows unembedded), so the neighbour search at `:268` cannot return an eligible row |
| 3 | `lib/brain/counter-intuitive.ts` | brain-intelligence `:173` | 0 new in 14d; 3 live of 69 ever; last created 2026-09-26 | Recall whitelist; Discover tab (1 verdict ever) | LIVE + UNPROVEN (runs, yields ~0) |
| 4 | `lib/brain/discoveries.ts` + `components/brain/discover-tab.tsx` | Reader only: `trpc.brain.discoveries`, first tab of `/brain` | n/a (reader) | Page. 8 verdicts ever across its 4 source categories | BUILT + WIRED, low use |
| 5 | `lib/brain/wisdom-distiller.ts` | brain-intelligence `:181` | `wisdom`: 50 new, 282 live, 2/282 near-duplicates | Contextual recall in every chat; morning brief wisdom-of-the-day (`lib/services/morning-brief.ts:602`); brain-dump wisdom pill | LIVE (reaches him; usefulness unmeasured) |
| 6 | `lib/brain/thinking-engine.ts` | `app/api/cron/think` (mega-evening, detached) | 14 success. `contradictions` 52 new / 76 open; `causal_chains` 16 new; identity snapshots 14 | Counts only (`learning-velocity.ts:204`), 3 business rows in `pipeline-controller.ts:578`. Never in chat, brief or a list he can read. 555/555 closures were the 30-day auto-expiry | BUILT + UNWIRED (the strongest engine) |
| 7 | `lib/brain/memory-consolidation.ts` | `app/api/cron/consolidate` (mega-evening) | 13 success, 1 interrupted (10-21). Merge, prune, promote, edges, auto-expire contradictions | Maintenance, not shown. The cron description's `consolidated_belief` rows do not exist (0 rows) | LIVE (maintenance) |
| 8 | `lib/brain/cross-system-nudge.ts` + `components/brain/nudge-panel.tsx` | Computed on read: chat nudges block (`lib/services/chat/brain-context.ts:371`), Memory tab | Of 11 sources, 7 have no live input: contradiction (0 rows), `hq_pin_candidate` (0 ever), `decision_drift` (0), `belief_refresh_report` (0), `nudge_pin_hygiene` (0), `correlation_alert` (last 07-27, outside its 7-day window), `prediction_streak` (all deleted) | Chat + Memory tab, but only identity axes, ghost accuracy and skills feed it | PARTIAL |
| 9 | `lib/brain/insight-meta.ts` | No importer anywhere | n/a | No | ORPHANED |
| 10 | `lib/ultron/situation-synthesizer.ts` + `lib/services/ultron-situation.ts` | `app/api/ultron/situation`, `trpc.operator.situation` | On read only | `SituationCard` is rendered by no page | BUILT + UNWIRED |
| 11 | `lib/intelligence/compose-daily-brief.ts` | Only the `triggerBrief` Nick tool (`lib/ai/tools/tasks.ts:1179`); the scheduled daily/weekly briefs were stopped on Nour's decision 2026-10-18 | `briefing_logs` daily: 13 in 14d, last 10-19 | When he asks | LIVE on demand |
| 12 | `lib/services/pulse-digest.ts` | `app/api/ultron/pulse-digest`, `trpc.brain.pulseDigest` (command palette) | On read only | Command palette | BUILT + WIRED, use UNKNOWN |
| 13 | `lib/services/brain-insights.ts` | `app/api/brain/insights`, `trpc.brain.insights` | On read only | `BrainInsightsPanel` in the Memory tab | BUILT + WIRED, use UNKNOWN |
| 14 | `lib/brain/camera-intelligence.ts` | Nick tool (`lib/ai/tools/business.ts:49`), agent action | On demand; 0 `camera_alert` rows | When he asks | LIVE on demand, use UNKNOWN |
| 15 | `app/api/cron/brain-intelligence` | mega-evening fan-out | 14 success. Sub-engines: `hidden_correlation` 1 new / 2 live, `teaching_moment` 1 new / 1 live, `learning_journal` 14 new, predictions scored | Through 1, 3, 5 above | LIVE, most sub-engines yield ~0 |

Not an engine but checked because the brief named it: the morning brief (`operator-morning-brief`,
14 success) carries anticipated questions, drift, shop revenue, failed crons, wellbeing and one
wisdom line. It carries no blind spot, contradiction or discovery.

## Duplicates (same job, more than one engine)

1. **Contradictions, three ways.** `contradiction-surfacer` (BrainMemory, empty), thinking-engine L7
   (`contradictions` table, live, unread), and `wisdom_contradiction` from the wisdom distiller. One
   job: "something he said conflicts with something else". Only the table one produces.
2. **"What needs attention", seven surfaces.** blind spots, nudges, the situation synthesizer,
   discoveries, the pulse digest, brain insights and the operator brief each rank attention items
   from overlapping reads. Two of them (situation, nudges' dead sources) have no live input or no page.
3. **Four nightly miners over the same window.** counter-intuitive, correlation-finder,
   teaching-moments and wisdom-distiller all read recent BrainMemory with an LLM each night; three
   of the four produced 0 to 1 rows in 14 days.

## Brain organization facts

| Fact | Value |
|---|---|
| Rows, all | 62,792 |
| Live (not deleted, not expired, not superseded) | 43,806 |
| Telemetry rows among live (the 17 categories in `TELEMETRY_CATEGORIES`, `lib/brain/embedding-policy.ts`) | 25,922 (59%) |
| Live memory rows (the rest) | 17,884 |
| ...never seen again after being written (`seen_count <= 1`, `last_seen` at creation) | 13,516 (76%) |
| ...not seen in 30 days | 15,182 (85%) |
| ...without a 1536-dim vector | 13 (0.07%) |

Top 15 live categories: `semantic_edge` 18,445 · `archive_document` 7,053 (none new since 08-14) ·
`industry_intel` 4,745 · `mastery_xp_event` 2,879 · `journal_brain_take` 1,641 · `persona_drift`
1,289 · `insight` 1,183 · `nick_quality` 915 · `reply_judgment` 838 · `memory_gateway_shadow` 640 ·
`nick_advice` 507 · `data_source_probe` 384 · `concern` 287 · `wisdom` 282 · `decision_log` 229.

Near-duplicate rate (nearest neighbour in the same category, pgvector cosine distance on
`embedding_vec_1536`; all live rows of each category, not a sample): `blind_spot` 208/224 under 0.05 ·
`insight` 28/1,183 under 0.05 and 60 under 0.10 · `wisdom` 2/282 · `prediction_lesson` 0/186 (11 under
0.10) · `decision_log` 0/229 · `conversation_summary` 0/171.

Missing embeddings: 13 of 17,884 live memory rows have no vector (the older gauge read 18 of
17,721; same denominator, same picture). Telemetry categories are unembedded by policy. One gap
found: `contradiction_injection_log`, the chat injector's dedupe marker, is not on the telemetry
denylist, so its rows would be embedded and recallable once it starts writing (fixed in the first build).

### How recall picks memories today

Two lanes run in parallel inside a 3-second budget each (`lib/services/chat/brain-context.ts`):
the contextual lane (semantic match, plus 0.15 x exponential recency decay, category boosts and a
wisdom freshness decay, `lib/brain/contextual-recall.ts`) and the hybrid lane (pgvector KNN plus
full-text plus exact identifiers, restricted to `CONTEXT_CATEGORIES`, `lib/brain/memory-recall.ts`).
Since 2026-10-17 the evidence-pack arbiter (`NICK_RECALL_ARBITER`) fuses both with a validity filter
and one rerank. The block reranker then drops non-critical blocks under 0.12 similarity to the turn.
Freshness is already weighted; what is missing is a way to keep stale mechanical rows (the August
blind-spot copies) out of the candidate set.

## Calibration measurement used by the first build

Best cosine similarity of each of the 250 most recent `chat_message` vectors against 40 recent
`blind_spot`/`insight` vectors (analysis-style text, the closest register to a contradiction row):
p50 0.387 · p80 0.443 · p90 0.459 · p95 0.482 · max 0.576. A 0.7 bar never fires in this space.

## Method and limits

- All reads were single SELECT statements through the Neon MCP `run_sql` tool. No writes.
- "Reaches Nour" is traced in code; whether he *opened* a page is UNKNOWN (no page-view read was made).
- Usefulness of anything that reaches him is UNMEASURED; only the Discover tab records verdicts.
- `last_seen` measures attention by recall lanes that touch it, so "never seen again" is a lower
  bound on use, not proof of uselessness.
