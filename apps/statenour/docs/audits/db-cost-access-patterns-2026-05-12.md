# DB Cost + Access-Pattern Audit · 2026-05-12

**Scope** · read-only audit of statenour-os Neon Postgres (pgvector
enabled) · ~81 Prisma models. Method: full schema walk of
`prisma/schema.prisma` (2,451 lines) + cross-reference with query
sites under `lib/services/`, `lib/brain/`, `lib/db/`, plus
`prisma/migrations/*` for HNSW + missing-index history. No live DB
profiling (no production credentials available in audit context) ·
verdicts are derived from declared indexes, write paths, and
retention policy. **Cost estimates use Neon Pro 2026 list pricing
($0.30/CU-hr compute + $0.16/GB-mo storage + 5 GB included)** ·
treat absolute dollar amounts as order-of-magnitude.

**Skill stances applied:** DATABASE-ARCHITECT (access patterns
first · backups before destructive moves) · `database-cloud-
optimization-cost-optimize` · `production-code-audit` · ELON
first-principles (delete what doesn't pay).

**Findings count by category:**

| Category | Count |
|---|---|
| Table-by-table cost profile | 20 tables |
| Missing indexes | 10 |
| Dead / redundant indexes | 11 |
| Tables needing partition | 4 |
| pgvector tuning issues | 3 |
| Memory consolidation gaps | 5 |
| **Top-10 ranked fixes** | 10 |

---

## 1 · Table-by-table cost profile · top 20

Row counts are *estimated* from comments in `prisma/schema.prisma`,
the retention policy in `config/retention.ts`, write-rate signals
from `config/crons.ts`, and forensic statements in
`docs/audits/AUDIT-2026-05-05-deep-honesty.md` ("2592 rows · 100%
vec_filled" · "2020 brain memories" · "109 AI calls yesterday" ·
"50% emergency rate"). Bytes/row from `lib/db/storage-quota.ts` is
illustrative — soft caps assume 1.5 GB for vector_embeddings at
200K rows = ~7.5 KB/row.

| # | Table | Est rows | Est bytes (heap+idx) | Write rate signal | Verdict |
|---|---|---|---|---|---|
| 1 | `vector_embeddings` | ~7,000-8,500 | ~50-65 MB | embed-backfill hourly · dual-write JSON + pgvector(1536) | **NEEDS-PRUNING** |
| 2 | `brain_memories` | ~2,000-3,000 | ~10-20 MB | every chat turn, every cron fan-out | **NEEDS-PRUNING** |
| 3 | `chat_messages` | ~5,000-15,000 (55 msg/day × 270d) | ~50-150 MB inc tsvector + GIN | every chat turn × 2 (user+assistant) | **NEEDS-PARTITION** |
| 4 | `chat_conversations` | ~500-1,500 | ~2-5 MB | one row per new chat | HEALTHY |
| 5 | `agent_traces` | ~100K (30d window × 100/day × multiple per chat) | ~50-150 MB | every AI call (chat + cron + autonomous) | **NEEDS-PARTITION** |
| 6 | `audit_events` | ~10K-30K | ~20-60 MB | tiered retention; chat_feedback + brain_insight + cron logs | **NEEDS-INDEX** |
| 7 | `entity_audits` | ~10K-50K (90d hot window) | ~30-150 MB | every mutation across all models | **NEEDS-PARTITION** |
| 8 | `provider_pings` | ~750 (7d × 4 providers × 24h hourly = 672) | <2 MB | hourly cron, retention 7d | HEALTHY |
| 9 | `autonomous_actions` | ~20K (deep-honesty audit: "~20K rows; bites at >100K") | ~30 MB | autonomous engine, retention forever | NEEDS-INDEX |
| 10 | `tool_verb_ratios` | ~5K-10K (30d × ~30 chats × 5 ratios) | ~5 MB | every chat turn, retention 30d | HEALTHY |
| 11 | `autonomous_events` | ~10K (90d × 100/day) | ~10 MB | autonomous engine, retention 90d | HEALTHY |
| 12 | `semantic_edges` | ~57-200 (probe says "57 rows today") | <1 MB | semantic-link nightly | HEALTHY |
| 13 | `system_metrics` | ~50K-100K (90d retention × dozens/hour) | ~30-60 MB | every API request (latency, cost) | HEALTHY |
| 14 | `api_request_logs` | ~30K (30d × ~1K req/day) | ~15-30 MB | every API request | HEALTHY |
| 15 | `error_logs` | ~500-2,000 (30d retention) | ~2-5 MB | every caught error | HEALTHY |
| 16 | `cron_job_logs` | ~5K-10K (30d × 38 active crons × ~5 fires) | ~5-10 MB | every cron fire | HEALTHY |
| 17 | `brain_bus_events` | ~5K-15K (durable event log, no retention!) | ~10-30 MB | every brain-bus produce | **NEEDS-PRUNING** |
| 18 | `tool_telemetry` | ~120 (one row per tool, aggregate counters) | <1 MB | every tool call (upsert) | HEALTHY |
| 19 | `task_events` | ~10K | ~10 MB | every task transition | HEALTHY |
| 20 | `memory_edges` | ~1K-5K | ~2-5 MB | crossPollinate nightly | HEALTHY |

**Subtotal storage estimate (top-20):** ~330-660 MB heap+index ·
within Neon Pro's 5 GB included tier. **Compute** is the dominant
cost line, not storage. Current spend profile (from
`/system/ai-cost`-style aggregates inferred from comments) shows
DB cost is shadowed by AI provider cost · still, every 100ms shaved
off chat-turn write path is one fewer Neon compute-unit-second
billed.

---

## 2 · Missing-index analysis · top 10 by expected query cost

Queries grep'd from `lib/services/*`, `lib/brain/*`, `lib/db/*`. I
cross-referenced filter+order columns against the `@@index`
declarations in `prisma/schema.prisma` (and the supplementary
`20260507103256_add_missing_indexes_v10_0_381` migration).

### M1 · `vector_embeddings(sourceType, sourceId)` missing covering for embed lookup hot path

**Evidence** · `lib/brain/embedding-utils.ts:141-144`:
```typescript
const existing = await prisma.vectorEmbedding.findFirst({
  where: { sourceType, sourceId },
  select: { id: true },
});
```

Existing index: `@@index([sourceType, sourceId])` (line 2271) ·
**already present**. But every embedding write hits this find-then-
update. The composite IS optimal, but `id` is the only selected
column · with a covering INCLUDE there's no need to hit the heap.

**Fix** ·
```sql
CREATE INDEX CONCURRENTLY "vector_embeddings_src_lookup_covering_idx"
  ON "vector_embeddings"("sourceType", "sourceId")
  INCLUDE (id);
DROP INDEX CONCURRENTLY "vector_embeddings_sourceType_sourceId_idx";
```

**Expected gain:** ~1ms saved per embed write × hourly backfill +
every chat turn. Minor.

---

### M2 · `chat_messages(conversationId, role, createdAt)` for recent-message FTS-precursor scan

**Evidence** · `lib/ai/system-prompt.ts:1679`:
```typescript
const recentChats = await prisma.chatMessage.findMany({
  // … filter by role + conversationId + recency
```
also `lib/brain/wisdom-violations.ts:49`, `lib/ai/tools.ts:1967`.

Current `chat_messages` has `(conversationId, createdAt)` (line
1136) but NOT `(conversationId, role, createdAt)`. Every system-
prompt build scans the conversation index, filters by role
in-memory.

**Fix** ·
```sql
CREATE INDEX CONCURRENTLY "chat_messages_conv_role_created_idx"
  ON "chat_messages"("conversation_id", "role", "created_at" DESC);
```

**Expected gain:** chat-turn warm path saves ~5-20ms per call ·
multiple call sites benefit.

---

### M3 · `brain_memories(source, createdAt)` for source-trust analytics

**Evidence** · `lib/brain/contextual-recall.ts:108-121` defines
`SOURCE_TRUST_WEIGHT` per-source, and source-tier queries are
implied. But there is NO index on `source` in BrainMemory.

**Fix** ·
```sql
CREATE INDEX CONCURRENTLY "brain_memories_source_created_idx"
  ON "brain_memories"("source", "created_at" DESC);
```

**Expected gain:** wisdom-source debugging queries cease scanning
the full table. ~50-200ms saved per /system/wisdom-by-source page.

---

### M4 · `agent_traces(label, startedAt)` for surface-by-call-type analytics

**Evidence** · `lib/ai/agent-trace.ts` writes `label` (per-call
chain step) to every trace; `/system/agent-trace` filters by label.
Schema declares `(traceId, startedAt)`, `(source, createdAt)`,
`(provider, createdAt)`, `(errorClass, createdAt)`, `(createdAt)`
but NOT label.

**Fix** ·
```sql
CREATE INDEX CONCURRENTLY "agent_traces_label_started_idx"
  ON "agent_traces"("label", "started_at" DESC);
```

**Expected gain:** every dashboard widget that filters by label.

---

### M5 · `entity_audits(entity_type, action, created_at)` for "what created" queries

**Evidence** · `lib/db/creation-spike-detector.ts` queries entity
audits filtered by `entityType` AND `action` (creates only) over a
recent window. Existing indexes: `(entity_type, entity_id,
created_at)`, `(actor, created_at)`, `(action, created_at)` · but
NOT `(entity_type, action, created_at)`.

**Fix** ·
```sql
CREATE INDEX CONCURRENTLY "entity_audits_type_action_created_idx"
  ON "entity_audits"("entity_type", "action", "created_at" DESC);
```

**Expected gain:** creation-spike-detect runs in mega-evening,
shaves ~100ms per entity-type bucket; multiplies across ~10
entity types.

---

### M6 · `chat_messages(parent_message_id)` is single-column · branching tree walks could use `(parent_message_id, createdAt)`

**Evidence** · branching UI walks the message tree by parent. Index
declares `[parentMessageId]` (line 1138) · works for direct parent
lookup but tree walks ordering by createdAt then re-sort.

**Fix** ·
```sql
CREATE INDEX CONCURRENTLY "chat_messages_parent_created_idx"
  ON "chat_messages"("parent_message_id", "created_at" ASC);
DROP INDEX CONCURRENTLY "chat_messages_parentMessageId_idx";
```

**Expected gain:** branch UI render avoids sort step; minor.

---

### M7 · `brain_bus_events(topic, status, available_at)` for queue drain per topic

**Evidence** · `lib/db/brain-bus-handlers.ts` (the polling backfill
cron) walks pending events. Schema has `(status, availableAt)` and
`(topic, createdAt)` separately. But if topic-routing wants to drain
ONE topic at a time, the right composite is missing.

**Fix** ·
```sql
CREATE INDEX CONCURRENTLY "brain_bus_events_topic_status_available_idx"
  ON "brain_bus_events"("topic", "status", "available_at" ASC);
```

**Expected gain:** marginal · the table is small. Low priority.

---

### M8 · `audit_events(eventType, actor, createdAt)` for per-actor-per-event queries

**Evidence** · `/api/system/ai-error-list` filters by eventType
AND actor. Existing: `(eventType, createdAt)` and `(actor,
createdAt)` · planner picks one but post-filters the other.

**Fix** ·
```sql
CREATE INDEX CONCURRENTLY "audit_events_event_actor_created_idx"
  ON "audit_events"("eventType", "actor", "createdAt" DESC);
```

**Expected gain:** when actor cardinality is high (autonomous,
nick, user, system × N), the planner choice matters. Conditional
on workload.

---

### M9 · `BrainMemory(category, expiresAt)` for category-aware decay scans

**Evidence** · `lib/brain/memory-manager.ts:250-258` runs:
```typescript
where: {
  lastSeen: { lt: thirtyDaysAgo },
  confidence: { gt: 0.1 },
  expiresAt: null,
  deletedAt: null,
},
```
Schema has `(lastSeen)` and `(expiresAt)` separately. The compound
`(category, expiresAt)` would let category-scoped decay (already
hinted at in roadmap) use a single index.

**Fix** · skip for now unless category-scoped decay ships ·
adding extra indexes too eagerly hurts write throughput on the
hottest write table.

---

### M10 · Partial-unique on `BrainMemory(category, key) WHERE deletedAt IS NULL`

**Evidence** · The current `@@unique([category, key])` blocks
"undelete then recreate". This is the same shape that hurt
IdentitySnapshot in v7.9 (now fixed via partial unique). Same
issue likely on BrainMemory for restorable categories.

**Fix** ·
```sql
ALTER TABLE "brain_memories" DROP CONSTRAINT IF EXISTS "brain_memories_category_key_key";
CREATE UNIQUE INDEX CONCURRENTLY "brain_memories_category_key_alive_uniq"
  ON "brain_memories"("category", "key")
  WHERE "deleted_at" IS NULL;
```

**RISK:** medium — must coordinate with `memory-manager.ts`
`findUnique({ where: { category_key: …}})` callers since Prisma
maps `@@unique` to a named compound key. Soft-delete consumers
need a fallback findFirst path. Schedule together with the
schema-sentinel update.

**Expected gain:** clean restore semantics; not a perf gain.

---

## 3 · Dead / redundant indexes · 11 candidates

The supplementary `20260507103256_add_missing_indexes_v10_0_381`
migration shipped indexes that are now redundant. Each `CREATE
INDEX IF NOT EXISTS` paired with the schema's `@@index([…])` is
fine, but several compounds make their single-column siblings
dead weight. Postgres can satisfy a `(a)` query with a `(a, b)`
index using the leading-column rule.

### D1-D2 · `BrainMemory` has 9 indexes — at least 2 are redundant

From `schema.prisma:1588-1614` and migration v10_0_381:

| Index | Status |
|---|---|
| `(category, key)` UNIQUE | needed |
| `(category, confidence)` | needed (recall sort) |
| `(expiresAt)` | needed (decay) |
| `(lastSeen)` | needed (decay) |
| `(category, updatedAt)` | needed (pinned panel) |
| `(category, createdAt)` | needed (recency reads) |
| `(category, deletedAt)` | needed (alive-filter) |
| `(createdAt)` standalone | **REDUNDANT** — `(category, createdAt)` covers most callers |
| `(updatedAt)` standalone | likely redundant |
| `(deletedAt)` standalone | likely redundant — `(category, deletedAt)` covers |

**Action** — drop, but verify usage via `pg_stat_user_indexes`
first:
```sql
SELECT indexrelname, idx_scan, idx_tup_read
FROM pg_stat_user_indexes
WHERE schemaname='public' AND relname='brain_memories'
ORDER BY idx_scan;
```
Drop only those with `idx_scan = 0` over >30 days.

**Expected savings:** ~1-2 MB index storage per redundant index ·
~5-10% faster INSERT/UPDATE on brain_memories (every write
maintains every index).

---

### D3 · `Task` has standalone `(status)` AND compound `(missionId, status, dueDate)` and `(loopKind, status)` AND `(goalId, status)`

`schema.prisma:357-364`. The standalone `(status)` is needed only
if a query filters by status alone with NO other column. Verify
via `pg_stat`. Likely redundant.

---

### D4 · `life_goals(status)` standalone redundant given `(domain, status)` + `(horizon, status)`

`schema.prisma:2065-2070`. Standalone `(status)` is rarely the
right pick when there are 2 compound indexes leading with status's
common co-filters.

---

### D5 · `vector_embeddings` has BOTH `(sourceType)` AND `(sourceType, sourceId)`

`schema.prisma:2271-2273`. The standalone `(sourceType)` is
**dead** — the compound serves every query that filters by
sourceType alone. **Drop:**
```sql
DROP INDEX CONCURRENTLY "vector_embeddings_sourceType_idx";
```

**Expected gain:** ~0.5 MB index storage saved. Every embedding
write maintains one fewer index page.

---

### D6 · `vector_embeddings(sourceId)` standalone is unused

Same migration: `vector_embeddings_sourceId_idx`. The hot pattern
is `(sourceType, sourceId)`. A bare `sourceId` lookup would scan
across types · this is never the access pattern. **Drop.**

---

### D7-D11 · `(createdAt)` + `(updatedAt)` standalone on ~50 tables

The mass index migration v10_0_381 added `createdAt` + `updatedAt`
indexes to every model. Several are dead weight:

- `OperatorProfile` · only 1 row, no recency queries
- `OperatorPreference` · 1 row
- `RunnerNode` · single-digit rows
- `SystemSnapshot` · single row scope
- `Integration` · ~10 rows
- `StrategicLaw` · static (~189 rows)
- `DailyStrategy` · 1 row/day, queried by unique date

**Action** · for any table with `@unique` on a `date` column and
< 1000 rows, drop both `(createdAt)` and `(updatedAt)`:
```sql
DROP INDEX CONCURRENTLY "OperatorProfile_createdAt_idx";
DROP INDEX CONCURRENTLY "OperatorProfile_updatedAt_idx";
-- repeat for: OperatorPreference, RunnerNode, SystemSnapshot,
--             integrations, strategic_laws, daily_strategies
```

**Expected savings:** ~5-10 MB across the board · 14 redundant
indexes × 2 columns × ~50KB each. More importantly, removes
write amplification on lookup tables.

---

## 4 · Hot tables needing partition · 4 candidates

Postgres-13+ declarative RANGE partitioning by created_at lets
Neon's autovacuum keep recent partitions hot while older months
roll off into cold compute.

### P1 · `audit_events` · **HIGH priority**

`audit_events` accumulates ~100+ rows/day per the spec, with a
tiered 14d/60d/90d/180d retention. Queries are time-windowed
(`createdAt >= cutoff`) and per eventType. Monthly RANGE partition
on `createdAt` lets retention enforcement be a `DETACH PARTITION`
operation instead of a `DELETE` row scan.

**Migration sketch** (Postgres declarative partitioning, ~50ms
DETACH vs ~30s DELETE on 100K rows):
```sql
-- Create partitioned parent
CREATE TABLE audit_events_p (LIKE "AuditEvent" INCLUDING ALL)
  PARTITION BY RANGE ("createdAt");
-- Monthly partitions
CREATE TABLE audit_events_p_2026_05 PARTITION OF audit_events_p
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
-- ... etc
-- Swap-table or pg_partman for automated roll-forward.
```

**RISK:** medium — requires migrating live data; do via Neon
branch first.

**Expected gain:** 90d retention cron drops from row-scan delete
to partition detach. ~10 sec → ~10 ms.

---

### P2 · `entity_audits` · **HIGH priority**

Same pattern as audit_events but explicitly designed with 90d hot
window per `lib/db/audit-retention.ts:34`. Currently hard-deletes
rows > 90d:
```typescript
const aged = await prisma.entityAudit.deleteMany({
  where: { createdAt: { lt: hotCutoff } },
});
```

This is a row-by-row DELETE on potentially tens of thousands of
rows every nightly cron fire. **Partition by month + DETACH old
partitions** is dramatically cheaper.

---

### P3 · `agent_traces` · **MEDIUM priority**

30d retention per `config/retention.ts:51`. AT 100+ traces/day
this is 3000 rows monthly. Heat is recent — older traces are
analytical-only. RANGE partition by `started_at`.

---

### P4 · `chat_messages` · **MEDIUM priority** but **trickier**

The `searchable_tsv` GENERATED ALWAYS tsvector column complicates
partitioning (each partition needs its own GIN index). However,
chat messages are FOREVER-retention per `config/retention.ts:25`,
so the goal isn't pruning · it's keeping the recent partition hot.

**Recommendation:** defer until the table crosses 100K rows
(estimated ~18 months at current write rate). Premature
partitioning is worse than late partitioning here.

---

## 5 · pgvector index tuning

### V1 · HNSW build params are **conservative-default**, not tuned

From `prisma/migrations/20260429250000_pgvector_extension_and_column/migration.sql:34-40`:

```sql
CREATE INDEX … USING hnsw ("embedding_vec" vector_cosine_ops);
```

**No `WITH (m = …, ef_construction = …)` clause.** pgvector
defaults to `m=16, ef_construction=64`. The migration comment
says these are "tuned for typical brain corpora (≤100K rows)" but
they ARE the pgvector defaults · no tuning happened.

At current ~7000 rows the defaults are fine. As the corpus grows
to 50K+:

**Fix** ·
```sql
-- Best practice: ef_construction = 200, m = 24 for 100K-1M rows
DROP INDEX CONCURRENTLY "vector_embeddings_embedding_vec_hnsw_cosine_idx";
CREATE INDEX CONCURRENTLY "vector_embeddings_embedding_vec_hnsw_cosine_idx"
  ON "vector_embeddings"
  USING hnsw ("embedding_vec" vector_cosine_ops)
  WITH (m = 24, ef_construction = 200);
```

**RISK:** HIGH — index rebuild on a table with 7000 vectors of
1536 dims is ~10-30 sec, blocking writes. Do during low-traffic
window OR build NEW index, drop old.

**Expected gain:** ~5% recall improvement at query time. Marginal
today; meaningful at scale.

---

### V2 · `embedding_vec` declared `vector` (no dim) AND `embedding_vec_1536` declared `vector(1536)` · **two columns for the same data**

`schema.prisma:2266-2267`:
```
embedding_vec      Unsupported("vector")?
embedding_vec_1536 Unsupported("vector(1536)")?
```

The HNSW index is on `embedding_vec` (no dim). pgvector indexes
work on typed vector columns of FIXED dim — the `vector` type
without a dim hint is more permissive but **can't be used by the
HNSW index without an implicit cast**.

**Recommendation:** verify which column actually has data via:
```sql
SELECT COUNT(*) FILTER (WHERE embedding_vec IS NOT NULL) AS untyped,
       COUNT(*) FILTER (WHERE embedding_vec_1536 IS NOT NULL) AS typed
FROM vector_embeddings;
```

If both have data, you're paying ~2× the storage. Consolidate to
one column. Audit-2026-05-05 noted "100% vec_filled" — verify
which column.

---

### V3 · Default `ef_search` not configured on Neon role · queries use code-side `withEfSearch`

`lib/db/vector-tuning.ts` wraps individual queries in `SET LOCAL
hnsw.ef_search = N`. The implicit default for queries that DON'T
call `withEfSearch` is whatever the Neon role default is (likely
40, the pgvector default).

**Action** · set the role default explicitly in production:
```sql
ALTER ROLE neondb_owner SET hnsw.ef_search = 40;
-- For higher recall on warm queries (memory recall path),
-- continue using withEfSearch(prisma, 80, …) at call sites.
```

**Expected gain:** none unless current default is wrong; this is a
documentation+belt-and-suspenders fix.

---

## 6 · Memory consolidation effectiveness

Reading `lib/brain/memory-consolidation.ts` (711 lines), the
consolidator has 9 stages: prune, merge, promote-wisdom, distill,
score, cross-pollinate, self-heal, health-check, evolve. **All
nine fire daily inside `runConsolidation()` per `config/crons.ts:194-202` (folded into mega-evening).**

### C1 · `pruneNoise()` deletes only via three criteria — **expired + low-confidence stale + action_frequency dupes**

`lib/brain/memory-consolidation.ts:205-260`:
```typescript
const expired = await prisma.brainMemory.deleteMany({
  where: { expiresAt: { lt: new Date() } },
});
const stale = await prisma.brainMemory.deleteMany({
  where: { confidence: { lt: 0.1 }, lastSeen: { lt: daysAgo(14) } },
});
// action_frequency dupes capped at 500 newest rows
```

The action_frequency dupe sweep is capped at 500 rows. With heavy
chat traffic accumulating 100+ action_frequency rows/day, the cron
can fall behind — **this matches the audit-2026-05-05 note about
"~1 row per turn" tool_verb_ratio writing**.

**FIX C1:** lift the cap to 5000 OR run more frequently. Better:
move action_frequency into its own table with TTL.

---

### C2 · `mergeMemories()` AI-driven · costs $$ per cron fire

The merge stage:
1. Pulls top-30 memories per category with `groupBy({ category })`
2. Sends each batch to AI: `aiChat([…], "fast")`
3. Executes merges via `$transaction`

Each `aiChat` call is ~$0.001-0.005. With ~10 categories having
>3 memories, that's ~$0.05 per evening cron fire = ~$18/year. Not
huge but not free.

**Verify:** if `distillKnowledge()` already produces wisdom rows
from the same pool, merging may be redundant. The two stages were
designed in different waves and may overlap.

---

### C3 · `scoreMemories()` updates 100 rows/night

```typescript
const memories = await prisma.brainMemory.findMany({
  where: { confidence: { gt: 0 }, category: { not: "wisdom" } },
  orderBy: { updatedAt: "asc" },
  take: 100,
});
```

At 100 rows/night × 365 days, the entire ~3000-memory table
cycles through scoring every ~30 days. Fine.

**Concern:** the `if (Math.abs(newConfidence - m.confidence) >
0.05)` guard is the only thing preventing constant rewrites. With
the v10.0.35 fix excluding wisdom, this is healthy. **No action
needed.**

---

### C4 · `selfHeal()` auto-resolves contradictions after 30 days · **HIDES data**

```typescript
const oldContradictions = await prisma.contradiction.updateMany({
  where: { resolved: false, createdAt: { lt: 30 days ago } },
  data: { resolved: true, resolvedHow: "Auto-resolved after 30 days without action" },
});
```

Per DATABASE-ARCHITECT lens: this is auto-acknowledging signal
without operator review. If the operator's "I follow up on every
lead" claim is contradicted by evidence, that contradiction
auto-resolves silently. **The signal is being eaten.**

**RECOMMEND:** soft-archive (move to `auto_resolved_at` column)
instead of marking `resolved=true`. Preserve the signal for
identity-snapshot mining.

---

### C5 · The `crossPollinate()` connection counter is `O(N×M)` AI-cost-free but write-heavy

Per cron run:
- 10 wisdoms × 5 contradictions = 50 edge candidates checked
- 5 predictions × 5 reflections = 25 candidates checked

Cheap. **No action.**

---

## 7 · Top-10 ranked fixes

Ranked by `(estimated_monthly_savings + latency_value) − risk_cost`.
Risk is HIGH if data migration; MEDIUM if index swap; LOW if
config-only.

| # | Fix | $/mo saved | Latency reduction | Risk |
|---|---|---|---|---|
| 1 | **Partition `entity_audits` by month** + replace DELETE retention with DETACH PARTITION | ~$2-4 (compute + storage) | retention cron 10s→10ms | HIGH (data migration) |
| 2 | **Partition `audit_events` by month** + same | ~$1-3 | retention cron 5s→5ms | HIGH |
| 3 | **Drop 14 dead `(createdAt)`/`(updatedAt)` standalone indexes on small tables** (OperatorProfile, OperatorPreference, RunnerNode, SystemSnapshot, integrations, strategic_laws, daily_strategies) | ~$0.50-1 | write throughput +5-10% on tiny tables | LOW |
| 4 | **Drop `vector_embeddings(sourceType)` and `vector_embeddings(sourceId)` standalone** (covered by composite) | ~$0.10 | embedding write +1-3% | LOW |
| 5 | **Add `chat_messages(conversationId, role, createdAt)` compound** for system-prompt build | $0 (slight increase) | chat warm path -5-20ms × ~50 calls/day | LOW |
| 6 | **Tune HNSW: `WITH (m=24, ef_construction=200)`** · rebuild concurrent | $0 | recall +5% at 50K+ rows | MEDIUM (rebuild blocks writes ~30s) |
| 7 | **Move `brain_memories(category="action_frequency")` to a dedicated `action_frequencies` table** with TTL | ~$0.50-1 (no more O(N) consolidator scans) | consolidator -200-500ms | MEDIUM (new table + dual-write window) |
| 8 | **Resolve `vector_embeddings.embedding_vec` vs `embedding_vec_1536` redundancy** · drop the unused column | up to 50% of vector_embeddings storage if both populated | embed write -50% if dual-write happening | MEDIUM (data audit needed first) |
| 9 | **Partition `agent_traces` by month** | ~$0.50 | retention cron 5s→5ms | HIGH |
| 10 | **Soft-archive `selfHeal()` auto-resolved contradictions** instead of marking `resolved=true` | $0 | none (it's an honesty/quality fix) | LOW |

**Total estimated savings:** ~$5-12/mo (small in absolute terms ·
the system isn't bleeding money on DB) BUT meaningful latency
reductions on hot paths AND substantial reduction in retention
cron times (the partition fixes alone make data-cleanup ~100×
faster).

---

## 8 · Methodology + caveats

- **Read-only audit**, no live DB queries · all row counts are
  estimates from comments and retention configs.
- Static analysis only — no `pg_stat_user_indexes` data, so dead-
  index claims are "likely dead" not "verified dead". Operator
  should pull the actual stats before dropping anything.
- Pricing assumes Neon Pro plan list pricing as of 2026. The
  user's actual bill may differ (autoscaling compute, branch
  costs, etc.).
- The biggest unknown is the **actual write rate of brain bus
  events** — `brain_bus_events` retention is unset in
  `config/retention.ts`. If producers are generating thousands of
  events daily, this table could grow large quickly. **Add a
  retention policy entry for it.**

---

## Top-3 actionable fixes (the 80/20)

1. **Partition entity_audits + audit_events by month.** Single
   biggest cost-perf lever. Replaces row-scan retention cron with
   ~ms partition detach.
2. **Drop redundant indexes** (5 × `createdAt`/`updatedAt`
   standalones on small tables + 2 × vector_embeddings dupe
   indexes). Free latency win on every write.
3. **Add `brain_bus_events` to `config/retention.ts`** with a
   `days: 14` policy (or shorter for `done` rows). Currently
   unbounded · operator might be paying for ancient processed
   events.

## Biggest open question

**Is `vector_embeddings.embedding_vec` AND `embedding_vec_1536`
actually dual-populated, or is one column dead?** The deep-honesty
audit said "100% vec_filled" without specifying which column. If
both are populated, you're storing 1536 floats × 7000 rows × 2 =
~100 MB redundantly. A single `SELECT COUNT(*) FILTER…` query
against prod settles this and unlocks fix #8.
