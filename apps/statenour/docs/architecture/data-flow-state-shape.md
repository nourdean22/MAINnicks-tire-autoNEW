# Data flow + state shape

A guide to the high-level data shapes that move through statenour-os.
Where the message lives at each hop, what each JSON blob carries, and
the canonical taxonomies for the three "sprawling" string columns
(`BrainMemory.category`, `AuditEvent.eventType`, `VectorEmbedding.sourceType`).

> Last verified against `prisma/schema.prisma` (2,451 LOC · 81 models)
> and the chat lifecycle in `app/api/ai/chat/route.ts` +
> `lib/services/chat/persist-{user,assistant}-turn.ts`.

---

## The chat message lifecycle — client → recall

```
┌─ CLIENT (React) ─────────────────────────────────────────────────┐
│ useChat() hook (Vercel AI SDK v6 / app/chat/page.tsx)            │
│                                                                  │
│   • holds messages: UIMessage[]                                  │
│   • POSTs body { messages, conversationId?, modeOverride?,       │
│                  providerOverride?, taskTypeOverride?,            │
│                  personality?, clientMessageId }                  │
│   • streams SSE response, hydrates into messages[]               │
└────────────────────────────┬─────────────────────────────────────┘
                             │ POST /api/ai/chat
                             ▼
┌─ ROUTE (Next.js app router) ─────────────────────────────────────┐
│ app/api/ai/chat/route.ts                                         │
│                                                                  │
│   1. requireSession + rate-limit                                 │
│   2. runGate (parse body, overrides, budget, etc.)               │
│   3. runInterceptors (image/decision/brain-dump fast-path)        │
│   4. persistUserTurn(...)  ──► creates ChatMessage(role="user")  │
│   5. mintTraceId            ──► traceId for the whole chain      │
│   6. parallel prefetch (prompt, recall, prefetch, compression)   │
│   7. buildSystemPrompt + brain context addendums                 │
│   8. streamWithFallback({ buildConfig: ... streamText ... })      │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌─ streamText (AI SDK) ────────────────────────────────────────────┐
│   • model.doStream(...)                                          │
│   • onChunk: capture TTFT, accumulate __partialRef.text          │
│   • onError: stream-error-handler (mark provider failed, persist │
│              partial as ChatMessage + agent_trace error row)     │
│   • onFinish: persist-assistant-turn (THE 977-line lifecycle)    │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌─ PERSIST ASSISTANT TURN ─────────────────────────────────────────┐
│ lib/services/chat/persist-assistant-turn.ts                      │
│                                                                  │
│   • salvage text from rawText → reasoningText → content → steps  │
│   • sanitize + image-hallucination guard + critic + reply-gate   │
│   • dedup guard on (convId, parentMessageId, branchId)           │
│   • CREATE ChatMessage(role="assistant", parts, searchableContent,│
│                        tokenUsage={ traceId, persona, turnSignal,│
│                                     contextBlocks, critic, citations,│
│                                     gate, factCheck, deeperContext })│
│   • bump conversation messageCount + lastActiveAt                │
│   • async dispatchers (fire-and-forget):                         │
│       judgeReplyAsync, criticizeAsync, tool-verb ratio,          │
│       temporal consistency, environment verifier, fabrication    │
│       rewriter, recordTrace, trackGeneration, recordInteraction, │
│       content-feedback capture, hallucination guard, friction    │
│       tracker, outcome predictions, processConversation,         │
│       summarizeAndStoreConversation, maybeAutoRename,             │
│       runPeopleIntelligence, parseActions + executeActions,      │
│       warmSuggestionCache                                        │
└────────────────────────────┬─────────────────────────────────────┘
                             │ (after 4+ messages)
                             ▼
┌─ CONVERSATION DIGEST ─────────────────────────────────────────────┐
│ lib/brain/conversation-memory.ts:summarizeAndStoreConversation   │
│                                                                  │
│   • AI extracts topics + decisions + commitments + emotionalArc  │
│     + peopleMentioned + keyInsight + followUpNeeded               │
│   • CREATE AuditEvent(eventType="conversation_digest", payload)   │
│   • UPSERT BrainMemory(category="conversation_summary",          │
│                        key="conv_<id>", source="conversation_<id>")│
│   • async storeMemoryEmbedding → VectorEmbedding(brain_memory)    │
│   • upsert PersonProfile per person mentioned                    │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼ (next chat turn, anywhere in time)
┌─ RECALL ────────────────────────────────────────────────────────┐
│ • contextual-recall pulls BrainMemory matching the new query      │
│   (3-lane RRF · CoALA boost · Cohere rerank · 4k token budget)    │
│ • conversation-recall (chat tool) cosine over conversation_summary│
│ • cross-session-thread synthesizes from digests + commitments +   │
│   tasks + people + predictions                                    │
│ • EVERYTHING THIS LIFECYCLE WROTE feeds back into the next turn's │
│   system prompt — the loop is closed.                             │
└──────────────────────────────────────────────────────────────────┘
```

---

## `ChatMessage` — the canonical chat row

```ts
// prisma/schema.prisma:1023-1144 (ChatMessage model)
{
  id                  String     // cuid
  conversationId      String
  role                String     // "user" | "assistant" | "system"
  content             String     // plaintext digest (the searchable form)
  model               String?    // model id when assistant turn
  tokenUsage          Json?      // structured blob — see below
  searchable_tsv      Unsupported("tsvector")?  // GENERATED ALWAYS AS for full-text search
  attachments         Json?      // Array<{ type:"file", mediaType, url, filename? }>
  clientMessageId     String?    // client-minted UUID (idempotency key)
  parts               Json?      // AI SDK v6 UIMessage parts tree (see below)
  streamingState      String     // "complete" | "partial" | "errored" | "aborted"
  parentMessageId     String?    // self-ref for branching
  branchId            String?    // UUID grouping siblings (regenerations)
  editedAt            DateTime?  // null = never edited
  editHistory         Json?      // last 10 versions [{ at, prevContent, prevPartsHash }]
  errorDetails        Json?      // structured error when streamingState="errored"
  provider            String?    // "venice" | "ollama" | "openai" | "anthropic" | "fallback"
  routerReason        String?    // "default" | "preferLargeContext" | "fallback-after-rate-limit" | …
  latencyMs           Int?
  firstTokenLatencyMs Int?       // TTFT — the perceived-quality metric
  costCents           Int?
  promptTokens        Int?
  completionTokens    Int?
  feedbackScore       Int?       // -1 thumbs-down | null neutral | +1 thumbs-up
  searchableContent   String?    // pre-extracted plaintext from parts (for tsvector)
  attachmentsHash     String?    // SHA256 of sorted attachment URLs (dedup storage)
  createdAt           DateTime

  // unique (conversationId, clientMessageId)
}
```

### `ChatMessage.parts` — the AI SDK v6 UIMessage tree

```jsonc
[
  { "type": "text",        "text": "Here's what I see in your data:" },
  { "type": "reasoning",   "text": "<internal thinking — Claude only>" },
  { "type": "tool-call",   "toolName": "getRevenueStats", "args": {...}, "toolCallId": "call_..." },
  { "type": "tool-result", "toolCallId": "call_...", "result": {...} },
  { "type": "file",        "mediaType": "image/png", "url": "data:..." },
  { "type": "source",      "url": "https://example.com", "title": "..." }
]
```

On reload, the client hydrates from `parts`. `content` stays as the
searchable plaintext digest (also exposed via `searchableContent` for
the tsvector index).

### `ChatMessage.tokenUsage` — the assistant-turn blob

```ts
// Written from lib/services/chat/persist-assistant-turn.ts:706-784
{
  // ── identity ──
  traceId:        "<the agent_traces.traceId for this turn>",
  promptTokens:   number,
  completionTokens: number,
  provider:       "venice" | "ollama" | "openai" | "anthropic",
  model:          "<model-id-string>",

  // ── prompt context what fired ──
  contextBlocks:  {
    recall:        boolean,
    skills:        boolean,
    identity:      boolean,
    ghost:         boolean,
    qualitative:   boolean,
    beliefs:       boolean,
    nudges:        boolean,
    contradictions:boolean,
  },
  deeperContext?: { count: number, types: string[] },
  persona:        "master" | "builder" | "friend",

  // ── turn signal (from classifyTurn) ──
  turnSignal: {
    complexity: "casual" | "complex" | "analytical" | "decision" | "reflective",
    intent:     "factual" | "analytical" | "decision" | "creative" | "reflective" | "emotional" | "casual" | "instructional",
    shape:      "email"|"sms"|"proposal"|"code"|"json"|"list"|"summary"|"freeform"|"…",
    urgency:    "low" | "normal" | "high",
    temp:       number,    // 0.1-1.05
    cot:        boolean,
  },

  // ── output critic (4-axis or 7-axis for content) ──
  critic?: {
    overall: number, // 0-100
    specificity: number, cliche: number, antiNour: number, length: number,
    wordCount: number, shouldRegen: boolean,
    reasons: string[], offenders: string[],
    // when contentMode:
    contentMode?: true,
    brandElement?: number,
    cta?: number,
    hashtagQuality?: number,
  },

  // ── citations ──
  citations?: Array<{ raw: string, category: string, detail: string, start: number, end: number }>,

  // ── reply-gate ──
  gate?: { severity: "info"|"warn"|"block", shouldRegen: boolean, reasons: string[], signals: string[] },

  // ── fact-check ──
  factCheck?: {
    total: number, unverified: number,
    claims: Array<{ raw, kind, value, start, end, verified }>,
  },

  // ── on stream error only ──
  streamError?:       true,
  errorMessage?:      string,
  partialChars?:      number,
  gracefulDegradation?: boolean,
}
```

The traceId link is the seam that lets
`/api/system/agent-traces/by-message/[id]` fan out into the full
provider/tool/brain chain without a schema migration.

---

## `BrainMemory.category` taxonomy

The full registry lives in `lib/brain/categories.ts:BRAIN_CATEGORIES`.
Domain groups + the most-used categories below. Every write should
import the const (`BRAIN_CATEGORIES.ANTI_PATTERN`) not hand-type the
string.

### Active categories (76 known)

| Domain                            | Categories                                                                                                       |
|-----------------------------------|------------------------------------------------------------------------------------------------------------------|
| **AI / Nick**                     | `ai`, `ai_analysis`, `ai_config`, `nick_advice`, `nick_quality`, `reply_quality`, `narrator_feedback`            |
| **Brain · identity + beliefs**    | `belief`, `belief_candidate`, `belief_manual`, `belief_refresh_report`, `identity_snapshot`, `qualitative_identity` |
| **Brain · insights + patterns**   | `anomaly`, `anti_pattern`, `blind_spot`, `causation`, `contradiction`, `correlation_alert`, `counter_intuitive`, `hidden_correlation`, `pattern`, `teaching_moment`, `wisdom`, `wisdom_candidate`, `wisdom_contradiction`, `reply_judgment`, `adversarial_objection`, `eval_run`, `domain_knowledge`, `nudge_ack`, `nudge_pin_hygiene` |
| **Brain · memory + learning**     | `brain`, `brain_dump_importance`, `emotional_arc`, `learning_journal`, `learning_velocity`, `lesson`, `reflection`, `skill`, `skill_pending`, `timeline` |
| **Brain · temporal patterns**     | `action_frequency`, `day_of_week`, `effort_band_avg`, `seasonal`, `time_pattern`                                  |
| **Brain · decisions**             | `decision_drift`, `decision_log`, `decision_manual`, `decision_pattern`, `decision_quality`, `decision_timing`    |
| **Brain · predictions + calibration** | `ghost_accuracy`, `ghost_prediction`, `prediction_calibration`, `prediction_lesson`, `prediction_streak`     |
| **Business / commerce**           | `business`, `crm`, `financial`, `financial_forecast`, `habit_revenue_correlation`, `industry`, `invoice`, `leads`, `live_shop`, `market`, `marketing`, `pricing`, `revenue`, `revenue_timing`, `sales`, `service`, `shop`, `staff_efficiency` |
| **Chat / conversation**           | `chat_importance`, `chat_pattern`, `chat_summary`, `conversation_summary`, `pinned_user`, `engagement`, `response_timing` |
| **Personal life**                 | `coding_preference`, `discipline`, `feedback`, `food`, `health`, `mental`, `mit`, `personal_development`, `physical`, `preference`, `routines`, `spiritual`, `tomorrow_note`, `weekly_target` |
| **Relationships + people**        | `relationships`, `comms`, `meetings`                                                                              |
| **Meta · archive + stale markers**| `ancient_device_events`, `hq_pin_candidate`, `orphan_conversations`, `overdue_decisions_reviews`, `glitch_capture`|
| **System / ops**                  | `api`, `automation`, `backlog_triage`, `browser`, `crons`, `env`, `notifications`, `system_health_digest`, `task_session`, `tools` |
| **Tech / content**                | `architecture`, `content`, `data`, `files`, `local`, `macro`, `operational`, `research`, `tech`, `ui`, `video`    |
| **Tasks + strategy**              | `planning`, `project_management`, `strategic_plan`, `strategy`                                                    |
| **Telemetry (chat post-stream)**  | `telemetry_tool_verb`, `telemetry_temporal_warn`, `chat_claim_warn`, `nick_quality`, `hallucination_flag`, `reply_quality` |

### Highest-volume categories on a typical day

| Category                | Writer                                                           | Reader(s)                                       |
|-------------------------|------------------------------------------------------------------|-------------------------------------------------|
| `conversation_summary`  | `summarizeAndStoreConversation` (post chat-turn, 4+ msgs)        | `contextual-recall`, `conversation-recall`, cross-session-thread |
| `nick_quality`          | `persist-assistant-turn.ts` output critic                        | `/admin/chat-quality` dashboard                 |
| `anti_pattern`          | `autoPromoteFailedDecisions` (nightly) + manual                  | `surfaceAntiPatterns` tool, `/system/anti-patterns` |
| `wisdom`                | `promoteToWisdom` (nightly) + `skill_ingestion` (manual packs)   | `contextual-recall` (3 reserved slots/turn)     |
| `identity_snapshot`     | `refresh-identity` cron + `runPeopleIntelligence`                | `dailyPulse`, `decisionPreFlight`               |
| `reply_judgment`        | `judgeReplyAsync` (post-stream async)                            | `/admin/chat-quality` + daily eval harness      |
| `chat_claim_warn`       | fabrication detector (post-stream)                                | `/api/ai/chat/claim-warnings` UI chip           |
| `chat_pattern`          | every 10 messages (length stats)                                  | personality learning                            |
| `weekly_target`         | `setWeeklyTargets` tool                                           | `getWeeklyTargets` tool                         |

### Deprecated (kept for back-compat · codemod rewrites on write)

```ts
// lib/brain/categories.ts:257-269
relationship      → relationships
skills            → skill
business_read     → business
business_write    → business
personal_read     → personal_development
personal_write    → personal_development
chatgpt_preference → preference
chatgpt_summary   → conversation_summary
// kept as-is (provenance matters):
chatgpt_conversation, chatgpt_decision
// catch-alls, always migrate:
uncategorized, random, desc
```

Runtime guard at `lib/brain/memory-manager.ts:32-44` —
`validateAndCanonicalizeCategory` warns on unknown, rewrites deprecated.

---

## `AuditEvent.eventType` taxonomy

Schema (`prisma/schema.prisma:742-753`):

```ts
model AuditEvent {
  id        String   // cuid
  actor     String   // who/what wrote this
  eventType String   // the taxonomy below
  detail    String   // free-form, usually a 1-line label
  payload   Json?    // structured details (varies by type)
  createdAt DateTime
  // @@index([eventType, createdAt]) + @@index([actor, createdAt])
}
```

### Top eventTypes by use (~50 distinct)

| eventType                    | Writer                                                       | What's in payload                                          |
|------------------------------|--------------------------------------------------------------|------------------------------------------------------------|
| `conversation_digest`        | `summarizeAndStoreConversation`                              | Structured digest (topics, decisions, commitments, arc — PII stripped) |
| `conversation_summary`       | Legacy summary writer (some scripts still produce these)     | Legacy `{ date, messageCount, topics, commitments, keyInsight }` |
| `brain_insight`              | Various cron jobs · `data-cleanup`, `refresh-identity`, etc. | `{ insight, basis, scope }`                                |
| `ai_error`                   | `lib/errors/record-error.ts`                                 | `{ source, error, context }`                               |
| `cron_run_failed`            | Test fixtures + cron error handler                            | `{ cronName, error }`                                       |
| `ticker_acknowledged`        | `/api/ultron/ticker/ack`                                     | `{ tickerId, by }`                                          |
| `business_metrics_sync`      | `/api/sync/business`                                         | `{ revenue, leads, bookings, source }`                      |
| `daily_backup`               | `/api/sync/backup`                                           | `{ snapshotKey, size }`                                     |
| `chat_renamed`               | `lib/chat/auto-rename`                                       | `{ conversationId, title, by: "auto"|"user" }`              |
| `chat_feedback`              | `/api/ai/chat/feedback`                                      | `{ conversationId, messageId, score: +1|-1 }`               |
| `chat_tool_call`             | tool-telemetry (legacy path)                                 | `{ toolName, success, durationMs }`                         |
| `conversation_forked`        | `/api/chat/fork`                                             | `{ fromConversationId, toConversationId }`                  |
| `email_sent`                 | `/api/email/send`                                            | `{ to, subject, threadId }`                                 |
| `push_sent`                  | `lib/notifications/push`                                     | `{ message, topic, priority }`                              |
| `page_visit`                 | `/api/brain/page-visit`                                      | `{ pagePath, durationMs }`                                  |
| `prompt_cache`               | system-prompt-cache telemetry                                | `{ hit: boolean, provider, topicTier }`                     |
| `gmail_messages_ingested`    | `scripts/ingest-gmail`, `/api/cron/ingest-gmail`             | `{ count, newCount }`                                       |
| `drive_docs_ingested`        | `scripts/ingest-drive`                                       | `{ count, totalChars }`                                     |
| `calendar_events_ingested`   | `scripts/ingest-calendar`, `/api/cron/ingest-calendar`       | `{ count }`                                                 |
| `calendar_ingest_skipped`    | `/api/cron/ingest-calendar`                                  | `{ reason }`                                                |
| `calendar_ingest_failed`     | `/api/cron/ingest-calendar`                                  | `{ error }`                                                 |
| `calendar_event`             | `/api/ai/plan-day`                                           | `{ title, start, end, source: "plan-day" }`                 |
| `device_offline_alert`       | `/api/cron/device-health`                                    | `{ deviceId, lastSeen }`                                    |
| `proactive_alert`            | `pipeline-controller`                                        | `{ alertType, content, severity }`                          |
| `memory_alert`               | (alert-telegram-bridge)                                       | `{ memoryId, urgency }`                                     |
| `journal_prompt_sent`        | `/api/cron/journal-checkin`                                  | `{ promptKey, channel }`                                    |
| `agent_actions_executed`     | `persist-assistant-turn` (nick-agent)                        | `{ actions[], conversationId, messageLength }`              |
| `people_intelligence_run`    | `persist-assistant-turn`                                     | `{ profilesUpdated, alerts[] }`                             |
| `generated_image`            | `/api/images/generate`                                       | `{ imageId, prompt, model, size }`                          |
| `upscaled_image`             | image upscaler                                                | `{ imageId, fromSize, toSize }`                             |
| `ceo_business_context`       | `/api/sync/business` (rollup write)                          | `{ revenue, leads, tasks, drift }`                          |
| `market_intel`               | `search-grounding`                                            | `{ query, results }`                                        |
| `social_post_published`      | `/api/sync/social`                                            | `{ platform, postId, mediaIds }`                            |
| `scheduled_buffer`           | `/api/social/schedule`                                       | `{ postId, scheduledAt, platform }`                         |
| `schedule_buffer_failed`     | `/api/social/schedule`                                       | `{ postId, error }`                                         |
| `notification`               | `/api/sync/nour-os`                                          | `{ type, content }`                                         |
| `tool_call`                  | `attention-tracker`                                          | `{ toolName, durationMs, success }`                         |
| `semantic_dedup_complete`    | `lib/brain/semantic-dedup`                                   | `{ scanned, merged, dryRun: false }`                        |
| `semantic_dedup_dry_run`     | `lib/brain/semantic-dedup`                                   | `{ scanned, wouldMerge, dryRun: true }`                     |
| `brain_snapshot`             | `lib/brain/cloud-memory`                                     | `{ snapshotId, size }`                                      |
| `sync_run`                   | `lib/integrations/gmail-sync`                                | `{ count, durationMs }`                                     |

### Use-case patterns

- **Idempotency check** (`summarizeAndStoreConversation`,
  `auto-rename`): query `AuditEvent` with `eventType + detail.contains(id)`
  to see if the side effect already fired.
- **Operator dashboards** (`/system/audit`, `/system/health-grid`):
  group by `eventType` + recency window.
- **Cron observability**: `eventType.contains("cron")` or
  `eventType.contains("ingested")` for ETL rollup.
- **Failure rollup**: `eventType: "ai_error"` is the universal sink for
  `recordError` calls — `level`, `context`, `provider`, `messageCount`
  go in `payload`.

> **PII note (v10.0.35):** `conversation_digest` payloads have
> `peopleMentioned` STRIPPED before write. Names + relational context
> live only in `PersonProfile` (row-level access controlled).
> AuditEvent is NOT row-level access controlled, so anyone with table
> access would get the whole digest including PII.

---

## `VectorEmbedding.sourceType` taxonomy

Schema (`prisma/schema.prisma:2256-2275`):

```ts
model VectorEmbedding {
  id                 String
  sourceType         String   // "brain_memory" | "chat" | "customer" | "knowledge" | …
  sourceId           String
  content            String   @db.Text       // raw text that was embedded
  embedding          String   @db.Text       // JSON array of floats — survives if pgvector drops
  embedding_vec      Unsupported("vector")?
  embedding_vec_1536 Unsupported("vector(1536)")?
  embedding_dim      Int?
  model              String?  @db.VarChar(64)
  createdAt          DateTime
  // @@index([sourceType, sourceId]) composite + per-axis indexes
}
```

The `embedding` field is a JSON-stringified float array. The
`embedding_vec_1536` raw-SQL column is the pgvector cousin — most
queries use the JSON because it survives if pgvector ever drops.

### Active sourceTypes

| sourceType        | Source table / surface                          | Writer                                                 | Reader                                              |
|-------------------|-------------------------------------------------|--------------------------------------------------------|-----------------------------------------------------|
| `brain_memory`    | `BrainMemory.id`                                 | `storeMemoryEmbedding` (called after `remember`)        | `contextual-recall`, `conversation-recall`          |
| `chat_message`    | `ChatMessage.id`                                 | Post-stream embedding (selective · long assistant turns)| `appendCrossSourceContext` (cross-source pull)      |
| `brain_dump`      | `BrainDump.id`                                   | `ingestJournal` post-write                             | `appendCrossSourceContext`                          |
| `reflection`      | `Reflection.id`                                  | `reflection-engine` after creating row                 | `appendCrossSourceContext`                          |
| `strategic_law`   | `StrategicLaw.id` (Greene 189 laws)              | One-time seed                                          | `appendCrossSourceContext`, `searchGreeneLaws`      |
| `skill`           | `data/skills-registry.json` (1,423 skills)       | One-time index build                                   | `lib/skills/skill-recall:recallSkills`              |
| `tool_cache`      | tool description text                            | `warmToolEmbeddings` (cold start)                      | `pruneTools` semantic ranker                        |
| `document`        | uploaded document chunks (`Document.id` planned) | `ingestDocument` → chunk → embed                       | `searchDocuments` tool                              |
| `photo`           | `VisionEvent.id` (photo metadata)                | `lib/brain/photo-embedding`                            | `getCameraIntelligence`                             |
| `customer`        | nickstire customer profile                       | (cross-ring sync)                                      | `findCustomer` semantic match                       |
| `knowledge`       | curated knowledge sources                        | `syncKnowledge` ingestion                              | `searchKnowledge`                                   |

### The recall pattern (works for any sourceType)

```ts
// lib/brain/embedding-utils.ts:semanticSearch
const queryVec = await getEmbedding(queryText);
const rows = await prisma.vectorEmbedding.findMany({
  where: { sourceType: { in: ["brain_dump", "reflection", "strategic_law", "chat_message"] } },
  select: { sourceId: true, sourceType: true, content: true, embedding: true },
});
const scored = rows.map((r) => ({
  ...r,
  similarity: cosineSimilarity(queryVec, JSON.parse(r.embedding)),
})).filter((r) => r.similarity >= 0.35);
scored.sort((a, b) => b.similarity - a.similarity);
return scored.slice(0, topK);
```

---

## `AgentTrace` — the call-chain contract

Schema (`prisma/schema.prisma:1633-1673`):

```ts
model AgentTrace {
  id           String   // cuid
  traceId      String   // SHARED across all calls in one operator request
  parentId     String?  // null for top-level
  source       String   // chat | cron | autonomous | tool | journal | brain | other
  provider     String?  // venice | ollama | openai | anthropic (null for pure-logic)
  model        String?  // model id (null for pure-logic)
  label        String   // "chat-turn" | "auto-rename" | "task-completion-detector" | …
  startedAt    DateTime
  finishedAt   DateTime?
  durationMs   Int?
  inputChars   Int?
  outputChars  Int?
  costCents    Int?
  toolCalls    Int      // count of tool invocations in this step
  errorClass   String?  // "stream_interrupted" | "auth_failed" | "timeout" | …
  errorMessage String?
  metadata     Json?    // varies — firstTokenAt, targetId, envelope, …
  createdAt    DateTime
}
```

### How messages link to traces

The seam is in the `ChatMessage.tokenUsage` blob:

```ts
// lib/services/chat/persist-assistant-turn.ts:706-713
tokenUsage: {
  // v10.0.515 · #7 reasoning-trace UI · link the assistant ChatMessage
  // to its agent_traces rows so /api/system/agent-traces/by-message/[id]
  // can fan out into the full provider/tool/brain chain without a
  // schema migration. Cheap to add to the existing JSON blob.
  traceId,
  promptTokens: usage?.inputTokens,
  completionTokens: usage?.outputTokens,
  // …
}
```

Lookup pattern:

```ts
// /api/system/agent-traces/by-message/[id]
const msg = await prisma.chatMessage.findUnique({ where: { id } });
const traceId = msg?.tokenUsage?.traceId;
const traces = await prisma.agentTrace.findMany({
  where: { traceId },
  orderBy: { startedAt: "asc" },
});
// Render as a tree using parentId
```

### Typical chain for one chat turn

```
agent_traces row 1
  label="chat-turn", source="chat", provider="venice", model="venice-uncensored"
  traceId="abc123", parentId=null
  metadata={ envelope: { reason, facts[], toolsCalled[] }, conversationId, … }
  toolCalls=2, costCents=3

  ├── agent_traces row 2
  │   label="contextual-recall", source="brain"
  │   traceId="abc123", parentId="<row 1 id>"
  │   metadata={ memoriesReturned: 8, mode: "semantic" }
  │
  ├── agent_traces row 3
  │   label="findCustomer", source="tool"
  │   traceId="abc123", parentId="<row 1 id>"
  │   metadata={ toolName: "findCustomer", args: {...}, success: true }
  │
  ├── agent_traces row 4
  │   label="auto-rename", source="brain", provider="venice"
  │   traceId="abc123", parentId="<row 1 id>"
  │
  └── agent_traces row 5
      label="conversation-memory", source="chat", provider="venice"
      traceId="abc123", parentId="<row 1 id>"
      metadata={ digest: {...} }
```

### Recording

Two helpers in `lib/ai/agent-trace.ts`:

- **`mintTraceId()`** — call at the TOP of the chain (chat route, cron
  handler, autonomous engine) to get a fresh traceId
- **`recordTrace(start, finalize)`** — write one row · accepts a
  start payload (label, source, provider, model, parentId, metadata)
  and a finalize payload (durationMs, outputChars, toolCalls,
  errorClass)
- **`makeTracedAiChat(label, source)`** — factory wrapper that produces
  an `aiChat`-compatible function that auto-traces. Used across the
  brain modules so every internal AI call shows up in the chain.

### Telemetry surfaces

- **`/system/agent-traces`** — top-level traces, grouped by traceId
- **`/system/agent-traces/[id]`** — single trace tree
- **`/system/agent-traces/by-message/[id]`** — entry from a chat
  message back to the trace tree
- **`/system/ai-cost`** — `groupBy(provider, source)` aggregation
- **error rate dashboards** — `WHERE errorClass IS NOT NULL` by source

---

## Other shapes worth knowing

### `BrainBusEvent` — durable event bus

```ts
// prisma/schema.prisma:1729-1757
{
  id, topic, eventType, payload,
  dedupeKey,        // mintIdempotencyKey suppresses duplicate NOTIFYs
  status,           // "pending" → "processing" → "done" (or "failed" | "dead")
  attempts,
  availableAt,      // backoff scheduling for retries
  lockedAt, lockedBy, processedAt,
  lastError,
}
```

The LISTEN/NOTIFY layer is the wake-up bell; this table is the
durable truth. Producer writes a row + fires NOTIFY. Consumer reads
pending rows on NOTIFY OR via 2-min polling backfill cron.

### `SchemaChangeLedger` — every `prisma db push` records here

```ts
// prisma/schema.prisma:1690-1719
{
  changeKey:    "v10.0.1-add-brain-bus-events",
  title, reason, changeType,  // add_column | drop_column | …
  method,       // db_push | migrate | raw_sql
  environment,  // local | preview | production
  sqlSummary, prismaDiff,
  destructive: boolean,
  approvedBy, appliedBy, appliedAt,
  rollbackPlan,
  status,       // planned | applied | rolled_back | failed
}
```

Surface: `/system/schema-history` reads this.

### `Reflection` — meta-cognition

```ts
// prisma/schema.prisma:1762-1789
{
  date, scope,        // "daily" | "weekly" | "monthly" | "triggered"
  category,           // "behavior" | "business" | "health" | "mastery" | "drift" | "prediction"
  insight, evidence,
  confidence,
  actionable, acknowledged,
  connections,        // { memoryIds: [], patternIds: [] }
  idempotencyKey,     // hash(date + scope + category)
  metadata,
  deletedAt,
}
```

Reflections are AI-generated rollups across BrainMemory + identity +
predictions. The idempotency key keeps the daily cron from creating
two reflections per day per category if it fires twice.

### `Prediction` — forecast taxonomy

```ts
// prisma/schema.prisma:1794-1828
{
  date, targetDate,     // YYYY-MM-DD
  category,             // "behavior" | "business" | "health" | "drift" | "operational"
  prediction, basis,
  confidence,
  status,               // "pending" | "confirmed" | "disproven" | "expired"
  outcome,              // filled at resolution
  kind,                 // "binary" | "continuous" | "interval" | "next_best_action"
  brierScore,           // (confidence - outcome)² for binary · null until resolved
}
```

`kind` was added v10.0.150 — old rows backfilled to "binary". New
predictions must declare `kind` explicitly.

### `MemoryEdge` — the relational graph

```ts
// prisma/schema.prisma:1833+
{
  sourceType, sourceId,     // "memory" | "reflection" | "prediction" | "commitment" | "decision" | "person" | "loop"
  targetType, targetId,
  relationship,             // "causes" | "blocks" | "supports" | "contradicts" | "relates_to" | "leads_to" | "depends_on"
  strength,                 // 0-1, reinforced over time
  evidence,
}
// unique (sourceType, sourceId, targetType, targetId, relationship)
```

Written by `crossPollinate` during nightly consolidation + by the
`semantic-link` module when it detects related insights.

---

## How the shapes compose end-to-end

A real example: operator says "what did Mo say about the brake job?"

```
1. POST /api/ai/chat
   body.messages[last] = { role: "user", content: "what did Mo say about the brake job?" }
   body.conversationId = "conv_abc123"

2. persistUserTurn
   ChatMessage CREATE row:
     { conversationId: "conv_abc123",
       role: "user",
       content: "what did Mo say about the brake job?",
       clientMessageId: "<from body>",
       parts: [{ type: "text", text: "..." }],
       searchableContent: "what did mo say about the brake job" }

3. parallel prefetch
   • promptPromise → buildSystemPrompt
   • auxPromise → detectCrossSessionThread
       → finds Mo in PersonProfile, recent commitments mentioning brake
       → returns "[KNOWN PERSON: Mo] Current tech, reliable, positive sentiment.\n
                    [ACTIVE COMMITMENT: 2026-05-08] Mo to inspect brake job by Friday."
   • contextual-recall
       → CoALA classifies "what did Mo say" as episodic
       → RRF over [semantic, keyword, category] lanes
       → kindMul=1.20 on episodic matches
       → cross-source pull finds 2 chat_message hits ("Past chat · 5d ago · sim 71%: You said: ...")
   • findRelatedConversations (via tool, model decides to call)
       → cosine over conversation_summary memories
       → returns conv_xyz789 from 5d ago with similarity 0.82

4. streamText fires
   onChunk captures TTFT (210ms)
   onFinish runs the 977-line lifecycle:

5. persist-assistant-turn
   ChatMessage CREATE row:
     { conversationId: "conv_abc123",
       role: "assistant",
       content: "Mo told me on Monday that the front pads need replacing...",
       parts: [{ type: "text", text: "..." }, { type: "tool-call", toolName: "findCustomer", ... }],
       provider: "venice",
       model: "venice-uncensored",
       latencyMs: 2845, firstTokenLatencyMs: 210,
       tokenUsage: {
         traceId: "abc123",
         persona: "master",
         contextBlocks: { recall: true, identity: false, … },
         turnSignal: { intent: "factual", shape: "freeform", … },
         critic: { overall: 78, specificity: 85, … },
         deeperContext: { count: 2, types: ["chat_message", "brain_dump"] },
         citations: [{ raw: "[brain:conv_xyz789]", category: "conversation", … }],
       },
       parentMessageId: "<user msg id>",
       branchId: "<user msg id>",
       streamingState: "complete" }

   AgentTrace CREATE rows (5):
     row 1: chat-turn (top-level)
     row 2: contextual-recall
     row 3: findCustomer (tool)
     row 4: findRelatedConversations (tool)
     row 5: auto-rename (if conv unnamed)

   AuditEvent CREATE: { eventType: "agent_actions_executed", payload: {...} }
                      (if any embedded actions)

6. async dispatchers (fire-and-forget):
   • judgeReplyAsync → BrainMemory(reply_judgment, key=<messageId>)
   • criticizeAsync → BrainMemory(adversarial_objection, ...)
   • processConversation → updates emotional_arc, beliefs, etc.
   • summarizeAndStoreConversation (if 4+ msgs):
       AuditEvent CREATE: { eventType: "conversation_digest", payload: digest }
       BrainMemory UPSERT: { category: "conversation_summary", key: "conv_abc123" }
       VectorEmbedding CREATE: { sourceType: "brain_memory", sourceId: <memory_id> }
       PersonProfile UPSERT: { name: "Mo", interactionCount++, lastInteraction: now }
   • runPeopleIntelligence (rate-limited 6h)
   • maybeAutoRename → ChatConversation UPDATE { title: "Mo on brake job" }

7. Future turn ("how did the brake job turn out?")
   contextual-recall finds:
     • conversation_summary key=conv_abc123 (Mo brake job, 1d ago)
     • cross-source chat_message hit from the assistant reply above
     • PersonProfile Mo with updated interactionCount
   → the model has the full context without ever re-reading the raw thread
```

This is the loop — every dispatch writes data that becomes input to
the next turn's recall. The closure is what makes the brain
"remember" without an explicit memory load.

---

## Common seams future-Nour will look for

| Question                                            | File · symbol                                            |
|-----------------------------------------------------|----------------------------------------------------------|
| Where do I add a new ChatMessage field?             | `prisma/schema.prisma:ChatMessage` + persist-assistant-turn |
| Where do I add a new tokenUsage subfield?           | `persist-assistant-turn.ts:706-784` (the `tokenUsage:` object) |
| Where do I add a new BrainMemory category?          | `lib/brain/categories.ts:BRAIN_CATEGORIES`                |
| Where do I add a new AuditEvent eventType?          | (no central registry — grep `eventType: "<name>"` to see writers · convention is snake_case) |
| Where do I add a new VectorEmbedding sourceType?    | `lib/brain/embedding-utils.ts:storeMemoryEmbedding` + recall callers |
| Where do I add a new AgentTrace source?             | `prisma/schema.prisma:AgentTrace.source` (free-form string) + use `makeTracedAiChat(label, source)` |
| Where do I see what touched a chat message?         | `/api/system/agent-traces/by-message/[id]` (joins via `tokenUsage.traceId`) |
| Where do I find which event types are noisy?        | `scripts/run-data-cleanup.ts:NOISY_PREFIXES`              |
| Where do I prune old AuditEvents?                   | `/api/cron/data-cleanup` keeps brain_insight 180d, others 30d |

---

## Pitfalls

1. **`tokenUsage` is JSON, not typed columns.** New fields are
   schema-free. If you need to query a sub-field at scale, denormalize
   it (e.g. `provider`, `costCents`, `promptTokens` are already split
   out).
2. **`searchable_tsv` is GENERATED by Postgres**, not managed by
   Prisma. Don't try to set it in writes; use raw SQL when you need to
   query it.
3. **`searchableContent` is the extraction target** for tsvector — if
   you change the `parts` shape, update `buildSearchableContent` so
   FTS keeps working.
4. **PII filter on `conversation_digest` is critical.**
   `peopleMentioned` is STRIPPED before write. The reverse path —
   `PersonProfile.upsert` — keeps the data in the access-controlled
   table.
5. **The `traceId` link is by string match, not FK.** If you rebuild
   the agent_traces table, preserve `traceId` values in
   `ChatMessage.tokenUsage`. Conversely, if you delete a chat message,
   trace rows survive (intentional — costs still accrue).
6. **Unknown BrainMemory categories warn, don't throw.** Silent
   write to an unregistered bucket is bad, but throwing would break
   the caller. Watch `/system/errors` for the `unknown_category`
   warnings and add to `BRAIN_CATEGORIES` proactively.
7. **`MemoryEdge` has a 5-tuple unique constraint**
   `(sourceType, sourceId, targetType, targetId, relationship)`.
   Reinforcement should increment `strength` (currently single-row
   strength bump), not create a new edge.
8. **`AuditEvent` is NOT row-level access controlled.** Don't put PII
   in payload that shouldn't be table-accessible by all server code.
