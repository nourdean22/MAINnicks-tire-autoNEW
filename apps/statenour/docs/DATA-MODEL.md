# Data Model · statenour-os

Prisma models in one Neon Postgres instance · model count last
verified 2026-05-21. This file is the map — if you're about to write a
migration or add a feature, read the relevant section first.

> **Model count:** 101 — verified via `grep -c "^model " prisma/schema.prisma` (2026-06-19).

> **NOUR OS consolidation models (#206) + migration `20260618000000_consolidated_models` (PR #217):**
> 10 models — `ContentNode`, `Contact`, `Booking`, `Agreement`, `Product`,
> `Order`, `FinancialTransaction`, `InvestmentHolding`, `ShortLink`, `LinkClick`
> (back `/crm` `/wealth` `/finance` `/links`) — are in `schema.prisma`. Their
> tables are **REGISTERED but not yet applied to prod**; apply via the guarded
> `apply-pending-migration` endpoint (key `20260618000000_consolidated_models`).
> See `prisma/migrations-pending/README.md`.

> **v526 prod index migration APPLIED (v529.1 · 2026-05-12):** 8
> `CREATE INDEX CONCURRENTLY` + 14 `DROP INDEX CONCURRENTLY` ran via
> `scripts/apply-pending-migration.ts` (autocommit pg driver bypasses
> Prisma's implicit transaction wrap). New indexes:
> `chat_messages_conv_role_created_idx` · `brain_memories_source_created_idx`
> · `agent_traces_label_started_idx` · `entity_audits_type_action_created_idx`
> · `chat_messages_parent_created_idx` · `brain_bus_events_topic_status_available_idx`
> · `audit_events_event_actor_created_idx` (PascalCase `AuditEvent`
> table · M8 fixup). `prisma migrate resolve --applied` recorded · 23
> migrations clean. M1 covering `INCLUDE` on `vector_embeddings`
> deferred (pgvector edge case).

> **v10.0.451 → v10.0.473 schema-timestamp parking lot:** the audit at
> `docs/schema-timestamp-audit-2026-05-07.md` flagged 8 mutable models
> missing `updatedAt`. The migration `20260508001336_add_updated_at_to_8_mutable_models`
> is parked at `prisma/migrations-pending/` because prod Neon was unreachable
> during the apply window. When operator confirms prod connectivity, run the
> README in that directory. Schema reverted in v10.0.473.

> **v526 `VoiceLatencyEvent` model — NOT in prod.** Schema-only addition
> for prospective voice-stack telemetry. Parked migration; scheduled for
> nickstire removal per `docs/vapi-removal-plan.md` (Tier 1 SAFE DELETE
> at v530.1 · ~2,485 LOC across 15 files + this model + the parked
> migration). Do not write to it from code.

> Verified counts in [`docs/RECONCILIATION.md`](RECONCILIATION.md).
> Source of truth: [`prisma/schema.prisma`](../prisma/schema.prisma).
> Retention: [`config/retention.ts`](../config/retention.ts).
> Enforcement: `/api/cron/data-cleanup` (Sunday 3am UTC).
> v7.9 added universal `deletedAt: DateTime?` to 9 tables;
> v8.0 added the `entity_audits` table for field-level audit log;
> v8.5 added `embedding_vec vector(1536)` to `vector_embeddings` (pgvector);
> v8.30 (P7 decision · 2026-04-30) confirmed `ChatConversation.archivedAt`
> IS the soft-delete column for that model — no separate `deletedAt`. Once
> archived, a conversation hides from the default sidebar but stays
> searchable via `/api/chat/search`. Auto-archive: 60d idle (v8.11
> stale-conversation-archive cron). Read-side: queries that build
> "active sidebar / continuity / distillation" filter `archivedAt: null`;
> queries that serve search keep archived rows visible.
>
> **v10 additions** (Prime Reliability + Control Layer, 2026-04-30):
>
> - `BrainBusEvent` (v10.0.1) — durable replay log under the LISTEN/
>   NOTIFY brain-bus. Status/availableAt/lockedAt/attempts/dedupeKey
>   columns + `FOR UPDATE SKIP LOCKED` claim semantics.
> - `SchemaChangeLedger` (v10.0.2) — audit trail for every `prisma db
>   push`. Records changeKey + reason + destructive flag + rollback
>   plan + approver + applier. `lib/db/schema-ledger.ts` enforces the
>   destructive-must-have-approver rule at write time.
> - `AgentTrace` (v10.0.8) — call-chain trace for every AI call.
>   traceId + parentId + provider + model + cost + error class.
>   `lib/ai/agent-trace.ts` exposes mintTraceId / wrapTrace /
>   recordTrace / listRecentTraceChains.
>
> **Known debt — `BrainMemory.category` sprawl:** the brain layer has
> grown organically; category strings now include drift sentinels,
> identity axes, decision replays, contradictions, person profiles,
> wisdom snippets, hot rules, anchors, etc. — many overlapping. The
> category enum was never tightened; new code can invent a category
> just by writing one. The brain still works (semantic search +
> keyword filter both retrieve), but a future consolidation wave
> should: (1) freeze the enum, (2) migrate stragglers, (3) add a
> `subkind` column for finer slicing without inventing new categories.
> Tracked in `ROADMAP.md` Horizon 5 hardening.

---

## Model groups

```
┌────────────────── AI / NICK ─────────────────────┐
│  AiGeneration       per-call cost + latency     │
│  ChatConversation   header                       │
│  ChatMessage        full message log             │
│  BrainMemory        the brain (everything)       │
│  MemoryEdge         memory graph edges           │
│  VectorEmbedding    semantic search vectors      │
│  AutonomousAction   audit of Nick's auto moves   │
└──────────────────────────────────────────────────┘

┌────────────────── BRAIN / LEARNING ──────────────┐
│  IdentitySnapshot   8-axis self-model timeline   │
│  Reflection         daily + weekly reflections   │
│  SessionReport      review snapshots             │
│  BrainDump          brain dumps                  │
│  Contradiction      detected self-contradictions │
│  CausalChain        inferred causation           │
│  DecisionReplay     past decisions for ghost     │
│  PatternDetection   cross-signal patterns        │
│  Prediction         bet-desk predictions         │
│  MasteryDecision    decisions w/ learnings       │
│  MasteryScore       8-axis score history         │
│  StrategicLaw       personal operating laws      │
│  PersonProfile      people Nour interacts with   │
│  EnvironmentalSignal external context            │
└──────────────────────────────────────────────────┘

┌────────────────── TASKS / GOALS ─────────────────┐
│  Task               unified task + daily + promise│
│  LifeGoal           top-level goal               │
│  Mission            project                      │
│  Commitment         promises to self/others      │
│  WorkItem           in-progress work             │
│  WorkResult         outcome of a work item       │
│  DailyExecutionState per-day snapshot of focus   │
│  DailyStrategy      intentional daily plan       │
│  PersonalDailyLog   energy/mood/habits per day   │
│  Reflection         (above, shared)              │
│  StagedRecoveryItem rescue queue for lost items  │
└──────────────────────────────────────────────────┘

┌────────────────── ULTRON / SIGNALS ──────────────┐
│  SituationLog       ultron situation card state  │
│  DriftAlert         drift detection firings      │
│  OperatorCheckIn    pulse check-ins              │
│  OperatorProfile    Nour's current operator mode │
│  OperatorPreference per-feature knobs            │
│  ScheduledAction    future-scheduled actions     │
│  RunnerNode         local runner registration    │
│  StateLog           NourState transitions        │
└──────────────────────────────────────────────────┘

┌────────────────── CAPTURE / INGEST ──────────────┐
│  CaptureInboxItem   unsorted capture feed        │
│  Integration        external integration config  │
│  ApiRequestLog      every request logged         │
│  DriveIngestLog     (via BrainMemory category)   │
│  LocalSyncLog       bridge sync receipts         │
└──────────────────────────────────────────────────┘

┌────────────────── BODY / FINANCIAL ──────────────┐
│  BodyTracking       weight + workout + sleep     │
│  FinancialSnapshot  net delta + savings rate     │
│  DailyEmpireSnapshot aggregate rollup            │
└──────────────────────────────────────────────────┘

┌────────────────── DEVICE / HOME ─────────────────┐
│  SmartDevice        Ring/Eufy/Tuya/Google        │
│  DeviceCommand      queued commands for agent    │
│  DeviceEvent        events from devices          │
│  VisionEvent        camera motion/presence       │
└──────────────────────────────────────────────────┘

┌────────────────── SYSTEM / AUDIT ────────────────┐
│  CronJobLog         every cron run               │
│  ErrorLog           every thrown error           │
│  SystemMetric       metric timeseries            │
│  SystemSnapshot     periodic full snapshots      │
│  AuditEvent         generic audit (tiered)       │
│  ServiceHealth      per-integration health       │
│  ReviewLog          weekly/monthly review log    │
│  UserPreference     user-facing settings         │
│  RecoveryActionLog  recovery pattern log         │
│  CommandResolution  command-palette usage log    │
│  AutomationRule     automation rule catalog      │
│  ExecutionInsight   execution pattern insight    │
│  ArsenalLog         integration arsenal actions  │
└──────────────────────────────────────────────────┘
```

---

## The fat-finger models

When designing features, know these are the models you'll most often
touch:

| Model | Fields | Notes |
|---|---|---|
| **Task** | 30 | unified task + daily + promise. `goalId`, `missionId` for bridge |
| **SystemSnapshot** | 23 | periodic state snapshot |
| **CaptureInboxItem** | 22 | unsorted capture → classified into task/memory/decision |
| **DailyExecutionState** | 20 | per-day focus state |
| **LifeGoal** | 18 | top-level goal w/ timeline |
| **PersonalDailyLog** | 17 | mood + energy + habits + weight + one per day |

`BrainMemory` is the firehose — any model we didn't bother creating
goes here as a typed key/value pair. Query: `category: "X"`, `key: "Y"`,
`content: JSON`, `confidence`, `expiresAt`, `embedding` (vector).

---

## Relations today · relations coming

The schema is denormalized (80 models, 27 `@relation` declarations as of 2026-05-21).
We use string FKs + application-level joins. This is **deliberate** —
lower write coupling, simpler migrations. But it hurts referential
integrity.

**v11.0 W5.3 adds 10 relations** (not yet shipped):
```
Task.goalId              ↔ LifeGoal
Task.missionId           ↔ Mission
ChatMessage.conversationId ↔ ChatConversation
DeviceCommand.deviceId   ↔ SmartDevice
DeviceEvent.deviceId     ↔ SmartDevice
Reflection.taskId        ↔ Task (nullable)
WorkResult.workItemId    ↔ WorkItem
Commitment.taskId        ↔ Task (nullable)
```

Until then: cascading deletes are app-layer concerns; orphan rows are
swept by `data-cleanup` cron.

---

## Retention policy

Full spec: [`config/retention.ts`](../config/retention.ts). Enforced
every Sunday 3am UTC by `/api/cron/data-cleanup`.

| Shape | Model | TTL | Why |
|---|---|---|---|
| **forever** | BrainMemory, ChatMessage, ChatConversation, AutonomousAction, SessionReport, DecisionReplay, IdentitySnapshot | — | audit + brain memory |
| **short (7-30d)** | ApiRequestLog (7d), SystemMetric (30d), StateLog (30d), CronJobLog (30d w/ keep last per job), ErrorLog (30d), DeviceEvent (14d), LocalSyncLog (90d) | — | hot metrics |
| **medium (30-90d)** | AiGeneration (90d), DeviceCommand (30d completed only), RecoveryActionLog (90d), SituationLog (90d), NotificationQueue (30d for terminal statuses) | — | cost + anomaly windows |
| **long (90-365d)** | AuditEvent (tiered: 14d noisy, 60d cron, 90d generic, 180d insight), ReviewLog (365d) | — | pattern signal |

---

## Common queries

### "Show me today's Nick cost"
```sql
SELECT COUNT(*) AS calls,
       SUM(cost_cents)/100.0 AS dollars,
       AVG(duration_ms) AS avg_ms
FROM ai_generations
WHERE created_at >= date_trunc('day', now());
```

### "Which cron hasn't run in >24h?"
```sql
SELECT job_name, MAX(created_at) AS last_run
FROM cron_job_logs
GROUP BY 1
HAVING MAX(created_at) < now() - interval '24 hours';
```

### "How many active brain memories?"
```sql
SELECT COUNT(*) FROM brain_memories
WHERE (expires_at IS NULL OR expires_at > now())
  AND confidence >= 0.1;
```

### "Top 10 Nick tools by failure rate"
```sql
SELECT tool_name,
       COUNT(*) AS calls,
       SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END)::float / COUNT(*) AS fail_rate
FROM system_metrics
WHERE metric_type = 'tool_invocation'
  AND created_at >= now() - interval '7 days'
GROUP BY 1
ORDER BY fail_rate DESC, calls DESC
LIMIT 10;
```

### "Recent autonomous actions without approval"
```sql
SELECT id, rule_name, trigger, created_at
FROM autonomous_actions
WHERE approval = 'pending'
ORDER BY created_at DESC;
```

---

## Migrations history

| Applied | Name | Notes |
|---|---|---|
| 2026-01-? | 0001_init | full initial schema |
| 2026-04-18 | 20260418001455_add_decay_and_watcher_indexes | perf indexes on BrainMemory decay path |
| 2026-04-26 | 20260426193000_add_task_events | TaskEvent append-only event log |
| 2026-04-27 | 20260427000000_add_goal_events | GoalEvent append-only event log |
| 2026-04-28 | 20260428210000_add_perf_indexes | system_metrics(createdAt) + autonomous_actions(result, createdAt) + brain_memories(category, createdAt) |
| 2026-04-29 | 20260429154500_add_chat_message_attachments | ChatMessage.attachments JSONB |
| 2026-04-29 | 20260429170000_chat_message_batch_a | **+16 cols on chat_messages, +7 on chat_conversations, +tsvector GIN, +self-ref FK** |
| 2026-04-29 | 20260429190000_universal_idempotency | **+idempotency_key on autonomous_actions, scheduled_actions, task_events, goal_events, reflections, decision_replays + UNIQUE PARTIAL INDEX per table** |
| 2026-04-29 | 20260429210000_universal_audit_actor | **+createdBy/updatedBy on Mission, Task, life_goals, brain_memories, mastery_decisions, commitments + per-table createdBy index. AsyncLocalStorage helper auto-resolves "user" / "nick" / "cron:<jobName>" / "bridge:<system>" / "system".** |
| 2026-04-29 | 20260429220000_universal_soft_delete | **+deletedAt on Mission, Task, life_goals, brain_memories, mastery_decisions, commitments, brain_dumps, reflections, identity_snapshots + per-table deletedAt index. Helper module `lib/db/soft-delete.ts` exposes softDelete / restore / findManyActive / countActive / softDeleteFor.** |
| 2026-04-29 | 20260429230000_identity_snapshot_drop_date_unique | **v7.9.1 hotfix — drop `IdentitySnapshot.date @unique`; replace with `@@index([date])`. Soft-delete needs to support "redo today" by hiding the prior alive row.** |
| 2026-04-29 | 20260429240000_entity_audit | **Phase 2A — new `entity_audits` table for universal field-level provenance log. Composed on v7.8 (actor) + v7.9 (soft-delete) to answer "who changed what when". Helper module `lib/db/entity-audit.ts` exposes recordAudit / logCreate / logUpdate / logSoftDelete / logRestore / logPurge / diffData / getEntityHistory / getActorActivity. API at `GET /api/audit/entity?type=&id=`.** |
| 2026-05-12 | v526 index optimization (applied v529.1) | **8 `CREATE INDEX CONCURRENTLY` + 14 `DROP INDEX CONCURRENTLY` applied to prod Neon via `scripts/apply-pending-migration.ts` (autocommit pg driver). New: `chat_messages_conv_role_created_idx` · `brain_memories_source_created_idx` · `agent_traces_label_started_idx` · `entity_audits_type_action_created_idx` · `chat_messages_parent_created_idx` · `brain_bus_events_topic_status_available_idx` · `audit_events_event_actor_created_idx` (M8 PascalCase fixup). M1 covering INCLUDE on `vector_embeddings` deferred. Source audit: `docs/audits/db-cost-access-patterns-2026-05-12.md`.** |

## Universal Entity-Audit (v8.0 Phase 2A · 2026-04-29)

A new generic `entity_audits` table records every meaningful mutation
(create / update / soft_delete / restore / purge) across the autonicks
personal-OS schema, with the actor and field-level diff. Composes on
top of v7.8 actor and v7.9 soft-delete to answer:

- "Show me everything Nick has done to my goals this week"
- "What changed in this mission between Mon and Wed?"
- "Who soft-deleted this brain memory and why?"

**Distinct from per-entity event logs** (TaskEvent, GoalEvent):
- TaskEvent / GoalEvent — domain-semantic ("started", "snoozed",
  "priority_changed") for the brain pattern miner.
- EntityAudit — field-level diffs (`title: 'A' → 'B'`) for "what
  happened" queries.

Both can coexist; they answer different questions.

**Schema** (`entity_audits` table):
- `entity_type` (lowerCamel Prisma model key — task / mission / lifeGoal / brainMemory)
- `entity_id`
- `action` — `created` | `updated` | `soft_deleted` | `restored` | `purged`
- `actor` — v7.8 format (`user` / `nick` / `system` / `cron:<jobName>` / `bridge:<system>`)
- `before` / `after` — Json, **diff only** (only changed keys, not full row)
- `reason` (optional human/AI explanation), `source` (optional surface tag)
- `idempotency_key` — auto-minted, 5s bucket, partial unique

**Indexes**: `(entity_type, entity_id, createdAt)` for per-entity history,
`(actor, createdAt)` for actor firehose, `(action, createdAt)` for
"what got soft-deleted today", `(createdAt)` global firehose.

**Helper API** (`lib/db/entity-audit.ts`):
```ts
import { logCreate, logUpdate, logSoftDelete, getEntityHistory } from "@/lib/db/entity-audit";

// Convenience constructors auto-pick the actor from async context
// and skip writing when there's no real diff.
await logCreate("task", task.id, task);
await logUpdate("task", id, before, after, { source: "service:updateTask" });
await logSoftDelete("brainMemory", id, { reason: "user clicked archive" });

// Read history for one entity
const history = await getEntityHistory("task", "t1", { limit: 50 });
```

**Wired call sites**:
- `lib/db/soft-delete.ts` softDelete + restore — auto-emit on every soft-delete/restore
- `lib/services/tasks.ts` createTask + updateTask
- `lib/services/missions.ts` createMission + updateMission
- `app/api/goals/route.ts` POST + PATCH

**API**: `GET /api/audit/entity?type=task&id=<id>&limit=50`
- `?firehose=1&actor=nick` — global firehose by actor (no entityId)
- `?action=soft_deleted&since=2026-04-29` — filter
- All filters compose

## Universal Soft-Delete (v7.9 · 2026-04-29)

Nine high-value tables now have `deletedAt: DateTime?` instead of
hard-delete on user actions:

| Model | Why soft-delete (vs hard) |
|-------|---------------------------|
| Mission | Cascade-delete tasks; preserve archive for "Why did I drop this?" recall |
| Task | Brain layer mines abandoned-task patterns + supports undo |
| LifeGoal | Goals shift constantly; preserve "goals Nour stopped pursuing" signal |
| BrainMemory | Manual "forget" should be reversible; pinned/anti-pattern UIs need undo |
| MasteryDecision | Audit trail required for the decision-replay loop |
| Commitment | Same — "broken commitments" pattern miner needs the history |
| BrainDump | Stray dump deletions shouldn't cost data |
| Reflection | Crons re-emit daily reflections; soft-delete preserves prior versions |
| IdentitySnapshot | "Redo today" without breaking the daily-unique constraint |

**Contract**:
- `deletedAt = null` → row alive (default)
- `deletedAt = now()` → hidden from default queries
- restore by clearing the column

**Helper API** (`lib/db/soft-delete.ts`):
```ts
import { softDelete, restore, findManyActive, softDeleteFor } from "@/lib/db/soft-delete";

await softDelete("task", { id });          // mark deleted, idempotent
await restore("task", { id });             // bring back
await findManyActive("task", { where: { ownerId } });  // auto-filters

const goals = softDeleteFor("lifeGoal");    // curried per-model API
await goals.delete({ id });
await goals.findManyActive({ where: { domain: "business" } });
```

**Wired call sites**:
- `app/api/goals/route.ts` DELETE (+ findMany honors `?includeDeleted=1`)
- `lib/services/tasks.ts` deleteTask / listTasks (default = active only)
- `lib/services/missions.ts` deleteMission (cascades soft-delete to child tasks)
- `app/api/brain/pinned/route.ts` DELETE (unpin)
- `app/api/system/anti-patterns/route.ts` DELETE
- `app/api/system/memory-decay/route.ts` POST {action:"delete"|"restore"|"purge"}
- `lib/brain/memory-manager.ts` `forget()` (+ new `restore()` and `purge()`)
- `lib/ai/system-prompt.ts` — all four BrainMemory injection paths filter `deletedAt: null`
- `lib/ai/tools.ts` `searchMemories` + person/correlation/anti-pattern tool calls

**Intentionally still hard-delete** (purgers, not user actions):
- `lib/system/stale-data-purger.ts` — TTL cleanup
- `lib/brain/memory-consolidation.ts` — duplicate merging
- `app/api/cron/data-cleanup/route.ts` — recurring GC
- `app/api/brain/reset/route.ts` — full nuke
- `prisma/seed.ts` + `scripts/*` — one-shots

## ChatMessage Batch A (v7.6 · 2026-04-29)

`chat_messages` now carries 23 fields (up from 7). The audit-driven
expansion fixed the entire class of "rich content lost on reload"
bugs and unlocked branching/edit/cost/search.

**New columns:**
- `client_message_id` — idempotency key (client-minted UUID)
- `parts` — full UIMessage tree (text + file + reasoning + tool-call + tool-result + source)
- `streaming_state` — complete | partial | errored | aborted
- `parent_message_id` (self-ref FK) + `branch_id` — branching/regenerate
- `edited_at` + `edit_history` — in-place edit + bounded history
- `error_details` — structured stream-error payload
- `provider` + `router_reason` + `latency_ms` + `first_token_latency_ms` — observability
- `cost_cents` + `prompt_tokens` + `completion_tokens` — denormalized cost
- `feedback_score` — router learning ground truth (-1/null/+1)
- `searchable_content` + `searchable_tsv` GENERATED + GIN — FTS
- `attachments_hash` — SHA256 dedup

**ChatConversation enrichment (7 new):**
- `pinned_summary` (TEXT) — running compressed history
- `topic_tags` (JSONB) — sidebar filter
- `archived_at` / `starred_at` / `muted_at` (TIMESTAMP) — sidebar controls
- `last_active_at` (TIMESTAMP) — denormalized sort
- `message_count` (INT) — denormalized counter

**Helpers + endpoints:**
- `lib/ai/chat/message-fields.ts` — single source of truth for parts extraction, attachment hash, searchable content, idempotency id (27 unit tests)
- `POST /api/ai/chat/feedback` — per-message thumbs up/down
- `PATCH /api/ai/chat/edit/[messageId]` — in-place edit, appends to editHistory
- `GET /api/ai/chat/branches/[parentMessageId]` — sibling list w/ metadata
- `PATCH /api/ai/chat/conversation/[id]` — archive/star/mute/title
- `GET /api/system/conversation-costs?range=...` — per-conv cost rollup with p95 latency + provider mode
- `GET /api/cron/chat-message-backfill` — fills Batch A fields on legacy rows (every 6h until empty)

**Most schema changes have been applied via `prisma db push` (raw SQL)
rather than migrations** — W5.4 reconciliation is pending. Consequence:
`prisma migrate status` shows drift. Workaround until W5.4 reconciles:
document new changes in this file and/or via raw SQL scripts in
`scripts/` (e.g. `scripts/add-pinned-index.ts`).

---

## Index inventory

Full list: `grep "@@index\|@unique\|@@unique" prisma/schema.prisma`.
Count: 101 indexes, 25 unique constraints.

Hot-path indexes worth knowing:
- `BrainMemory(category, key)` unique — every lookup
- `BrainMemory(embedding)` HNSW/IVFFlat (via raw SQL) — semantic search
- `CronJobLog(job_name, created_at)` — /system/crons
- `ErrorLog(level, created_at)` — /system/errors
- `AiGeneration(feature, created_at)` + `(model, created_at)` — /system/ai-cost
- `AutonomousAction(rule_name, created_at)` + `(approval, created_at)` — /system/actions
- `Task(status, due_date)` — /tasks NOW lane

---

## Adding a new model

1. Edit `prisma/schema.prisma`. Keep field names snake_case on DB side via `@map`.
2. Add indexes for hot-path reads.
3. Run `pnpm db:migrate` to create a migration.
4. Update `lib/env.ts` if new env vars are needed.
5. Add a retention entry to `config/retention.ts` if the model is log-shaped.
6. Extend `/system/` surface if it's user-visible.
7. Document it above.

---

## Logs-that-grow-forever vs pinned

These tables grow indefinitely. Nothing runs against them except the
retention cron. Monitor Neon storage growth monthly via `/system` →
database models panel.

| Table | Growth driver | Mitigation |
|---|---|---|
| `ChatMessage` | every Nick turn | none — this is long-term memory |
| `BrainMemory` | chat + crons + brain engines | confidence decay + `data-cleanup` GC |
| `AiGeneration` | every LLM call | 90d retention |
| `ApiRequestLog` | every API hit | 7d retention |
| `SystemMetric` | every tool call + metric | 30d retention |
| `AuditEvent` | tiered writes | 14d-180d by eventType prefix |
| `CronJobLog` | every cron run | 30d w/ keep-last-per-job |

Projected growth at current velocity (~30 commits/day, ~80 Nick turns/day):
- ChatMessage: ~30K rows/year at current rate
- BrainMemory: ~50K rows/year (much higher with Drive ingest)
- AiGeneration: ~30K rows/year
- Total DB size: comfortably < 1GB for 3+ years on Neon free tier.

---

**Reconciled 2026-05-21** · infra sweep — model count corrected to 80
and `@relation` count to 27 (both verified via `grep` against
`prisma/schema.prisma`). If a claim in this doc contradicts code
reality, the code wins · open an issue.
