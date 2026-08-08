# Architecture · statenour

Last verified 2026-05-21. Source of truth for subsystem boundaries.

> **Verified counts live in [`docs/RECONCILIATION.md`](RECONCILIATION.md).**
> If a number here disagrees with that file, RECONCILIATION wins.
>
> **v10 layered additions** (this section is appended; older diagrams
> below are still accurate):
>
> - `BrainBusEvent` table + `lib/db/brain-bus-durable.ts` — durable
>   replay layer underneath the v8.5 LISTEN/NOTIFY brain-bus. Events
>   persist with status/availableAt/attempts so a missed NOTIFY is
>   recovered by the every-2-min `brain-bus-backfill` cron.
> - `SchemaChangeLedger` table + `lib/db/schema-ledger.ts` — every
>   `prisma db push` records reason + destructive flag + rollback plan
>   + approver. `/system/schema-history` renders the audit trail.
> - `AgentTrace` table + `lib/ai/agent-trace.ts` — standard trace
>   contract for every AI call. `traceId` (root) + `parentId` (chain)
>   + provider + model + duration + cost + error class. Operator
>   dashboards group by traceId so one chat turn = one collapsed row
>   with child tool calls visible. **v528** adds the per-trace
>   waterfall timeline at `GET /api/system/agent-traces/[traceId]/timeline`
>   plus `components/chat/reasoning-trace-{drawer,timeline}.tsx`.
> - `streamWithFallback` (`lib/ai/stream-with-fallback.ts`) — wraps
>   chat-route streamText so a provider failure pre-first-token rotates
>   to ollama → openai → anthropic in the SAME turn. Composes with
>   v9.1.27 `markProviderFailed` 60s sticky window.
> - **Operator surfaces:** `/system/repos` · `/system/schema-history`
>   · `/system/deployment-truth` (v10 E.1/E.2/E.4) plus `/system/command-
>   center` (v9.0+) form the new control layer above the v8.x
>   observability deck.
>
> **v529 defense-in-depth layer** (Prompt-Injection / Leak / Quota /
> Replay · ADRs 0012-0015 · 2026-05-12):
>
> - `lib/utils/sanitize-error.ts` (ADR-0012 · v529.4) — scrubs
>   postgres URLs, Bearer tokens, `sk-*` keys, absolute fs paths
>   (14-prefix root set), IPv4 before any JSON 500 leaves a route.
>   Swept across 26 high-traffic AI routes via `replace_all` plus a
>   parallel agent pass. DST-correct `nextMidnightEtIso()` companion.
> - `lib/ai/tool-quota.ts` (ADR-0013 · v529.4) — per-tool daily quota
>   gate backed by `BrainMemory(category="tool_quota_daily")`. No new
>   tables. Atomic `INSERT … ON CONFLICT DO UPDATE SET metadata =
>   jsonb_set(…)` raw SQL fixes the v529.8 race condition. Wired into
>   `runPython` (100/day) and `ingestDocumentFromUrl` (50/day).
> - `lib/ai/tool-result-fencing.ts` (ADR-0014 · v529.5) — wraps
>   `searchDocuments` / `searchWebVerified` / `findRelatedConversations`
>   outputs in `<tool_data tool="..." source="external_web|external_doc
>   |cross_session">` fences. System prompt gains `TOOL_DATA_FENCING_RULE`
>   (~170 tokens). Phase 2 classifier deferred (see cohort summary).
> - `lib/services/decision-replay-coach.ts` (ADR-0015 · v528) — daily
>   replay queue builder. `app/api/cron/decision-replay/route.ts`
>   enqueues into `BrainMemory(category="decision_replay_due")`. Read
>   path: `GET /api/system/decision-replays` · ack path: `POST
>   /api/system/decision-replays/[id]/mark` (v529.7 · owner-gated).
>   Surface: `components/ultron/decision-replay-card.tsx` → click
>   navigates to `/chat?seed=` (composer pre-hydration · 2000-char cap).
> - `scripts/apply-pending-migration.ts` (v529.1) — autocommit pg
>   driver runner that bypasses Prisma's implicit transaction wrap.
>   Used to apply v526 index migration (8 `CREATE INDEX CONCURRENTLY`
>   + 14 `DROP INDEX CONCURRENTLY`) to prod Neon.
>
> **Known debt (Round 1 + Round 2 audits, v9.1.13-v9.1.27):**
>
> - 65+ real bugs fixed across two parallel deep-audit waves. Findings
>   that became principles, not just patches: prompt injection
>   sanitizer (v9.1.13), sensitive-GET auth gate ratcheted to HARD
>   (v9.1.17), `Cascade → Restrict` on Mission/LifeGoal/Task delete
>   chains (v9.1.15), AI rate limits 10/min/IP (v9.1.19), provider
>   auto-rotation on stream-error 60s sticky (v9.1.27).
> - `BrainMemory.category` sprawl is acknowledged debt — see
>   [`docs/DATA-MODEL.md`](DATA-MODEL.md).
> - Mid-stream provider fallback (post-first-token) deferred to a
>   later wave; v10 only handles pre-first-token rotation.
> - **All CVEs closed v529.10** (43 → 0) via Next 16.2.3 → 16.2.6
>   bump plus 8 pnpm.overrides (axios · fast-uri · hono ·
>   @hono/node-server · mermaid · postcss · uuid · ip-address) and
>   `xlsx@0.18.5 → exceljs@4.4.0`.

---

## The two-ring model

Nour runs two parallel systems. Everything in this repo belongs to the
personal ring. Business ops live in the other repo.

```
┌───────────────────────────── PERSONAL RING ─────────────────────────────┐
│                                                                         │
│   statenour  (bdnick.info)                                              │
│   Next.js 16 · Prisma 6 · Neon Postgres · Railway                       │
│                                                                         │
│   Surfaces:  Ultron · Nick · Brain · Tasks · Journal · Knowledge        │
│              Devices · Body · Financial · System · Settings             │
│                                                                         │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │  Apr 20 — cross-ring device RPC bridge
                               │    POST /api/devices/command  → enqueue
                               │    GET  /api/devices/queue    ← agent poll
                               ▼
                     ┌────────────────────────────┐
                     │ nour-os-unified (local)    │   Python agent
                     │ Windows service            │   (Ring · Eufy · Tuya
                     │ C:\NOUR_OS                 │    · Google Home)
                     └────────────────────────────┘

┌────────────────────────────── BUSINESS RING ────────────────────────────┐
│                                                                         │
│   nickstire.org  (MAINnicks-tire-autoNEW)                               │
│   Express 4 · tRPC 11 · React 19 · Drizzle · TiDB · Railway             │
│                                                                         │
│   statenour bridge:                                                     │
│     every 4h → POST <statenour Railway URL>/api/sync/...                 │
│     authenticates via STATENOUR_SYNC_KEY                                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Strictly separated.** Nour's personal OS never holds business ops
state; the business admin never holds Nour's private brain. The
bridge is a thin sync + oversight channel.

---

## statenour — internal layers

```
                            ┌─────────────────────────┐
                            │   Next.js middleware    │
                            │ (middleware.ts auth)    │
                            └───────────┬─────────────┘
                                        │
                ┌───────────────────────┼───────────────────────┐
                │                       │                       │
   ┌────────────▼─────────────┐ ┌───────▼─────────┐   ┌─────────▼──────────┐
   │   (mastery) route group  │ │    /api/*        │   │    /api/cron/*     │
   │   59 pages · auth-gated  │ │    325 handlers  │   │    36 active       │
   │   wrapped in             │ │    auth: session │   │    + 24 folded     │
   │   NourStateProvider +    │ │    (apiHandler)  │   │    + 8 retired     │
   │   AmbientAura            │ │                  │   │    auth: CRON_SECRET│
   │                          │ │                  │   │    cronHandler()   │
   └────────────┬─────────────┘ └───────┬─────────┘   └─────────┬──────────┘
                │                       │                       │
                └───────────────────────┼───────────────────────┘
                                        │
                              ┌─────────▼──────────┐
                              │      lib/          │
                              │                    │
                              │  ai/      · 35 f   │ Nick: provider/prompt/tools/chat
                              │  brain/   · 58 f   │ Memory + learning + identity
                              │  ultron/  · 10 f   │ Situation synth + narrator
                              │  services/· 29 f   │ Personal + platform + business bridge
                              │  state/            │ NourState (client context)
                              │  hooks/            │ useSystemPulse, useNourState, etc.
                              │  utils/            │ http, cn, datetime, cache
                              │  db/      · query-helpers
                              │  env.ts            │ boot-time spec + health
                              └─────────┬──────────┘
                                        │
                              ┌─────────▼──────────┐
                              │   Prisma 6         │
                              │   80 models        │
                              └─────────┬──────────┘
                                        │
                              ┌─────────▼──────────┐
                              │   Neon Postgres    │
                              │   pooled + direct  │
                              └────────────────────┘
```

---

## Request lifecycle — a Nick chat turn

Because `/api/ai/chat` is the hottest path in the app (~80% of Nick
cost), here's the full lifecycle:

```
User types in /chat page
        │
        ▼  POST /api/ai/chat { messages, conversationId }
 middleware.ts  ← session check (email in AUTH_ALLOWED_EMAIL)
        │
        ▼
 apiHandler wrapper — rate limit + request log
        │
        ▼
 chat/route.ts (1729 lines · W6 split target)
        │
        ├── classifyTurn()              — intent + complexity + shape
        ├── detectChatMode()            — BATTLE/SURGICAL/RECOVERY/etc
        ├── pruneTools(mode)            — narrow catalog from ~150 → ~20
        ├── embedUserMessage()          — query vector for memory
        ├── buildSystemPrompt()         — identity + Nour voice +
        │                                 subsystems (8 pieces) + tier
        ├── rerankContextBlocks()       — push most-relevant brain
        │                                 memories into window
        ├── prefetchIntents()           — speculative tool-call primer
        │
        ├── streamText({ model, tools, messages, system })
        │       │
        │       ├── each tool call:
        │       │    ├── parseActions() / executeActions()
        │       │    ├── recordToolInvocation() → SystemMetric
        │       │    └── tool handler from lib/ai/tools.ts
        │       │
        │       └── sanitizeResponse() / critiqueOutput() / factCheck()
        │
        ├── runReplyGate()              — gate content before emit
        ├── recordInteraction()         — BrainMemory write
        └── trackGeneration()           — AiGeneration row (cost/tokens)

Response streams back via SSE; UI renders tool cards + citations.
```

Each step has dedicated telemetry written to SystemMetric so the
`/system/ai-cost` burn-rate panel is live.

---

## State model — NourState

The client-side ambient state that every page can read. Updates
trigger MODE classifier → ambient aura tint.

```
NourState (client context, lib/state/nour-state.tsx)
  · currentState : "focused" | "drift" | "on_fire" | "recovering" | "shutdown"
  · timeOfDay    : "morning" | "midday" | "afternoon" | "evening" | "late"
  · todayScore   : number | null
  · habitsDone   : number
  · habitsTotal  : number
  · overdueCommitments : number
  · staleLeads   : number
  · agingCritical : number

  Derived:
    MODE = classifyMode(state) ∈ BATTLE · SURGICAL · RECOVERY · SHUTDOWN · NORMAL
    Ambient aura color + Nick persona shift in response to MODE.
```

---

## Cron orchestration

Every scheduled job is declared in `config/crons.ts` — the single
source of truth. Scheduled jobs run through the mega fan-out + the
Inngest evening job list, not a `vercel.json` crons block (statenour
left Vercel for Railway). CI guards manifest-vs-filesystem drift.

```
config/crons.ts  (single source of truth)
  ├── CRONS: CronDef[]           — every cron, with mode active/folded/retired
  └── expectedCronRouteNames()   — used by the verifier

scripts/verify-crons.ts  (CI + local check)
  1. manifest → fs : every CRONS[] has a route.ts
  2. fs → manifest : every /api/cron/*/route.ts is in CRONS[] (no dark)
  3. retirement window : warns when a retired cron is past deletion date

lib/utils/http.ts → cronHandler(handler)
  Wraps every cron route with:
    · CRON_SECRET auth check
    · isCronEnabled(jobName) kill-switch (BrainMemory cron_control)
    · logCronRun() → CronJobLog row with duration + status + error
    · Error re-throw so apiHandler can surface HTTP failure

/system/crons       → live deck w/ kill-switch + run-now + sparkline
/system/cron-runs   → all-jobs index sortable + failures-first
/system/cron-runs/[jobName] → per-job drill-down (duration trend
                              + expandable error preview + run-now button)
/api/system/crons/toggle → flip kill switch (writes BrainMemory).
/api/system/crons/run    → fire a cron on demand (validates against manifest).
```

Each cron is `active` (own schedule), `folded` (runs inside a parent
cron, mostly mega-evening), or `retired`. The device crons
(`device-command-reap`, `device-sync`, `device-health`, `status`)
and `notification-sender` were deleted with their route files.

---

## Observability stack

Data flows into these models automatically; `/system/*` surfaces read
them live.

| Model | Writer | Consumer |
|---|---|---|
| `CronJobLog` | every `cronHandler()` invocation | `/system/crons` + `/api/system/pulse` |
| `ErrorLog` | `lib/errors/*` boundaries | `/system/errors` + `/api/system/pulse` |
| `AiGeneration` | `lib/ai/track.ts` per LLM call | `/system/ai-cost` + `/api/system/pulse` |
| `SystemMetric` | `recordToolInvocation`, lane-check, suggestions | `/system/ai-cost` tool view, dashboards |
| `AutonomousAction` | `executeActions()` in nick-agent | `/system/actions` + `/api/system/pulse` |
| `ApiRequestLog` | `apiHandler()` default | `/system/requests` (W2.6) |
| `DeviceEvent` · `DeviceCommand` | device bridge | `/devices`, `/system/devices` |
| `BrainMemory` | chat + cron ingestion | `/brain`, memory citations |
| `SituationLog` | ultron situation synthesizer | Ultron home page |
| `StateLog` | NourState transitions | Mode classifier + `/brain` timeline |

**Retention policy** lives in `config/retention.ts` and is enforced
by the `data-cleanup` cron (Sunday 3am UTC). Log-shape models roll
off by TTL; brain + audit + decision data is `forever`.

---

## AI provider chain

**Declared in `lib/ai/provider.ts` — that file is the source of truth. Set `AI_PROVIDER` env to pin one.** The chain *shape* below is illustrative; exact model ids are env-driven and drift, so verify in code rather than citing a model from this diagram.

```
Ollama Cloud   (primary · large-context)
   │   if down:
   ▼
OpenAI          (fallback)
   │
   ▼
Anthropic       (fallback)
   │
   ▼
Gemini          (xAI Grok also installed but unused)
```

`preferLargeContext` routing promotes Ollama for content/deep modes.
Domain matrix (code/vision/strategy/marketing/creative) lives in
`memory/ai_policy.md`. Each call writes `AiGeneration` with model,
tokens, cost, duration, status. Circuit breaker lives in the provider
module.

---

## Module boundaries

Strict-ish. If a cycle appears, move shared utilities down.

```
       ui (pages + components)
            │ reads
            ▼
       lib/services  (one level up from DB)
            │
   ┌────────┼───────────┐
   │        │           │
   lib/ai   lib/brain   lib/ultron      ← feature modules
   │        │           │
   └────────┼───────────┘
            ▼
       lib/utils + lib/db + lib/errors + lib/state  ← primitives
            │
            ▼
       prisma/schema + Neon Postgres
```

Rules:
- `lib/services/*` never imports `app/*`.
- `lib/brain/*` never imports `lib/ai/*` directly — both are consumers of each other through events.
- `lib/ai/*` imports `lib/brain/memory-manager` for read-only memory access.
- `app/api/*` is a thin handler layer; business logic lives in `lib/services` or `lib/{feature}`.

---

## Where things live · quick reference

| I want to … | Go to … |
|---|---|
| Add a new Nick tool | `lib/ai/tools.ts` (W6 split incoming) + `lib/ai/tool-embeddings.ts` |
| Add a new cron | `config/crons.ts` + `app/api/cron/<name>/route.ts` · run `pnpm check:crons -- --fix` |
| Add a new scheduled surface | add entry to `NAV_ITEMS` in `components/layout/nav-items.ts` · optionally `systemTab: true` for the ops deck |
| Add a new integration | `lib/integrations/<name>.ts` + add env vars to `lib/env.ts` + `.env.example` |
| Change the system prompt | `lib/ai/system-prompt.ts` (W6.3 split incoming) |
| Add brain memory category | `lib/brain/memory-manager.ts` write path · consider adding retention entry |
| Expose a new observability surface | `app/(mastery)/system/<name>/page.tsx` + `app/api/system/<name>/route.ts` · add to `/system` nav chips |

---

## Two hard limits that shape the design

1. **Single operator.** The whole app assumes one Nour. Auth is a
   single allowlist email. No multi-tenant anywhere. Simplifies
   everything — we never paginate by user, we never cache per-user.
   (v8.5 added a `lib/db/tenant.ts` skeleton with `withTenant` async
   ctx; no propagation yet.)
2. **Stateless request model.** Background work goes through crons,
   not long-lived `setInterval` loops. State lives in Postgres +
   Redis (L2) + module-level caches (L1). The brain-bus `subscribe()`
   helper addresses the LISTEN/NOTIFY pattern via the
   `brain-bus-consume` folded cron, which runs the subscriber for
   ~50s per invocation.

---

## v8.x infrastructure highlights (Apr 29 mega-overhaul)

The Apr 28-29 wave landed a coordinated set of cross-cutting
primitives. Listed here so future work knows what's already there:

- **Universal idempotency keys** (v7.7) — `lib/db/idempotency.ts`,
  race-safe createOrFind via partial unique index on 6 tables.
- **AsyncLocalStorage actor** (v7.8) — `lib/db/actor.ts`, `createdBy`
  / `updatedBy` propagation universal.
- **Universal soft-delete** (v7.9) — `deletedAt: DateTime?` on 9 tables;
  `lib/db/soft-delete.ts` helpers.
- **Entity-audit log** (v8.0 Phase 2A) — `entity_audits` table +
  `lib/db/entity-audit.ts` field-level diff log; published on the
  brain-bus channel `entity_audit`.
- **Brain-bus** (v8.4 Phase 2B) — Postgres LISTEN/NOTIFY publish/subscribe
  in `lib/db/brain-bus.ts`. Health-probe round-trips a synthetic envelope
  daily; consumer subscribes for 50s daily and accumulates derived counters.
- **Schema-drift sentinel** (v8.1 Phase 2C) — `lib/db/schema-sentinel.ts`,
  fires `schema_drift_alert` on mismatch.
- **pgvector + dual-read** (v8.4/v8.5/v8.12) — `lib/db/pgvector.ts`
  KNN search + `lib/brain/semantic-dedup.ts` self-join with `<=>`
  cosine operator + JS-cosine fallback for un-vectorized rows.
- **5-category Telegram alert pipeline** (v8.5) — cron writes
  `BrainMemory category=*_alert` → `alert-telegram-push` (every 15m)
  → Telegram with emoji prefix. 7 categories now: correlation,
  decision-quality drift, schema drift, storage quota, creation/update
  spike, brain-bus probe.
- **Cron budget gate** (v8.7.1/v8.8) — pre-push hardfails when active
  count > 38 (40-cap with 2-slot safety).
- **8-gate pre-push** (v8.21) — typecheck + lint + tests + raw-sql +
  cron-budget + AI-catalog + env-secret bypass + auth-coverage.
- **Operator surfaces** (v8.11.2/v8.13/v8.14/v8.18) — `/system/alerts`,
  `/system/embedding-coverage`, `/system/cron-runs[/jobName]`.

---

## See also

- `docs/cohort-2026-05-12-eod-summary.md` — v529.11 sprint (defense-in-depth · CVE cleanup · decision-replay end-to-end)
- `docs/cohort-2026-05-08-eod-summary.md` — v484 sprint (prompt-builder split · 10 ADRs backfilled · editorial a11y)
- `docs/adr/0012-error-message-sanitization.md`
- `docs/adr/0013-per-tool-daily-quota.md`
- `docs/adr/0014-tool-result-data-fencing.md`
- `docs/adr/0015-decision-replay-coach.md`

---

**Reconciled 2026-05-21** · infra sweep — deploy/cron sections
rewritten for the Railway monorepo reality (was Vercel / a
`vercel.json` cron pipeline, all retired); Prisma model count
corrected to 80. If a claim in this doc contradicts code reality, the
code wins · open an issue.
