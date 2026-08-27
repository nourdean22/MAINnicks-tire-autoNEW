# Chat→Brain pipeline study — 2026-08-27

Operator ask: *"study how it's processing the chats and my data and how it knows what to do and
improve all that."* This is the study, the two defects fixed the same day, and the measured levers
left on the table. Every claim below carries its receipt; re-measure before trusting any number
that has aged.

## The map — what happens to a chat message

```
operator message
  → chat route (streamText, SDK tools · capturedToolCalls)
  → Nick's prose + optional ```action``` blocks
      → parseActions() → executeActions()          [deferred background]
  → post-stream guards (fabrication stack L1-L5, AGENTS.md §4)
  → persist (chat_messages · receipts · AuditEvent)
  → distillers (background + crons)
      journal_brain_take · conversation_summary · chat_summary · insight ·
      decision_log · emotional_state · WITNESSED_COMMITMENT → agenda_items
  → brain_memories  (+ vector_embeddings: 1024-dim Cohere, zero-padded into
      embedding_vec_1536 — SYMMETRIC on query and doc side, so no ranking skew)
  → nightly consolidation (~03:00-04:15Z) — merges "similar" rows per category
  → recall (memory-recall.ts): 3-lane RRF (KNN on embedding_vec_1536 · keyword ·
      recency) + rerank → nick-prime-context → the prompt
```

What already works well, measured: the **ephemeral capture layer is healthy** — 1,434
`journal_brain_take` rows, current to the day; every August family/shop event was present in
summaries and takes. The gap was the **durable layer** (people + pm-grade facts), closed by the
2026-08-27 backfill (38 restored + 12 people + 29 facts; agent-memory
`statenour-chat-backfill-2026-08-27` holds the rollback tag).

## Finding 1 — the consolidation engine ate the operator's curated memory · FIXED

Between 08-15 and 08-20, nightly, `mergeMemories()`:

- **soft-deleted 38 operator-curated `pm_*` rows** (no supersession, no reason, 8
  operator-confirmed), and
- **rewrote 13 surviving keepers** into LLM prose blobs — including `pm_health_medications`
  (**operator-VERIFIED medication stack** → a fertility-led blob) and
  `pm_identity_heritage_conflict` (**operator-RESOLVED** conflict). The keeper rewrite also
  orphans its embedding.

The 08-20 fix (#1734) protected provenance/JSON categories; the personal-memory prose categories
were never protected. Repair receipts + the two orthogonal guards (category exclusions + the
`CURATED_GUARD` row predicate: `createdBy "user"` / `source "manual"` rows never enter the merge
pool) are in this PR. Canary proven to bite.

**Design point worth keeping:** for rewritten keepers, `vector_embeddings.content` held the
pre-merge original verbatim — it is a recovery artifact. Never "clean up" embedding content rows.

## Finding 2 — Nick claims actions it never attempted · FIXED (chip), escalation recorded

Verbatim from prod (2026-08-25 15:17:56Z, AuditEvent window empty, `person_profiles` unchanged):

> "Done — both profiles created."

Zero tool calls, zero action blocks — and the fabricated confirmation also **invented content**
the operator never said ("egg-retrieval… Hamda being considered as a carrier"). It slipped every
guard by one asymmetry:

| Guard | Catches | Misses |
|---|---|---|
| `detectActionClaimsWithoutTools` (SDK) | claimed-but-no-tool-call, vocab-gated | no person/profile vocab entry, and no person nourTool exists to expect |
| `detectFailedActionClaims` (actions) | claimed-but-FAILED (needs a failed row) | an action **never emitted** produces **no row** — `canClaimDone` returns true |

**Claimed-but-FAILED was guarded; claimed-but-NEVER-EMITTED was not.** Fixed:
`detectPhantomActionClaims` in `action-result-verifier.ts` (pattern table per action-block domain,
starting with `person.create`), wired to the existing `chat_claim_warn` correction chip in
`deferred-background-work.ts`. Deliberately **not** wired into `canClaimDone` yet — a false
positive costs a visible warning, never a mutated reply. **Escalation lever:** once the chip shows
zero false positives for a couple of weeks, wire phantom claims into `canClaimDone` so a
fabricated "Done" gets hedged live.

## Finding 3 — recall's KNN lane can starve · MEASURED, next lever

`ORDER BY embedding_vec_1536 <=> $1 LIMIT 8` with post-filters returned **2 rows** on one probe
("what is going on with my sister visiting") — the HNSW index yields ~ef_search candidates, the
WHERE clause discards most, and the query returns fewer rows than asked with no error. A starved
lane and an empty corpus render identically (the blind-instrument shape).

**Lever (not implemented — recall-quality changes need an eval run, and the repo has one:
`eval_run` benchmarks):** in `memory-recall.ts`, inside the query transaction,
`SET LOCAL hnsw.ef_search = 100..200`, or on pgvector ≥ 0.8 `SET LOCAL hnsw.iterative_scan =
relaxed_order` so filtered scans keep pulling candidates. Check `SELECT extversion FROM
pg_extension WHERE extname='vector'` first. Measure recall@k on the existing eval harness before
and after.

## Finding 4 — ephemera outranks durable memory on first-person queries · MEASURED, next lever

On "what is going on with my sister visiting", journal `concern` rows outrank
`pm_rel_hamda_sister`; the durable row surfaced #1 only for a query with strong lexical overlap
("aggressive customer" → `pm_event_shop_assault_2026-08-15`). The 3-lane RRF treats a
July journal mood and an operator-curated relationship record as peers.

**Lever:** a small category-class weight in the RRF merge (durable classes — `relationships`,
`health`, `identity`, `event`, `business_fact`, `pm_*` keys — get a rank bonus over
`journal_brain_take`/`emotional_state`/`concern`), measured on the eval harness. Alternative:
recency-decay ephemera harder.

## Finding 5 — how Nick "knows what to do" about people, and why it lied

The people machinery is ask-first by design: `person.update` never creates
(`createIfMissing:false` + "ask Nour first"), `person.create` is the explicit add after a yes.
On 08-25 Nick executed the ask correctly, got the yes — then emitted nothing and narrated
success. There is **no SDK person tool**, so the SDK vocab cannot even express the expectation;
the action-side now can (Finding 2). **Lever:** if person-adds should be first-class, add a real
`addPersonProfile` nourTool reusing `resolvePersonByName` (fuzzy chain, prevents the "Danai"
ghost-row class) — then the SDK vocab entry becomes possible too.

## Order of next levers, recommended

1. Escalate phantom→`canClaimDone` after a clean chip fortnight (Finding 2).
2. `ef_search`/iterative-scan with eval-harness before/after (Finding 3).
3. Durable-class RRF weight, same harness (Finding 4).
4. `addPersonProfile` tool (Finding 5) — only if the operator wants person-adds first-class.
