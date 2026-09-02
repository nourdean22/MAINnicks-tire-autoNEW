# StateNour Brain / Memory / Retrieval — Trust Audit

**Scope:** Read-only audit of `apps/statenour` Brain/memory/retrieval subsystem, treated as a TRUST
system (can the operator believe what it says, correct it, and know when it's stale).

**Snapshot:** `C:\Users\nourd\AppData\Local\Temp\claude\C--\a2f6988a-8f6b-463b-a858-39bfbee811de\scratchpad\main2\apps\statenour`
— git archive of `origin/main` @ `abdd99395` (production commit `abdd993`).

**Stack:** Prisma 6 -> Neon Postgres, pgvector via `Unsupported` columns + raw SQL
(`lib/db/pgvector.ts`), tsvector for full-text.

**Lenses applied:** kaizen, karpathy-guidelines, rag-engineer, memory-systems (invoked via Skill
tool before this audit began).

**Method:** Bash-only (grep/read/wc) against the static snapshot. No writes, no git, no network,
no installs. Every claim is tagged:
- **A** = verified directly in this snapshot's code (path:line cited)
- **H** = inference/estimate from code (labeled, e.g. rows/day derived from a cron schedule + loop bound)
- **I** = claimed by a doc/comment but NOT independently verified against code in this pass
- **D** = a dated measurement/number recorded in a doc, cited with that doc's date — not re-verified live

No retrieval-quality claims are made anywhere in this report unless a dated doc reports numbers
(cited as class D). No confidence percentages are invented. Every absence claim ("no reader",
"nothing calls X") names the exact grep corpus and pattern used, plus a positive control showing
the same grep finds a known-true hit elsewhere, so a null result reads as "searched and absent,"
not "search was broken."

---

## CAPTURE — every producer of BrainMemory rows

### The write API and the gateway it sits behind

**A** — The single write API is `BrainMemoryManager.remember(category, key, content, source, metadata?)`,
exported as `brainMemory` — `lib/brain/memory-manager.ts:274-514,758`. Dedup/identity key is the
`@@unique([category, key])` DB constraint (`prisma/schema.prisma:1720`), i.e. two writes to the same
`(category, key)` pair always collide — there is no separate `contentHash` field on `BrainMemory` itself
(a `contentHash` does appear, but only inside `metadata` on gateway-parked rows, and as a real column on
the unrelated `IntelligenceOutcome` table, schema.prisma:3324).

New rows: confidence starts at 0.5, `expiresAt` = now+24h unless the category is in
`ONE_SHOT_RECORD_CATEGORIES` (`reply_judgment`, `trajectory_judgment` — memory-manager.ts:38-43), which
instead take `computeExpiresAt(category)` from `lib/brain/category-ttl.ts`. Existing-key writes normally
route to `reinforce()`: +0.1 confidence (cap 1.0), `seenCount++`, and after `seenCount>=3` the row is
promoted to permanent (`expiresAt: null`) — memory-manager.ts:528-565.

**Every `remember()` call passes through the memory-commit gateway** (`lib/brain/memory-commit-gateway.ts`),
in two layers, both **A**:
1. **Shadow observation, unconditional, on every call, both new and existing rows.** The `void (async
   () => {...})()` block at memory-manager.ts:339-362 always fires `shadowMemoryCommit()`, which itself
   `prisma.brainMemory.create()`s a row in category `memory_gateway_shadow` (memory-commit-gateway.ts:263,
   292-317) recording what the gateway would decide, confidence 0.1, TTL 7 days. This means every
   `remember()` call, new or reinforce, writes at least one extra BrainMemory row beyond the "real"
   write, a self-multiplying effect on raw row counts that is easy to miss when reading a "N memory
   writes today" counter (see Home-counter note at the end of this section).
2. **Real enforcement on existing-key writes**, gated by two independent kill switches, both default-on
   (**A**, memory-manager.ts:375,413):
   - Phase-1 (`NICK_MEMORY_GATEWAY_PHASE1`, default on) — `evaluateMemoryCandidate()` classifies the
     candidate against the existing row using a 7-tier evidence-strength ladder keyed off `source`
     (`operator_stated` > `system_receipt` > `direct_observation` > `external_source` >
     `supported_inference` > {`generated_summary`,`prediction`} > `weak_inference` —
     memory-commit-gateway.ts:70-91). Same source plus same content triggers `noop` — the write is dropped
     entirely (existing row returned untouched, memory-manager.ts:394-402).
   - Phase-2 (`NICK_MEMORY_GATEWAY_PHASE2`, default on) — `update` (equal-strength source changed the
     claim) reinforces content only, no confidence bump (`reinforce(id, content, {bumpConfidence:
     false})`); `review_required` with `reasonCode: "weaker_evidence"` parks the candidate into category
     `research_pack` under key `candidate_<hash>` instead of writing it (`parkForReview()`,
     memory-manager.ts:184-263), the existing stronger claim is left untouched and the candidate becomes
     an operator-reviewable row (see CORRECTION section); `unknown_category` review_required is
     deliberately not parked (memory-manager.ts:430-431, matches CURRENT-TRUTH's "349/wk" note);
     `supersede` only snapshots history when a third flag, `NICK_MEMORY_SUPERSESSION=1`, is also set. That
     flag is **default OFF** (memory-manager.ts:461), so on a stock deploy a "stronger evidence replaced a
     claim" verdict still silently overwrites via legacy `reinforce()`, same as before the gateway existed.

**Direct `prisma.brainMemory.create`/`.upsert` calls bypass all of the above.** No category-registry
validation, no wisdom gate, no gateway evidence-ladder check, no shadow receipt, no automatic embedding
call (embeddings are triggered explicitly inside `remember()`/`reinforce()` only, see EMBEDDING). This is
architecturally the majority of the write surface, not a minority. Grep counts below.

### Producer census (grep corpus: apps/statenour/**/*.ts, non-test files)

Positive control: `grep -rln "prisma\.brainMemory\." lib --include="*.ts"` returns 191 files, confirming
the search pattern matches broadly before any exclusion is applied — a later "0 results" claim below was
checked against this same live pattern, not a broken grep.

| Write path | Count | Goes through gateway? |
|---|---|---|
| `brainMemory.remember(...)` call sites | ~55 call sites across ~40 files (grep: `brainMemory\.remember\(`) | Yes, full gateway |
| `prisma.brainMemory.create(...)` direct | 71 call sites; 55 files outside `memory-manager.ts`/`memory-commit-gateway.ts` | No, bypasses entirely |
| `prisma.brainMemory.upsert(...)` direct | 80 call sites; 57 files outside `memory-manager.ts`/`memory-commit-gateway.ts` | No, bypasses entirely |
| `prisma.brainMemory.createMany(...)` | 0 (class A absence, same corpus as the positive control above) | n/a |

**H (inference):** the shadow-receipt effect means raw `brain_memories` row-count growth over any window
overstates "beliefs learned" by roughly 1x for every `remember()`-routed write, new-key writes also
shadow-write once, so the multiplier applies to essentially all `remember()` traffic, not only
reinforcements. Most `memory_gateway_shadow` rows self-expire in 7 days (TTL, memory-commit-gateway.ts:264),
so a same-day "N writes" counter on Home is inflated by shadow rows unless that counter explicitly excludes
the category. **Not verified in this pass:** whether the Home change-line counter (the task brief's "202
memory writes... previous ~20 hours") excludes `memory_gateway_shadow` — that counter's own source route
was not located in this pass; see the NOT VERIFIED list at the end of the report.

### remember() callers: source, category, cron/trigger (A unless noted)

| File:line | Category (literal or constant) | source string | Trigger |
|---|---|---|---|
| app/api/cron/ingest-calendar/route.ts:86 | var category (event-derived) | not captured this pass (I) | cron ingest-calendar, 1x/day (config/crons.ts:335-342, mega-morning fan-out) |
| app/api/cron/ingest-gmail/route.ts:320 | var category | "gmail_cron" | cron ingest-gmail, 1x/day (crons.ts:324-331) |
| app/api/telegram/webhook/route.ts:1779 | "visual_input" | not captured this pass | Telegram photo message, on-demand (operator-triggered) |
| app/api/telegram/webhook/route.ts:1933 | "link_analysis" | not captured this pass | Telegram URL message, on-demand |
| lib/integrations/gmail-sync.ts:46,68,94,106 | "insight", "lead_intent", "routine", "insight" | not captured | Called only from app/api/sync/gmail/route.ts and app/api/sync/nour-os/route.ts, neither of which appears in config/crons.ts, i.e. this path is on-demand/manual sync, not cron-scheduled (negative claim checked against the full CRONS array read in this pass) |
| lib/brain/pipeline-controller.ts (17 call sites: 60,68,84,108,115,128,141,202,232,240,359,377,450,470,498,589,614) | business_event, pattern (booking_hour), insight (lead_source/repeat_customer/conversation_insight), business_alert (negative review/lead_surge/lead_drought/stale_estimates/unanswered_leads/overdue_commitments), anomaly (emergency), emotional_state (mood), action_outcome, action_frequency | "bridge_pipeline", "pipeline_analysis", "conversation_analysis", "proactive_alert", "feedback_loop" | Mixed, not one cron. processShopEvent() fires per inbound nickstire.org bridge event (POST /api/sync/events): booking/lead/review/emergency/call — scales with real shop traffic, not a fixed schedule (H, rows/day not derivable from code alone, needs prod event volume). processConversation() fires from lib/services/chat/deferred-background-work.ts, i.e. on (a subset of) chat turns, see EXTRACTION. proactiveAlerts() and generateShopIntelligence() have zero callers found in this snapshot (grep across app/ and lib/) — likely orphaned despite being exported and documented as "runs as part of the brain cycle" / "runs as part of the morning cron". runBrainCycle()'s only caller is lib/ai/agent-actions/system-actions.ts:53 (handleSystemSyncNow), an agent-action handler reachable only when Nick's tool-use invokes it or an operator hits the matching UI action, not a cron, despite its own docstring saying "Called by crons" (pipeline-controller.ts:627). Class A on the code; the docstring claim is refuted by the only wiring found. |
| lib/brain/autonomous-engine.ts:230,447,692,925 | not captured this pass (I) | not captured | folded into mega-evening cron, gated by NICK_AUTONOMY flag (crons.ts:933-938), fail-closed per its own manifest description ("nothing auto-sends") |
| lib/brain/journal-ingest.ts:504,568,594,612 | not captured this pass (I) | not captured | operator journal entries, on-demand not cron |
| lib/brain/memory-consolidation.ts:695,714 | not captured (I) | not captured | folded into mega-evening consolidate step, nightly |
| lib/brain/blind-spot-identity.ts:346 | BRAIN_CATEGORIES.BLIND_SPOT | "blind-spot-detector" | Discover engine, nightly, see "nightly creative categories" section |
| lib/brain/counter-intuitive.ts:514 | key ci_${category}_${Date.now()} — still clock-keyed per LEARNING-LOOPS-2026-08-28.md (dated, class D), every regeneration mints a fresh unjudged row | not captured | Discover engine, nightly |
| lib/brain/external-memory-intake.ts:68 | caller-supplied p.category | caller-supplied p.source | see PROVENANCE, routes reviewed MemoryInboxItem claims into BrainMemory only after operator approval |
| lib/knowledge/candidate-store.ts:142,295 | research-pack candidate categories | not captured | promotion path for NotebookLM/Obsidian/web-research candidates (Wave 3 contract in KNOWLEDGE-ENGINES.md) |
| lib/services/brain-memories.ts:82 | caller-supplied | not captured | tRPC/REST surface, best guess from file name is the operator-facing "add memory" UI — not opened this pass (I) |
| scripts/*.ts (ingest-calendar, ingest-drive, ingest-gmail, ingest-operator-biography, ingest-research-pack, ingest-archives-direct, sync-gmail-notes) | various | various | manual operator-run scripts, never cron-scheduled — none appear in config/crons.ts; standalone CLI twins of the cron routes, likely for backfill/one-off ingestion |

### High-value direct writers spot-checked (bypass the gateway, class A)

| File:line | Category | Cron/trigger |
|---|---|---|
| lib/services/chat/persist-assistant-turn.ts:341-343 | BRAIN_CATEGORIES.NICK_QUALITY | Every assistant chat turn (persistence path for every Nick reply), direct .create(), gateway bypassed |
| lib/services/chat/persist-assistant-message.ts:199-201 | "chat_claim_warn" | On detected fabrication-risk claims in an assistant message (ties to the L2 pre-persist rewrite in AGENTS.md's fabrication-defense stack) |
| lib/services/chat/deferred-background-work.ts:157-159,231-234,394-396,480,523 | "hallucination_flag", BRAIN_CATEGORIES.CHAT_PATTERN (upsert key "latest_session"), "chat_claim_warn" (3 sites) | Post-turn deferred work, fires after chat turns (the "post-turn outbox" per CURRENT-TRUTH.md). This file also invokes pipeline-controller.processConversation() (LLM extraction, see EXTRACTION) |
| lib/services/auto-learn.ts:337-339,399-401,448-450 | "task_insight", "learn_complete", BRAIN_CATEGORIES.TASK_LESSON | Task-completion-triggered (bounded self-learning per KNOWLEDGE-ENGINES.md, "never for core task completion success") |
| lib/services/auto-learn-llm.ts:78-152,373 | "auto_learn_dedup", "auto_learn_budget", "task_insight" | Same lane, LLM-assisted variant |
| lib/db/brain-bus-handlers.ts (9 handlers) | system_alert, drift_history, commitment_event, task_completion, score_event, goal_event, reflection_event, brain_dump_event (+1 more not captured) | Drained by cron brain-bus-drain, every 15 min via the worker's node-cron (crons.ts:549-558), durable queue so this is a real, bounded-frequency polling writer |
| lib/brain/identity-snapshot.ts | BRAIN_CATEGORIES.IDENTITY_SNAPSHOT (key "current" plus daily "history:<date>") | cron refresh-identity, folded into mega-evening, nightly — one upsert plus one create per night (H, inferred from the key shape) |
| lib/db/conversation-mission-linker.ts:294-302 | "conversation_mission_link_review" | cron conversation-mission-link, 1x/night (crons.ts:382-389) |
| lib/inngest/functions/morning-brief.ts, goal-pruner.ts, content-performance.ts | not captured this pass (I) | Inngest-native daily/weekly crons per crons.ts |

### Rows/day estimate (H, inference from cron cadence, NOT a measured count)

No prod row-count access in this pass (read-only, code-only). What the code supports as an estimate: daily
crons that touch BrainMemory number at least ingest-gmail, ingest-calendar, ingest-drive, ingest-reviews,
consolidate, mastery-xp, predict, intelligence, industry-pull, refresh-identity, distill-sessions,
conversation-compile, anticipate, kept-word-scan, journal-checkin (2x/day), plus the 15-minute
brain-bus-drain (up to 96 polls/day, writes only when its queue is non-empty) and the always-on
shadow-receipt multiplier on every remember() call. embed-backfill and semantic-link do not themselves
write BrainMemory rows (see EMBEDDING and the table inventory). **The task's observed figure of roughly
202 memory writes over roughly 20 hours cannot be decomposed into a per-cron breakdown from static code
alone** — that requires either a GROUP BY source, category query against prod (out of scope, read-only) or
a dated census doc, and none was found in this pass for this exact figure. Flagged as **NOT VERIFIED**:
which categories/crons account for the ~202, and whether the counter includes shadow rows and the
chat-turn writers (nick_quality, chat_claim_warn, hallucination_flag) which scale with chat usage rather
than a fixed daily cron count.

## EXTRACTION — LLM-extracted memories from chat/journal

**A** — `lib/brain/pipeline-controller.ts:processConversation(userMessage, nickResponse)` (lines 263-388)
is the chat-side extractor. Called from `lib/services/chat/deferred-background-work.ts` (the post-turn
deferred-work hook, i.e. after a subset of chat turns — gated at line 265 to `userMessage.length >= 20 &&
nickResponse.length >= 50`). It runs one `aiChat(..., "fast")` call with a system prompt asking for strict
JSON: `{commitments[], openQuestions[], emotionalSignals, businessDecisions[], keyInsight}`, with an
explicit strictness rule for commitments (must have either an explicit deadline phrase or a specific
non-self recipient, else it is dropped — pipeline-controller.ts:279-283). Commitments are written directly
via `prisma.commitment.create()` (not `remember()`) plus a mirrored `AgendaItem` row
(`category: "WITNESSED_COMMITMENT"`, pipeline-controller.ts:323-340) — this is a distinct path from the
"AI-proposed COMMITMENT rows on Home" discussed later (those carry `status: "proposed"`; these
chat-extracted ones are created directly `status: "active"`). `openQuestions` extraction is retired
(explicitly discarded, comment: "Apr 18 — open-loops extraction retired", line 344-347).
`emotionalSignals` writes `BrainMemory(category: "emotional_state", key: "mood_<date>_<hourET>")` only if
the value passes a `VALID_MOODS` allowlist (line 354-368). `keyInsight` writes
`BrainMemory(category: "insight", key: "conversation_insight_<date>_<hash8>")` with a
content-hash-derived key so a retried write is a no-op through `remember()`'s upsert semantics
(line 370-383).

**A** — Journal-side extraction lives in `lib/brain/journal-ingest.ts` (4 `remember()` sites: 504, 568,
594, 612 — not opened line-by-line this pass, **I** on the exact categories) and `lib/brain/journal-brain.ts`
/ `journal-fanout.ts` (not opened this pass, **I**). Per `config/crons.ts`, journal entries are
operator-authored and processed on-demand, not on a fixed schedule (journal-checkin is a *prompt* cron —
"Telegram prompt with the day's journal question", not an extraction cron).

**A** — A second, cron-driven extractor is `lib/brain/memory-consolidation.ts` (`consolidate`, folded into
`mega-evening`, nightly): an LLM MERGE+DISTILL pass that rewrites a category's fresh rows into one
"consolidated memory" prose row. `CONSOLIDATION_EXCLUDE_CATEGORIES` (`lib/brain/categories.ts:774-799+`)
denylists categories with structured (non-prose) payloads after this exact failure mode shipped and broke
JSON-parsing readers for a week (categories.ts:766-772, dated incident, class D). This is a MERGE
extractor, not a per-turn one — it does not run per chat message.

### Dedup/merge inside extraction (A)

- Identity dedup is entirely the `(category, key)` unique constraint plus the gateway's evidence-ladder
  verdict (see CAPTURE) — there is no separate embedding-similarity dedup pass inside `remember()` itself.
- `memory-commit-gateway.ts:nearDuplicateScore()` (lines 225-233) is a token-Jaccard near-duplicate
  detector, but it runs **only inside the shadow observer** (`findDuplicateSuspect`, lines 244-261,
  scans the 50 most recent same-category rows) — it measures the semantic-dupe rate for later review and
  **never blocks or merges a write**. Its own comment names the design rule explicitly: "no LLM, no
  embedding call, in the write path" (memory-commit-gateway.ts:40).
- `lib/brain/semantic-dedup.ts` exists as a separate module (not opened this pass, **I**) — grep confirms
  it is not called from `remember()` or the gateway; its actual callers were not traced in this pass (NOT
  VERIFIED).

## PROVENANCE — the source ladder

**A** — The evidence-class ladder is `lib/brain/memory-commit-gateway.ts:evidenceClassForSource()`
(lines 70-91), a 7-tier deterministic `source` string classifier: `operator_stated` (exact match on
`user`/`manual`/`skill_ingestion`) > `system_receipt` (substring `receipt`/`tool-exec`/`action`) >
`direct_observation` (`observ`/`event`) > `external_source` (`external`/`import`/`drive`) >
`supported_inference` (`infer`/`insight`/`pattern`) > `generated_summary`/`prediction`
(`summary`/`brief`/`digest` or `predict`) > `weak_inference` (fallback for anything unmatched).

**A** — This exact ladder is reused as the render-time provenance label (not re-implemented — "one
vocabulary, not a fourth taxonomy" per CURRENT-TRUTH.md, confirmed in code):
`lib/brain/contextual-recall.ts:provenancePrefix()` (lines 159-163) renders
`[<category> · <EVIDENCE_LABEL> · seen <N>x]` (the `seen Nx` suffix only when `seenCount > 1`). The label
map (`EVIDENCE_LABEL`, lines 124-143) deliberately renders the `weak_inference` fallback as
**"unclassified"**, never "unverified" — the code comment explains why: real operator-authored writers
(`source: "operator"`, `pin:chat`, `pin:manual`) land in this fallback bucket too because the
`operator_stated` test is exact-equality on three literal strings, not a prefix match, so labelling the
fallback "unverified" would have told the model the operator's own pins were untrusted.

**A** — Inventory of `source` string VALUES actually used in `remember()` call sites found in this pass
(non-exhaustive — grep corpus is the ~55 `remember()` call sites cataloged in CAPTURE, not the ~150 direct
writers which mostly bypass this exact ladder by construction since their `source` is whatever literal the
individual file chose): `bridge_pipeline`, `pipeline_analysis`, `conversation_analysis`, `proactive_alert`,
`feedback_loop`, `gmail_cron`, `visual_input`(Telegram, used as category not source — recheck), `insight`,
`lead_intent`, `routine` (gmail-sync.ts sources not separately captured — see NOT VERIFIED),
`blind-spot-detector`, `memory-commit-gateway` (the shadow writer's own source), `wisdom_sync_cron`,
`improve-agent`. Operator-trusted sources that bypass the wisdom quality gate:
`skill_ingestion`/`manual`/`user` (memory-manager.ts:309-310).

**A** — External inbound content has its own quarantine, separate from the gateway:
`lib/brain/external-memory-intake.ts` routes inbound content (its own comment names Gmail specifically)
into `MemoryInboxItem` (`status: "quarantined"` by schema default, `prisma/schema.prisma:2945`) for human
review, and only calls `brainMemory.remember(p.category, p.key, p.content, p.source, p.metadata)` — still
gateway-covered — at line 68, for items that have cleared review. The module's own header comment states
this explicitly: routes into BrainMemory "never consulting the policy" is the anti-pattern this module
exists to avoid (external-memory-intake.ts:11-12).

## EMBEDDING

**A** — Model: **Cohere `embed-v4.0`**, dimension **1024**, per `docs/RETRIEVAL-BASELINE-2026-08-27.md`
line 76 (class D, dated 2026-08-27, both sampled eras 1024-dim) — not independently re-derived from a
single call site in this pass because the provider-selection logic lives in `lib/ai/provider.ts`'s
`getEmbedding()` (referenced from `memory-recall.ts:21`) which was not opened line-by-line this pass
(**I** for the exact model-selection code path; the dimension and provider identity are class D from the
dated doc, corroborated indirectly by `lib/db/pgvector.ts:124`'s canonical `VECTOR_DIM_1536 = 1536` fixed
HNSW column width and the zero-pad strategy in `padToVectorDim()`/`padToTargetDim()` — both pad a
shorter-than-1536 embedding with trailing zeros, which is exactly the mechanism a 1024-dim embedding needs
to live in a 1536-wide HNSW column while preserving cosine similarity, `lib/db/pgvector.ts:126-146`,
`lib/brain/memory-recall.ts:249-253`).

**A** — Write path: `lib/brain/memory-manager.ts` calls `storeMemoryEmbedding(created.id, ...)` on every
new `remember()` row (line 509) and again on `reinforce()` whenever `newContent` is supplied (line 559) —
both fire-and-forget (`.catch()`, never blocks the write). `storeMemoryEmbedding` is exported from
`lib/brain/embedding-utils.ts:307`. **Direct `prisma.brainMemory.create`/`.upsert` writers (the ~150-site
majority of the write surface, see CAPTURE) do NOT get this automatic embedding call** — their rows are
only embedded if the nightly `embed-backfill` cron later picks them up, or never, if the category is
denylisted (below).

**A** — `lib/brain/embedding-policy.ts` (42 lines, read in full) defines `TELEMETRY_CATEGORIES` — a
**denylist**, explicitly not an allowlist, of 12 high-volume event-log categories excluded from the
semantic index (`mastery_xp_event`, `memory_gateway_shadow`, `persona_drift`, `nick_quality`,
`data_source_probe`, `objection_injection_log`, `goal_lift`, `score_event`, `friction`, `reply_quality`,
`brain_dump_event`, `task_completion`). The file's own comment states the reason for denylist-not-allowlist
directly: an allowlist "made 83.5% of the brain silently unreachable" in a prior incident (dated measurement
2026-08-16, class D within class-A code). `TELEMETRY_CATEGORY_LIST` (the mutable copy) is folded into
`RECALL_EXCLUDE_CATEGORIES` via spread (`lib/brain/categories.ts:747`).

**A** — Cron: `embed-backfill`, 2x/day (`0 3,9 * * *`, both mega fan-outs — `config/crons.ts:371-378`),
"Embedding backfill for any new BrainMemory rows". Route file not opened this pass (**I** on its exact
scan-bound / batch-size logic, so no rows/day figure is derivable for it specifically).

**A** — Coverage/health: `lib/brain/embedding-utils.ts:countLiveBrainMemoryEmbeddings()` (813) and
`getEmbeddingHealth()` (834-887) compute a coverage percentage plus a composite health score (40% coverage
+ 30% dimension consistency + 30% low-duplicate-rate) — not traced to a specific dashboard route in this
pass (**I**).

## INDEXING

**A — HNSW is raw SQL**, confirmed at two sites: `scripts/add-hnsw-index.ts:111` and
`scripts/recover-pgvector-from-text.ts:148`, both `CREATE INDEX ... ON vector_embeddings USING hnsw
(embedding_vec_1536 vector_cosine_ops)`. `lib/db/schema-sentinel.ts:286-288` asserts the index KIND
(`"USING hnsw"` substring match) as a defense-in-depth drift check, not as the index's creation site.
Prisma cannot model `vector`/`vector(N)` types, so the columns are declared `Unsupported("vector")` /
`Unsupported("vector(1536)")` in `prisma/schema.prisma:2661-2662` specifically so `prisma db push` sees
them and does not offer to drop them (the schema comment documents three past near-misses where this
almost destroyed 7,000+ vector rows, schema.prisma:2625-2650).

**A** — Query-time KNN goes through `lib/db/pgvector.ts:knnSearch()` (generic, sourceType-filtered,
liveness/supersession/quarantine-aware) or hand-written `$queryRawUnsafe` in `memory-recall.ts` and
`contextual-recall.ts` directly against `embedding_vec_1536 <=> $1::vector(1536)` (cosine distance
operator). `ef_search` is tunable per-call via `lib/db/vector-tuning.ts`'s `withEfSearch()` +
`EF_SEARCH.HIGH_RECALL` constant (referenced `memory-recall.ts:25,355`; the module itself not opened this
pass, **I** on its exact default/HIGH_RECALL numeric values — the retrieval-baseline doc's lever table
names "ef_search 200" as the measured HIGH_RECALL setting, class D).

**I (not independently verified this pass)** — tsvector/GIN full-text index: `RETRIEVAL-BASELINE-2026-08-27.md`
states "GIN FTS index present and queried" (class D, dated). `contextual-recall.ts:getLexicalMatches()`
(line 464) and `buildLexicalTsQuery()` (line 418) build a `to_tsquery`-style lexical lane (grep confirms
`to_tsvector`/`tsvector` referenced in `contextual-recall.ts`, `lib/ai/tools/brain.ts`,
`lib/services/chat-search.ts`, `lib/brain/people-embed-hook.ts`) but the exact `CREATE INDEX ... USING gin`
DDL / trigger-vs-generated-column mechanics were not located in a migration file in this pass — statenour's
migrations are hand-applied per `docs/DB-MIGRATION-POLICY.md` and column-first, so the DDL may live in a
one-off script not matched by this pass's greps. Flagged NOT VERIFIED: exact tsvector column definition and
whether it is a stored generated column or trigger-maintained.

## RETRIEVAL — signals fused, k values, floors

**A — Three separate recall code paths exist and are NOT the same pipeline** (matching
`RETRIEVAL-BASELINE-2026-08-27.md`'s lane taxonomy, independently re-derived from code in this pass):

1. **`lib/brain/memory-recall.ts:recallMemoriesForQuery()`** ("Lane D" in the baseline doc, called the
   "live chat lane"). Despite its own file-header docstring claiming "Hybrid search (FTS + KNN)" (line 6),
   **the function as it reads in this snapshot runs no FTS/lexical query at all** — it runs two parallel
   vector-KNN lanes only: (a) full-corpus HNSW top-30 (`KNN_TOP=30`, `ef_search=HIGH_RECALL`,
   confidence >= 0.3, supersession/validity honored, lines 355-388) and (b) an exact scan over a
   materialized CTE of the ~122-row `DURABLE_PERSONAL_CATEGORIES` partition, top-10
   (`DURABLE_KNN_LIMIT=10`, lines 321-353) — deliberately NOT HNSW, the code comment names this as
   avoiding "the starvation shape this file's own baseline documented" for a highly-selective category
   filter riding an ANN index. The two lane orderings are fused via `rrfMergeHitOrders()` (k=60, equal
   weights, lines 237-247). Per-hit score = `(1-distance) + recencyBoost(0.2 if <14d / 0.1 if <60d / 0) +
   confidence*0.3` (lines 403-410). Default `limit=8` (`FINAL_TOP`), max 20. Category filter is
   `CONTEXT_CATEGORIES` (an allowlist, lines 89-170, now including `DURABLE_PERSONAL_CATEGORIES` after the
   2026-08-27 fix — this is the exact whitelist the baseline doc's Finding F1 says was previously missing
   every durable-personal category). **This is a stale-docstring finding, not a stale-code finding**: the
   file's top comment (line 6) was not updated when the FTS lane was apparently replaced/removed by the
   2026-08-27 durable-lane-fusion rewrite (or FTS lives elsewhere and this docstring always overclaimed —
   NOT VERIFIED which).
   Called from `lib/services/chat/brain-context.ts:299` under its own independent 3000ms `withTimeout`.

2. **`lib/brain/contextual-recall.ts:getContextualMemories()`** (the "sophisticated pipeline" / Lane E).
   Candidate pool: `prisma.brainMemory.findMany({confidence: {gte: 0.3}, deletedAt: null, category: {notIn:
   RECALL_EXCLUDE_CATEGORIES}, supersededById: null, validity-window})`, ordered by confidence desc, **take
   300** (line 680-696 — this is exactly the "planner-arbitrary 300 rows" the baseline doc's F3 finding
   describes). Unioned with (a) a real Postgres FTS lane (`getLexicalMatches`, topics-derived
   `to_tsquery`, `SET LOCAL statement_timeout = 900ms` per-statement, line 471) and (b) — since the
   2026-08-27 F3 fix — a true-KNN pool (`getKnnPoolRows`, only when the caller supplies a precomputed
   `queryEmbedding`, lines 722-729). Three RRF lanes: semantic (cosine), lexical-rank-or-keyword-overlap,
   category-importance (`CATEGORY_SCORES`, wisdom=0.9 highest, anomaly=0.3 lowest, lines 287-305), weights
   `[2.0, 1.0, 1.0]` with embeddings else `[1.0, 1.5, 1.0]` (lines 807-820). Post-fusion multipliers, all
   compounded multiplicatively into `hybrid`: source-trust, recency (0.85-1.05x), CoALA
   semantic/episodic/procedural kind-match, domain-topic match (1.15x), wisdom freshness decay
   (floor 0.6x past 90d unless seenCount>=5 or an operator-trusted source), a fixed 1.10x "favorite persona"
   boost (Greene), and an off-by-default `importanceMultiplier` (lines 830-866). **Reranker** (Cohere or
   BGE via `lib/brain/rerank.ts`, top-25 only, own 1500ms `RERANK_CALL_BUDGET_MS` bound via
   `withRerankBudget`) **overwrites `hybrid` for the top 25** with `0.5 + 0.5*rerankScore` when it fires
   (lines 877-914) — confirmed in code exactly as CURRENT-TRUTH.md describes: this discards every
   post-fusion multiplier including `importanceMultiplier` for the reranked slice. **Novelty**
   (`NICK_NOVELTY_RECALL` flag, `noveltyMultiplier()` 0.95-1.18x, lines 916-939) is applied
   **deliberately after** the rerank overwrite for exactly this reason (code comment states it explicitly,
   lines 916-921) — greedy MMR-style diversification against the last 5 accepted picks
   (`NOVELTY_COMPARISON_SET=5`). Output slotting: 3 reserved wisdom slots (1 if `NICK_EPISODIC_SPLIT` is on
   and the query is episodic), then a guaranteed-top-3 regardless of score, then fill to `maxMemories` for
   anything scoring hybrid > 0.15 (lines 941-1017+). Whole function is raced at 3000ms from
   `brain-context.ts:285-291`, itself passing the chat route's precomputed `userEmbedding` through since
   the 2026-08-27 F2/F4 fix.

3. **`lib/brain/chat-recall.ts:buildChatRecallBlock()`** — a third, separate block (called from
   `brain-context.ts:231`, also 3000ms-raced), covering prior-chat-message recall specifically (not opened
   line-by-line this pass, **I** on its internal signal mix — grep confirms it exists and is Promise.all'd
   alongside the other two).

**A — `RECALL_EXCLUDE_CATEGORIES`** (`lib/brain/categories.ts:717-758`, full list read): morning-brief
audio, `suggestion_hypothesis`, `research_claim_candidate` (confirms CURRENT-TRUTH's "NOW actually
quarantined" claim at the code level), `superseded_snapshot`, all 12 `TELEMETRY_CATEGORIES`, and
`active_chat_stream` (called out by name in a 2026-08-28 comment as having been quarantined only by
`confidence: 0.1` accidentally sitting under the recall floor, not by policy — "Name it explicitly").

**Floors, k values, budgets (A, consolidated):**

| Parameter | Value | Where |
|---|---|---|
| `recallMemoriesForQuery` confidence floor | >= 0.3 (both lanes) | memory-recall.ts (durable CTE + main query) |
| `recallMemoriesForQuery` KNN_TOP / DURABLE_KNN_LIMIT / FINAL_TOP | 30 / 10 / 8 (max 20) | memory-recall.ts:32-33,229 |
| `getContextualMemories` candidate-pool confidence floor + size | >= 0.3, top 300 by confidence | contextual-recall.ts:682,692 |
| `getContextualMemories` output floor | hybrid > 0.15 (below guaranteed-top-3) | contextual-recall.ts:1005,1014 |
| RRF constant k | 60 (both memory-recall.ts and contextual-recall.ts, matches rrf.ts literature-default comment) | rrf.ts:12,30 |
| Lexical statement timeout | 900ms (`SET LOCAL statement_timeout`) | contextual-recall.ts:438,471 |
| Rerank call budget | 1500ms | contextual-recall.ts:450 |
| Per-context-block chat-route timeout | 3000ms, ~19-21 blocks run via one `Promise.all` (parallel, not serial) | services/chat/brain-context.ts:128,214-351 |
| Novelty multiplier range | 0.95x - 1.18x | contextual-recall.ts:96-113 |
| Wisdom freshness decay floor | 0.6x (after 90d, seenCount<5, non-trusted source) | contextual-recall.ts:781-793 |

**Who calls recall (A):** `lib/services/chat/brain-context.ts` is the one call site found for both
`recallMemoriesForQuery` and `getContextualMemories` on the interactive chat path (both inside the same
`Promise.all`, each independently timeout-raced). Non-chat callers of `getContextualMemories`: the
retrieval-baseline doc's Finding F4 states there is exactly **one production caller**
(`brain-context.ts:277` at the time of that doc) — this pass did not re-run that specific caller-count grep
independently (class D, not re-verified as class A this pass).

## RANKING

Covered inline above (signal fusion is inseparable from retrieval in this codebase's structure — there is
no separate ranking-only module; `lib/brain/rrf.ts` and the per-pipeline multiplier stacks in
`contextual-recall.ts` and `memory-recall.ts` **are** the ranking layer). Summary of what feeds the final
order: lane RRF position (fused rank, not raw score) as the base, then in `getContextualMemories` a chain
of up to 7 multiplicative post-fusion factors, then an optional cross-encoder rerank that **replaces**
(does not multiply) the top-25 score, then an optional novelty re-multiplication applied last so it always
survives regardless of whether rerank fired.

## PROMPT INJECTION

**A** — `lib/services/chat/brain-context.ts` is the assembly point. `withTimeout()` (line 128, default
3000ms) wraps roughly 19-21 independent context-block builders, all launched together inside one
`Promise.all` (lines 214-351): chat recall, skills, identity, ghost, qualitative, beliefs, nudge, concerns,
anticipated, physical-business, cross-session thread detection, `getContextualMemories`, predictive
prefetch, `recallMemoriesForQuery` (`hybridRecallReport`), truth grounding, contradiction injector,
strategic-lens, Greene, dark-psychology, skill-registry recall, objection injector, tactician next-move.
Each block that times out degrades to its own documented fallback (`""`, `null`, or `[]`) rather than
failing the turn — the chat route never blocks indefinitely on a slow memory lane, but per
`RETRIEVAL-BASELINE-2026-08-27.md` Finding F2 (dated, class D), a slow **first stage** inside one of these
blocks can consume the entire 3000ms budget and drop the WHOLE block, not just degrade it (this was the
LLM topic-extraction stage inside `getContextualMemories`, fixed 2026-08-27 by `deriveFastTopics` on the
chat hot path — confirmed live in code as `opts.fastTopics` at contextual-recall.ts:628,657-658).

**A — Every memory-rendering block is now fenced against prompt injection.** Two independent, dated
self-audit comments in this snapshot both reference the same fix (task brief's "#2062/#2064/#2065"):
`contextual-recall.ts:172-176` ("S-1 (2026-09-01 audit) ... recalled memory was the one path external
content reached the system prompt WITHOUT a `<tool_data>` fence ... fenceContent wraps ~20 tool results at
read time and never touched these blocks") and `memory-recall.ts:526-531` ("S-1 completion (2026-09-02
self-review) ... Every memory-rendering block is fenced at source now;
`tests/ai/prompt-block-fencing-gate.test.ts` enumerates the producers so a new one cannot ship unfenced").
Mechanism: `fenceContent()` / `fenceRecallBlock()` (contextual-recall.ts:184-189) wrap the memory-line body
(heading stays outside the fence so a section-aware trimmer still sees the `## ` boundary) —
`RECALL_FENCE_MAX_CHARS=200_000` for the contextual-recall block, `maxChars: 20_000` for
`formatRecallForPrompt`'s block (memory-recall.ts:545).

## CORRECTION — can the operator edit/delete/mark-wrong a memory?

**A — Yes, via `PATCH /api/brain/memories`** (`app/api/brain/memories/route.ts:62-90`, `auth: "owner"`,
full file read). Body `{id, action}` where action is one of:
- `confirm` -> `brainMemory.confirm(id)`: sets `confidence: 1.0`, `expiresAt: null`, `source: "manual"`
  (memory-manager.ts:632-641) — this is the explicit "mark correct/permanent" affordance, and it
  overwrites `source` to `"manual"`, which upgrades the row's own future evidence-class to
  `operator_stated` on next render.
- `contradict` -> `brainMemory.contradict(id, evidence)`: `confidence: {decrement: 0.2}`, merges (not
  replaces) a `contradictionEvents` array in `metadata` (capped at the last 10, memory-manager.ts:601-627).
- `forget` -> `brainMemory.forget(id)`: **soft delete** (`softDelete("brainMemory", {id})`,
  memory-manager.ts:648-650) — the row is retained with `deletedAt` set; recall queries filter
  `deletedAt: null` everywhere this pass checked (memory-recall.ts, contextual-recall.ts, pgvector.ts), so
  a forgotten memory stops being recalled but is not destroyed and does not drop its `VectorEmbedding` row.
- `reinforce` -> `brainMemory.reinforce(id, content)`: manual re-affirm / content edit, goes through the
  same `bumpConfidence` path as an automatic reinforcement (+0.1, `seenCount++`).

Same four verbs are also reachable from `lib/ai/agent-actions/memory-actions.ts:24` (`forget` only, as an
agent-invocable action) and `lib/knowledge/candidate-store.ts:236,329` (`forget`, used when the operator
rejects a research/knowledge candidate). **`purge()` (true hard-delete) has no operator-facing route found
in this pass** — its only callers are internal (`memory-manager.ts` itself and `lib/system/stale-data-purger`
class paths not traced this pass, **I**); the code comment says it is "used only by stale-data-purger and
GDPR-style scrub paths. UI deletes go through `forget`" (memory-manager.ts:659-662).

**A — A parallel correction surface is Discover verdicts** (`known`/`noise`/`investigate`,
`discoveryVerdict` column, `prisma/schema.prisma:1710`), covered in the Brain tabs section below — this is
a cluster-level "mark wrong/already-knew" affordance distinct from the single-row PATCH route.

**A — `POST /api/brain/reset`** (`app/api/brain/reset/route.ts`, full file read, `auth: "owner"`) is a
scoped hard-wipe: `chat_importance`, `chat_summary`, `skill`, `skill_pending`, `identity_snapshot` (current
+ history), `qualitative_identity` (current + history), `ghost_prediction` (current + dismissals),
`ghost_accuracy`, `contradiction`, `belief`, `belief_candidate`, `brain_dump_importance` — a named category
allowlist, **not** a full-table wipe of `BrainMemory`. Delegates to
`lib/services/brain-domain.resetBrainState()` (not opened this pass, **I** on soft vs hard delete inside
it, though the route's own comment says "Cannot be undone"). Both the REST route and `trpc.brain.reset`
call the same function by design (route comment, "the destructive category set never drifts between
transports").

## SUPERSESSION — do `validFrom`/`validUntil`/`supersededById`/`lastVerifiedAt` have readers now?

**Yes — this is a materially different answer than CURRENT-TRUTH.md's 2026-08-14 entry** ("No code reads
the new columns yet; the schema is ahead of the app on purpose") and than the still-standing 2026-08-16
entry's framing that `NICK_MEMORY_SUPERSESSION` (default OFF) gates the only writer. **As of this
snapshot there are two independent writers and at least six confirmed reader sites**, class A:

**Writer 1 — `lib/brain/memory-manager.ts:snapshotSupersededVersion()`** (lines 132-182), gated behind
`NICK_MEMORY_SUPERSESSION=1` (default OFF, memory-manager.ts:461) inside the gateway's `supersede` verdict
path. Creates a **separate snapshot row** (category `superseded_snapshot`) carrying the OLD content, and
stamps `validFrom`/`validUntil` on that snapshot plus `validFrom`/`lastVerifiedAt` on the canonical
(surviving) row. On a stock deploy this writer never fires.

**Writer 2 — `lib/brain/contradiction-cleanup.ts:cleanupResolvedContradiction()`** (170 lines, full file
read) — **NOT flag-gated for the supersession stamp** (only its harsher soft-delete half is, behind
`NICK_CONTRADICTION_CLEANUP`). Fires whenever the operator resolves a contradiction with an explicit
winner (`current_wins`/`old_wins` — `both_valid`/`dismissed` are no-ops, "we never guess a winner", line
21). Stamps the **existing loser row in place** (no new row): `supersededById = winnerId`,
`validUntil = winner.validFrom ?? now()` (bi-temporal: the loser's validity ends when the winner's begins,
citing Zep/Graphiti and SQL:2011 as prior art, lines 90-93), and `lastVerifiedAt = now()` on the winner
(the code calls this "BDN-310 lastVerifiedAt's first writer", line 113) — plus a "verdict flip" branch
(lines 100-110) that un-strands a row that was previously superseded but has now been re-ruled correct.
Called from `lib/brain/contradiction-surfacer.ts:resolveContradiction()` (line 366, imports
`cleanupResolvedContradiction` at line 453), which is called from `app/api/contradictions/route.ts` and
three tRPC surfaces (`lib/trpc/routers/brain.ts`, `system/quality.ts`, `system-brain.ts`) — i.e. **the
operator-facing contradiction-resolution UI is a live, unconditional writer of the supersession columns.**

**Readers (A, grep-confirmed, camelCase + snake_case corpus, positive control = the writer sites above
matching the same grep):**
- `lib/brain/memory-recall.ts` — both KNN lanes filter `supersededById IS NULL AND (valid_until IS NULL OR
  valid_until > NOW())` in raw SQL (lines 333-334, 377-378).
- `lib/brain/contextual-recall.ts` — the 300-row candidate pool filters `supersededById: null, OR:
  [{validUntil: null}, {validUntil: {gt: new Date()}}]` in Prisma (lines 686-689).
- `lib/db/pgvector.ts:knnSearch()` — the same validity window inside its liveness `EXISTS` subquery
  (lines 245-254).
- `lib/ai/tools/brain.ts` — at least one recall-adjacent query filters the same window (line 340) plus a
  `supersededById: null` filter on a separate lane (line 363).
- `lib/brain/cold-memory.ts` — same validity filter (lines 138-139).
- `lib/brain/embedding-utils.ts` — same validity filter inside what is very likely the embedding-eligible
  candidate query (lines 426-427, not traced to its enclosing function name this pass, **I**).
- `lib/media/media-evidence.ts` references `valid_from` in a comment about NOT backfilling it for legacy
  rows (line 100) — **I** on whether it actually queries the column or only documents the gap.

**Net effect:** supersession is now a real, load-bearing part of the retrieval boundary (every recall lane
checked in this pass excludes superseded/expired-validity rows), but it is populated by exactly one
operator-triggered event (resolving a contradiction with an explicit winner) plus one default-off
automated path. **`validFrom` itself still has no writer found in this pass** other than
`snapshotSupersededVersion` (which only fires behind the default-off flag) — `contradiction-cleanup.ts`
reads `winner.validFrom` (line 96) but only to fall back to `new Date()` when it is null (line 98), and its
own comment says so explicitly: "`validFrom` has no writer yet, so this degrades to NOW()." So
`validUntil`/`supersededById`/`lastVerifiedAt` are live; `validFrom` is still effectively unpopulated on
the normal (non-flagged) path.

## CONTRADICTIONS — model, detectors, resolution UI, Home slot

**A** — Storage: `Contradiction` model (`prisma/schema.prisma:2018-2051`, full definition read) —
`claimSource`/`claimId`/`claim`/`reality`/`gap`/`severity`(mild/moderate/severe/critical)/
`category`/`resolved`(bool)/`resolvedHow`, soft-deleted. This is a **separate table from BrainMemory**,
though `BrainMemory` also has a `contradict()` method that flags a single row in place (see CORRECTION) —
these are two different mechanisms answering two different questions ("is there a standing
contradiction between two claims" vs "mark this one memory as disputed").

**A** — Detection: `lib/brain/contradiction-surfacer.ts` (468 lines; `findRelevantContradictions()` is one
of the ~20 parallel-raced context-block builders in `brain-context.ts`, see PROMPT INJECTION) and
`lib/brain/contradiction-injector.ts` (271 lines, not opened line-by-line this pass, **I** on its exact
detection heuristic — grep confirms it exists and is imported into `brain-context.ts`'s
`Promise.all` under the `contradictionHit` slot).

**A** — Resolution UI: `resolveContradiction()` (`contradiction-surfacer.ts:366`) accepts an operator
verdict of `current_wins`/`old_wins`/`both_valid`/`dismissed`, and on the two winner-naming verdicts calls
`cleanupResolvedContradiction()` (see SUPERSESSION above) which (a) unconditionally stamps the
supersession columns on the loser and (b) — only behind `NICK_CONTRADICTION_CLEANUP` (default state not
re-verified this pass, **I**) — soft-deletes the loser (`deletedAt`) so it also leaves the recall pool by
the ordinary `deletedAt: null` filter, not only by the validity-window filter. Reached from
`app/api/contradictions/route.ts` and three tRPC routers.

**A — the "Home contradiction slot"** referenced in CURRENT-TRUTH.md ("renders `null` on measured zero and
deep-links to the EXISTING resolution panel... `?resolve=<key>`") was not re-opened at the component level
this pass (**I** on the exact Home component file) — the resolution-route wiring above corroborates that a
real resolution panel exists to deep-link into; the Home-tile rendering code itself is NOT VERIFIED in this
pass.

## RETENTION / DELETION — what data-cleanup deletes, the category floor, the circuit breaker

**A — There was a real incident, now guarded, dated 2026-08-28 through 2026-09-01 (one day before this
snapshot).** `lib/brain/hard-delete-guard.ts` (102 lines, full file read) documents it directly: an
`AuditEvent` receipt timestamped `2026-08-28T07:01:07Z` recorded `"Pruned 55944 rows across 29 tables"`
with `deletedByTable.brain_memories_gc = 54107` against a normal nightly range of 187-505 — one run
hard-deleted 54,107 `brain_memories` rows and still reported `status: "success"` because the predicate
(`expiresAt < now()`, no category filter, no `deletedAt` filter) does not distinguish a telemetry row's
TTL from an operator-authored row that happens to carry one. The affected population that night was
`memory_gateway_shadow` (the gateway's own shadow-receipt category, see CAPTURE) — telemetry, but nothing
in the predicate encoded that.

**A — Two independent guards, both confirmed wired into the live cron route**
(`app/api/cron/data-cleanup/route.ts`, 200 lines read of ~200+):
1. `NEVER_HARD_DELETE_CATEGORIES` (hard-delete-guard.ts:37-63) — a category allowlist-of-exemption
   covering `DURABLE_PERSONAL_CATEGORIES` (identity/health/relationships/event/etc., imported from
   `memory-recall.ts`) plus the compounding-knowledge layer (`wisdom`, `belief`, `contradiction`,
   `decision_pattern`, `insight`, `pattern`, `blind_spot`, `principle`, `reflection`, `decision_log`,
   `task_lesson`, `weekly_review`, `mission_retro`, `qualitative_identity`, `strategic_plan`,
   `counter_intuitive`, `hidden_correlation`, `teaching_moment`, `identity_snapshot`, `anti_pattern`) —
   these categories are never eligible for hard-delete regardless of `expiresAt`.
2. `judgeSweep(count, cap)` (hard-delete-guard.ts:86-102) — a **circuit breaker**: `MAX_HARD_DELETE_PER_SWEEP
   = 5_000` (set well above the normal 187-505/night range and far below the 54,107 incident). A sweep is
   COUNTED first (`prisma.brainMemory.count()`); if the count exceeds the cap, **nothing is deleted** and the
   sweep records itself as a blocked/failed verdict instead of silently succeeding. Fails closed on a
   negative or non-finite pre-count too (a broken counter must never authorize a delete).

Both guards are live in `data-cleanup/route.ts:73-176` (verified by grep + read): the generic
`brain_memories_gc` sweep (`expiresAt < now()` OR `confidence < 0.1 AND updatedAt > 30d stale`, excluding
`NEVER_HARD_DELETE_CATEGORIES` AND excluding `createdBy: "user"`/`source: "manual"` rows) is a genuine
**hard delete** (`prisma.brainMemory.deleteMany`), gated by `judgeSweep`; a second loop iterates
`BRAIN_MEMORY_RETENTION` from `config/retention.ts` (per-category day thresholds) applying the same two
guards per category, with an explicit self-check that a category listed in BOTH the retention table and
`NEVER_HARD_DELETE_CATEGORIES` resolves conservatively (rows kept, reported as skipped) rather than
deleting.

Cron: `data-cleanup`, folded into `mega-evening`, **nightly 03:00 UTC** (`config/crons.ts:502-509`).

**A — Other retention/purge mechanisms touched by the same route:** `Commitment` auto-expiry (status ->
`"expired"` after 90d past deadline, or 90d from `createdAt` for null-deadline rows — a status flip, not a
delete); `AutonomousAction` pending-approval sweep via `purgeStaleCategory("pending_actions_7d")`
(`lib/system/stale-data-purger.ts`, not opened line-by-line this pass, **I** on whether this module also
purges any BrainMemory category directly — NOT VERIFIED); tiered `AuditEvent` retention (14d noisy / 60d
cron / 180d insight / 90d default).

**A — Soft vs hard delete summary:** operator `forget()` = soft delete (`deletedAt`, reversible via
`restore()`); nightly GC = hard delete (`prisma.brainMemory.deleteMany`, irreversible, now
guarded); `purge()` = hard delete + drops the row's `VectorEmbedding`s too
(`lib/brain/memory-tombstone.ts:dropEmbeddingsForMemories`, memory-manager.ts:663-670) — the only path
found in this pass that also scrubs the embedding table, documented explicitly as closing the gap where "a
scrub that leaves the text in vector_embeddings is not a scrub" (memory-manager.ts:665-667). Ordinary
`forget()`/nightly GC do **not** appear to touch `VectorEmbedding` rows in the code read this pass — a
soft- or hard-deleted `BrainMemory` row's embedding may persist in `vector_embeddings` unless a KNN
liveness join filters it out at read time (which `pgvector.ts:knnSearch()` does, via the same
`deleted_at IS NULL` `EXISTS` check) — **NOT VERIFIED**: whether the nightly `brain_memories_gc` hard-delete
also cascades to `vector_embeddings`, or leaves orphaned vectors (the schema shows no `onDelete` FK from
`vector_embeddings` to `brain_memories` — they are joined only by an untyped `sourceId` string, so no DB
cascade is possible; an orphan would need its own cleanup pass, not located in this search).

## EVALS — corpus, metrics, last recorded results

**A — Two separate eval systems exist, testing two different things:**

1. **Retrieval eval** — `lib/brain/recall-eval.ts` (273 lines; exports read, not fully read line-by-line)
   plus `lib/brain/recall-corpus-builder.ts` (327 lines, not opened this pass beyond grep, **I**). In-code
   corpus is `SEED_CASES` (`recall-eval.ts:141+`), **15 entries** (grep count of `relevantKeys:`
   occurrences), each with `relevantKeys: string[]` and `forbiddenKeys: string[]`. `runRecallEval()`
   (line 86) computes `precisionAtK` per case (`relevant retrieved ÷ min(k, expected)`, line 74-84) and
   aggregates a mean precision@k, explicitly treating cases with empty `relevantKeys` as abstention cases
   excluded from the precision mean (comment at line 66, matching `LEARNING-LOOPS-2026-08-28.md`'s
   description of the harvested-corpus defect). `RECALL_EVAL_CORPUS_VERSION = "v1"` (line 18). Script:
   `pnpm eval:recall` -> `scripts/recall-eval.ts`. Corpus growth: `pnpm harvest:evals` ->
   `scripts/harvest-eval-corpus.ts`.
   - **A separate, larger, gitignored corpus is used for the dated retrieval-baseline measurement**:
     `docs/RETRIEVAL-BASELINE-2026-08-27.md` describes `eval-datasets/recall-corpus.json`, **28 labelled
     cases**, "queries taken verbatim from the operator's chat turns", with slice breakdown (health 7,
     business 6, relationships 4, identity 4, event 4, routine 2, preference 1) and its own harness
     `eval-datasets/run-baseline.ts` running the real production functions read-only (write-stub-verified).
     **This is a different, larger corpus than the 15-entry in-code `SEED_CASES`** — not merged or
     cross-referenced in this pass; NOT VERIFIED whether `runRecallEval`/`pnpm eval:recall` and
     `run-baseline.ts` share any code path beyond both calling the same production recall functions.
   - **Last recorded results (class D, dated 2026-08-27, `RETRIEVAL-BASELINE-2026-08-27.md`, not
     re-measured in this pass):** live chat lane (`recallMemoriesForQuery`) went **0% hit@5 -> 50% -> 86%**
     hit@5 / **96% hit@10**, MRR 0.715-0.718, p50 138ms, across same-day fix waves; dense-KNN-only baseline
     39% hit@5; lexical-only 21%; naive RRF(dense+lexical) 43%. Contextual pipeline (`getContextualMemories`)
     went from measuring 0% (an artifact of the local harness's spend-protection short-circuit, not a real
     quality number) to **39-46% containment** post-fix, p50 ~2.0s (was p50 4,183ms just for its first
     stage). These are the only quantitative retrieval-quality numbers found anywhere in this pass — no
     number in this report is asserted as current beyond this dated citation.
   - **A second dated finding (class D, `LEARNING-LOOPS-2026-08-28.md`) qualifies the corpus's own
     validity**: all three harvested-case constructors in `recall-corpus-builder.ts` hard-coded
     `relevantKeys: []` AND `forbiddenKeys: []` (cited at lines 52-53, 79-80, 112-113 of that file in the
     doc), meaning a harvested case could never fail precision scoring — "the corpus can detect a crashed
     retriever, never a bad one." The same doc records the fix: a Discover `noise` verdict now mints
     `forbiddenKeys: [judgedRow.key]` (one real label per operator tap), moving the harvested-corpus
     labeled-case count from 0 to 6 (of the ~38 harvested at the time), with a second "labeled eval cases /
     30" odometer metric reported alongside the untouched 200-case fine-tune-volume gate. **Not
     independently re-counted against current `recall-corpus-builder.ts` in this pass** — cited as class D.

2. **Generation/faithfulness eval** — `lib/evals/{memory-evals.ts, memory-eval-runner.ts,
   memory-eval-types.ts, memory-eval-report.ts}`. `MEMORY_EVALS` (`memory-evals.ts:19`) holds **23 cases**
   (grep count). `gradeDoc()`/`gradeAnswer()`/`missingFacts()` (`memory-eval-runner.ts:34-94`) check
   whether a generated document or chat answer contains an expected set of facts — this is testing whether
   Nick **states** what the memory store already contains correctly, not whether retrieval **found** the
   right row. `validateDataset()` (line 95) and `runMemoryEvals()` (line 113) round out the runner. Script:
   `pnpm eval:memory` -> `scripts/run-memory-evals.ts`. `docs/CURRENT-TRUTH.md`'s own closing line names
   this exact pair as "the truth scoreboard that checks Nick remembers this file" — i.e. this eval's
   canonical test subject includes CURRENT-TRUTH.md itself as ground truth, not just BrainMemory rows.
   **No dated results for this eval were found in the docs read this pass** — NOT VERIFIED: last-run
   pass/fail numbers for `eval:memory`.

**No retrieval-quality or generation-quality claim in this report goes beyond the two dated citations
above.** Any number not marked class D in this report is either a static code constant (class A) or an
inference from code shape (class H), never a live measurement re-run in this pass.

## TABLE INVENTORY — every memory-like table

Writer/reader counts are **file counts** (grep `-l`, i.e. "N files contain a write/read call"), not
call-site or row counts — a positive control was run for the corpus (BrainMemory's 216-reader-file count is
consistent with the earlier 191-file `prisma.brainMemory.` count taken over a narrower `lib/`-only corpus,
class A). Canonical vs derived and the human-confirmation question are answered from the code read in this
pass; where not directly opened, marked **I**.

| Table (Prisma model) | Writer files | Reader files | Canonical or derived | AI content becomes canonical fact without human confirmation? |
|---|---|---|---|---|
| **BrainMemory** (`brain_memories`) | 147 | 216 | **Canonical** — the hub (KNOWLEDGE-ENGINES.md: "the canonical online memory used by the production application") | **Yes, on first write.** The commit gateway (`memory-commit-gateway.ts:evaluateMemoryCandidate`) only evaluates evidence strength when a row for that `(category,key)` already **exists** — `if (!existing) return {decision: "add", ...}` unconditionally (memory-commit-gateway.ts:162-169). A brand-new AI-inferred claim (any `source`, any evidence class) is written and immediately recallable with zero human step. The gateway is a re-write arbiter, not a first-write gate. Direct `create`/`upsert` writers (the ~150-site majority) bypass even that. |
| **BrainDump** (`brain_dumps`) | 5 | 24 | Canonical (operator-authored raw capture) | No — operator-typed by construction; `journal-brain.ts` derives `Reflection`/`Commitment` rows FROM it, which then follow their own gates |
| **MemoryInboxItem** (`memory_inbox_items`) | 2 | 3 | **Explicitly a quarantine, not canonical** — `status: "quarantined"` by schema default (`prisma/schema.prisma:2945`); `external-memory-intake.ts` only promotes reviewed items into `BrainMemory` | No — this table's entire purpose is to hold AI-extracted claims (`extractedClaims: Json`) OUT of canonical memory pending review (**I** on whether the review step is enforced by a route auth check vs merely a UI convention — not traced this pass) |
| **MemoryEdge** (`memory_edges`) | 1 | 6 | Derived (relational graph over other tables) | N/A — structural, not a factual claim |
| **SemanticEdge** (`semantic_edges`) | 1 | 1 | Derived (pgvector KNN neighbor cache) | N/A — cosine-distance metadata, written by `semantic-link.ts` (cron `semantic-link`, folded into `mega-evening`) |
| **Contradiction** (`contradictions`) | 2 | 5 | Derived (detected, then operator-resolved) | No — becomes actionable only via the operator's explicit `resolveContradiction()` verdict (see CONTRADICTIONS); detection alone does not mutate `BrainMemory` |
| **Reflection** (`reflections`) | 3 | 29 (heavily read — feeds many surfaces) | Canonical-ish: AI-generated (`insight`/`evidence`/`confidence`, schema.prisma:1909-1948) but carries `acknowledged: Boolean` — an operator-seen flag, not a confirmation gate | **Partially** — rows are created and readable before `acknowledged` flips; nothing found in this pass blocks an unacknowledged reflection from being surfaced (**I**, not exhaustively traced) |
| **Prediction** (`predictions`) | 6 | 13 | Canonical forecast ledger, self-resolving (`status: pending→confirmed/disproven/expired`, Brier score at resolution) | N/A — predictions are explicitly hedged claims, not asserted facts; `outcome-tracker.ts` resolves them against later reality |
| **IdentitySnapshot** (`identity_snapshots`) | 1 | 3 | Canonical (the operator's 8-axis self-model timeline) | **Yes** — `identity-snapshot.ts`, cron `refresh-identity` (nightly, folded into `mega-evening`), computes `coreValues`/`strengths`/`blindSpots` from behavioral signals with no operator confirmation step found in this pass before the "current" row is overwritten and read by "pulse ticker nudges, chat context, drift engines" (per `config/crons.ts:699` comment) |
| **CausalChain** (`causal_chains`) | 1 | 4 | Canonical inferred-causation ledger | **Yes** — `frequency`/`broken` fields update automatically as the same chain re-observed; no confirmation gate found |
| **StrategicLaw** (`strategic_laws`) | **0** (no app-level `create`/`upsert` matched this pass) | 7 | **Reference corpus, not learned** — Robert Greene's 48 Laws etc., a fixed taxonomy | N/A — read-only reference data. **I**: the actual seed mechanism (likely `scripts/seed-greene-corpus.ts` using a write pattern this grep didn't match, e.g. `createMany`) was not re-verified this pass |
| **IntelligenceClaim** (`intelligence_claims`) | 1 | 4 | Derived from `SourceDocument` (external research pipeline) | No — `status` starts `"unverified"`, becomes `"source_supported"` only via `verificationScore` cosine check against BrainMemory (see CURRENT-TRUTH's "source_supported means cosine >= 0.75 against OUR OWN MEMORY" caveat) — never a human-confirmation gate, and CURRENT-TRUTH.md flags this exact distinction as a place the label could be misread as source-verified when it is not |
| **SourceDocument** (`source_documents`) | 1 | 1 | Derived (raw capture from a `RegisteredSource`) | N/A — raw text, not a claim itself |
| **RegisteredSource** (`intelligence_sources`) | 3 | 6 | Canonical config (the research-source registry + trust score) | N/A — a source's `authScore` DOES adjust automatically via the closed-loop `Experiment` resolver (schema.prisma comment: "stamped by the experiment-measure resolver"), which is an automated trust-score adjustment with **no human confirmation step** found in this pass — worth flagging as its own small autonomous-trust-update loop |
| **PageSnapshot** (`page_snapshots`) | 1 | 1 | Derived (change-detection sensor) | N/A — "observes only... takes NO autonomous action" per its own schema comment (schema.prisma:3232-3234) |
| **VectorEmbedding** (`vector_embeddings`) | 10 | 23 | Derived (embedding cache/index for BrainMemory + other source types) | N/A — a representation of existing content, not a new claim |
| **JournalThread** / **JournalThreadEntry** (`journal_threads`, `journal_thread_memberships`) | 1 / 1 | 4 / 3 | Derived (auto-clustering of journal/reflection/decision entries by cosine convergence) — `namedAt` field implies operator confirms the thread's NAME, not its membership | Partially — membership joins are automatic (`joinMode: "auto"` is a real value alongside `"seed"`/`"operator"`, schema.prisma:2582); an auto-joined entry is live in the thread with no confirmation step |
| **BriefingLog** (`briefing_logs`) | 3 | 2 | Canonical audit record of sent briefs | N/A — a log of what was sent, not a new claim about the world |
| **"Pins"** | — | — | **Not a separate table.** `lib/services/pins.ts` operates entirely on `BrainMemory` rows in `category: BRAIN_CATEGORIES.PINNED_USER` (confirmed: `pins.ts:57-58,135-157,203,225`, all `prisma.brainMemory.*` calls) — a pin is a BrainMemory row like any other, distinguished only by category and (per `contextual-recall.ts:124-143`'s evidence-ladder comment) by `source: "pin:chat"`/`"pin:manual"`, which the ladder classifies as `operator_stated`-adjacent but technically falls into the `weak_inference`("unclassified") fallback bucket unless the exact `operator_stated` literal match happens to apply — see PROVENANCE. |

## Brain UI tabs + Discover + the nightly "creative" engines

**A — the Brain page (`app/(mastery)/brain/page.tsx`, tab list read directly) has exactly five tabs**:
`Discover`, `Memory` (`MemoryTab`), `Wisdom` (`WisdomTab`), `Board` (`BoardTab`), `Reason` (`ReasonTab`),
plus a non-tab `KnowledgeReviewTab` rendered unconditionally above the tab strip (line 36) — this is very
likely the operator-facing review surface for `MemoryInboxItem`/gateway-parked `research_pack` candidates
(not confirmed component-internals this pass, **I**).

**A — the actual four Discover-feed engines, read directly from `components/brain/discover-tab.tsx`'s
`KIND_META` (lines 68-93, the UI's own epistemic-labeling map) are: `counter_intuitive`
("INFERRED... an assumption the data appears to contradict"), `hidden_correlation` ("SPECULATIVE...
co-movement only, not a demonstrated cause"), `blind_spot` ("INFERRED... a gap derived from your own
activity, not observed directly"), `teaching_moment` ("INFERRED... a reading of past events, worth
checking against memory").**

**This does not match the task brief's naming of "ghost-predict, time-travel, identity-projection, wisdom
evolution" as the four nightly creative categories — those four terms name a different, and largely
NOT-nightly, set of features:**

| Term | Code found | Cron-wired? | UI-wired? | Verdict |
|---|---|---|---|---|
| ghost-predict | `lib/brain/ghost-nick.ts`, `lib/services/ghost-nour-predict.ts`, `lib/services/ghost-nour.ts`, route `app/api/system/ghost-nour/route.ts` | **No** — absent from `config/crons.ts` (grep for "ghost" in the manifest: zero matches) | **No** — zero references to `system/ghost-nour` found in `components/**/*.tsx` or `app/**/*.tsx` | **Dead route** — coded, reachable by direct API call only, not scheduled, not linked from any UI found in this pass |
| time-travel | route `app/api/brain/time-travel/route.ts` | **No** — absent from `config/crons.ts` | **No** — zero UI references found | **Dead route** |
| identity-projection | route `app/api/brain/identity-projection/route.ts`, `components/mastery/identity-arc-card.tsx` references the term, `lib/trpc/routers/operator.ts` references it | **No** — absent from `config/crons.ts` | **Unclear** — `identity-arc-card.tsx` exists and references the concept but was not opened this pass to confirm it calls this exact route (**I**) | **Likely live-but-manual or partially wired** — NOT VERIFIED, flagged rather than asserted dead |
| wisdom evolution | `lib/brain/wisdom-evolution.ts`, route `app/api/brain/wisdom/evolution/route.ts` | **No** — absent from `config/crons.ts` | **Yes** — called from `components/brain/brain-insights-panel.tsx`, `components/brain/wisdom-evolution-panel.tsx`, and `components/brain/wisdom-tab.tsx` (the live Wisdom tab) | **Live, but on-demand (page-load-triggered), not a nightly cron** |

**Net finding:** none of the four terms the task brief named are scheduled nightly crons in this snapshot.
One (`wisdom evolution`) is a real, UI-wired, on-demand feature inside the live `Wisdom` tab. Two
(`ghost-predict`, `time-travel`) show no UI caller found in this pass — coded but apparently unreachable
from the product surface, i.e. dead in practice even though not formally retired. `identity-projection`'s
status is genuinely unresolved by this pass's search depth (component exists, route exists, the link
between them was not confirmed) and is listed in NOT VERIFIED rather than called dead. **The actual
nightly, cron-scheduled "creative" engines are the four in `discover-tab.tsx`'s `KIND_META`** —
`counter_intuitive`, `hidden_correlation`, `blind_spot`, `teaching_moment` — none of which share a name
with the task brief's list, which appears to describe a different (older or aspirational) framing of the
feature than what ships today.

## AI-proposed COMMITMENT rows (`Commitment.status === "proposed"`)

**A** — Single shared writer: `lib/services/commitments.ts:proposeCommitment()` (read in full, lines
80-130), called from exactly one site in this codebase: `lib/brain/journal-brain.ts:enrichJournalEntry()`
(call at journal-brain.ts:486-487). `createdBy: "system:proposer"`, idempotent per `sourceRef` (pattern
`"journal-take:<entryId>"` per the interface doc comment, line 84) — re-processing the same journal entry
never mints a duplicate proposal. **Trigger is per-journal-entry enrichment, not a fixed nightly cron** —
journal entries are operator-authored and processed on save/enrichment (consistent with CAPTURE's finding
that journal ingestion is on-demand, not scheduled). **Rate is therefore bounded by how often the operator
journals, not derivable as a rows/day figure from code alone** (H). Proposed rows are surfaced via
`lib/home/operator-brief.ts:847` (`where: {status: "proposed", createdAt: {gte: since}}`) — i.e. this is
very likely the exact query behind the "AI-proposed COMMITMENT rows on Home" the task asked about — and
via `lib/services/commitments.ts:136,145,256` (accept/reject/list-pending handlers, not opened
line-by-line this pass, **I** on the exact accept/reject route).

## CLOSE — what a memory's provenance display can and cannot answer

Based on the code read in this pass (`provenancePrefix()` + `renderFactStatus()` in
`contextual-recall.ts`/`memory-recall.ts`, the commit gateway, the supersession columns, and the
correction routes):

**Can answer, directly, at render time (A):**
- **Where from (source class)** — `[category · <you stated|receipt|observed|external|inferred|summary|
  prediction|unclassified> · seen Nx]`, from `provenancePrefix()`. This is a real, code-level distinction
  between an operator-authored claim and a machine-generated one, for `remember()`-routed rows.
- **Stated vs inferred** — the same evidence-class label answers this directly for the seven recognized
  classes; ambiguous for the eighth (`unclassified`), which the code deliberately admits rather than
  guesses (see PROVENANCE).
- **How many times seen** — `seenCount`, shown when >1.
- **How old the fact is** — `factAgeDays` (from `createdAt`, immune to the lastSeen recall-touch bump) via
  `renderFactStatus()`, with an explicit "STALE — verify before relying on this" marker past 120 days
  (365 for wisdom-tier categories).
- **Correctable** — yes, four explicit operator verbs (`confirm`/`contradict`/`forget`/`reinforce`) via
  `PATCH /api/brain/memories`, plus cluster-level Discover verdicts (`known`/`noise`/`investigate`).
- **Deletable** — yes, `forget()` (soft, reversible) is the operator path; hard delete (`purge()`,
  or the nightly guarded GC) exists but has no direct operator-facing route found in this pass.

**Cannot answer, or answers only approximately (A/H):**
- **Why believed, in the sense of "why is this the accepted version"** — the system can say a claim's
  evidence class and sighting count, but **confidence is a frequency/strength proxy, not a truth
  estimate** — the codebase's own comments say this explicitly in three places (CURRENT-TRUTH.md,
  `contextual-recall.ts:148-151`, and `memory-recall.ts:178-182`'s note that 73% of recent `seenCount=1`
  rows violate the stated `0.5+0.1×(n−1)` formula because many writers stamp confidence directly at
  creation, e.g. `nick_quality` at 0.9, `task_completion` at 1.0). A high-confidence row and a
  well-corroborated row are not reliably the same row.
- **When true, bitemporally** — `validUntil` is live (populated by contradiction resolution, see
  SUPERSESSION), but **`validFrom` has effectively no writer on the default path** — `contradiction-cleanup.ts`
  itself falls back to `new Date()` when `validFrom` is null (its own comment: "`validFrom` has no writer
  yet, so this degrades to NOW()"). So the system can say **when a claim stopped being current** far more
  reliably than **when it started being true** — the two halves of bitemporal validity are asymmetric in
  this codebase today.
- **Still true, in the epistemic sense** — the STALE marker is a pure time-since-creation heuristic; it
  does not mean "we checked and it changed," only "it's been a while, verify." A row can be simultaneously
  `deletedAt: null`, `supersededById: null`, `validUntil: null`, confidence 1.0, and simply wrong, with
  nothing in the render path distinguishing that from a row that has been actively re-verified.
  `lastVerifiedAt` exists and IS written by `contradiction-cleanup.ts` on the winning side of a resolved
  contradiction, but is not rendered in any provenance-label code path opened in this pass (**NOT
  VERIFIED** whether it surfaces anywhere in the UI or the chat prompt).
- **Whether a specific claim ever passed through the commit gateway at all** — the shadow-receipt audit
  trail (`memory_gateway_shadow` category) exists only for `remember()`-routed writes. The majority of the
  write surface (the ~150-site direct `create`/`upsert` corpus in CAPTURE) leaves **no gateway verdict, no
  evidence-class computation at write time, and no shadow receipt** — for those rows, the provenance label
  at render time is still computed (since `provenancePrefix()` runs on ANY row's `source` string at recall
  time, not only gateway-processed ones), but there is no record of whether the write itself was ever
  evaluated against a competing claim.
- **The exact figure behind "~202 memory writes in ~20 hours"** — not decomposable from static code in
  this pass; see CAPTURE's closing paragraph and the NOT VERIFIED list below.

---

## NOT VERIFIED (this pass) — read-only, code-only limits

- Whether the Home change-line "N memory writes" counter excludes `memory_gateway_shadow` rows, and its
  exact route/query (not located).
- Per-cron / per-category breakdown of the observed ~202-writes-per-~20h figure — requires a live
  `GROUP BY source, category` query against prod, out of scope for a read-only code pass.
- `source` string literals for several `remember()` call sites noted "not captured this pass" in CAPTURE's
  table (ingest-calendar's exact source string, Telegram webhook sources, gmail-sync.ts source strings).
- Exact categories written by `lib/brain/journal-ingest.ts` (4 call sites), `autonomous-engine.ts` (4),
  `memory-consolidation.ts` (2) — grep-located, not individually opened this pass.
- The full ~150-site direct `prisma.brainMemory.create`/`.upsert` corpus was census-counted and
  spot-checked (roughly 15 files opened for category/trigger), not exhaustively read file-by-file — see
  CAPTURE for the complete file-path list from the grep census; the remaining ~130 files are named there
  by path but their individual categories/triggers are not itemized in this report.
- `lib/ai/provider.ts:getEmbedding()`'s exact model-selection code path (embedding model/dimension is
  class D from `RETRIEVAL-BASELINE-2026-08-27.md`, not re-derived from a single call site this pass).
- Exact `CREATE INDEX ... USING gin` DDL / trigger-vs-generated-column mechanics for the tsvector lexical
  index — not located in a migration file this pass (statenour's migrations are hand-applied/column-first
  per `docs/DB-MIGRATION-POLICY.md`, so the DDL may live in a one-off script not matched by this pass's
  greps).
- `lib/db/vector-tuning.ts`'s exact `EF_SEARCH` numeric constants (referenced, not opened).
- `lib/brain/chat-recall.ts`'s internal signal mix (grep-confirmed to exist and be wired into
  `brain-context.ts`'s `Promise.all`, not read line-by-line).
- Whether `getContextualMemories` genuinely has only the single production caller
  (`brain-context.ts:277`, per the dated baseline doc's Finding F4) — not independently re-grepped as
  class A this pass; cited as class D.
- `lib/system/stale-data-purger.ts`'s full scope — confirmed it purges `AutonomousAction` pending-approval
  rows (called from `data-cleanup/route.ts:140`); NOT VERIFIED whether it also purges any BrainMemory
  category directly.
- Whether the nightly `brain_memories_gc` hard-delete cascades to or orphans rows in `vector_embeddings`
  (no FK exists between the tables — joined only by an untyped `sourceId` string — so no DB-level cascade
  is possible; an application-level cleanup pass for orphaned vectors was not located).
- `lastVerifiedAt`'s render-time surfacing — written by `contradiction-cleanup.ts`, not traced to any UI
  or prompt-injection consumer in this pass.
- `identity-projection` (`app/api/brain/identity-projection/route.ts`) — whether
  `components/mastery/identity-arc-card.tsx` actually calls it (both exist; the link between them was not
  confirmed) — see Brain tabs section.
- `KnowledgeReviewTab` (rendered above the Brain page's tab strip) — not opened; assumed to be the
  operator review surface for `MemoryInboxItem`/gateway-parked candidates based on naming and file
  location only.
- Accept/reject route for AI-proposed `Commitment` rows (`status: "proposed"`) — the writer
  (`proposeCommitment` in `journal-brain.ts`) is confirmed; the operator's accept/reject UI path
  (`lib/services/commitments.ts:136,145,256`) was grep-located, not opened.
- Live default state of the `NICK_CONTRADICTION_CLEANUP` flag in production (code shows it gates only the
  soft-delete half of contradiction cleanup; its current on/off value was not queried — this is a runtime
  DB/flag-service value, not a static code default, and out of scope for a read-only code pass).
- `docs/CURRENT-TRUTH.md`'s 2026-08-14 "no code reads the new columns yet" claim about the supersession
  columns is **superseded by this pass's own code read** (see SUPERSESSION) — flagged here so the
  discrepancy between the doc and the current snapshot is explicit rather than silently overwritten.

