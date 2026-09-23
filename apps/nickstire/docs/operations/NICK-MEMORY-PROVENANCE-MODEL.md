# Nick's memory · the smallest provenance model that answers the questions we actually ask (2026-09-22)

**Answer first.** Seven fields on the memory row's JSON, no new table, no graph: `source`,
`scope`, `authority`, `effectiveAt`, `supersededBy`, `lastVerifiedAt`, `retentionClass`. Four of
them already exist under other names; the other three are one write each at the writer that knows
the answer. Operator mandate 2026-09-22 item 8 (smallest provenance model, no graph DB) and item 11
(confidence stays confidence — none of these fields is a score).

## The questions a reader asks of a memory, and the field that answers each

| question | field | today | proposal |
|---|---|---|---|
| Who said this? | `source` | exists (`daily_score`, `statenour_pull`, `chat`, …) | keep; already the join key for every census |
| About what? | `scope` | implicit in `type` (`customer` / `preference` / `pattern` / `insight` / `lesson`) | add `scope: "shop" \| "operator" \| "customer:<id>" \| "system"` — the eviction simulation showed the store cannot tell a shop report from a fact about the operator; `type` conflates content shape with subject |
| On whose authority? | `authority` | implicit in `source` | add `authority: "operator" \| "measured" \| "inferred" \| "third_party"` — an operator statement outranks an autopilot inference at equal confidence; today only confidence orders them, which is the scalar collapse item 11 warns about |
| Since when is it true? | `effectiveAt` | `createdAt` (when it was written) | add for rolling rows: the report's own period (`revenue_analytics_weekly` → the week it covers); for facts, `createdAt` is fine |
| Is there a newer version? | `supersededBy` | none — a re-issued report used to be a NEW row; with `identity` (#2529) it refreshes in place | for identity rows, in-place refresh is supersession; for content-keyed facts, add `supersededBy: <key>` when a writer knowingly replaces one (the contradiction detector already finds candidates and does nothing with them) |
| When was it last confirmed? | `lastVerifiedAt` | `lastReinforced` (a re-sight, not a verification) | rename in place: a reinforcement IS the only verification the store has; a rolling refresh sets it too |
| How long should it live? | `retentionClass` | one rule for all (decay 0.05/30 d, prune < 0.15 after 90 d, preferences immune) | add `retentionClass: "durable" \| "rolling" \| "episodic"` — durable = operator preferences and lessons (immune), rolling = identity rows (never pruned, always refreshed), episodic = event memories (`learnFromEvent`), which should expire on a short clock instead of competing with facts at the cap |

## Why these seven and not more

- The simulation showed the store's failure is at ADMISSION and RANKING, not eviction: machine
  reports at 0.95 outrank operator facts at 0.7. `authority` + `scope` let `recall()` ask for
  "operator-authority facts about the shop" instead of "highest confidence anything", without
  touching the confidence number.
- `retentionClass` replaces the one-size decay curve with three, and it is a label the writer
  already knows at write time (a health issue is episodic; a preference is durable).
- `supersededBy` is the whole supersession model. No versions table: the newest row wins, the old
  row points forward, decay takes the old one out.
- Nothing here is a score. Confidence keeps meaning "how sure the writer was".

## What is NOT proposed

- No graph database, no embeddings table, no separate provenance table (item 8).
- No re-scoring or "utility" scalar (item 11).
- No migration: the fields ride in the existing JSON `value`; readers default a missing field to
  today's behaviour (`scope` unknown → treated as today, `retentionClass` missing → the current
  curve).

## Order of work, if the operator wants it

1. Writers stamp `authority` and `retentionClass` (ten analytics writers → `measured`/`rolling`;
   `learnFromEvent` → `measured`/`episodic`; statenour pulls → `inferred`/`durable`; chat lessons
   → `operator`/`durable`). One line per writer.
2. `decayMemories` reads `retentionClass`: episodic rows prune at 14 days untouched; rolling rows
   never prune; durable rows keep today's curve.
3. `recall()` accepts `{ authority?, scope? }` and the chat prompt asks for operator-authority
   rows first — measured with the counterfactual replay (item 9) before it is the default.
4. Only then `supersededBy`, driven by the contradiction detector's existing candidates.

Each step is a small PR with a test; none changes what a customer sees.
