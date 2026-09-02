# StateNour Data Model — Ontology Inventory (Read-Only)

Snapshot: `apps/statenour` from `origin/main @ abdd99395` (production commit `abdd993`), git-archive
copy at `C:\Users\nourd\AppData\Local\Temp\claude\C--\a2f6988a-8f6b-463b-a858-39bfbee811de\scratchpad\main2\apps\statenour`.
`prisma/schema.prisma` = 3,446 lines, read in full (4 sequential reads, offsets 1/901/1801/2701,
zero gaps). Corpus scanned for writer/reader evidence: `app/`, `lib/`, `components/`, `scripts/`,
`tests/`, `__tests__/`, `cli/`, `hooks/`, `features/`, `types/`, `tools/`, `config/`, root `*.ts`,
plus sibling `apps/worker/` — 2,522 files. STANCE: read-only, no DB access, no writes except this
file. Lenses applied: kaizen (small-improvement / error-proofing framing for the target ontology),
karpathy-guidelines (state assumptions, simplest defensible read), database-architect (access
patterns before schema opinions), domain-driven-design (bounded-context read on the boundary
doctrine). Row counts are UNKNOWN unless a dated doc/comment records them — cited as class D even
when embedded in code comments, because they are someone else's prior claim, not something this
run queried live.

**Class key**: A = read directly off `schema.prisma`/migrations (ground truth for this snapshot).
H = this run's inference/judgment. I = inferred from code behavior (e.g. a service function's
logic), not independently executed. D = a dated claim in a doc or code comment — could be stale.

**Headline count correction (class A):** the brief's "~120 models, 27 enums" is off — the schema
has **103 models** and **31 enums** (`grep -c "^model "` = 103, `grep -c "^enum "` = 31, both cross-
checked against the parsed block list with zero diff). Treat the brief's figures as a stale prior
estimate, not this snapshot's shape.

## Methodology notes (read before trusting any single row)

- **Writer/reader counts** come from a regex scan for `<accessor>.<camelModel>.<method>(` across the
  corpus above, classified into writer methods (`create/createMany/update/updateMany/upsert/delete/
  deleteMany`) and reader methods (`findUnique/findFirst/findMany/count/aggregate/groupBy`), with a
  `[TEST]` flag when the hit is under `tests/`/`__tests__/`/`*.test.*`/`*.spec.*`. Full per-model
  counts are in the companion TSV this run generated; every row below cites the count plus one
  concrete `path:line`.
- **Positive control (required by the brief):** hand-grepped `\.brainMemory\.(create|...)\(` directly
  (no script) across `app/ lib/ components/ scripts/ tests/ __tests__/` → **735 raw hits**. The
  script's BrainMemory total is 285 writers + 454 readers = 739 (the script's method list also
  counts `findFirstOrThrow`/`findUniqueOrThrow`, absent from the hand-grep pattern, which fully
  explains the 4-hit gap). The counter is trustworthy at this scale — verified, not assumed.
- **Known blind spot (found live, not theoretical):** the regex only matches *direct* accessor calls.
  Prisma relational `include`/`select` reads (e.g. `prisma.lifeGoal.findMany({ include: { statLinks:
  true }})`) and nested writes (e.g. `prisma.task.update({ data: { events: { create: {...} }}})`)
  do **not** match `\.goalStat\.` / `\.taskEvent\.`. Confirmed concretely: `GoalStat` scores 0/0 in
  the flat grep, but `lib/mastery/goal-stats.ts:196`, `lib/services/goals.ts:78`,
  `lib/brain/journal-brain.ts:127,227` all read it via nested `select`. `TaskEvent` scores 0 writers
  in the flat grep, but `lib/services/tasks.ts:258` reads it via nested `include`, and no
  `events: { create` nested-write site was found anywhere in the corpus either — so TaskEvent's
  write path is genuinely unlocated, not merely mis-grepped. Per row below, "no code writer/reader
  found in `<corpus>`" is used verbatim wherever the flat grep is empty and no nested-relation
  alternative was independently confirmed; a positive nested-relation finding is called out by name.
- **Seed/migration writers are a separate corpus.** `prisma/` was deliberately excluded from the main
  writer/reader scan (it is fixtures, not runtime). `StrategicLaw`'s only writers are
  `prisma.strategicLaw.upsert()` calls in 6 files under `prisma/seeds/*.ts` — real, but one-time/
  operator-run, not an app-runtime writer. Flagged per-row as "seed-only writer."
- Windows path separators (`\`) appear in citations pulled verbatim from the grep tool's raw output;
  forward-slash citations came from direct file reads. Both point at the same repo-relative path.

## 1. MODEL INVENTORY (103 models, alphabetical)

Bucket codes: **POS**=PERSONAL-OS core · **EXE**=EXECUTION · **MEM**=MEMORY-KNOWLEDGE · **PPL**=PEOPLE
· **OBS**=AI-TRACE-OBSERVABILITY · **INF**=INFRA-DEVICES · **SHOP**=SHOP-OPERATIONAL (boundary
candidate) · **MKT**=CONTENT-MARKETING · **LEG**=LEGACY-UNKNOWN.
Class codes: **LIVE** (nontest writer+reader in app runtime) · **W-UV**=WIRED-RUNTIME-UNVERIFIED
(seed/cron/script-only writer, or one side live one side thin) · **ORPHAN-W**=no code writer found ·
**ORPHAN-R**=no code reader found · **TEST**=test-only · **LEGACY**=confirmed retired.
"AI/confirm" = can AI-authored content land in this row, and is there a human-confirm field.

| Model | @@map | Bucket | Writers (n · example) | Readers (n · example) | Soft-del | Temporal fields | Provenance fields | AI-content / human-confirm | Idx | Class |
|---|---|---|---|---|---|---|---|---|---|---|
| ActionReceipt | action_receipts | EXE | 14 · `app/api/telegram/webhook/route.ts:271` update | 3 · `app/api/telegram/webhook/route.ts:253` findUnique | none | createdAt, updatedAt, executedAt | sourceSystem, verificationPayload | Y (verificationPayload) / no explicit human-confirm flag | 2 | LIVE |
| AgendaItem | agenda_items | POS | 5 · `lib/brain/pipeline-controller.ts:324` create | 9 · `lib/ai/context/nick-prime-context.ts:135` findMany | none (has status ARCHIVED/RESOLVED, not a deletedAt) | createdAt, updatedAt, dueDate, lastNudgedAt, escalateAt | source, sourceId | Y (source="chat"/"journal"/"prediction") / status RESOLVED is the human-confirm signal | 1 | LIVE |
| AgentTrace | agent_traces | OBS | 3 · `app/api/cron/data-cleanup/route.ts:283` deleteMany | 12 · `lib/ai/agent-trace.ts:252` findMany | none (retention = deleteMany) | startedAt, finishedAt, createdAt | traceId/parentId (lineage, not classic provenance) | Y (is itself the AI call record) / none | 5 | LIVE |
| Agreement | agreements | SHOP (boundary) | **0 · none found** | 1 · `app/api/crm/route.ts:26` findMany | none | createdAt, signedAt | signatureMetadata | Y (documentUrl is external, not AI) / signedAt is the confirm field, but nothing sets it | 1 | ORPHAN-W — scaffolded (Documenso-replacement comment) but create/sign path never wired |
| AiGeneration | ai_generations | OBS | 2 · `lib/ai/memory.ts:52` create | 30 · `lib/ai/budget.ts:53` aggregate | none | createdAt | feature, model | Y (is the AI call record) / none | 5 | LIVE |
| ApiRequestLog | api_request_logs | OBS | 4 · `app/api/cron/data-cleanup/route.ts:31` deleteMany | 2 · `lib/services/metrics.ts:76` count | none | createdAt | none | N / n/a | 3 | LIVE |
| ApprovalRequest | approval_requests | EXE | 8 · `lib/ai/runtime/approval-gate.ts:88` create | 13 · `lib/ai/runtime/approval-gate.ts:46` findFirst | none | createdAt, updatedAt, expiresAt, approvedAt, executedAt | requestedBy, reason | Y (payload is agent-proposed) / approvedBy + status="approved" | 2 | LIVE — state machine detailed in §4 |
| ArsenalLog | arsenal_logs | LEG | **0 · none found** | **0 · none found** | none | createdAt | none | N / n/a | 4 | **LEGACY** — self-documented dead in `lib/services/ai-research.ts:12-18` (2026-08-29 comment: sole writer deleted, "ZERO readers... confirmed three independent ways"; prod held 2 rows, newest 2026-04-10 — class D, that count is the comment's claim, not this run's query) |
| AuditEvent | (none — bare `AuditEvent` table) | OBS | 32 · `app/api/cron/data-cleanup/route.ts:191` deleteMany | 44 · `app/api/brain/page-visit/route.ts:49` findMany | none | createdAt | actor, eventType | Y / none | 3 | LIVE |
| AutomationPolicy | automation_policies | EXE | 5 · `lib/automation/policy.ts:239` upsert | 12 · `app/api/cron/autonomous-engine/route.ts:160` findMany | **deletedAt (in SOFT_DELETE_MODELS helper set)** | createdAt, updatedAt | owner, approvalClass | N (is a governance rule row, not AI content) / approvalClass gates auto-fire | 5 | LIVE |
| AutomationPolicyFire | automation_policy_fires | EXE | 1 · `lib/automation/policy.ts:378` create | 1 · `lib/automation/policy.ts:417` findMany | none (append-only; FK to policy is `onDelete: Restrict` on purpose, see §4) | firedAt | none | N / n/a | 2 | LIVE (low volume, still wired both sides) |
| AutomationRule | automation_rules | EXE | 2 · `lib/brain/automation-engine.ts:210` update | 6 · `app/api/brain/status/route.ts:14` findMany | none | createdAt, updatedAt, lastFired | createdBy | N / n/a | 3 | LIVE |
| AutonomousAction | autonomous_actions | EXE | 9 (7 nontest) · `app/api/cron/nick-action-proposal/route.ts:119` create | 35 (34 nontest) · `app/api/telegram/webhook/route.ts:2060` findMany | none | createdAt, executedAt | approvedBy | Y (payload = agent action) / approval field ("auto"/"pending"/"approved"/"rejected") | 4 | LIVE |
| AutonomousEvent | autonomous_events | EXE | 3 · `app/api/cron/data-cleanup/route.ts:290` deleteMany | 4 · `lib/events/projection.ts:71` findMany | none | firedAt | worker (proc id, not human provenance) | N (pure event log) / none | 3 | LIVE — schema comment marks it a Phase-1 dual-write extraction from BrainMemory(category="autonomous_event") |
| BodyTracking | body_tracking | POS | 4 · `app/api/sync/nour-os/route.ts:206` upsert | 14 · `app/api/ultron/pulse/route.ts:101` findMany | none | createdAt, updatedAt | none | N (manual health entry) / n/a | 1 | LIVE |
| Booking | bookings | SHOP (boundary) | **0 · none found** | 1 · `app/api/crm/route.ts:21` findMany | none | createdAt, startTime, endTime | none | N / status field exists but nothing sets past default | 2 | ORPHAN-W — same "scaffolded, never wired" shape as Agreement (Cal.com-replacement comment) |
| BrainBusEvent | brain_bus_events | EXE | 6 · `lib/db/brain-bus-durable.ts:221` update | 20 · `lib/db/brain-bus-durable.ts:81` findUnique | none (append-only durable queue) | availableAt, lockedAt, processedAt, createdAt, updatedAt | none | N (transport envelope) / n/a | 6 | LIVE — durable LISTEN/NOTIFY backstop, state machine in §4 |
| BrainDump | brain_dumps | MEM | 13 · `app/api/sync/nour-os/route.ts:119` create | 28 · `app/api/ai/journal-brief/route.ts:95` count | **deletedAt (helper)** | createdAt, updatedAt, enrichedAt | none explicit (moodBefore/After are self-report) | Y (extractedItems/patterns can be AI-derived) / linkStatus | 7 | LIVE |
| BrainMemory | brain_memories | MEM | 285 (282 nontest) · `app/api/ai/home-moves/route.ts:192` update | 454 (453 nontest) · `app/api/ai/assist/route.ts:40` findMany | **deletedAt (helper)** | lastSeen, expiresAt, validFrom, validUntil, lastVerifiedAt, createdAt, updatedAt | createdBy, source, supersededById | Y / createdBy distinguishes user vs nick vs cron; `discoveryVerdict`+`discoveryRatedAt` is an explicit human-rating pair | 12 | **LIVE — hottest model in the schema**; supersession invariant detailed in §4 |
| BridgeCallLog | bridge_call_logs | OBS | 1 · `lib/agent-bridge/audit.ts:42` create | **0 · none found in corpus** | none | createdAt | clientId (token name only, args never stored — sha256 hash instead) | N (audit row) / n/a | 3 | ORPHAN-R — write-only by design per its own doc comment ("Durable audit of every /api/mcp and /api/actions bridge call"), added 2026-08-27; no dashboard reads it yet |

*(20/103 — batch 1 of 6. Continuing below.)*

| Model | @@map | Bucket | Writers (n · example) | Readers (n · example) | Soft-del | Temporal fields | Provenance fields | AI-content / human-confirm | Idx | Class |
|---|---|---|---|---|---|---|---|---|---|---|
| BriefingLog | briefing_logs | POS | 4 · `app/api/intelligence/briefs/generate/route.ts:41` create | 3 · `app/api/intelligence/briefs/today/route.ts:30` findFirst | none | sentAt, createdAt | none | Y (content is AI-generated brief) / none | 1 | LIVE |
| CalibrationReviewItem | calibration_review_items | MEM | 6 · `app/api/cron/calibration-generator/route.ts:63` upsert | 5 · `lib/brain/calibration-engine.ts:363` findMany | none | createdAt, updatedAt, evidenceFreshness, reviewedAt | reviewedBy, evidence | Y (predictedOutcome vs proposedActualOutcome) / reviewedBy + status incl. "approved"/"corrected"/"rejected" | 2 | LIVE |
| CaptureInboxItem | (none — bare table) | MEM | 1 · `lib/services/runner-state.ts:1118` upsert | 11 · `app/api/nour-os/query/route.ts:268` count | none (status/triageStatus lifecycle instead) | capturedAt, syncedAt, triagedAt, createdAt, updatedAt | source | Y (kind/source can be AI-ingested) / triageStatus NEW→TRIAGED→CONVERTED is the human gate | 4 | LIVE |
| CausalChain | causal_chains | MEM | 2 · `lib/brain/thinking-engine.ts:342` update | 6 · `lib/brain/learning-velocity.ts:74` count | none | lastSeen, createdAt | none explicit | Y (rootCause/chain are AI-derived) / `broken` boolean is the closest confirm-like flag | 4 | LIVE |
| ChatConversation | chat_conversations | OBS | 11 · `lib/ai/chat/handlers/shared.ts:131` create | 25 · `app/api/chat/export/[conversationId]/route.ts:148` findUnique | archivedAt (ad-hoc, **not** in the `SOFT_DELETE_MODELS` helper list — see §4) | createdAt, updatedAt, lastActiveAt, archivedAt, starredAt, mutedAt | none | N (container) / n/a | 6 | LIVE |
| ChatMessage | chat_messages | OBS | 12 · `lib/agent/run-follow-up.ts:104` create | 66 · `app/api/ai/chat/[conversationId]/stream/route.ts:186` findFirst | none (edits tracked via editHistory, not soft-delete) | createdAt, editedAt | provider, routerReason | Y (role="assistant" rows) / feedbackScore (+1/-1) is the human-confirm signal | 8 | LIVE — raw `searchable_tsv` generated column, see §6 |
| Commitment | commitments | POS | 25 · `app/api/commitments/route.ts:69` update | 59 · `app/api/ai/assist/route.ts:69` count | **deletedAt (helper)** | createdAt, updatedAt, verifiedAt | createdBy, sourceRef | Y (sourceRef can be `journal-take:<id>`) / verifiedAt + evidenceRequired | 7 | LIVE — lifecycle detailed in §4 |
| Contact | contacts | SHOP (boundary) | 4 · `app/api/crm/route.ts:65` create | 4 · `app/api/crm/route.ts:14` findMany | none | createdAt, updatedAt | none | Y (psychProfile "AI-extracted") / none | 1 | LIVE — the only model in the CRM cluster with a real write path |
| ContentStudioProject | content_studio_projects | MKT | 3 · `lib/services/content-studio.ts:31` create | 2 · `lib/services/content-studio.ts:66` findMany | none | createdAt, updatedAt | none | Y (briefJson is AI brief) / status "draft"/"published" | 2 | LIVE |
| Contradiction | contradictions | MEM | 2 · `lib/brain/memory-consolidation.ts:597` updateMany | 8 · `lib/brain/learning-velocity.ts:76` count | deletedAt (ad-hoc, **not** in helper list) | createdAt, updatedAt | claimSource, claimId | Y (gap/reality are AI-computed) / resolved boolean + resolvedHow | 5 | LIVE |
| CronJobLog | cron_job_logs | OBS | 6 · `app/api/cron/data-cleanup/route.ts:237` deleteMany | 29 · `app/api/system/cockpit/route.ts:74` groupBy | none | createdAt | none | N / n/a | 4 | LIVE — schema comment flags a stale prior comment: "partial" is a live status (2,535 rows as of 2026-08-22, class D), filters must use `not: "failed"` not `equals: "success"` |
| DailyExecutionState | (none — bare table) | POS | 1 · `app/api/health/summary/route.ts:136` upsert | 1 · `lib/brain/task-signals.ts:114` findUnique | none (dayState OPEN/CLOSED is the lifecycle) | openedAt, closedAt, createdAt, updatedAt | none | N / n/a | 4 | LIVE (thin but both sides present — one row/day singleton pattern via `stateDate @unique`) |
| DecisionReplay | decision_replays | MEM | 7 · `lib/ai/tools/tasks.ts:756` create | 12 · `app/api/cron/embed-backfill/route.ts:226` findMany | none | reviewAt, reviewedAt, createdAt, enrichedAt | none explicit | Y (reasoning/lesson can be AI-assisted) / reviewed boolean | 4 | LIVE — idempotencyKey from {decisionId+reviewAt} |
| DeviceCommand | device_commands | INF | 10 · `app/api/cron/data-cleanup/route.ts:258` deleteMany | 7 · `app/api/devices/[id]/command/route.ts:13` findMany | none | sentAt, ackedAt, createdAt | none | N / n/a (status pending→sent→acked→failed) | 3 | LIVE |
| DeviceEvent | device_events | INF | 11 (9 nontest) · `app/api/cron/data-cleanup/route.ts:43` deleteMany | 19 (16 nontest) · `app/api/devices/[id]/events/route.ts:19` findMany | none | timestamp, createdAt | source | N / n/a | 3 | LIVE |
| EntityAudit | entity_audits | OBS | 1 · `lib/health-governor/action-guard.ts:8` create | 5 · `lib/db/audit-retention.ts:81` count | none (append-only field-level diff log by design) | createdAt | actor, source | N (records provenance, isn't itself AI content) / n/a — this IS the system's generic before/after provenance ledger, see §4 | 4 | LIVE, but thin writer surface — schema doc says "every meaningful mutation" should write here; only 1 direct-call site found (most provenance likely flows through a shared helper not matched by the flat grep — see methodology note) |
| ErrorLog | error_logs | OBS | 6 · `app/api/cron/data-cleanup/route.ts:37` deleteMany | 15 · `app/api/system/error-lookup/route.ts:46` findMany | none | createdAt | none | N / n/a | 2 | LIVE |
| ExecutionInsight | (none — bare table) | POS | 3 · `app/api/sync/nour-os/route.ts:139` create | 7 · `app/api/sync/nour-os/route.ts:394` findMany | none | createdAt, updatedAt | none | Y (insight is AI-derived) / none | 3 | LIVE |
| Experiment | experiments | MEM | 4 · `app/api/intelligence/decisions/log/route.ts:44` upsert | 1 · `lib/intelligence/experiment-measure.ts:78` findMany | none | startedAt, dueAt, measuredAt, createdAt, updatedAt | sourceId (denormalized from OpportunityLog at spawn) | Y (hypothesis/actualResult) / status running→measuring→held_up/failed/inconclusive | 2 | LIVE — closed-loop authScore feedback, `opportunityId @unique` makes accept idempotent |
| FinancialSnapshot | financial_snapshots | POS | 2 · `app/api/financial/route.ts:38` upsert | 7 · `app/api/sync/nour-os/route.ts:405` findFirst | none | createdAt, updatedAt | none | N (manual/derived figures) / n/a | 2 | LIVE |

*(40/103 — batch 2 of 6.)*

| Model | @@map | Bucket | Writers (n · example) | Readers (n · example) | Soft-del | Temporal fields | Provenance fields | AI-content / human-confirm | Idx | Class |
|---|---|---|---|---|---|---|---|---|---|---|
| GoalEvent | goal_events | POS | 1 · `lib/ai/tools/goals.ts:210` create | 4 · `lib/brain/goal-events.ts:114` findMany | none (append-only, FK `onDelete: Restrict`) | createdAt | source | N (event log) / n/a | 3 | LIVE (thin, mirrors TaskEvent pattern) |
| GoalStat | goal_stats | POS | **0 direct `.goalStat.` call found** — no `statLinks: { create` nested-write site found either | **0 direct calls, but read via nested `select` at `lib/mastery/goal-stats.ts:196`, `lib/services/goals.ts:78`, `lib/brain/journal-brain.ts:127,227`** | none | createdAt | none | N (declared weighting, not AI content) / n/a | 1 | ORPHAN-W (write path genuinely unlocated in this corpus) but reads confirmed live via relation include — `lib/mastery/goal-stats.ts:5` comment: most goals declare zero `GoalStat` rows and the code falls back to `inferGoalStats()` |
| HealthIngestBatch | health_ingest_batches | POS | 1 · `lib/services/apple-health-ingest.ts:210` create | 2 · `lib/ai/tools/health.ts:58` findFirst | none (batch receipt, replay-idempotent by id) | receivedAt, committedAt | inlet ("canonical"\|"hae") | N / n/a | 1 | LIVE |
| HealthSample | health_samples | POS | 1 · `lib/services/apple-health-ingest.ts:195` createMany | 2 · `lib/ai/tools/health.ts:50` findMany | none | startAt, endAt, importedAt | sourceSystem, sourceSampleId, sourceName, sourceBundleId | N (raw device export) / n/a | 3 | LIVE — Layer-A raw truth per its own doc comment; `BodyTracking` stays the daily canonical, this is the deduped raw feed |
| IdentitySnapshot | identity_snapshots | MEM | 2 · `lib/brain/thinking-engine.ts:171` update | 4 · `lib/brain/memory-consolidation.ts:634` count | **deletedAt (helper)** | createdAt | none explicit | Y (coreValues/trajectory are AI-measured, "not stated" per comment) / none | 3 | LIVE — soft-delete exists specifically so the daily cron can "redo today's snapshot" without violating the old `@unique` on `date` (comment at schema:2054-57) |
| Integration | integrations | INF | 4 · `app/api/integrations/[name]/test/route.ts:159` update | 6 · `app/api/integrations/[name]/test/route.ts:125` findUnique | none | lastSyncAt, nextSyncAt, createdAt, updatedAt | none | N / n/a | 5 | LIVE |
| IntelligenceClaim | intelligence_claims | MEM | 1 · `lib/intelligence/ingest.ts:250` create | 6 · `app/api/knowledge/pipeline-status/route.ts:43` groupBy | none | createdAt | documentId → SourceDocument → RegisteredSource (chained provenance) | Y (text is scraped/extracted) / status "source_supported"/"weak_support"/"unverified" | 3 | LIVE |
| IntelligenceOutcome | intelligence_outcomes | MEM | 3 · `lib/services/outcome-ledger.ts:63` create | 10 · `app/api/cron/outcome-harvest/route.ts:44` count | none | shownAt, decidedAt, outcomeAt, createdAt | sourceEngine, evidenceRefs | Y (is the machine-recommendation record) / decision "accepted"/"dismissed"/"edited"/"ignored" | 2 | LIVE — explicitly the outcome-tracking ledger sitting *beside*, not replacing, agenda/approvals/queue receipts (own doc comment) |
| JournalSettings | journal_settings | POS | 1 · `lib/trpc/routers/journal.ts:750` upsert | 1 · `lib/journal/settings.ts:49` findUnique | none | updatedAt | none | N (config) / n/a | 0 | LIVE — singleton row (`id="singleton"` default) |
| JournalThread | journal_threads | MEM | 4 · `lib/services/journal-threads.ts:266` create | 10 · `app/api/ai/journal-brief/route.ts:76` findMany | deletedAt (ad-hoc, **not** in helper list) | detectedAt, namedAt, lastJoinAt, createdAt, updatedAt | none | Y (auto-detected convergence) / `namedAt` = operator confirmed the auto-name | 3 | LIVE |
| JournalThreadEntry | journal_thread_memberships | MEM | 1 · `lib/services/journal-threads.ts:499` create | 3 · `lib/ai/page-data.ts:362` count | none | joinedAt | joinMode ("seed"\|"auto"\|"operator") | Y (auto joins) / joinMode="operator" is the confirm case | 2 | LIVE — polymorphic (entrySource, entryId) membership across 4 journal sources, deliberately not 4 join tables (own comment: "YAGNI") |
| LifeGoal | life_goals | POS | 8 · `lib/ai/tools/goals.ts:127` update | 31 · `app/api/ai/goals-brief/route.ts:66` findMany | **deletedAt (helper)** | deadline, achievedAt, createdAt, updatedAt, lastChallengedAt, killBy | createdBy, updatedBy | Y (planData/coachLog are AI) / none beyond createdBy | 7 | LIVE |
| LinkClick | link_clicks | MKT | 1 · `app/api/short/[code]/route.ts:44` create | **0 · none found** | none | clickedAt | ipHash (anonymized), referrer | N / n/a | 1 | ORPHAN-R — write-only click log; no dashboard reads it (denormalized `clickCount` on `ShortLink` is what dashboards actually read instead) |
| LocalSyncLog | local_sync_log | INF | 6 · `app/api/cron/data-cleanup/route.ts:57` deleteMany | 2 · `app/api/obsidian/status/route.ts:20` findFirst | none | createdAt | none | N / n/a | 2 | LIVE |
| MasteryDecision | mastery_decisions | POS | 9 · `app/api/decisions/route.ts:28` update | 28 · `app/api/decisions/route.ts:27` findUnique | **deletedAt (helper)** | reviewDate, createdAt, updatedAt | createdBy, updatedBy | Y (chat-extracted decisions) / createdBy disambiguates manual vs chat-extracted | 6 | LIVE |
| MasteryScore | mastery_scores | POS | 3 · `app/api/mastery/route.ts:75` upsert | 9 · `app/api/mastery/route.ts:18` findMany | none | createdAt, updatedAt | evidence | N (measured score) / n/a | 2 | LIVE — schema comment marks the sibling `DailyScore` model as retired 2026-04-18 ("Nour: 'i think its stupid'"), table dropped from client; `prisma/seeds/seed-foundation.ts:prisma.dailyScore.create(` still references it — **that seed file would throw at runtime, dead/broken code, class A** |
| MemoryEdge | memory_edges | MEM | 2 · `lib/brain/relational-graph.ts:54` update | 14 · `lib/brain/brain-graph.ts:545` findMany | none (cascade-deleted with source/target per `soft-delete.ts` header comment, not independently soft-deleted) | createdAt, updatedAt | evidence | Y (strength "reinforced over time") / none | 5 | LIVE |
| MemoryInboxItem | memory_inbox_items | MEM | 3 · `lib/tools/guardian.ts:483` create | 4 · `app/api/cron/ingest-gmail/route.ts:140` findFirst | none (status "quarantined"→reviewed lifecycle) | createdAt, updatedAt, reviewedAt | sourceUrl, sourceType | Y (rawTextFenced is untrusted external content, explicitly fenced) / reviewedBy + reviewedAt | 2 | LIVE — privacyClass field suggests a PII-quarantine gate ahead of promotion into BrainMemory |
| Mission | (none — bare `Mission` table) | POS | 19 · `app/api/missions/[id]/retro/route.ts:160` update | 63 · `app/api/ai/home-moves/route.ts:78` findFirst | **deletedAt (helper)** | deadline, createdAt, updatedAt | createdBy, updatedBy | Y (planData is AI-generated project plan) / none beyond createdBy | 5 | LIVE |
| MissionLink | mission_links | POS | 2 · `lib/services/mission-links.ts:93` upsert | 2 · `lib/services/mission-links.ts:131` findMany | none | createdAt | createdBy | N (operator-declared relation) / n/a | 4 | LIVE — self-referential M:N via `sourceId`/`targetId`, both `onDelete: Cascade` |

*(60/103 — batch 3 of 6.)*

| Model | @@map | Bucket | Writers (n · example) | Readers (n · example) | Soft-del | Temporal fields | Provenance fields | AI-content / human-confirm | Idx | Class |
|---|---|---|---|---|---|---|---|---|---|---|
| OperatorPreference | (none — bare table) | POS | 3 · `lib/brain/preference-inference.ts:332` upsert | **0 · none found** | none | createdAt, updatedAt | none | N (config) / n/a | 4 | ORPHAN-R — write-only; 1:1 with OperatorProfile, likely read only via nested `include: { preferences: true }` on OperatorProfile (same blind spot as GoalStat), not independently confirmed |
| OperatorProfile | (none — bare table) | POS | 4 · `lib/brain/preference-inference.ts:316` upsert | 1 · `lib/brain/preference-inference.ts:288` findUnique | none | createdAt, updatedAt | none | N (config) / n/a | 2 | LIVE (thin — single-operator singleton-shaped table) |
| OpportunityLog | opportunity_logs | MEM | 4 · `app/api/intelligence/decisions/log/route.ts:40` update | 7 · `app/api/intelligence/decisions/log/route.ts:19` findUnique | none | createdAt, updatedAt | sourceId (denormalized highest-authority source) | Y (score/impact/urgency machine-scored) / status "pending"/"accepted"/"declined"/"resolved" | 4 | LIVE — feeds the Experiment closed loop |
| Order | orders | SHOP (boundary) | 1 · `app/api/webhooks/stripe/route.ts:158` create | **0 · none found** | none | createdAt | none | N (commerce record) / n/a | 1 | ORPHAN-R — written by the Stripe webhook, never read back anywhere in this corpus (no order-history UI found) |
| PageSnapshot | page_snapshots | MEM | 1 · `lib/intelligence/change-detection.ts:105` create | 1 · `lib/intelligence/change-detection.ts:98` findFirst | none | checkedAt | contentHash (change-detection fingerprint) | N (raw scrape) / n/a — own doc comment: "OBSERVES only, takes NO autonomous action" | 2 | LIVE |
| PatternDetection | pattern_detections | POS | 1 · `app/api/sync/nour-os/route.ts:135` create | 5 · `app/api/brain/status/route.ts:9` findMany | none | createdAt | evidence | Y (pattern is AI-detected) / interventionApplied is closest to a confirm field | 2 | LIVE |
| PersonProfile | person_profiles | PPL | 24 · `app/api/cron/dossier-autodraft/route.ts:87` update | 40 · `app/api/ai/draft-outreach/route.ts:58` findUnique | deletedAt (ad-hoc, **not** in helper list — see §4) | lastInteraction, createdAt, updatedAt, blownUpAt, dossierUpdatedAt, lastArcPlan(json) | source | Y (patterns/dossierMd/behavioralFingerprint are AI-authored) / `pendingClassification` suggest-then-approve pattern, operator accepts or dismisses | 11 | LIVE — richest single model after BrainMemory/Task/PersonProfile itself (40 fields) |
| PersonalDailyLog | (none — bare table) | POS | 5 · `app/api/health/summary/route.ts:91` upsert | 8 · `app/api/health/summary/route.ts:52` findUnique | none | createdAt, updatedAt | none | N (self-report) / n/a | 3 | LIVE |
| PostTurnOutbox | post_turn_outbox | EXE | 7 · `app/api/cron/agent-followups/route.ts:53` update | 13 · `lib/agent/follow-up.ts:165` count | none (durable outbox, drained not deleted) | createdAt, updatedAt, nextAttemptAt | none | Y (payload = frozen chat-turn context) / n/a | 1 | LIVE — dual implementation found: `lib/agent/follow-up.ts` and `lib/services/chat/post-turn-outbox.ts` both claim rows via `updateMany`, see §3(e) overlap note |
| Prediction | predictions | MEM | 7 · `lib/brain/memory-consolidation.ts:587` updateMany | 29 · `app/api/cron/calibration-generator/route.ts:49` findMany | none | targetDate, createdAt, updatedAt | basis | Y (prediction/basis are AI-generated) / status "pending"/"confirmed"/"disproven"/"expired", brierScore computed at resolution | 5 | LIVE |
| Product | products | SHOP (boundary) | 1 · `app/api/webhooks/stripe/route.ts:126` create | 4 · `app/api/webhooks/stripe/route.ts:114` findUnique | none | createdAt | none | N (catalog item) / n/a | 0 | LIVE |
| PromptVersion | prompt_versions | OBS | 2 · `lib/trpc/routers/system/agents.ts:356` updateMany | 1 · `lib/trpc/routers/system/agents.ts:290` findMany | none | createdAt, updatedAt | createdBy | Y (systemPrompt/userPrompt content) / `active` boolean flag | 2 | LIVE |
| RecoveryActionLog | (none — bare table) | POS | 1 · `app/api/cron/data-cleanup/route.ts:267` deleteMany | **0 · none found** | none | nextFollowUpAt, createdAt | none | N / n/a | 1 | ORPHAN-R — only writer found is the retention deleteMany itself; no creator and no reader located in this corpus |
| Reflection | reflections | MEM | 6 (5 nontest) · `app/api/ultron/reflect/route.ts:128` create | 38 · `app/api/ai/goals-brief/route.ts:82` count | **deletedAt (helper)** | createdAt, updatedAt, enrichedAt | evidence | Y (insight/evidence are AI-generated) / `acknowledged` boolean = "has Nour seen/acted on this" | 8 | LIVE |
| RegisteredSource | intelligence_sources | MEM | 3 · `app/api/intelligence/sources/route.ts:55` create | 7 · `app/api/intelligence/briefs/generate/route.ts:12` findMany | none | lastFetched, createdAt, updatedAt, authScoreUpdatedAt | authScore (closed-loop trust score) | N (registry row, not itself content) / authScore nudged by Experiment outcomes — the closest thing to an automated confirm loop in the schema | 2 | LIVE |
| RelationshipLedger | relationship_ledger | PPL | 3 · `app/api/relationships/log-outreach/route.ts:61` create | 14 · `app/api/ai/draft-outreach/route.ts:71` findMany | none (append-only ledger) | createdAt | source ("gmail"\|"calendar"\|"chat"\|"telegram"\|"manual"\|"auto"\|"greene_play") | Y (auto entries) / source="manual" is the human-authored case | 3 | LIVE |
| RelationshipPlay | relationship_plays | PPL | 2 · `lib/brain/power-plays-runner.ts:100` create | 1 · `lib/trpc/routers/task/power-atlas.ts:32` findMany | none | createdAt | none | Y (output is AI-generated play/message) / outcome + outcomeNote is the after-the-fact human grading | 2 | LIVE — reader surface is thin (1 site) relative to writer |
| ReviewLog | review_logs | POS | 1 · `app/api/cron/data-cleanup/route.ts:273` deleteMany | **0 · none found** | none | generatedAt, createdAt | none | Y (is an AI-generated brief) / none | 2 | ORPHAN-R — schema doc says it's "read by GET /api/reviews for the Review mode history drawer," but no `.reviewLog.find*` call exists in this corpus; that reader route may be gone or reads via a path this grep missed |
| RunnerNode | (none — bare table) | INF | 3 · `app/api/sync/nour-os/route.ts:310` upsert | 2 · `lib/services/runner-state.ts:697` findFirst | none | lastHeartbeatAt, createdAt, updatedAt | none | N (infra heartbeat) / n/a | 3 | LIVE |
| ScheduledAction | scheduled_actions | EXE | 2 · `app/api/cron/stale-tasks/route.ts:95` updateMany | **0 · none found** | none | scheduledFor, completedAt, createdAt, updatedAt | none | N (reminder/follow-up record) / n/a — status "pending"/"done"/"skipped"/"overdue" | 4 | ORPHAN-R — only a bulk-update writer found; no reader located, so the status field's "overdue" branch may never actually surface anywhere |

*(80/103 — batch 4 of 6.)*

| Model | @@map | Bucket | Writers (n · example) | Readers (n · example) | Soft-del | Temporal fields | Provenance fields | AI-content / human-confirm | Idx | Class |
|---|---|---|---|---|---|---|---|---|---|---|
| SchemaChangeLedger | schema_change_ledger | OBS | 4 · `lib/db/schema-ledger.ts:78` create | 9 · `lib/db/schema-ledger.ts:70` findUnique | none | appliedAt, createdAt, updatedAt | approvedBy, appliedBy | N (DDL audit row) / approvedBy + status "planned"/"applied"/"rolled_back"/"failed" | 5 | LIVE — closes the "no SQL audit trail" gap left by `prisma db push` (own doc comment) |
| SemanticEdge | semantic_edges | MEM | 1 · `lib/brain/semantic-link.ts:153` upsert | 1 · `lib/brain/brain-graph.ts:553` findMany | none | createdAt, updatedAt | none | N (cosine-derived, deterministic) / n/a | 4 | LIVE — Phase-1 dual-write extraction from `BrainMemory(category="semantic_edge")`, own comment says Phase-3 drops the legacy rows (unclear if that phase shipped) |
| ServiceHealth | (none — bare table) | INF | 3 · `lib/services/runner-state.ts:976` upsert | 5 · `lib/services/runner-state.ts:683` findMany | none | checkedAt, lastSuccessAt, lastFailureAt, createdAt, updatedAt | none | N (health probe) / n/a | 4 | LIVE |
| SessionReport | session_reports | OBS | 4 · `app/api/sync/nour-os/route.ts:259` create | 1 · `lib/services/session-import.ts:253` findFirst | none | createdAt | agentModel | Y (summary/decisions are agent-authored session notes) / none | 2 | LIVE (thin reader side) |
| ShortLink | short_links | MKT | 3 · `app/api/short/[code]/route.ts:33` update | 2 · `app/api/short/[code]/route.ts:24` findUnique | none | createdAt | campaign/medium/source (UTM, not human provenance) | N (redirect config) / n/a | 0 | LIVE — `id` IS the slug (no `@default(cuid())`), `clickCount` denormalized from `LinkClick` |
| SituationLog | situation_logs | MEM | 6 · `app/api/cron/data-cleanup/route.ts:252` deleteMany | 9 · `app/api/cron/embed-backfill/route.ts:195` findMany | none | createdAt, updatedAt, enrichedAt | none explicit | Y (aiAnalysis field is explicitly AI-generated) / none | 6 | LIVE |
| SmartDevice | smart_devices | INF | 9 (8 nontest) · `app/api/devices/[id]/events/route.ts:71` update | 22 · `app/api/cameras/route.ts:6` findMany | none | lastSeenAt, createdAt, updatedAt | none | N (device state) / n/a | 6 | LIVE |
| SocialPublishQueue | social_publish_queue | MKT (boundary-adjacent) | 15 · `app/api/sync/events/route.ts:96` upsert | 17 · `app/api/content/render-asset/route.ts:22` findUnique | deletedAt (ad-hoc, **not** in helper list) | scheduledFor, publishedAt, renderClaimedAt, renderLeaseExpiresAt, createdAt, updatedAt | source ("nick"\|"manual"\|"statenour-pack"), sourceMetadata | Y (content is AI-generated) / approvedBy/approvedAt vs rejectedBy/rejectedAt/rejectionReason | 5 | LIVE — publishes to `platforms: ["instagram","gbp"]`; GBP = Google Business Profile, i.e. this queue can post to Nick's Tire's public presence *from* statenour — flagged as a live boundary crossing, not merely a candidate (see §3 note) |
| SourceDocument | source_documents | MEM | 1 · `lib/intelligence/ingest.ts:232` create | 1 · `lib/intelligence/compose-daily-brief.ts:130` findFirst | none | capturedAt | rawContent (the provenance payload itself) | N (raw scrape) / n/a | 2 | LIVE |
| StateLog | (none — bare table) | POS | 3 · `app/api/cron/data-cleanup/route.ts:246` deleteMany | 2 · `app/api/health/summary/route.ts:111` findFirst | none | createdAt | none | N (self-report scores) / n/a | 1 | LIVE (thin both sides) |
| StrategicLaw | strategic_laws | MEM | **0 app-runtime writers; 6 seed-only writers** `prisma/seeds/48-laws.ts:prisma.strategicLaw.upsert(` (+5 more seed files) | 8 (7 nontest) · `app/api/ai/chat/finalize-system-prompt.ts:142` findMany | none | createdAt, updatedAt | none | N (Robert Greene corpus text, curated not AI-generated) / n/a | 3 | **W-UV** — fixture-loaded reference data (48 Laws / 33 Strategies / Human Nature / Mastery / Art of Seduction), read live, never written by the running app |
| SystemMetric | system_metrics | OBS | 15 · `app/api/cron/data-cleanup/route.ts:25` deleteMany | 15 · `app/api/system/metrics/route.ts:14` findMany | none | createdAt | none | N / n/a | 3 | LIVE |
| SystemSnapshot | (none — bare table) | OBS | 1 · `lib/services/runner-state.ts:928` upsert | 2 · `cli/nour.ts:51` findFirst | none | briefUpdatedAt, generatedAt, createdAt, updatedAt | none | N (rolled-up dashboard state) / n/a | 2 | LIVE — singleton via `scope @unique @default("global")` |
| Task | (none — bare table) | POS | 58 (55 nontest) · `app/api/cron/stale-tasks/route.ts:50` update | 181 · `app/api/ai/assist/route.ts:68` count | **deletedAt (helper)** | dueDate, lastTouchedAt, lastCompletedAt, startedAt, snoozedUntil, createdAt, updatedAt | createdBy, updatedBy | Y (autoPriorityExplanation is AI reasoning) / `proof` json field + `outcomeRating` enum are explicit human-confirm/grading fields | 11 | **LIVE — second-hottest model** (reader side); positive control cross-checked by hand |
| TaskClassificationCorrection | task_classification_corrections | POS | 1 · `lib/services/tasks.ts:831` create | **0 · none found** | none | createdAt | createdBy | N (few-shot training signal, not itself AI content) / n/a — write-only by design (few-shot examples are read directly off recent rows inside the classifier prompt, not via a Prisma reader call the grep would catch) | 1 | ORPHAN-R by this grep, but functionally write-then-inline-prompt-read, not a true dead end |
| TaskEvent | task_events | POS | **0 direct `.taskEvent.create` found; no `events: { create` nested-write site found either** | 14 direct (`lib/brain/task-events.ts:195` count) **+ confirmed nested `include` read at `lib/services/tasks.ts:258`** | none (append-only, FK `onDelete: Restrict` — see §4) | createdAt | source | N (event log) / n/a | 4 | LIVE for reads; **write path not located in this corpus** — flagged, not assumed dead (see methodology note) |
| ToolTelemetry | tool_telemetry | OBS | **0 via `.toolTelemetry.` — actual writer is raw SQL** `lib/ai/tool-telemetry.ts:67: prisma.$executeRaw` (own doc comment: "Updated atomically per invocation via UPSERT") | 2 · `lib/services/system-pages.ts:922` findMany | none | createdAt, updatedAt, lastCallAt | none | N (aggregate counters) / n/a | 4 | LIVE — a case where the flat-grep "0 writers" would be a false negative if not cross-checked; Phase-1 dual-write extraction from `BrainMemory(category="tool_telemetry")` |
| ToolVerbRatio | tool_verb_ratios | OBS | 2 · `app/api/cron/data-cleanup/route.ts:297` deleteMany | **0 · none found** | none | createdAt | none | N (fabrication-defense metric) / n/a | 2 | ORPHAN-R — own schema comment: "Phase 2 cuts reads (no readers yet — the data was just being collected)"; still true at this snapshot |
| UserPreference | user_preferences | POS | 12 · `app/api/cron/cost-slo-check/route.ts:87` delete | 9 · `app/api/habits/route.ts:28` findUnique | none | createdAt, updatedAt | none | N (key/value settings) / n/a | 4 | LIVE — generic KV store, `category` field is "ui"\|"notifications"\|"ai"\|"system" |
| VectorEmbedding | vector_embeddings | MEM | 16 · `lib/ai/tool-embeddings.ts:191` update | 38 · `app/api/brain/wisdom/[id]/related/route.ts:72` findFirst | none | createdAt, updatedAt | none | N (derived embedding, not content) / n/a | 4 | LIVE — raw pgvector columns, see §6 |

*(100/103 — batch 5 of 6.)*

| Model | @@map | Bucket | Writers (n · example) | Readers (n · example) | Soft-del | Temporal fields | Provenance fields | AI-content / human-confirm | Idx | Class |
|---|---|---|---|---|---|---|---|---|---|---|
| VisionEvent | vision_events | INF | 2 · `app/api/sync/nour-os/route.ts:67` createMany | 4 · `app/api/sync/vision/route.ts:61` findMany | none | timestamp, createdAt | source ("local"\|"v380"\|"direct") | N (camera event) / n/a | 3 | LIVE |
| VoiceLatencyEvent | voice_latency_events | OBS | 1 · `lib/services/voice-latency.ts:96` create | 2 · `lib/services/voice-latency.ts:142` findMany | none | createdAt | none | N (per-stage VAPI timing) / n/a | 3 | LIVE |
| WorkItem | (none — bare table) | EXE | 4 · `lib/services/autonomic-orchestrator.ts:303` update | 9 · `lib/services/autonomic-orchestrator.ts:293` findMany | none | availableAt, claimedAt, completedAt, createdAt, updatedAt | none | N (job queue payload) / n/a | 5 | LIVE — the queue the brief says "must never be merged into Task" (prior finding respected below) |

*(103/103 — model inventory complete.)*

## 2. ENUMS (31 total)

| Enum | Values | Used by a model field? | Notes |
|---|---|---|---|
| MissionDomain | BUSINESS, PERSONAL, HEALTH, CONTENT, FINANCE | Yes — `Mission.domain` | Schema comment at `Mission.systemKind` marks this the *legacy* routing key; `canonicalDomain` (free-text VarChar) is "the real routing key" now. Enum is live but semantically demoted. |
| MissionStatus | ACTIVE, PAUSED, COMPLETE, KILLED | Yes — `Mission.status` | |
| TaskStatus | INBOX, READY, DOING, WAITING, DONE, ARCHIVED | Yes — `Task.status` | State machine detailed in §4. |
| LoopKind | ONCE, DAILY, PROMISE, WEEKLY | Yes — `Task.loopKind` | Comment: collapses the old MasteryHabit + Commitment + OpenLoop 3-table split onto one Task column (Apr-15 rebuild). |
| EffortBand | M5, M15, M30, H1, H2PLUS | Yes — `Task.effort` | |
| EnergyLevel | LOW, MEDIUM, HIGH | Yes — `Task.energyRequired` | |
| TaskContext | DESK, PHONE, SHOP, CAR, HOME, ANYWHERE | Yes — `Task.context` | **"SHOP" is a *task-execution-location* value, not a Nick's Tire shop-domain concept** — do not conflate with the boundary doctrine's "shop." |
| **CustomerRiskStatus** | HEALTHY, AT_RISK, DORMANT, LOST | **No model field references it** | **Shop concept, schema-orphaned.** |
| **LtvBand** | LOW, MID, HIGH, VIP | **No model field** | **Shop concept, schema-orphaned.** Re-implemented as a plain function `calculateLtvBand` in `lib/scoring/dormant-customers.ts`, called from `lib/demo-store.ts` — demo-surface only. |
| **CustomerFollowUpStage** | NONE, QUEUED, SENT, RESPONDED, BOOKED | **No model field** | **Shop concept, schema-orphaned.** |
| **CustomerSegment** | TIRE, REPAIR, FLEET, PRICE_SHOPPER, VIP, OTHER | **No model field** | **Shop concept, schema-orphaned.** |
| **LeadSource** | WEBSITE, INSTAGRAM, PHONE, WALK_IN, REFERRAL, ADS, OTHER | **No model field** | **Shop concept, schema-orphaned.** |
| **LeadType** | TIRES, BRAKES, DIAGNOSTIC, OIL, REPAIR, OTHER | **No model field** | **Shop concept.** The Prisma enum itself is dead, but its *value set* is duplicated as a plain `as const` array `leadTypeValues` in `lib/domain.ts:28`, consumed by `lib/scoring/lead-parser.ts` for demo/scoring only — see `lib/services/leads.ts` header comment (class A, quoted in §3(a)): production lead persistence "moved to nickstire," and `createLead` in production now throws a typed error directing the operator to nickstire admin. |
| **LeadUrgency** | LOW, MEDIUM, HIGH | **No model field** | Same pattern — re-declared as `leadUrgencyValues` in `lib/domain.ts:29`, demo/scoring only. |
| **LeadStatus** | NEW, CONTACTED, BOOKED, LOST, DEAD | **No model field** | **Shop concept, schema-orphaned**, and unlike LeadType/LeadUrgency, not even re-declared as a plain array elsewhere in this corpus. |
| **ServiceCategory** | TIRES, BRAKES, DIAGNOSTIC, OIL, ALIGNMENT, SUSPENSION, GENERAL_REPAIR, OTHER | **No model field** | **Shop concept, schema-orphaned.** |
| ServiceState | STARTING, READY, DEGRADED, FAILED, AUTH_PENDING | Yes — `RunnerNode.status`, `ServiceHealth.status`, `SystemSnapshot.startupStatus` | Infra health, not "service" as in auto-repair service. |
| WorkItemType | AI_NEXT_MOVE, AI_DRIFT_ANALYSIS, AI_CLARIFY_MISSION, ALE_REFRESH | Yes — `WorkItem.type` | |
| WorkItemStatus | PENDING, CLAIMED, COMPLETED, FAILED, CANCELLED | Yes — `WorkItem.status` | |
| CommunicationMode | NEUTRAL, DIRECT, SHADOW | Yes — `OperatorProfile.communicationMode` | |
| DevicePriority | PHONE_FIRST, DESKTOP_FIRST, BALANCED | Yes — `OperatorProfile.devicePriority` | |
| DesignMode | SHADOW_TACTICAL, AUTOMOTIVE_EXECUTIVE, BOARDROOM_MINIMAL | Yes — `OperatorProfile.designMode` | |
| EmpireLane | MONEY, HEALTH, PERSONAL | Yes — `DailyExecutionState.activeEmpireLane` | |
| DayState | OPEN, CLOSED | Yes — `DailyExecutionState.dayState` | |
| CaptureTriageStatus | NEW, TRIAGED, CONVERTED, ARCHIVED | Yes — `CaptureInboxItem.triageStatus` | |
| CaptureConversionTarget | TASK, MISSION, LEAD, REFERENCE, PERSONAL, ARCHIVE | Yes — `CaptureInboxItem.conversionTarget` | **"LEAD" is a live conversion target with no local `Lead` model to convert into** — the actual conversion presumably hands off to nickstire (consistent with `leads.ts`'s "moved to nickstire" note); `convertedLeadId` on `CaptureInboxItem` is a bare `String?`, not a relation, which fits an external-system ID rather than a local FK. |
| GreeneBook | FORTY_EIGHT_LAWS, THIRTY_THREE_STRATEGIES, HUMAN_NATURE, MASTERY, ART_OF_SEDUCTION, FIFTIETH_LAW | Yes — `StrategicLaw.book` | |
| ActionStatus | PENDING, SUCCESS, FAILED | Yes — `ActionReceipt.status` | |
| AgendaItemCategory | WITNESSED_COMMITMENT, STANDING_INTENTION, CONTRADICTION, NEGLECT_ALERT, FOLLOW_UP | Yes — `AgendaItem.category` | |
| AgendaItemStatus | ACTIVE, RESOLVED, SNOOZED, ARCHIVED | Yes — `AgendaItem.status` | |
| OutcomeRating | OUTSTANDING, SATISFACTORY, SUBSTANDARD, FAILED | Yes — `Task.outcomeRating` | |

**Summary:** 22 of 31 enums back a live model field; **9 are schema-orphaned and every one of the 9 is a shop/CRM concept** (Customer×4, Lead×4, ServiceCategory×1) — a clean, self-consistent signature of the boundary doctrine having been enforced on the *data* (no Customer/Lead/Service model exists) while the *enum declarations* were left behind as dead schema weight (~45 lines). Two of the nine (`LeadType`, `LeadUrgency`) still have live *value-shape* consumers, but those consumers import a hand-duplicated plain array from `lib/domain.ts`, not the Prisma enum — so even those two could be deleted from `schema.prisma` with zero code impact.

## 3. OVERLAP CLUSTERS

For each cluster: what the code actually enforces as the difference, and whether that earns a
separate table (H, this run's judgment, grounded in the citations given).

### (a) Task / WorkItem / AgendaItem / Commitment / ScheduledAction / AutonomousAction / ActionReceipt / ApprovalRequest / TaskEvent / DailyExecutionState / PersonalDailyLog / ExecutionInsight

- **Task** is the one user-facing unit-of-work table. `LoopKind` (schema:35-40, class A) states it
  "replaces the old 3-table split of MasteryHabit + Commitment + OpenLoop" -- a PROMISE-kind Task row
  (`promiseTo`/`personId`) is a commitment, per that Apr-15 rebuild comment.
- **Commitment** (the model, not the Task.loopKind value) is a second, independently-alive
  commitment representation, reintroduced 2026-07-28 (WP-13, schema:913-939) with its own richer
  lifecycle (`successCondition`, `evidenceRequired`, `executionRef`, `outcomeRef`, `sourceRef`,
  `verifiedAt`) and no FK to Task at all. It is LIVE (25w/59r, S1) and independently corroborated
  by the brief's own CONTEXT: "Home surfaces AI-proposed Commitment rows (status 'proposed')." So
  today there are two unreconciled commitment concepts: `Task{loopKind:PROMISE}` (older, Apr-15)
  and `model Commitment` (newer, Jul-28, no relation between them). This is not a naming coincidence
  -- it is the same domain concept modeled twice, six sprints apart, with the newer one apparently
  live for the exact judgment-surface use case the brief is asking about.
- **WorkItem** is confirmed distinct and should stay so: internal job queue (`AI_NEXT_MOVE` /
  `AI_DRIFT_ANALYSIS` / `AI_CLARIFY_MISSION` / `ALE_REFRESH`), claimed by a `RunnerNode` via
  `availableAt`/`claimedAt`/`completedAt` lease fields plus an `idempotencyKey`, zero relation to
  Task. Matches the prior finding verbatim -- it is infrastructure, not a to-do.
- **AgendaItem** is the judgment/attention ledger, not an execution unit -- its own enum comment says
  it now durably persists "Home follow-ups promoted from localStorage-only dismissal" (schema:3361-
  3363). `source`/`sourceId` are loose strings, no FK to Task/Mission/Commitment. Earns its table:
  different question ("what needs my attention") than Task's ("what am I doing").
- **ScheduledAction** looks like an earlier, parallel reminder/follow-up scheduler
  (`entityType`/`entityId` as untyped strings covering task/customer/lead/mission/device) that never
  got a consuming UI -- ORPHAN-R in S1 (writer exists, no reader found). Functionally redundant
  with AgendaItem's `dueDate`/`escalateAt` today; does not clearly earn continued separate existence.
- **AutonomousAction** vs **ActionReceipt**: both are "what actually fired" records but for different
  surfaces. AutonomousAction logs autonomous-engine rule fires (`ruleName`, `approval` auto/pending/
  approved/rejected, `idempotencyKey`). ActionReceipt is Mission-scoped (`missionId` FK, `ActionStatus`
  enum, `sourceSystem`, `verificationPayload`) and its heaviest writer is the Telegram webhook
  (`app/api/telegram/webhook/route.ts:271`). Genuinely different callers and different FK shape --
  justified split, though a reader auditing "everything that happened" has to union two tables plus
  TaskEvent/GoalEvent to get a full picture.
- **ApprovalRequest** is upstream of both: the gate that gets consulted BEFORE AutonomousAction/
  ActionReceipt exist for a gated action. See S4 for its state machine.
- **TaskEvent** (per-Task domain-semantic log) is the direct structural twin of **GoalEvent**
  (cluster b) -- same idempotency pattern, same `onDelete: Restrict` FK reasoning, same "kinds:" doc
  comment style. Intentional, repeated pattern, not accidental duplication.
- **DailyExecutionState** (`stateDate @unique`, one row per day, tracks today's live cockpit state --
  current command/task/blocker) is a genuinely different axis from **PersonalDailyLog**
  (`logDate @unique`, one row per day, end-of-day self-report wellbeing -- sleep/energy/mood/
  workout/driftIncidents). Both are one-row-per-day singletons but measure different things
  (execution state vs. self-report) -- justified split EXCEPT that PersonalDailyLog's own sibling
  BodyTracking (cluster i) admits field duplication with it directly in a schema comment
  (schema:967-974, class A): "The PersonalDailyLog model has overlapping fields but was never wired
  into /body... Adding directly here so the daily check-in stays single-table." That is a live,
  self-admitted duplication, not a hypothesis.
- **ExecutionInsight** (generic `insightType`/`title`/`detail`/`score`) reads as an earlier, thinner
  version of **Reflection** (cluster c) with no differentiator found beyond vintage -- both are
  free-form AI-derived insight rows with a score/confidence axis.

### (b) Mission / MissionLink / LifeGoal / GoalStat / GoalEvent / MasteryScore / MasteryDecision

- **Mission** and **LifeGoal** each carry an independent hierarchy mechanism: Mission<->Mission via
  `MissionLink` (self-referential M:N, `relation`: depends-on/blocks/related), LifeGoal<->LifeGoal via
  its own `parentGoalId` self-relation ("compounding ladder," schema:2319), plus a third,
  cross-model link: `Mission.lifeGoalId` (optional, one Mission -> one LifeGoal). Three distinct
  hierarchy/relation mechanisms across two models is real complexity, not obviously wrong (missions
  and goals genuinely have different graph shapes) but worth flattening in a target design.
- **GoalStat** is real schema but thin in practice: `lib/mastery/goal-stats.ts:5` (class A comment)
  states most goals declare zero `GoalStat` rows and the code falls back to
  `inferGoalStats(domain)`. S1 already shows no direct-call writer found. It is a real, live-read
  (via nested `select`) refinement layer sitting on top of a working default-inference fallback --
  not dead, but optional in a way the schema doesn't signal.
- **GoalEvent** mirrors **TaskEvent** exactly (see cluster a) -- same append-only, idempotency-keyed,
  `onDelete: Restrict` pattern, one per aggregate root. Consistent, intentional pattern.
- **MasteryScore** and **MasteryDecision** predate the Ambition Engine (`Int @default(autoincrement())`
  ids -- the only two models on the whole schema not using `cuid()`, a structural tell of age) and
  are unrelated to `GoalStat`'s weighted stat-leveling -- they are a separate, older "Mastery Models
  (consolidated from SQLite)" wave (schema:838). Both are still LIVE (S1).
- **MasteryDecision** vs **DecisionReplay** (cluster c) is the sharpest overlap in this cluster:
  near-identical shape -- `chosen`/`reasoning`/`predictedOutcome`/`actualOutcome`/`grade`/`reviewDate`
  (MasteryDecision) vs. `choiceMade`/`reasoning`/`outcome`/`lesson`/`reviewAt`/`reviewed`/
  `outcomeScore` (DecisionReplay) -- and `DecisionReplay.decisionId Int?` is explicitly documented as
  "link to MasteryDecision" (schema:2491, class A). DecisionReplay reads as a newer wrapper/successor
  around MasteryDecision, not a full replacement: both are independently writable today (MasteryDecision
  9w/28r, DecisionReplay 7w/12r, S1) with no enforced single-writer path between them.
- Sibling note (dead, not overlapping): a `DailyScore` model was retired 2026-04-18 per a schema
  comment at schema:840-844 ("Nour: 'i think its stupid'") and removed from the Prisma client -- but
  `prisma/seeds/seed-foundation.ts` still calls `prisma.dailyScore.create(` (class A, found live in
  this snapshot). That seed file cannot run without erroring on that line.

### (c) The memory cluster (26 models)

Grouped by what the code actually treats as the same vs. different function, not by the brief's list
order:

1. **Core associative memory.** `BrainMemory` is the one general-purpose category-tagged fact store,
   with the BDN-310 temporal-validity/supersession machinery (S5). `MemoryEdge` is a general
   typed-relationship graph (`sourceType`/`targetType`: memory, reflection, prediction, commitment,
   decision, person, loop -- any two typed+id'd rows). `SemanticEdge` is a narrower, performance-
   motivated extraction: its own doc comment says it was "Pre-extraction ·
   BrainMemory(category='semantic_edge')... Forced graph data through a KV store; queries that join
   edges with their endpoint memories paid two BrainMemory scans" (schema:1538-1546, class A). It only
   ever connects two BrainMemory rows and carries a cosine `distance`/`score` instead of MemoryEdge's
   generic `strength`. Judgment (H): SemanticEdge earns its table on access-pattern grounds (a
   dedicated composite index for "what's connected to memory X"), not semantic necessity -- a
   database-architect-lens split, correctly documented as such in the schema itself, not an accident.
2. **Capture funnel.** `MemoryInboxItem` (external content, `privacyClass`-quarantined pre-promotion)
   and `BrainDump` (raw personal stream-of-consciousness, `extractedItems`) are different capture
   modes feeding the same downstream pipeline -- legitimately distinct triggers, not duplication.
3. **Self-model layer.** `Reflection` (meta-cognition insight), `Contradiction` (stated-vs-actual gap:
   `claim`/`reality`/`gap` triple), `IdentitySnapshot` (periodic measured self json), `CausalChain`
   (root-cause chain array), `Prediction` (forecast + Brier-score calibration) are five structurally
   distinct payload shapes, not one table wearing five hats -- judged as earning separate tables
   (H), unlike SemanticEdge above.
4. **Journal + its clustering layer -- a well-justified design.** `BrainDump`/`Reflection`/
   `SituationLog`/`DecisionReplay` are the "4 journal sources" that `JournalThread` polymorphically
   clusters via `(entrySource, entryId)` on `JournalThreadEntry`; `JournalSettings` is pure config.
   The schema comment explicitly reasons through and rejects 4 separate join tables as YAGNI
   (schema:2524-2530, class A) -- worth citing as a positive restraint example, not just a finding.
5. **Strategic-law reference vs. instance.** `StrategicLaw` (curated Greene-corpus text, seed-only
   writer per S1) is cited by `SituationLog.lawId` (optional FK) when a live journal entry matches a
   pattern. Clean reference/instance separation -- not overlap.
6. **External-intelligence pipeline.** `RegisteredSource` -> `SourceDocument` -> `IntelligenceClaim` is
   a clean 3-stage FK chain (source you watch -> documents captured -> claims extracted), each stage a
   different cardinality and different reader. `PageSnapshot` is a separate, simpler sensor with
   no FK into that chain -- own comment: "change-detection-lite... OBSERVES only... takes NO autonomous
   action" (schema:3232-3234). `OpportunityLog` (scored, `sourceId` denormalized from the pipeline) ->
   `Experiment` (spawned 1:1 per accepted opportunity, `opportunityId @unique` makes accept
   idempotent) closes a loop back onto `RegisteredSource.authScore`. This is a genuinely clean,
   unidirectional pipeline where every stage earns its table.
7. **Two outcome ledgers, different axes, no cross-reference.** `IntelligenceOutcome` tracks whether a
   shown recommendation was acted on (`decision`: accepted/dismissed/edited/ignored), explicitly
   scoped to surfaces that lack their own receipt table and explicitly NOT duplicating agenda/
   approvals/queue (own comment, schema:3311-3317). `CalibrationReviewItem` tracks whether a
   prediction/task-ROI/business-projection held up (`predictedOutcome`/`proposedActualOutcome`/
   `approvedActualOutcome`/`accuracyScore`, human `reviewedBy`). Related in purpose (did the
   machine's claim hold up) but different measurement axis (adoption vs. calibration) -- judged
   justified (H), though there is no FK between them today, so a single "was the model right"
   report has to union both.
8. **A stale predecessor, not a live overlap.** `BriefingLog` (daily/weekly/monthly briefs, LIVE, 3
   readers via `/api/intelligence/briefs/*`) and `ReviewLog` (morning/evening/weekly briefs) are
   near-identical shape. `ReviewLog`'s own doc comment claims it is "read by GET /api/reviews" -- but
   S1 found zero readers for it in this corpus. Read as: BriefingLog superseded ReviewLog and the
   old table/route was never cleaned up, not two live systems doing the same job.
9. **ArsenalLog** -- confirmed dead, see S1 and S8.

### (d) PersonProfile / Contact / RelationshipLedger / RelationshipPlay

`PersonProfile` is the broad personal-OS "people I know" model (`role` includes employee, customer,
vendor, family, competitor, advisor, friend, mentor, etc. -- schema:2107) with an explicit `source`
field whose own 2026-06-06 comment says "shop-vs-personal is structural" (schema:2115-2117, class A)
-- i.e., the code already knows this field can hold a shop customer/vendor. `Contact` is the fully
separate CRM-replacement model (`role`: coaching_client/lead/sponsor/partner -- Nour's own coaching/
consulting business, per its "=== 2. CRM/Audience (Replaces Twenty CRM) ===" section header) used by
`Booking`/`Agreement`/`Order`. There is no FK, no shared key, and no code path found linking a
`PersonProfile` row to a `Contact` row. A human who is both a "close_friend" in `PersonProfile` and
a "coaching_client" in `Contact` is two disconnected rows with nothing tying them together -- a real
identity-fragmentation finding, not a naming quirk. `RelationshipLedger`/`RelationshipPlay` are both
scoped exclusively to `PersonProfile.personId` (Power-Atlas deposit/withdrawal ledger + power-play
execution log) with no relation to `Contact` at all.

### (e) ChatConversation / ChatMessage / AgentTrace / AiGeneration / PostTurnOutbox / ToolTelemetry / ToolVerbRatio / PromptVersion

`ChatConversation`/`ChatMessage` are the transcript itself. The split of `AgentTrace` vs.
`AiGeneration` is explicitly documented and clean: "AiGeneration tracks usage/billing per individual
generation; AgentTrace tracks the CALL CHAIN -- the same operator request may produce multiple
AiGeneration rows... but ONE traceId" (schema:1762-1765, class A). `PostTurnOutbox` is not chat
content -- it is a durability layer for work that must happen after a turn (memory writes, receipts,
journal ingest), added because that pipeline used to be fire-and-forget and crash-losable (schema:
3399-3404). Duplicate-implementation finding: two separate files both implement the outbox's
atomic claim (`updateMany` on `status`) independently -- `lib/agent/follow-up.ts:279` and
`lib/services/chat/post-turn-outbox.ts:148,258` -- same table, two parallel consumers, which is a
maintenance risk even if both are individually correct (not verified whether they claim disjoint row
sets or can race each other; out of scope for a read-only pass, flagged as H). `ToolTelemetry`
(per-tool aggregate counters, raw-SQL upsert) and `ToolVerbRatio` (per-turn raw sample) are both
Phase-1 dual-write extractions out of `BrainMemory` category-abuse (same story as SemanticEdge in
cluster c) but at genuinely different grain (aggregate vs. event) -- justified split. `PromptVersion`
is orthogonal config (system-prompt versioning with an `active` flag), unrelated to the runtime chat
tables.

### (f) Observability tables

`ApiRequestLog` (HTTP layer) / `ErrorLog` (app errors) / `SystemMetric` (generic metric+tag time
series) / `CronJobLog` (job outcomes -- see its own stale-comment warning in S1) / `SchemaChangeLedger`
(DDL history, closing the "no audit trail for `prisma db push`" gap) / `SessionReport` (engineering-
session meta-log: `agentModel`/`tokenCost`/`filesChanged`/`commits` -- this is the coding-agent's own
session record, not a product-AI trace) / `BridgeCallLog` (newest, 2026-08-27, narrowly scoped to
`/api/mcp` + `/api/actions` bridge calls, added because "the bridge audit was console.log only") /
`VoiceLatencyEvent` (per-stage VAPI timing, explicitly non-overlapping with AgentTrace per its own
comment: "AgentTrace already covers LLM-side latency on calls that flow through the chat pipeline ·
don't double-count there. This model captures STT/TTS/network legs that AgentTrace can't see"
(schema:2861-2863, class A)). `AuditEvent` (generic `actor`/`eventType`/`detail`/`payload`, used e.g.
for page-visit tracking) and `EntityAudit` (structured before/after diff log, scoped to entity
mutations) genuinely overlap in purpose -- both answer "something happened, who did it" -- but differ
in shape (free-form event vs. structured diff); EntityAudit's own doc comment (schema:525-531)
explicitly reasons through why both can coexist. S1 flags EntityAudit's writer surface as thin (1
direct-call site against a doc comment claiming "every meaningful mutation" writes here) -- most
provenance likely flows through a shared helper this flat grep would not catch as a distinct writer
per call site; not independently confirmed which helper.

### (g) Devices

`SmartDevice` (registry) -> `DeviceEvent` (inbound telemetry) -> `DeviceCommand` (outbound queue,
pending->sent->acked/failed) is a clean, standard 3-table IoT pattern. `VisionEvent` is camera-specific
and has no FK to `SmartDevice` despite a camera being a `SmartDevice` with `deviceType=CAMERA` --
a "SHOPINSIDE" motion event and the `SmartDevice` row for that same camera are not joined in the
schema. `RunnerNode`/`ServiceHealth`/`SystemSnapshot`/`WorkItem` are the internal-process-health axis
(distinct from physical smart-home devices): RunnerNode registers a worker process, ServiceHealth is
a per-dependency health check optionally scoped to a RunnerNode, SystemSnapshot is the rolled-up
singleton dashboard row. `Integration` is third-party SaaS config/health -- a third, separate axis
again (external APIs, not physical devices or internal processes). `LocalSyncLog` is a generic
module/action/count sync log bridging a local agent (PowerShell/Obsidian side) and the cloud DB.

### (h) Shop/commerce tables

Covered in depth in S1/S2: `Contact`/`Booking`/`Agreement`/`Product`/`Order` are an explicitly-labeled
"Replaces Twenty CRM / Cal.com / Documenso / Medusa" stack (schema:2972, 2992, 3010, 3026, class A)
for what the `Contact.role` values (`coaching_client`, `sponsor`, `partner`) show is Nour's own
coaching/consulting side business -- not Nick's Tire. Only `Contact`, `Product`, and `Order` have a
real write path (the latter two via a Stripe webhook); `Booking` and `Agreement` are schema-complete
but never wired to a create path (S1: both ORPHAN-W). `ShortLink`/`LinkClick` (link attribution,
"Replaces Dub") sit adjacent -- content/marketing-shaped, not shop-operational, but built with the
same "replace a SaaS tool" pattern. `SocialPublishQueue` is the one genuinely live boundary
crossing: it publishes to `platforms: ["instagram","gbp"]` -- GBP is Google Business Profile, which
is Nick's Tire's public listing -- from a queue that lives in statenour's schema (S1).

### (i) Health tables

`HealthSample` (raw Apple Health export, Layer A, deduped on `(sourceSystem, sourceSampleId)`) ->
summarized into `BodyTracking` (the daily canonical every analyzer/MODE/RECOVERY/brief consumes) ->
receipted by `HealthIngestBatch` (idempotent batch wrapper). A clean layered design EXCEPT for the
already-cited, self-admitted field duplication between `BodyTracking` and `PersonalDailyLog`
(schema:967-974) -- sleep/workout/energy exist on both, wired into only one.

### (j) Preference tables

Four independently-shaped settings surfaces with no unifying pattern found: `UserPreference` (generic
untyped key/value/type/category KV store), `OperatorProfile` + `OperatorPreference` (a 1:1-split pair
-- profile holds identity-ish fields like `preferredName`/`communicationMode`, preference holds a
second settings blob `uiDensity`/`motionLevel`/`alertAggressiveness`; both are always read/written
together from the same file, `lib/brain/preference-inference.ts`, and no different-cardinality or
different-access-pattern reason for the split was found), and `JournalSettings` (a fourth, separate
single-row config table, feature-scoped to the Journal Brain, not FK-linked to OperatorProfile). Four
different shapes for "settings," not one.

## 4. INVARIANTS AND STATE MACHINES actually enforced in code

- **Task status** (`INBOX -> READY -> DOING -> WAITING -> DONE -> ARCHIVED`, `TaskStatus` enum) has
  **no single enforced state machine**. `lib/services/task-actions.ts` (Phase RR, 2026-05-19; class A
  header comment) is the "single source of truth" for exactly 3 named actions -- `checkTask`
  (`:96`), `startTask`, `breakPromise` -- and its own doc comment explicitly contrasts this against
  "the plain status PATCH path through `updateTask` [which] only handles the bare status transition"
  (i.e., no validation there). Separately, a direct `.task.update({ data: { status ... } })` call
  that can set status to any value with no guard was found in at least 12 other files, e.g.
  `app/api/cron/stale-tasks/route.ts:50`, `lib/services/autonomic-orchestrator.ts`,
  `lib/trpc/routers/task.ts`, `app/api/realtime/tool-call/route.ts`, `lib/ai/execute-actions.ts`,
  `lib/brain/task-completion-detector.ts`. **So: enforced for complete/start/break-promise via
  `task-actions.ts`; free-form for every other transition.**
- **Mission status** -- no dedicated transition-guard function was located (grep for
  `MissionStatus.`/literal status-setting patterns in `lib/services/missions.ts` and `lib/missions/*`
  returned nothing). Writer example from S1 (`app/api/missions/[id]/retro/route.ts:160`) is a plain
  `.mission.update()`. Read as free-form, same shape as Task's un-gated PATCH path (H, not
  independently confirmed against every call site).
- **Commitment lifecycle** -- the schema comment (schema:913-916, class A) declares the intended
  vocabulary: "proposed -> accepted -> active -> verified|abandoned," extending a
  `COMMITMENT_STATUSES` contract. The write path (`app/api/commitments/route.ts:69`, S1) is again a
  direct `.commitment.update()`; no dedicated transition-guard function was located in this corpus for
  Commitment specifically (unlike ApprovalRequest below). Flagged H/I, not confirmed enforced.
- **ApprovalRequest -- the one clearly, atomically enforced state machine found.** `lib/tools/
  guardian.ts:executeApprovedToolAsync` (`:76-160`) claims a row with:
  ```
  const claim = await prisma.approvalRequest.updateMany({
    where: { id: requestId, OR: [
      { status: "approved" },
      { status: "executing", updatedAt: { lt: staleTime } }  // 5-min TTL reclaim
    ]},
    data: { status: "executing" },
  });
  if (claim.count !== 1) { /* lost the race, bail */ return; }
  ```
  (`guardian.ts:78-91`, class A) -- a real compare-and-swap: the `updateMany` only matches (and thus
  only succeeds for) a row currently in an eligible status, `claim.count` tells the caller whether
  *this* invocation won the race, and a 5-minute stale-`executing` window lets a crashed execution be
  reclaimed instead of wedging the row forever. Terminal transitions to `"executed"`
  (`guardian.ts:141-148`) or `"failed"` (`guardian.ts:151-158`) happen only after the claim succeeds,
  via plain (non-atomic, but now single-owner) `.update()` calls. `checkApprovalGate`
  (`lib/ai/runtime/approval-gate.ts:17-115`) is the *upstream* half: it dedupes on
  `(toolId, status in [...]) + payload-string-equality` before minting a new `pending_approval` row,
  and short-circuits on `status="executed"`/`"rejected"`/`"failed"` for an in-flight duplicate call.
- **PostTurnOutbox** states (`pending -> processing -> done|failed`) also use an `updateMany`-style
  atomic claim, but with **two independent implementations of the same claim** --
  `lib/agent/follow-up.ts:279` and `lib/services/chat/post-turn-outbox.ts:148,258` -- both doing
  their own `updateMany({ where: { status: "pending", ... }, data: { status: "processing" } })`-shaped
  claim against the same table. Not verified (read-only pass) whether the two claim disjoint row
  sets or could double-claim under a race; flagged as a maintenance/correctness risk to check, not a
  confirmed bug (H).
- **BrainMemory supersession** is enforced at one concrete, findable site:
  `lib/brain/memory-manager.ts:155` sets `supersededById: args.existing.id` when a memory is replaced;
  `lib/brain/memory-manager.ts:584` clears it back to `null` (a restore/undo path). The self-relation
  is `onDelete: SetNull` (schema:1691, class A) specifically so a hard-deleted replacement leaves a
  detectable dangling pointer rather than silently cascading the fact that something changed --
  documented reasoning in the schema comment itself (schema:1686-1690).
- **AutomationPolicyFire -> AutomationPolicy** FK is `onDelete: Restrict`, not `Cascade`, *specifically
  because* `AutomationPolicy` is soft-delete-managed (`lib/db/soft-delete.ts` `SOFT_DELETE_MODELS`) --
  the schema comment (schema:2828-2835, class A) states this was a deliberate fix: a stray hard-delete
  bypassing the `softDelete()` helper used to cascade-erase the fire history silently; `Restrict` now
  forces that mistake to error loudly. The same `onDelete: Restrict` reasoning recurs at
  `Task -> TaskEvent`, `LifeGoal -> GoalEvent`, and `Mission -> Task` (all schema comments cite v9.1.15
  "Cascade was a Postgres-level hard-delete that bypassed v7.9 universal soft-delete") -- a
  consistent, intentional, repeated invariant across the schema, not four separate accidents.
- **Soft-delete coverage is inconsistent with the schema's own field-presence.** `lib/db/soft-delete.ts`
  (class A) defines `SOFT_DELETE_MODELS` as exactly 10 model keys: `mission, task, masteryDecision,
  commitment, brainDump, brainMemory, reflection, identitySnapshot, lifeGoal, automationPolicy`. But
  five *other* models also carry a `deletedAt`/`archivedAt` field in the schema and are **not** in that
  helper set: `ChatConversation.archivedAt`, `Contradiction.deletedAt`, `JournalThread.deletedAt`,
  `PersonProfile.deletedAt`, `SocialPublishQueue.deletedAt` (cross-referenced directly against the
  parsed schema field list, class A). Their `deletedAt` gets set by ad-hoc code at each call site
  rather than the shared `softDelete()`/`findManyActive()` helpers -- meaning the "filter
  `deletedAt: null` everywhere" contract the helper module exists to guarantee is **not** guaranteed
  for these five. `soft-delete.ts`'s own header comment additionally documents *why three other
  tables* are intentionally excluded (`chat_messages`, `audit_logs`/`events`/`predictions`,
  `memory_edges` -- append-only/TTL/cascade-only by design), which shows the omission of the five
  above was not part of that reasoned exclusion list -- it reads as five follow-on `deletedAt` fields
  added after the helper module shipped, without the helper being extended to cover them.

## 5. TEMPORAL GOVERNANCE

- **Event time vs. ingestion time vs. effective time, cleanest example:** `HealthSample` distinguishes
  `startAt`/`endAt` (when the health event *occurred*, per Apple Health) from `importedAt` (when this
  system ingested it) -- textbook event-time/ingestion-time separation (schema:992-1013, class A).
- **Event time vs. ingestion time vs. effective/validity time, richest example:** `BrainMemory`
  distinguishes **four** temporal axes on one row, and its own schema comment (schema:1662-1690,
  class A) is explicit that this is deliberate, not redundant: `lastSeen` = last time this fact was
  *observed/touched* (bumped on every read, "measures attention, not confirmation" per the comment);
  `expiresAt` = decay TTL (after which the system stops trusting it, independent of belief validity);
  `deletedAt` = explicit removal (should not have existed); `validFrom`/`validUntil` = the belief's
  *validity window* -- `validUntil = null` means "still believed," a non-null `validUntil` plus
  `supersededById` means "this was true, then a specific replacement fact took over" (temporal
  supersession, not deletion); `lastVerifiedAt` = explicit re-confirmation, deliberately **not**
  touched by `lastSeen`'s read-driven updates. That is event time (`lastSeen`), effective/validity
  time (`validFrom`/`validUntil`), and an explicit confirmation timestamp (`lastVerifiedAt`) modeled
  as three genuinely different things on the same row.
- **IntelligenceOutcome** carries four sequential lifecycle timestamps on one row --
  `shownAt` -> `decidedAt` -> `outcomeAt`, plus `createdAt` -- tracking when a recommendation was
  surfaced, when the operator reacted, and when its real-world result became known, as three
  independently-nullable points in time (schema:3318-3343).
- **ApprovalRequest** carries five: `createdAt`, `expiresAt` (a forward-looking deadline, not a
  record of the past), `approvedAt`, `executedAt`, `updatedAt` -- the temporal footprint of the state
  machine documented in S4.
- **Timezone handling:** `lib/utils/datetime.ts` (class A) is the ET clock utility referenced by the
  brief. `today()`, `hourET()`, `weekdayET()` all resolve via `Intl.DateTimeFormat`/
  `toLocaleDateString` with `timeZone: "America/New_York"` -- i.e. they use the IANA timezone name,
  not a fixed UTC offset. Its own comments are explicit about *why*: "The system operates in ET
  (Cleveland). Using UTC would return tomorrow's date when crons run at 5am UTC (midnight ET)" and
  "The server runs UTC (Railway), so `new Date().getHours()` returns the UTC hour -- use this for ET
  time-gates." Because it names the IANA zone rather than hardcoding an offset, DST transitions are
  handled correctly *by construction* (JS's `Intl` API applies the zone's DST rules automatically) --
  **no explicit DST test or edge-case comment was found**, so this is a design-level guarantee (H).
- **Recurrence:** modeled only on `Task` -- `LoopKind.WEEKLY` + `recurringDays Int[]` (0=Sun..6=Sat,
  schema:428-433, class A). The schema comment documents the actual mechanism: on completion, a
  WEEKLY task is snoozed to its next listed weekday via `status=WAITING` + `snoozedUntil`, and a
  dedicated `task-resurface` cron (`app/api/cron/task-resurface/route.ts`, confirmed in S1's writer
  list for `Task`) flips it back to `READY` on that day. No other model expresses recurrence as a
  first-class concept (`ScheduledAction.recurrence` is a bare string `"once"/"daily"/"weekly"/
  "monthly"` with no weekday/interval structure, and per S1 has zero confirmed readers).
- **Duplicate-event handling for calendar ingestion:** **no code was found in this corpus.** Searches
  for `googleEventId`/`calendarEventId`/`icalUid`/"calendar...dedup" across `lib/` and `app/` returned
  nothing. Either this app does not ingest external calendar events directly (most likely, given no
  Calendar-shaped model exists in the 103), or the ingestion path lives entirely outside this
  snapshot's corpus (e.g. behind an MCP/connector this scan cannot see). Reported as a gap, not
  guessed at.

## 6. RAW SQL SURFACE

- **365 `$queryRaw`/`$queryRawUnsafe`/`$executeRaw`/`$executeRawUnsafe` call sites across 128 distinct
  files** (grep count, class A). Dominated by `lib/ai/**` and `lib/brain/**` (pgvector similarity
  search, hybrid BM25+cosine search, tool-quota atomic increments) and `app/api/system/**`
  (dashboards computing percentiles/aggregates Prisma's query builder can't express).
- **pgvector columns** live on `VectorEmbedding` as `Unsupported("vector")` /
  `Unsupported("vector(1536)")` (schema:2661-2662, class A) -- deliberately declared as
  `Unsupported(...)` rather than omitted, per the schema's own extensive comment (schema:2625-2650):
  before this fix, `prisma db push` could not see these raw-SQL-only columns and repeatedly offered
  to `--accept-data-loss` drop 7,000+ vector rows ("Three near-misses in 10 days," class D self-
  report). `lib/db/pgvector.ts` and `lib/brain/semantic-link.ts` are the query-side raw-SQL
  consumers. `lib/db/schema-sentinel.ts` is a defense-in-depth existence check.
- **tsvector column:** `chat_messages.searchable_tsv` is a Postgres `GENERATED ALWAYS AS (...) STORED`
  tsvector, deliberately **left out** of the Prisma model entirely (not even `Unsupported`) because
  Prisma 6 cannot model a generation expression and would try to `ALTER` the column
  (schema:1092-1103, class A). Queried only via raw SQL in `app/api/chat/search`.
- **HNSW index creation:** `prisma/migrations/20260429250000_pgvector_extension_and_column/
  migration.sql:38-40` -- `CREATE INDEX IF NOT EXISTS "vector_embeddings_embedding_vec_hnsw_cosine_idx"
  ... USING hnsw ("embedding_vec" vector_cosine_ops)`. A second tuning pass lives at
  `prisma/migrations/20260512_v526_index_optimization/`. Operational scripts: `scripts/
  add-hnsw-index.ts` (original install), `scripts/tune-vector-index.ts`, `scripts/
  recover-pgvector-from-text.ts` / `recover-pgvector-embedding-vec.ts` (emergency rebuild if the
  columns are ever dropped).
- **Raw SQL that can DROP/TRUNCATE/DELETE:** the automated scan (regex for `DROP`/`TRUNCATE`/
  `DELETE FROM` inside a `$queryRaw`/`$executeRaw` line) found **zero literal matches** across all 365
  sites. The single highest-risk *dynamic* site is `app/api/system/apply-pending-migration/route.ts:
  357` -- `await prisma.$executeRawUnsafe(stmt)` where `stmt` is a loop variable, not a literal --
  but `stmt` is drawn only from a hardcoded `MIGRATIONS` dictionary keyed by a `name` the caller
  supplies (not raw SQL text from the request body), and the route is gated by `requireSession(req)`
  (operator-only auth, confirmed at `:11,28,335`, class A) before any statement runs. Not arbitrary
  SQL execution, but it is the one route in this corpus that runs ad-hoc `ALTER TABLE`/DDL statements
  in production outside the normal migration flow -- consistent with the durable "apply prod migration
  w/o DB creds" pattern already on record for this app. A non-destructive maintenance command was also
  found: `lib/ai/chat/command-registry.ts:380: await prisma.$executeRaw\`VACUUM\``.

## 7. N+1 AND FAN-OUT HINTS (best effort, H)

Detected via a loop-start pattern (`for(`/`for await`/`.map(async`/`.forEach(async`/`while(`) followed
within 15 lines by an `await`ed Prisma call -- 182 raw candidate sites found; the following 10 are the
clearest genuine per-item-database-round-trip risk (as opposed to a loop that happens to contain one
conditional query that fires at most once):

1. `app/api/system/mission-surface-stats/route.ts:79` (loop) -> `:91` `brainMemory.findFirst` **and**
   `:107` -> `:115` `brainMemory.update` in the same loop body -- a read-then-write per iteration (2
   round-trips × N items).
2. `lib/brain/automation-engine.ts:180` and `:187` -> both `deviceCommand.create` inside the same
   loop (`:194`) -- two writes per rule-fire iteration.
3. `lib/ai/tools/goals.ts:265` -> `:266` `commitment.create` inside a loop -- multiple `Commitment`
   rows minted per call.
4. `lib/ai/judge-eval/sampler.ts:172` -> `:176` `chatMessage.findFirst` inside a loop -- a per-sample
   lookback query, classic N+1 shape for an eval/sampling pass over many messages.
5. `app/api/webhooks/inbound-crm/route.ts:163` -> `:166` `task.create` inside a loop -- webhook
   fan-out creating one Task per inbound item.
6. `lib/brain/contextual-recall.ts` has **three separate** loop-guarded `brainMemory.findMany`/
   `.reflection.findMany` sites in one file (`:1274`, `:1420`, `:1523`) -- a concentration worth a
   single profiling pass rather than three separate fixes.
7. `app/api/cron/dossier-autodraft/route.ts:80` -> `:87` `personProfile.update` inside a loop --
   per-person dossier write, scales with People count.
8. `app/api/cron/greene-law-tag-refresh/route.ts:38` -> `:41` `personProfile.update` inside a loop --
   same shape as #7, different cron.
9. `app/api/cron/calibration-generator/route.ts` has **two** loop-guarded `calibrationReviewItem.
   upsert` sites (`:59`->`:63` and `:131`->`:139`) in the same file.
10. `app/api/people/search/route.ts:114` -> `:124` `personProfile.findMany` inside a loop -- a search
    fan-out; worth checking whether this can collapse to one `findMany` with an `IN`/`OR` filter.

**Missing-index hints on hot filtered columns (H, best effort, not measured):** `EntityAudit` is
filtered by `(entityType, entityId, createdAt)` and separately by `(actor, createdAt)` per its own
doc comment's example queries, and both are already indexed (schema:568-570) -- no gap found there.
`AuditEvent.eventType`/`.actor` are both indexed with `createdAt` composites (schema:770-772) also
covered. The more interesting *possible* gap: `ScheduledAction` is filtered by `entityType`/`entityId`
(schema:1483, `@@index([entityType, entityId])` -- present) but since S1 found no confirmed reader at
all, this index may be entirely unused overhead rather than a hot path; not something a schema read
alone can settle (H, would need `pg_stat_user_indexes`).

## 8. CANDIDATE TARGET ONTOLOGY (H — this run's recommendation)

Kaizen framing: this is a *smallest-viable-change* list, not a rewrite plan. Every recommendation
below is either (a) delete something already confirmed dead, (b) link two things that already
duplicate each other instead of merging them destructively, or (c) extract a repeated *pattern*
(not a repeated table) into one shared implementation. Database-architect framing: nothing here is
justified by taste — every "keep separate" call above was because the two tables have a different
access pattern or a different payload shape (S3), and every "merge" call is because they don't.

### Canonical objects and the invariant each one needs

| Canonical object | Reference implementation today | Invariant it must hold |
|---|---|---|
| **Evidence** (raw captured material) | `HealthSample`, `PageSnapshot`, `SourceDocument` | Immutable once captured (no in-place edits, only new rows); a dedup key with a real `@@unique` (HealthSample's `(sourceSystem, sourceSampleId)` is the pattern to copy); explicit `sourceSystem`. |
| **Claim/Memory** (interpreted, confidence-scored belief) | `BrainMemory` | Must carry `confidence`; must separate observation-time (`lastSeen`-shaped) from validity-time (`validFrom`/`validUntil`) from explicit-confirmation-time (`lastVerifiedAt`-shaped) — BrainMemory's BDN-310 design (S5) is the bar every future claim-shaped table should clear before earning its own table, exactly as `SemanticEdge`/`ToolTelemetry`/`ToolVerbRatio` already did when extracted out of `BrainMemory.category` for proven index-shape reasons (S3-c1, S3-e). New claim-shaped data should default to landing in `BrainMemory.metadata` first; fork out a dedicated table only when a specific query pattern demands it — that is the codebase's own already-validated evolutionary path, not a new idea. |
| **Person** | `PersonProfile` | A single identity space with an unambiguous scope/context discriminator (personal / coaching-client / other), and a real dedup anchor (email or phone, both already optional fields on `PersonProfile` and `Contact`) instead of the current two disconnected name-keyed tables. |
| **Commitment** | `Commitment` (the WP-13 model, not `Task.loopKind=PROMISE`) | One source of truth for "a promise": `successCondition` + `evidenceRequired` + a terminal `verified`/`abandoned` state with a timestamp — already true of `Commitment`; `Task` rows should reference it, not duplicate it. |
| **Action** (what the system actually did) | `AutonomousAction` | `idempotencyKey` + explicit `result`/`status` + `executedAt` — already true of `AutonomousAction`; any new action-log table should copy this shape rather than reinvent one, as `ActionReceipt` mostly (but not identically) does. |
| **Decision** | `DecisionReplay` | A review window (`reviewAt`) + an outcome + a lesson field — already true; should become the *only* decision-journal table. |
| **Outcome** (did the machine's claim/recommendation hold up) | `IntelligenceOutcome` | Three distinct nullable lifecycle timestamps (`shownAt`/`decidedAt`/`outcomeAt`, S5) + a predicted-vs-actual comparison field. |
| **Conversation** | `ChatConversation` + `ChatMessage` | Append-only messages, branch-capable (already true via `parentMessageId`/`branchId`), soft-archive not hard-delete (already true via `archivedAt`, though not through the shared helper — see below). |
| **Receipt** (universal "something changed, who did it, why") | `EntityAudit` | Written by *every* mutating path, not just one call site — this is a completion task on an already-correct design, not a new table (S1, S4). |
| **Job/Queue** (durable, claimable work) | `WorkItem`, `PostTurnOutbox`, `BrainBusEvent`, `DeviceCommand` | `availableAt` + `claimedAt`/`lockedAt` + `attempts` + `idempotencyKey`, and — this is the actionable gap — **one shared atomic-claim helper function** (the `updateMany`-with-stale-TTL-reclaim pattern proven correct in `guardian.ts` for `ApprovalRequest`, S4) instead of the current per-table reimplementations (`PostTurnOutbox` alone has two, S3-e). |

### CURRENT -> TARGET mapping (only rows with a recommended action; everything else in S1 is KEEP as-is)

| Current | Action | Why (citation) |
|---|---|---|
| `ArsenalLog` | **DELETE** | Self-documented dead: sole writer deleted, zero readers confirmed three ways, prod held 2 stale rows (`lib/services/ai-research.ts:12-18`, S1/S3-c9). |
| `CustomerRiskStatus`, `LtvBand`, `CustomerFollowUpStage`, `CustomerSegment`, `LeadSource`, `LeadStatus`, `ServiceCategory` (7 enums) | **DELETE** | Schema-orphaned, zero model field references, zero code references of any kind (S2). |
| `LeadType`, `LeadUrgency` (2 enums) | **DELETE from schema.prisma**; their value *shape* already lives independently as `leadTypeValues`/`leadUrgencyValues` in `lib/domain.ts:28-29` | Demo/scoring code imports the hand-duplicated array, not the Prisma enum (S2) — deleting the enum declarations is zero-impact. |
| `prisma/seeds/seed-foundation.ts` (`prisma.dailyScore.create(...)`) | **FIX or DELETE the seed file** | References a model removed from the Prisma client 2026-04-18 (schema:840-844); the file cannot run without erroring on that line (S1/S3-b, class A). |
| `MasteryDecision` | **MERGE INTO `DecisionReplay`** (one-time data migration, then drop) | `DecisionReplay.decisionId` is already documented as "link to MasteryDecision" (schema:2491); both are independently live today with no enforced single-writer path (S3-b). |
| `Task.loopKind = PROMISE` rows | **DERIVE AS VIEW off `Commitment`** — near-term, add a nullable `Task.commitmentId` FK as a non-destructive first step; longer-term, PROMISE-kind tasks are generated from accepted `Commitment` rows rather than modeled as a second primary source | Two independently-writable commitment concepts exist today with no relation between them (S3-a) — this is the single clearest actionable duplication in the schema. |
| `ExecutionInsight` | **DERIVE AS VIEW off `Reflection`** (new writes land in `Reflection`; keep `ExecutionInsight` read-only for history) | No differentiator found beyond vintage — both are free-form AI-derived insight rows with a score/confidence axis (S3-a). |
| `ReviewLog` | **DELETE** (after confirming zero prod reads since its own doc-claimed `GET /api/reviews` route) | `BriefingLog` appears to have superseded it; zero readers found in this corpus against a doc comment claiming a live reader route (S3-c8). |
| `Contact`, `Booking`, `Agreement`, `Product`, `Order` | **EXTRACT to their own small app/schema**, not "move to nickstire.org" literally — this is Nour's own coaching/consulting business data (`Contact.role` includes `coaching_client`/`sponsor`/`partner`), a *third* business context, not Nick's Tire's | The boundary doctrine's underlying principle (ordinary commerce/CRM ops don't belong in the personal-judgment OS) applies structurally regardless of *which* business — but the literal instruction "belongs in nickstire.org/admin" is about Nick's Tire specifically and doesn't fit this data (S3-h). `Booking`/`Agreement` are unwired scaffolding (S1) and could simply be dropped if the coaching-business surface is not being actively built. |
| `SocialPublishQueue` rows targeting `platforms` containing `"gbp"` | **MOVE the *execution* to nickstire** (GBP = Nick's Tire's Google Business Profile); the same table's use for Nour's own/coaching-brand social content stays in statenour | This is a live boundary crossing today, not a candidate (S1/S3-h) — statenour is currently the system of record for at least one Nick's Tire-facing publish action. |
| `PersonProfile` <-> `Contact` | **Non-destructive first step: add a nullable cross-link field** (e.g. `Contact.personProfileId`) rather than a full merge | No FK/shared key exists today; a person who is both a personal contact and a coaching client is two disconnected rows (S3-d). A full `Person` unification (scope-discriminated) is the longer-term target once/if the coaching-business surface is extracted per the row above. |
| `IntelligenceOutcome` <-> `CalibrationReviewItem` | **Not urgent — add a cross-reference FK, do not merge tables** | Both measure "did the machine's claim hold up" but on genuinely different axes (adoption vs. calibration accuracy, S3-c7); merging would lose that distinction. A shared `sourceId`/`outcomeId` link would let one report union them without collapsing the schema. |
| `PostTurnOutbox` claim logic (`lib/agent/follow-up.ts` + `lib/services/chat/post-turn-outbox.ts`) | **Consolidate into one shared claim function**, reused by `ApprovalRequest`'s already-correct pattern (`guardian.ts:78-91`) | Two independent atomic-claim implementations against the same table is a maintenance/race risk, not a schema problem (S3-e/S4). |
| `soft-delete.ts` `SOFT_DELETE_MODELS` | **Extend to cover `ChatConversation`, `Contradiction`, `JournalThread`, `PersonProfile`, `SocialPublishQueue`** (or explicitly document why each is intentionally excluded, the way the module already does for `chat_messages`/`audit_logs`/`memory_edges`) | These five models have a `deletedAt`/`archivedAt` field in the schema but are not in the shared helper set — the "always filter `deletedAt: null`" guarantee is not enforced for them today (S4, class A cross-reference). |

### Explicitly KEEP as-is (good separations, don't touch)

`WorkItem` (per the brief's own prior finding — infra queue, not a to-do, S3-a). `SemanticEdge` /
`ToolTelemetry` / `ToolVerbRatio` (documented, perf-motivated extractions out of `BrainMemory` — the
pattern to imitate, not flatten, S3-c1/e). `AgentTrace` vs `AiGeneration` (explicitly and correctly
documented split, S3-e). `VoiceLatencyEvent` vs `AgentTrace` (explicitly documented non-overlap,
S3-f). The journal + `JournalThread` polymorphic-membership design (explicit, reasoned rejection of
4 separate join tables as YAGNI — a positive example, S3-c4). The `RegisteredSource` ->
`SourceDocument` -> `IntelligenceClaim` -> `OpportunityLog` -> `Experiment` pipeline (clean,
unidirectional, each stage a different cardinality, S3-c6).

## NOT VERIFIED / explicit gaps in this pass

- **Row counts for every table are unknown.** The only production row-count figures in this report
  are the two class-D numbers quoted from code comments (`ArsenalLog`: "2 rows, newest 2026-04-10,"
  `CronJobLog`: "'partial' status, 2,535 rows as of 2026-08-22") — both are someone else's prior
  claim embedded in a comment, not a live query from this run. No database was queried (per the
  read-only mandate).
- **EntityAudit's true writer coverage is unconfirmed.** Its own doc comment claims "every meaningful
  mutation... writes one row here," but only one direct `.entityAudit.create(` call site was found.
  Most writes likely flow through a shared helper (candidates seen in imports: `lib/db/entity-audit.ts`
  exports `logUpdate`/`logSoftDelete`/`logRestore`, referenced from `soft-delete.ts` and
  `task-actions.ts`) whose *own* call sites were not independently re-grepped as `entityAudit`
  writers — the flat regex only credits direct `.entityAudit.<method>(` calls, and a wrapper function
  by a different name would not be attributed here even though it may write the table correctly.
  Treat the "thin writer surface" finding as "not confirmed complete," not "confirmed broken."
- **`TaskEvent`'s create path was not located** in `app/`, `lib/`, `components/`, `scripts/`,
  `tests/`, `__tests__/`, `cli/`, `hooks/`, `features/`, `types/`, `tools/`, `config/`, or
  `apps/worker/` — neither a direct `.taskEvent.create(` call nor a `events: { create:` nested-write
  site. This is reported as "no code writer found in this corpus," not "does not exist" — a helper
  under a name this regex didn't anticipate, or a call site in a directory outside this scan, remains
  possible.
- **Duplicate calendar-event ingestion:** no evidence found either way; most likely this app does not
  ingest external calendar events directly in the code paths this scan covered (S5).
- **`PostTurnOutbox`'s two independent claim implementations** were not tested against each other for
  a race condition — flagged as a risk to check, not a confirmed bug.
- **Whether the five soft-delete-field models missing from `SOFT_DELETE_MODELS`
  (`ChatConversation`, `Contradiction`, `JournalThread`, `PersonProfile`, `SocialPublishQueue`) are an
  oversight or an intentional, undocumented exclusion** was not resolved — the helper module documents
  three deliberate exclusions by name and reasoning; these five are simply absent from both lists.
- **Missing-index claims (S7) are schema-only inference** — no `EXPLAIN`, no `pg_stat_user_indexes`,
  no live query-plan evidence. Every "no gap found" or "possible gap" in S7 is bounded by what the
  schema's own `@@index` declarations show, not by measured query cost.
- **`worker` (apps/worker) confirmed to have zero direct Prisma calls**, consistent with its own
  AGENTS.md claim ("No DB client — every read/write goes over authenticated HTTP") — included in the
  scanned corpus per the brief's instruction, contributed zero writer/reader hits to any model.
