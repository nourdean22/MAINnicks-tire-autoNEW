# StateNour Brain Intelligence Upgrade Plan

**Date:** 2026-09-08 · **Inspected `origin/main`:** `2dfa32270` (2026-09-08) · **Author:** Claude (Fable 5.1), this session ·
**Inputs:** three read-only research passes (the live code map, the settled-decision history in
this repo's docs, a fresh external evidence dossier), two read-only production probes run under the
service environment the same day, the operator-pasted "StateNour Brain Intelligence Upgrade Plan"
(checked claim by claim, §3), and the program doc `2026-09-07-statenour-quality-power-program.md`.

> **Read this first.** Most of what a generic "upgrade your RAG" plan proposes is already here, and
> a large part of what *is* missing is not retrieval at all. The two facts that shape everything
> below were measured today, not inferred: (1) **0 of 40,889 live memories carry a validity window
> or a supersession pointer** — the temporal machinery shipped in code and has never been fed;
> (2) **19% of the live personal rows (2,460 of 12,924) have no embedding** — they are invisible to
> every dense lane at any threshold and only the lexical lane can still see them.

---

## 1 · Executive verdict

The Brain does not need another retrieval framework, a graph database, a second memory store, or
an LLM query rewriter on every turn. It needs to become **one governed pipeline** with a measured
contract at each stage: what enters (admission + provenance), what is believed now versus then
(validity at write), what is retrieved (one evidence pack instead of two lanes that never meet),
what is put in front of the model (a token budget allocated by utility, best evidence at the ends),
which capability is reachable (a measured tool funnel), and what the answer rested on (a claim
receipt). Every one of those stages exists in some form today; none of them is closed.

The ranked stack (§5) is ordered by *expected intelligence gain × reliability × leverage*, with the
evidence grade beside each. Waves 0–1 shipped in the PR that carries this document (§11). Waves 2–5
are specified to file-and-function level so a coding agent can implement them without inventing
architecture. The external techniques the pasted plan and the dossier name are dispositioned in §8
with the register's own vocabulary; none of the named frameworks beats the incumbent on the
evidence, and several are unavailable on Neon at all.

## 2 · Evidence boundary

IMPLEMENTED ≠ TESTED ≠ MERGED ≠ DEPLOYED ≠ RUNTIME-VERIFIED. What this document is allowed to claim:

| Claim class | Basis | Examples |
|---|---|---|
| **Runtime-verified today** | two SELECT-only probes under `railway run --service statenour-web` (2026-09-08 ~13:00Z) | row counts, index list, validity-column emptiness, embedding coverage, source/category distribution |
| **Source-verified** | files read on `origin/main` `2dfa32270` | every `file:line` in §4 |
| **Measured, dated** | `docs/RETRIEVAL-BASELINE-2026-08-27.md`, `RECONCILIATION.md` | the 28-case corpus numbers, refuted levers |
| **External evidence** | primary sources with dates in the dossier (§8, §9) | effect sizes; graded strong / moderate / weak |
| **Not verified** | — | which `NICK_*` flags are overridden in prod (stored per-user in `UserPreference`, not probed); whether GC orphans vector rows; the 28-case corpus content (gitignored) |

Production numbers used below (2026-09-08): live `brain_memories` **40,889** · `superseded_by_id` set
**0** · `valid_from` set **0** · `valid_until` set **0** · `memory_gateway_shadow` receipts **944** ·
`contradiction` rows **0** · `vector_embeddings` **95,498** (1536-column **95,434**, 1024-column
**95,459**; `sourceType=brain_memory` **89,407**) · live rows outside graph-edge / shadow / archive /
xp categories **12,924**, of which **10,464** have a `brain_memory` embedding row · top sources
`lib:semantic-link` 18,438 · `manual` 9,789 · `mastery-xp` 2,098 · `journal_brain` 1,488 · top
categories `semantic_edge` 18,434 · `archive_document` 7,058 · `industry_intel` 2,843 · rows whose
source is `user_save` / `operator` / `owner` / `pin:*` **3** · `brain_memories_content_fts_idx` GIN
**present** · HNSW on both vector columns **present** (partial, `IS NOT NULL`).

## 3 · The pasted plan, checked

The operator-pasted plan is **largely accurate** on architecture and right in its central thesis
(governance over frameworks). Corrections that change priorities:

| Pasted claim | Verdict | Evidence |
|---|---|---|
| Temporal / as-of recall **LIVE** | **Code-live, data-empty.** | 0 rows with `valid_from`/`valid_until`; `NICK_MEMORY_SUPERSESSION` default-off (`memory-manager.ts:132`); 0 `contradiction` rows so cleanup never stamped one |
| Supersession / current-vs-historical **LIVE** | **BUILT-UNWIRED** at write; readers live | same probe; `validityWhere()` reads columns nobody writes |
| Query decomposition / rewrite **PARTIAL** | **ABSENT** | grep-confirmed; `deriveFastTopics` is unigram extraction, not a rewrite (`contextual-recall.ts:230`) |
| Memory commit gateway **LIVE, coverage weak** | Confirmed, and sharper: it is a *rewrite arbiter* — `{decision:"add"}` unconditionally when no row exists | `memory-commit-gateway.ts:147`; 107 files call `brainMemory.create/upsert` directly (`lib`+`app`+`features`+`hooks`) |
| Evidence mapper accepts only `user`/`manual`/`skill_ingestion` | Confirmed; today's blast radius is **3 rows**, the forward risk is every `/save` (`user_save` default, `save.ts:305`) and every pin (`pins.ts:184`) | fixed in Wave 1 (§11) |
| Reranking **LIVE** | Wired in `contextual-recall.ts:947` only; `memory-recall.ts` (the lane that measured 86% hit@5) is not reranked | `rerank.ts` (Cohere first, BGE opt-in, identity fallback) |
| Contextual document retrieval **BUILT / FLAGGED**, `searchDocuments` dense-only | Confirmed | `document-ingest.ts:106` (flag `NICK_CONTEXTUAL_RETRIEVAL`), `:155` (`knnSearch` only) |
| Tool budget 24 of 181 | Confirmed | `chat-mode.ts:552`, `catalog.ts` (181 entries) |
| "Novelty recall live by default despite no eval win" | Confirmed | `feature-flags.ts:180-185` `defaultOn: true` since 2026-08-16 "on operator instruction" |
| Direct-writer count "should not reuse the historical count" | Fresh count: **107 files** | `tests/repo/brain-memory-direct-writers.allowlist.json` (frozen today) |
| Not in the pasted plan | **19% of live personal rows unembedded**; **45% of live rows are graph edges stored as memories** (`semantic_edge`); **`data-cleanup` cron paused in prod since 2026-09-01**; **two parallel vector columns** (1024 generic, 1536 chat) | probes; `RECONCILIATION.md`; `pgvector.ts` |

## 4 · Current-state map (five classes)

Paths are under `apps/statenour/`. LIVE means wired into the chat path or a running cron with tests.

### 4.1 LIVE (preserve; improve selectively)
- **Admission decision + shadow receipts** — `lib/brain/memory-commit-gateway.ts:147` `evaluateMemoryCandidate` (noop / update / review_required enforced by default, Phase 1+2), `shadowMemoryCommit` (7-day receipts; 944 in prod). Enforcement point: `lib/brain/memory-manager.ts:280` `remember()`.
- **Two chat recall lanes, every turn, same prompt** — `lib/brain/memory-recall.ts:262` `recallMemoriesForQuery` (main KNN top-30 at `ef_search=80` + exact MATERIALIZED scan over the ~122-row durable-personal partition, RRF k=60; **86% hit@5 / 96% hit@10 / MRR 0.72 / p50 138 ms on n=28**) and `lib/brain/contextual-recall.ts:657` `getContextualMemories` (semantic + FTS `getLexicalMatches:465` + true-ANN `getKnnPoolRows:528` → 300-row pool → `fuseRankings` → trust/recency/CoALA/topic/persona/importance multipliers → Cohere/BGE rerank top-25 → novelty → token trim; **39–46% containment at ~2.0 s**). Assembled by `lib/services/chat/brain-context.ts:214-300`.
- **KNN primitive** — `lib/db/pgvector.ts:219` `knnSearch`: liveness + category exclusion inside the query **before** `ORDER BY … LIMIT` (a measured 25.5%-live post-filter was the prior bug). `ef_search` is set by callers via `vector-tuning.ts withEfSearch` — `memory-recall` asks HIGH_RECALL(80), `contextual-recall`'s KNN lane does not wrap it.
- **Block assembly + budget** — `brain-context.ts:97` `buildBrainContext` (~20 blocks in `Promise.all`, 3 s per block, cosine block-rerank `lib/ai/context-reranker.ts` drop < 0.12, `critical` blocks always kept); `lib/ai/system-prompt.ts:269` `trimPromptToBudget` (58,000 chars; `## ` sections dropped by priority 30 → 1).
- **Tool selection** — `lib/ai/chat-mode.ts pruneTools` cascade (circuit breaker → CORE → ACTION_CORE → exact mention → ~15 keyword families → semantic top-N over `tool_embedding` rows → playbooks → budget 24), `lib/ai/tool-selection-telemetry.ts` (tiers 1–7), read-mode stripping in `lib/ai/capability-registry.ts`, `searchTools`/`invokeTool` recovery.
- **Contradiction loop** — `contradiction-surfacer.ts` (cosine ≥ 0.78 + negation/reversal/antonym), `contradiction-injector.ts` (critical block), `contradiction-cleanup.ts` (stamps supersession on resolution; soft-delete flag-gated). 0 rows in prod today.
- **Consolidation (nightly)** — `memory-consolidation.ts` MERGE/PROMOTE/PRUNE/DISTILL with `CONSOLIDATION_EXCLUDE_CATEGORIES` + `CURATED_GUARD` after the 2026-08-15→20 incident (38 operator rows eaten, 13 rewritten).
- **Provenance in the prompt** — `contextual-recall.ts:160` `provenancePrefix` renders the gateway's evidence class ("you stated" / "receipt" / … / "unclassified"); fencing at every prompt door (#2059/#2062/#2064/#2065).
- **Truth grounding** — `lib/ai/chat/truth-grounding.ts` (entity → live DB state, critical block). `fact-check.ts`, `cliche-detector.ts`, `hallucination-guard.ts` are **re-export shims** to `lib/ai/chat/output-guardian.ts` (regex filler stripping), not semantic verification.
- **Evals** — `lib/brain/recall-eval.ts` (precision@k, full-recall, contradiction-injection, abstention), `scripts/recall-eval.ts` (`pnpm eval:recall`, read-only), 28 hand-labelled cases (gitignored `eval-datasets/recall-corpus.json`), `tests/eval/` 38 LLM-judge scenarios, Langfuse traces + NUMERIC thumb scores (#2193).
- **Observability** — `[brain-recall]` per-stage timings, `brain.recall.avg_distance` SystemMetric, tool-selection funnel, gateway shadow receipts.

### 4.2 BUILT-UNWIRED (finish or delete)
- **Bi-temporal write** — `memory-manager.ts:132 snapshotSupersededVersion` behind `NICK_MEMORY_SUPERSESSION` (default off). Result in prod: **0** rows with any validity column set. The as-of recall (U3, #2198) reads an interval nobody writes.
- **External-content quarantine** — `external-memory-intake.ts:78` routes **Gmail only** through `withGuardian("memory.pin")` → `MemoryInboxItem`; Drive / Calendar / Reviews crons call `remember()` directly (named as an open gap in the module's own header).
- **Contextual document retrieval** — `lib/brain/contextual-retrieval.ts` behind `NICK_CONTEXTUAL_RETRIEVAL`; contextualized text overwrites `text` in the stored chunk; `searchDocuments` has no lexical lane.
- **Braintrust** — `wrapWithBraintrust` has had zero callers since Wave-200 (`docs/UPSTREAMS.md`).

### 4.3 BROKEN or WEAK (measured)
- **Embedding coverage** — 2,460 of 12,924 live personal-ish rows (19%) have no `brain_memory` embedding row → invisible to `memory-recall`, `semanticSearch` and the KNN pool lane. `scripts/drain-brain-embeddings.ts` exists; nothing gauges the gap continuously.
- **Provenance vocabulary** — three exact source names were "operator-stated"; `user_save`, `operator`, `owner`, `pin:*` fell to `weak_inference` (3 rows today, every future `/save`). **Fixed in Wave 1.**
- **Lane duplication** — two lanes feed one prompt with no cross-lane dedupe; nothing measured the overlap until today's instrument (`lib/brain/lane-overlap.ts`).
- **Eval corpus** — n=28 is below every gate the baseline set (≥50 pairs for weighted fusion / episodic split); `harvest:evals` output carries `relevantKeys: []` ("structurally unable to fail", LEARNING-LOOPS-2026-08-28).
- **Novelty term** — live by default without an eval win; the full pipeline could not be scored until the `onRanked` hook (Wave 0) — it can now.
- **Hygiene** — `data-cleanup` cron paused in prod since 2026-09-01 (after the 54,107-row hard-delete incident, #2043 guard); whether GC orphans `vector_embeddings` rows is NOT VERIFIED; `memory_gateway_shadow` rows expire in 7 days by TTL only while the cron is paused.
- **Two vector columns** — `embedding_vec` (1024, generic `semanticSearch`) and `embedding_vec_1536` (chat hot path) are both indexed and both populated (95,459 / 95,434); every embedding is written twice and any lane change must remember which column it reads.

### 4.4 DUPLICATE or OBSOLETE
- `lib/ai/fact-check.ts`, `cliche-detector.ts`, `hallucination-guard.ts`, `output-sanitizer.ts`, `output-critic.ts` — one-line shims to `output-guardian.ts` (naming implies semantic checks that do not exist).
- `lib/ai/domain-routing.ts` → shim to `runtime/chat-classifier.ts` (model routing, not retrieval routing).
- `BrainMemory` as a **graph-edge store**: 18,434 `semantic_edge` rows (source `lib:semantic-link`) — 45% of live rows — sit in the memory table, excluded from recall by category lists. Not wrong, but every "how many memories" number is 2× inflated and every category-exclusion list is load-bearing.
- Old refuted levers (do not re-propose): global `ef_search` / `iterative_scan` (endpoint hit@10 96.4% either way), naive RRF(A+B) fusion (43% < 50%), lexical topic caps (flat), episodic split (+1 case at n=28), BDN-307 prompt trim (refuted by measurement), persona A/B, iterative retrieval loop.

### 4.5 MISSING (genuinely)
- A **universal admission contract** (memory kind, evidence class, lineage, extraction method) — Wave 1 ships the envelope and the ratchet; migration of the 107 writers is incremental.
- **Validity at write** (`valid_from` = event/created time; supersession stamped by the gateway's `update`/`supersede` verdicts) — Wave 2.
- A **retrieval arbiter** (one evidence pack across lanes: union by id, content-identity dedupe, one rerank, validity, diversity) — Wave 2.
- A **query planner** (deterministic classes; the original query is never replaced) — Wave 3.
- A **context budget allocator** with placement rules (utility-per-token, MMR redundancy, best evidence at the ends) and a **context receipt** — Wave 3.
- A **tool funnel** with a budget experiment (24 → 16 → 12 with recovery measured) — Wave 4.
- **Document RAG 2.0** (raw vs contextualized text kept apart; lexical lane over documents; RRF + the existing reranker; a document benchmark) — Wave 5.
- **Derived-memory invalidation** (`derivedFrom` is in the envelope; the propagation job is Wave 6).
- **Brain Eval V2** (LongMemEval-shaped slices, hand labels to n≥50 then n≥150, judge calibration slice, retriever / assembler / generator / tool stages scored separately) — Wave 0 → continuous.

## 5 · Ranked upgrade stack

| # | Upgrade | Gain | Reliability | Leverage | Evidence grade | Wave |
|---|---|---|---|---|---|---|
| 1 | Memory truth spine: operator-source predicate, admission envelope, direct-writer ratchet, writers migrated incrementally | very high | very high | very high | source-verified defect; "invalidate-never-delete + provenance" survives controls (Zep, Engram, tenure study) | **1 (shipped)** → 2 |
| 2 | Embedding coverage: backfill the 2,460 unembedded personal rows, gauge the gap in `/system/health`, alert on regression | high | very high | very high | runtime-verified gap; a row without a vector is absent, not weak | 0 (operator-run backfill) |
| 3 | Validity at write + supersession flip after a shadow check | high | high | high | 0 rows today; as-of recall is data-empty | 2 |
| 4 | Retrieval arbiter (one evidence pack) with lane-overlap telemetry first | very high | high | very high | two lanes, no dedupe; RRF sensitivity (Bruch 2022), weak-lane drag (2025); overlap instrument shipped | 0 (instrument) → 2 |
| 5 | Context budget allocator + placement + context receipt | high | high | very high | lost-in-the-middle reproduced 2023→2026; fewer, higher-similarity items win | 3 |
| 6 | Query planner (deterministic; decomposition only for multi-hop; never replaces the original) | medium-high | high if gated | high | expansions help weak retrievers and harm strong ones; decomposition helps multi-hop only | 3 |
| 7 | Tool funnel + budget experiment | high | high | high | selection degrades past ~30 live tools; retrieval restores it (Anthropic tool search, 2603.20313) | 4 |
| 8 | Document RAG 2.0 (raw/context split, lexical lane, RRF, rerank, benchmark) | medium-high | high | medium | contextual retrieval −49% failed retrievals on documents (Anthropic); no evidence on short rows | 5 |
| 9 | Brain Eval V2 (slices, n≥50 → n≥150, judge calibration) | foundational | very high | very high | ARES ~150 labels/system; n=100 ±10 pp; judges overstate agreement 33–41 pp | 0 → continuous |
| 10 | Derived-memory invalidation | high | high | medium | envelope carries `derivedFrom` since Wave 1 | 6 |
| 11 | Claim receipt (claim → evidence ids, temporal basis, support type) + MiniCheck-class support check | medium-high | high | medium | prompt-only abstention weak; NLI support at 400× lower cost than GPT-4 | 6 |
| 12 | Weighted / convex fusion, ef tuning per lane, episodic split | conditional | medium | low today | gated on n≥50 labelled pairs (baseline's own rule) | after Eval V2 |

## 6 · The upgrades, specified

Each entry: integration points · why · evidence · mechanism · pattern · tests/evals · risk ·
complexity · reversibility · acceptance.

### 6.1 Memory truth spine (Wave 1 — shipped, see §11)
- **Integration:** `lib/brain/memory-commit-gateway.ts` (`isOperatorSource`, `OPERATOR_SOURCE_NAMES`), `memory-manager.ts` (wisdom-gate bypass), `contextual-recall.ts` (freshness decay), `memory-consolidation.ts` (`CURATED_GUARD`), **new** `lib/brain/memory-admission.ts` (`buildAdmissionEnvelope`, `stampAdmission`, `admitMemory`), `lib/services/brain/save.ts` and `lib/services/pins.ts` (stamped), **new** `tests/repo/brain-memory-direct-writers-ratchet.test.ts` + frozen allowlist (107 files).
- **Why:** provenance decides rank, trust, decay, consolidation safety and what the model is told; one exact-match set had made the operator's own statements the weakest class.
- **Mechanism:** one predicate everywhere; every explicit operator write carries `metadata.admission = { memoryKind, evidenceClass, extractionMethod, derivedFrom, evidenceRefs, contentHash, admittedAt }`; a derived memory is capped at `generated_summary` whatever its source string says; a derived memory without lineage is flagged `orphanDerived`.
- **Next (Wave 2):** migrate semantic writers to `admitMemory()` in order of prod volume — `journal_brain` (1,488 rows), `conversation_analysis`, `belief-harvester`, `distillation`, the Drive/Calendar/Reviews intake (through the quarantine door, not around it) — one PR per writer family, each shrinking the allowlist; telemetry writers (`mastery-xp`, `output_critic`, `judge-eval`, `persona_drift`, `tool_embedding`, `semantic_edge`) get the `brain-memory-direct-write:` marker with a one-line reason and stay direct.
- **Acceptance:** zero operator-authored rows in `weak_inference` (probe query in §2, 3 today → 0 after the next `/save`); every new semantic writer is either `admitMemory()` or a declared bypass; the ratchet's allowlist only shrinks; correction and as-of tests stay green.
- **Risk:** low (pure predicate + metadata). **Reversibility:** high.

### 6.2 Embedding coverage (Wave 0, operator-run)
- **Integration:** `scripts/drain-brain-embeddings.ts` (exists), `scripts/probe-brain-recall-coverage.ts` (exists), `/system/health` gauge (new tile: unembedded live personal rows).
- **Why:** 2,460 rows cannot be recalled by any dense lane. The 2026-08-27 baseline reported a "backlog 9" among *recall-eligible* rows — a narrower population than the personal-ish rows the operator actually asks about.
- **Mechanism:** backfill through the existing drain (Cohere `embed-v4.0`, 1024 zero-padded into 1536, symmetric on query and doc); then a nightly gauge with a `SystemMetric` and a health tile that says the number, never "ok".
- **Tests:** the gauge's own positive control (a planted unembedded row shows up); the tile renders the count.
- **Acceptance:** unembedded personal-ish rows < 1% and the gauge visible; `pnpm eval:recall` hybrid lane not worse.
- **Risk:** low; cost is one embedding call per row. **The backfill writes production rows — it is an operator-run command, not agent initiative:**
  `railway run --service statenour-web -- pnpm tsx scripts/drain-brain-embeddings.ts` after reading its `--dry-run` proof.

### 6.3 Validity at write + supersession (Wave 2)
- **Integration:** `memory-manager.ts remember()` (set `validFrom = now` on `add`; on `update`/`supersede` verdicts stamp the old row's `validUntil` and `supersededById` when `NICK_MEMORY_SUPERSESSION` is on), `memory-commit-gateway.ts` (verdict already computed), `contradiction-cleanup.ts` (unchanged), `scripts/probe-gateway-agrees.ts` (the shadow review the module header says Phase-2 never had).
- **Why:** U3's as-of recall and the historical predicate (`validityWhere(asOf)`) are correct and unused; the operator cannot ask "what did I believe in July" until rows carry intervals.
- **Evidence:** invalidate-never-delete with validity windows is the memory design that held under controls (Zep 2025; Engram 2026: point-in-time filter, +10.4 pp over full-context from 8× fewer tokens).
- **Pattern:** two timestamps, no new table; a bi-temporal exclusion constraint is optional later (`btree_gist`, PG18 on Neon supports `WITHOUT OVERLAPS`).
- **Tests:** gateway verdict → columns (unit); `supersession-recall`, `recall-as-of` (exist); a shadow week: `shadowMemoryCommit` receipts show what the flip would have stamped, compared against the legacy path before the default flips.
- **Acceptance:** after the flip, `valid_from` set on 100% of new rows; a corrected fact returns the old row for `asOf` before the correction and the new row now; 0 hard deletes involved.
- **Risk:** medium (write path). **Reversibility:** kill switch exists; columns are additive.

### 6.4 Retrieval arbiter — one evidence pack (Wave 2)
- **Integration:** **new** `lib/brain/retrieval-arbiter.ts` called from `brain-context.ts` after both lanes resolve; inputs `memory-recall` hits (ids, knn distance) and `contextual-recall` ranked rows (via `onRanked`); output one ordered pack with lane attribution; `lib/brain/rerank.ts` runs **once** on the union (top ≤ 25) instead of only inside the contextual lane; `formatRecallForPrompt` renders the pack.
- **Why:** two lanes, no dedupe, two renders. The instrument shipped in Wave 0 (`recall_lane_overlap`) gives the baseline overlap per turn; the pack must beat it.
- **Evidence:** RRF is k-sensitive and a weak lane drags it (Bruch 2022; 2508.01405); a shallow cross-encoder over ≤100 candidates adds a small, consistent gain and deeper K hurts (2411.11767); the durable exact lane's 86% is measured and must be preserved as a nominator.
- **Mechanism:** union by id → secondary dedupe by `contentHash` (the envelope) → keep lane nominations → RRF over lane ranks (k=60, the measured default) → one rerank → validity filter (`isVisibleAsOf`) → MMR-style redundancy penalty → budgeted cut.
- **Tests/evals:** unit on the pure arbiter (dedupe, attribution, ordering); `pnpm eval:recall` gains an "arbiter" lane; the frozen 28-case corpus is a no-regression gate (hit@5 ≥ 86%, hit@10 ≥ 96%, identity 4/4); telemetry: duplicate-token ratio before/after, p95 latency ≤ today's contextual budget (3 s) and ideally ≤ memory-recall's 138 ms + rerank.
- **Acceptance:** overlap ratio → 0 duplicates rendered; corpus not worse; p95 within budget; every rendered item keeps provenance and lane history.
- **Risk:** medium. **Reversibility:** flag `NICK_RECALL_ARBITER`, default off until the corpus says otherwise.

### 6.5 Context budget allocator + placement + context receipt (Wave 3)
- **Integration:** `brain-context.ts` (replace the 0.12 drop threshold with a utility-per-token greedy fill; keep `critical` hard-protected), `lib/ai/system-prompt.ts trimPromptToBudget` (section order: highest-utility evidence adjacent to the user turn, never buried mid-prompt), `app/api/ai/chat/route.ts` (extend `recallReceipts` into a **context receipt**: blocks considered, kept, dropped, tokens, truncation, forced-critical reasons).
- **Evidence:** position effects reproduced 2023→2026 (middle can fall below closed-book; 11 of 13 long-context models below 50% of their short baseline by 32k); "fewer, higher-similarity items, at the ends" is the rule that follows; KV-cache stability (stable prefix, append-only) is the top production metric in Manus's account.
- **Pattern:** greedy utility/token + MMR — not an LLM controller; the prefix stays stable for caching (identity/rules first, evidence last).
- **Tests:** unit on the allocator; a "lost in the middle" e2e fixture (needle memory placed mid-prompt vs end) scored by the judge suite; receipt persisted and readable in the Memory Inspector.
- **Acceptance:** non-inferior task quality on the judge suite first; then lower duplicate-evidence tokens, lower irrelevant-context ratio, lower prompt tokens; the receipt answers "why was this in front of Nick".
- **Risk:** medium (prompt shape). **Reversibility:** flag.

### 6.6 Query planner (Wave 3)
- **Integration:** **new** `lib/brain/query-plan.ts` (pure, deterministic), consumed by `brain-context.ts` before the lanes; classes: exact identifier / quoted phrase · semantic lookup · durable personal · temporal (parses `asOf`, feeds `getContextualMemories({ asOf })` and `searchMemories.asOf`) · correction/change · anaphoric follow-up (resolve the referent from the last turns, add as a second query) · multi-entity · true multi-hop (≤ 2 sub-queries) · broad synthesis.
- **Evidence:** query rewriting hurt the strongest configuration in the 2024 best-practices study (0.486 → 0.443 at 8× latency); expansions help weak retrievers and harm strong ones (Weller 2024); decomposition + rerank helps multi-hop (+36.7% MRR@10) and adds noise elsewhere.
- **Rule:** the original query is always a lane; a transformation is an extra lane, only for its class; no LLM call for the common classes (the 2026-08-27 lesson: the LLM topic extraction cost p50 4.2 s and lost the block to its own timeout).
- **Tests:** fixtures per class ("what did I think about that before?", "what changed after August?", "which one is current?", negation, changed amount, future-effective statement, nickname alias, pronoun follow-up, exact identifier, compound question); a transformation ships only if it improves its slice without degrading exact/temporal slices.
- **Risk:** low-medium. **Reversibility:** per-class switches.

### 6.7 Tool funnel + budget experiment (Wave 4)
- **Integration:** `lib/ai/tool-selection-telemetry.ts` (add `selected`, `executed`, `succeeded`, `recovered_via_searchTools`, `recovered_via_invokeTool` to the existing offer/allow/budget-out/block record), `app/api/ai/chat/prepare-tools.ts`, `lib/ai/chat-mode.ts` (`NICK_TOOL_BUDGET` variants), `lib/ai/tools/meta.ts` (recovery path).
- **Evidence:** selection > 90% only up to ~30 live tools, sharp degradation past ~100; retrieval over tool descriptions restores it at −85% tool tokens (Anthropic tool search); the incumbent already has semantic tool retrieval plus recovery.
- **Experiment:** 24 → 16 → 12 initial tools with recovery measured on a held-out tool suite; keep authority/risk constraints, required action tools, explicit-name forcing, blocklists.
- **Acceptance:** required capability initially surfaced or recovered on ≥ 99% of executable fixtures; zero forbidden effects in read-mode/red-team fixtures; recovery rate falls as selection improves; no tool deleted for low usage alone.

### 6.8 Document RAG 2.0 (Wave 5)
- **Integration:** `lib/services/document-ingest.ts` (store `rawText`, `contextHeader`, `retrievalText = header + raw` separately; embed and FTS-index `retrievalText`; present `rawText`), `searchDocuments` (add a lexical lane over `retrievalText`, RRF, then `lib/brain/rerank.ts`), a document benchmark (headings referenced elsewhere, in-chunk pronouns, tables described later, exact terms, paraphrases), flag `NICK_CONTEXTUAL_RETRIEVAL` promoted only after it wins.
- **Evidence:** contextual embeddings + contextual BM25 + rerank cut failed retrievals 5.7% → 1.9% on Anthropic's document eval; no evidence on sub-100-token rows — so this stays a *document* upgrade, not a memory-row upgrade.
- **Acceptance:** raw evidence never contaminated by generated context; contextual vs plain compared on the benchmark; partial embedding failure non-fatal.

### 6.9 Brain Eval V2 (Wave 0 → continuous)
- **Integration:** `scripts/recall-eval.ts` (now scores the **full pipeline** through `onRanked` as a third lane; corpus fingerprint manifest at `data/recall-corpus.manifest.json`), `tests/eval/` scenarios, Langfuse scores, a hand-labelling surface (the `/discover` verdict loop already yields label-bearing cases — 6 so far).
- **Slices (borrowed from LongMemEval's taxonomy, not its corpus):** exact/rare lookup · durable personal · temporal · correction · contradiction · provenance · anaphora · multi-hop · workflow/gotcha · missing-evidence abstention · document RAG · distractors · tool retrieval · security (poisoned context cannot authorize) · long context (needle mid-prompt).
- **Stages scored separately:** retriever (candidate recall@k, hit@k, MRR, temporal correctness, duplicate ratio) · assembler (relevant facts retained, conflicts represented, tokens, lost-in-middle) · generator (claim support, abstention correctness, provenance correctness) · tools (surfaced / recovered / correct / effect verified / forbidden blocked).
- **Rules:** keep the 28 cases frozen (manifest); grow hand labels to n ≥ 50 (unlocks weighted fusion / episodic split per the baseline's own gate) then n ≥ 150 (ARES-scale, ±8 pp); LLM judges only with a human-labelled calibration slice and chance-corrected agreement reported (raw agreement overstates by 33–41 pp; one judge accepted 63% of wrong-but-topical answers); never one "Brain IQ" number.

### 6.10 Derived-memory invalidation + claim receipt (Wave 6)
- **Integration:** `memory-admission.ts` (`derivedFrom` already stored), a bounded cron that marks derived rows `stale_due_to_source_change` when a source is superseded (no deletion; excluded from authoritative context; regeneration enqueued only for artifacts that matter); `app/api/ai/chat/route.ts` (claim receipt: claim → `evidenceMemoryIds[]`, `externalEvidenceIds[]`, `temporalBasis`, `supportType`, built from what was in the prompt — never a post-hoc search); optional MiniCheck-class support scoring on important claims.
- **Fixture:** fact A → summary S derived from A → A corrected to A2 → S cannot remain authoritative; a historical request still inspects A and S.

## 7 · Quick wins (status)

| # | Quick win | Status |
|---|---|---|
| Q1 | Source/evidence normalization (`user_save`, `pin:*`, `operator`, `owner` → operator-stated everywhere) | **Shipped** (this PR) |
| Q2 | Direct-writer ratchet with declared bypass + positive control | **Shipped** (this PR; 107 files frozen) |
| Q3 | Score the full pipeline (and therefore the novelty term) in `pnpm eval:recall` | **Hook + lane shipped**; the run needs the gitignored corpus (operator's machine) and `DATABASE_URL` under `railway run`; compare `NICK_NOVELTY_RECALL=0` vs `1` |
| Q4 | Cross-lane duplicate telemetry | **Shipped** (`recall_lane_overlap` per turn) |
| Q5 | Raw vs contextualized document text kept apart | Wave 5 (specified in §6.8) |
| Q6 | Freeze the 28-case corpus | **Shipped** (`--write-manifest` writes `data/recall-corpus.manifest.json`; the runner reports "frozen" / "changed") — run once where the corpus lives |
| Q7 | Embedding backfill for the 2,460 unembedded rows | **Operator-run** (§6.2) |
| Q8 | Decide the paused `data-cleanup` cron (re-enable with the #2043 guard, or leave paused and accept shadow-receipt growth) | Operator decision |

## 8 · Rejected or dispositioned alternatives (register vocabulary)

| Proposal | Verdict | Grounds |
|---|---|---|
| Mem0 / OpenMemory as the memory system | **PATTERN** (unchanged, `docs/UPSTREAMS.md`) | its reconciliation verbs already live in the gateway; LoCoMo/LongMemEval numbers are vendor-run and disputed (Zep rebuttal; 6.4% wrong answer keys; judge accepts 63% of wrong answers); "≈ cloud RAG at 50× the cost" under controls |
| Hindsight as a runtime | **PATTERN** (unchanged) | typology borrowed into `memoryKind`; Python service needing PGroonga, not on Neon |
| Microsoft GraphRAG / LightRAG / HippoRAG 2 / PathRAG | **WATCH** (unchanged trigger: pgvector recall capped on a named curated corpus) | independent multi-hop gains ~2–4 F1 at 10–100× indexing tokens; single-hop favors plain RAG; GraphRAG repo in maintenance mode |
| Graphiti / Zep / Neo4j | **PATTERN** (unchanged) | the useful part is bi-temporal edges — two timestamps on the existing table (Wave 2); "does memory need graphs?" (2026): differences driven by harness settings |
| ColBERT / late interaction for personal memory | **REJECT** for memory rows; **WATCH** for documents (trigger: dense+lexical+rerank still fails exact/fine-grained document queries on the Wave-5 benchmark) | per-token storage, no MaxSim in pgvector, VectorChord not on Neon |
| pgvectorscale / VectorChord-bm25 / ParadeDB pg_search | **REJECT** on Neon | not available (pgvectorscale, VectorChord); pg_search deprecated on Neon since 2026-03-19, migration deadline 2026-09-21 |
| Lakebase Search (`lakebase_text` BM25 on Neon, GA 2026-07-02) | **WATCH** (trigger: the lexical lane measured weak on a ≥ 50-case corpus; today lexical alone is 21% hit@5 but its role is recall of unembedded/exact rows) | true IDF BM25 would fix `ts_rank`'s TF-only ranking; two months old, no benchmarks |
| LLM query rewrite / HyDE / multi-query on every turn | **REJECT** | hurts strong retrievers, invents entities, 8× latency; the incumbent removed an LLM call from the hot path for exactly this reason |
| Global `ef_search` / `iterative_scan` | **REJECT** (refuted 2026-08-27) | endpoint hit@10 96.4% either way; per-lane experiment only against a failing lane |
| Second eval platform (RAGAS / DeepEval / TruLens as infrastructure) | **PATTERN** | implement the metrics in `recall-eval.ts` + Langfuse scores; RAGAS's validation is n=50 from 2023 |
| DSPy / GEPA on the Nick system prompt | **WATCH** (unchanged; trigger: n ≥ 200 labelled cases for one narrow sub-prompt) | optimized prompts are model-specific and fragile; never on identity, authority or security prompts |
| Rewrite the system prompt shorter | **REJECT** (refuted: BDN-307) | Layer 1 is 13,274 chars against a 40,000 guard |
| Expose every tool / delete low-usage tools | **REJECT** | catalog size degrades selection; usage is not capability |
| New vector DB / second memory store / Neo4j | **REJECT** | no measured ceiling on pgvector for this corpus (86% hit@5 on the operator's own queries); the constraint is governance, not storage |

## 9 · Benchmark and eval plan (governs every Brain change)

1. **Frozen regression set:** the 28 labelled cases (manifest in `data/`); no PR may reduce hit@5/hit@10/MRR on it.
2. **Held-out V2 corpus:** hand-labelled through the Discover verdict loop and a `/brain` labelling surface; target n=50 by the end of Wave 2, n=150 by Wave 4; split tuning vs held-out.
3. **Per-stage metrics** as in §6.9; reported as a table per PR, never a single score.
4. **Lane telemetry in prod:** `recall_lane_overlap` (shipped), per-lane candidate counts and latency (exist), duplicate-token ratio (Wave 2), context receipt (Wave 3), tool funnel (Wave 4).
5. **Judge hygiene:** every LLM-judged metric ships with a human-labelled calibration slice (≥ 30 items) and a chance-corrected agreement figure.
6. **Security slice:** AgentDojo scenarios as data (register: ADOPT-AS-BENCHMARK) — poisoned context must never authorize a side effect (the sink policy is the enforcement; the eval is the proof).

## 10 · Waves and definition of DONE

| Wave | Scope | DONE when |
|---|---|---|
| **0 · Measurement lock** | corpus manifest, full-pipeline lane in `eval:recall`, lane-overlap instrument, direct-writer census, prod probes recorded here | the current SHA and live numbers are written (§2), the hybrid lane has a number, overlap is logged per turn, the writer census is frozen |
| **1 · Truth spine** | operator-source predicate, admission envelope, ratchet, explicit writers stamped | no operator-authored row is weak_inference; every new semantic writer is admitted or declared; tests green (this PR) |
| **2 · Validity + arbiter** | `validFrom` at write, supersession flip after shadow review, retrieval arbiter behind a flag, writer migration batch 1 | 100% of new rows carry `valid_from`; an as-of query returns the old belief; overlap ratio → 0 rendered duplicates; frozen corpus not worse |
| **3 · Context + query plan** | allocator, placement, context receipt, deterministic planner | non-inferior judge score, fewer prompt tokens, receipt answers "why this"; every class fixture green |
| **4 · Tool intelligence** | funnel telemetry, 24/16/12 experiment | ≥ 99% capability reachable, zero authority regressions, recovery rate falling |
| **5 · Documents** | raw/context split, lexical lane, RRF + rerank, benchmark, flag decision | contextual retrieval earns or loses its flag on the benchmark |
| **6 · Lineage + receipts** | stale-derived propagation, claim receipt, support check | a corrected fact cannot keep influencing Nick through a stale derived belief; "why did Nick say that" is answerable |
| **7 · Narrow optimisation** | one sub-prompt under DSPy/GEPA with n ≥ 200 | held-out win with zero security/authority regression, or dropped |

## 11 · Shipped with this document (Wave 0 + Wave 1 slice)

Code (all under `apps/statenour/`, tests beside each):
- `lib/brain/memory-commit-gateway.ts` — `OPERATOR_SOURCE_NAMES`, `isOperatorSource()`, ladder uses it.
- `lib/brain/memory-manager.ts` — wisdom-gate bypass uses the predicate.
- `lib/brain/contextual-recall.ts` — freshness decay uses the predicate; `onRanked` observer; `RankedRecallRow`.
- `lib/brain/memory-consolidation.ts` — `CURATED_GUARD` covers `user_save` / `operator` / `owner` / `pin:*`.
- `lib/brain/memory-admission.ts` — envelope, `stampAdmission`, `admitMemory`.
- `lib/services/brain/save.ts`, `lib/services/pins.ts` — stamped (declared direct writers).
- `lib/brain/lane-overlap.ts` + `lib/services/chat/brain-context.ts` — per-turn `recall_lane_overlap`, `laneOverlap` on the result.
- `scripts/recall-eval.ts` — `hybrid` lane, corpus fingerprint + `--write-manifest`.
- `tests/repo/brain-memory-direct-writers-ratchet.test.ts` + `.allowlist.json` (107 files, positive control).
- `tests/brain/memory-admission.test.ts`, `tests/brain/lane-overlap.test.ts`; `memory-commit-gateway.test.ts`, `provenance-label.test.ts`, `memory-consolidation-exclusions.test.ts`, `tests/lib/services/brain-save-dedupe.test.ts` updated to the new contract.

Docs corrected in the same PR: the stray merge-conflict marker in `docs/RECONCILIATION.md`; the
"no code reads the supersession columns" line in `docs/CURRENT-TRUTH.md` (now states the readers
and the 0-row fact); the "approval UI missing" gap in `docs/SECURITY.md` (closed by #2195/#2198).

Not shipped, by rule: the embedding backfill (production write → operator-run, §6.2), the
supersession flip (needs its shadow week, §6.3), any flag flip.

## 12 · 2026-09-17 — a second external plan, checked (and the wave delta since this doc shipped)

A ~5,700-word plan pasted by the operator (unattributed, web-research citations to Hindsight
v0.10.0 / LongMemEval-V2 / Cohere rerank-v4 / etc., dated 2026-09) proposes the same territory as
this document: 12 "custom features," a StateNourEval-250 benchmark, a three-receipt execution
model, Graphify MCP wiring, an Obsidian Bases cockpit. Checked claim by claim (`plan-gate` skill)
before writing anything, per the operator's standing "careful, other sessions working this repo
too" caution.

**Verdict: near-total overlap with §5/§6/§8 above, at lower rigor — do not build from it.** Its own
§55 "what I would not build" list matches this document's §8 register almost verbatim (no Neo4j,
no shoving the graph into memory, no mass-reembed-before-bakeoff). Its 12 "custom features" map
onto work already ranked here:

| Pasted-plan feature | This doc | Status today (2026-09-17) |
|---|---|---|
| Claim Receipts | §6.10 claim receipt (Wave 6) | not started |
| Context Packet Debugger | §6.5 context receipt (Wave 3) | not started |
| Decision Delta Dossiers / Evidence Rejection Memory | `docs/UPSTREAMS.md` register | **already exists, in daily use** — every REJECT/WATCH row there is exactly this, for external tools |
| ProcedureMemory / Environment Gotcha Memory | `AGENTS.md` §5 + `CURRENT-TRUTH.md` gotcha sections, as prose | not a queryable table — genuine gap, and this doc doesn't propose one either |
| Premise Firewall | §6.6 query planner's correction/change class (Wave 3) | not started |
| CommandReceipt / RunReceipt / EffectReceipt | out of this doc's scope (chat recall, not job execution) | **a sibling session shipped proof-of-invocation for 21 Inngest crons the same day** (#2412 "every inngest cron now proves it was invoked", #2410 cron-manifest reconciliation) — adjacent subsystem, same shape, already real |

**No external-tool verdict in §8 changes.** Hindsight, Mem0, Graphiti/Zep/Neo4j, GraphRAG/LightRAG,
ColBERT, DSPy/GEPA all already carry a dated, evidenced row there. The pasted plan reaches the same
PATTERN / WATCH / REJECT calls independently, with web citations instead of production probes —
convergent validation of §8, not new information.

**Delta since this doc shipped (2026-09-08 → 2026-09-17), verified against `origin/main`
(`9c4f30f4c`) file-by-file, not trusted from the wave table:**
- **Wave 2 retrieval arbiter — DONE (code), gated.** `lib/brain/retrieval-arbiter.ts` (pure core:
  union → content dedupe → RRF k=60 → MMR cut) + `lib/brain/evidence-pack.ts` (caller: rerank,
  validity filter, format) both exist with tests; `evidence-pack.ts`'s `buildEvidencePack()` is
  imported and called live in `brain-context.ts:33,490` behind `arbiterOn` (`NICK_RECALL_ARBITER`,
  still `defaultOn: false`).
- **Wave 3 query planner — DONE (code), WIRED AND CALLED, no flag.** `lib/brain/query-plan.ts`
  (`planQuery`) is imported at `brain-context.ts:32` and called unconditionally at `:166` —
  `const queryPlan = planQuery(userContent, { recentTurns: … })`. This corrects an earlier pass in
  this same edit that read the wave table instead of the tree and reported Wave 3 as not started.
  **Not independently confirmed:** whether `queryPlan`'s output (`asOf`, `exactTerms`, `classes`)
  actually changes lane behavior downstream, or is computed and only logged/received by
  `recallReceipts` — worth a follow-up read of `brain-context.ts:166-260` before trusting either way.
- **Wave 2 validity-at-write — still not flipped.** 0 evidence of a change since the 2026-08-14
  probe (0/40,889 rows with `valid_from`/`valid_until`/`superseded_by_id`); nothing in
  `CURRENT-TRUTH.md`'s 2026-09-17 (W12) section mentions it.
- **Wave 3 context budget allocator + context receipt — confirmed genuinely missing.** No
  `context.?receipt`, `blocksConsidered` or `blocksDropped` anywhere in `lib/`.
- **Wave 5 document RAG 2.0 — confirmed genuinely missing.** No `contextHeader`/`retrievalText` in
  `document-ingest.ts`; still the flag-only state §4.2 described.
- **Wave 6 claim receipt / derived-memory invalidation — confirmed genuinely missing.** No
  `stale_due_to_source_change` or `ClaimReceipt` anywhere outside this doc.
- **Wave 4 tool funnel — NOT genuinely missing, actively in flight.** See concurrency note below.

**Concurrency, 2026-09-17:** 23 active worktrees; ≥6 same-day statenour branches with
tool/metric-adjacent names (`statenour/tool-name-guard` ×3, `statenour/tool-chosen-lane`,
`statenour/chosen-census`, `statenour/metric-reader-sweep`) that may already be mid-flight on
Wave 4 territory (§6.7) — not confirmed either way without opening them. Check before starting any
tool-funnel work.

**Recommendation:** do not implement the pasted plan. If the operator wants the brain plan
advanced, the next gated action is a specific Wave 2/3 item from §10 (most likely: check the
28-case corpus and promote `NICK_RECALL_ARBITER`, or run the Wave 2 shadow week for the
supersession flip) — chosen and confirmed against the active branch list above, not started blind.
