# Migration · REST → tRPC

**Started:** Phase J (2026-05-18 PM · commit a37a4442)
**Strategy:** Strangler fig · coexistence · gradual surface-by-surface
**Status:** 31 / 50+ surfaces · **~62% complete** · **8 domain routers** (nick · operator with 3 · system with 11 · chat with 10 · browser with 4 · task with 16 · journal with 2 · **brain with 3** · total **21 mutations**) · /goals (OO) · /tasks reads (PP) · /tasks mutations (RR + SS.1-SS.4) · /journal (TT) · **/brain/wisdom (UU · 8th domain router)**

### sql-pro findings (Phase RR follow-up)

- `lib/services/task-actions.checkTask` reality-gap writeback runs
  `findMany WHERE status='DONE' AND effort=X AND actualMinutes>0 AND updatedAt>=30d`
  on every ONCE/PROMISE completion. Current Task indexes are
  `(status)` + `(updatedAt)` separately · Postgres picks one and
  filters the rest in memory. At >5k DONE tasks this is the dominant
  cost of a completion. **Add composite `@@index([status, effort, updatedAt])`**
  as a Prisma migration when convenient · operator approves before
  applying. Documented inline in the service file. · invalidate-after-mutation pattern (T.4) · typed-output inference pattern (Y.2 uses `inferRouterOutputs`) · optimistic-cache-update pattern (Z.3 uses `utils.x.y.setData()`) · lazy-on-open pattern (EE/KK/LL use `enabled: open`) · read-shaped POST modeled as `.query()` (GG) · `.mutation()` pattern via `useMutation().mutateAsync()` (HH/II/JJ/KK/LL) · imperative-fetch-via-utils pattern (JJ + MM use `utils.x.y.fetch()` · MM combines with setTimeout delay for post-stream BrainMemory polling) · drift-detection-via-typed-output (KK caught 9-month-old field bug) · error-code-branching (LL uses `error.data.code === "PRECONDITION_FAILED"` to distinguish not-configured from real errors)

## Why

Pre-J the codebase had ~50 client components calling REST endpoints
via `useAuthedFetch<T>(url)`. Every response shape was manually
mirrored client-side · drift was easy. End-to-end type safety was
absent.

J introduced tRPC v11 + `@tanstack/react-query` v5 with:
- Server router (`lib/trpc/root.ts`)
- Client provider (`components/providers/trpc-provider.tsx`)
- App Router handler (`/api/trpc/[trpc]/route.ts`)
- Two domain routers (nick · operator)

End-to-end types flow from server → client · no manual mirrors.

## Migrated surfaces (16)

| Surface | From | To | Commit |
|---|---|---|---|
| `/reason/history` | `useAuthedFetch<HistoryShape>` | `trpc.nick.history.useQuery` | J (a37a4442) |
| `/reason/telemetry` | `useAuthedFetch<TelemetryShape>` | `trpc.nick.telemetry.useQuery` | J |
| OperatorPulse component | `useAuthedFetch<PulseShape>` | `trpc.operator.pulse.useQuery` | J |
| CompoundChain component | `useAuthedFetch<CompoundShape>` | `trpc.operator.compound.useQuery` | J |
| `/system/health` | `useAuthedFetch` → `/api/system/health-report?range=X` | `trpc.system.healthReport.useQuery({range})` | S.3 |
| `/system/cron-diagnostics` (read only) | `authedFetch` → `/api/system/cron-diagnostics` | `trpc.system.cronDiagnostics.useQuery()` | T.4 |
| `/system/lens-stats` | `authedFetch` → `/api/system/lens-stats?days=N` | `trpc.system.lensStats.useQuery({days})` | U.4 |
| `/system/ai-cost` | `authedFetch` → `/api/system/ai-cost` | `trpc.system.aiCost.useQuery()` | **Y.2** |
| `/system/ghost-nour` (candidates list) | `authedFetch` → `/api/system/ghost-nour?list=recent` | `trpc.system.ghostNourCandidates.useQuery()` | Y.4 |
| ChatHistorySearch (Cmd+F overlay) | `authedFetch` → `/api/chat/search?q=X&limit=25` (debounced × 2 sites) | `trpc.chat.search.useQuery({q, limit})` + `setData()` optimistic drop | Z.3 |
| MessageBranchSwitcher (alt 2 of 3 controls) | `authedFetch` → `/api/ai/chat/branches/[parentMessageId]` | `trpc.chat.branches.useQuery({parentMessageId})` | DD.3 |
| MessageInfoCard (brain context section, lazy-on-open) | `authedFetch` → `/api/brain/provenance/[messageId]` | `trpc.chat.messageProvenance.useQuery({messageId}, {enabled: open})` | EE.3 |
| LaneCorrectionChip (proactive blind-spot alert) | `authedFetch` POST → `/api/ai/chat/lane-check` | `trpc.chat.laneCheck.useQuery({userMessage, assistantMessage}, {enabled: tokensReady})` | GG.3 |
| EmailDraftCard (Send button · first true `.mutation()`) | `authedFetch` POST → `/api/email/send` | `trpc.chat.sendEmail.useMutation().mutateAsync(...)` | HH.3 |
| NickMessage image upscale (2x/4x hover button) | `authedFetch` POST → `/api/images/upscale` | `trpc.chat.upscaleImage.useMutation().mutateAsync(...)` | II.3 |
| NickMessage image vary ("vary" button · N variants) | `authedFetch` POST → `/api/images/variations` | `trpc.chat.varyImage.useMutation().mutateAsync(...)` | II.3 |
| MessageEditControls (edit + history drawer · 1 query + 1 mutation) | `authedFetch` PATCH/GET → `/api/ai/chat/edit/[id]` | `trpc.chat.editMessage.useMutation()` + `utils.chat.editHistory.fetch()` on click | JJ.3 |
| BuilderSandbox (chat slide-out · deploy panel · 1 query + 1 mutation) | `authedFetch` GET/POST → `/api/system/deploys` + `/api/system/deploys/rollback` | `trpc.system.deploys.useQuery({limit, enabled: open})` + `trpc.system.rollbackDeploy.useMutation()` | KK.3 |
| BrowserSandbox (chat slide-out · Browserbase live view · 1 query + 2 mutations) | `authedFetch` GET/POST/DELETE → `/api/browser/session` | `trpc.browser.sessions.useQuery({enabled: open})` + `createSession.useMutation()` + `closeSession.useMutation({id})` | LL.3 |
| ActionClaimWarning (chat chip · poka-yoke for fabricated tool calls) | `authedFetch` GET → `/api/ai/chat/claim-warnings?conversationId=X` (600ms delayed) | `utils.chat.claimWarnings.fetch()` in delayed setTimeout (imperative-fetch-via-utils · JJ pattern) | MM.3 |
| /system/cron-diagnostics runNow + enableCron (closes T.4 carve-out · 2 mutations) | `authedFetch` POST `/api/settings/crons/trigger` + PATCH `/api/settings/crons` | `trpc.system.runCron({jobName}).useMutation()` + `setCronEnabled({jobName, enabled}).useMutation()` · caught + fixed 9-month-old `{jobName}` vs `{path}` mismatch bug | NN.3 |
| /goals page (`<GoalsPage>`) snapshot composite (ladder · missions · axes · prune-count) | `useAuthedFetch<Snapshot>("/api/goals/snapshot")` | `trpc.operator.goalsSnapshot.useQuery({staleTime: 30s})` · 30s cache matches the route's prior Cache-Control | OO.3 |
| /tasks page · 4 reads (tasks · missions · goals · actions-brain) | `authedFetch` × 4 inside `load()` Promise.all | `utils.task.list({goalId, missionId}).fetch()` + `utils.task.missions.fetch()` + `utils.task.goals.fetch()` + `utils.task.actionsBrain.fetch()` · imperative inside existing scheduling discipline · 6th domain router added (`task`) | PP.3 |
| TaskEvent read surface (`events`, `eventsByKind`, `emitEvent`) | `authedFetch` POST `/api/tasks/[id]/event` (write-only) | `trpc.task.events({taskId})` + `eventsByKind({kind, sinceDays})` + `emitEvent({taskId, kind, payload})` · brain pattern-detection now has typed read surface · client-emit allowlist preserved verbatim | QQ.3 |
| /tasks 4 task-write mutations (check · start · breakPromise · delete) | `authedFetch` POST × 4 · per-mutation `r.ok` / `r.json()` dances | `trpc.task.{check,start,breakPromise,delete}.useMutation().mutateAsync(...)` · all 4 delegate to new `lib/services/task-actions.ts` (extracted from 350-LOC check route + 70-LOC start + 95-LOC break-promise) · TRPCError translation for NOT_FOUND + BAD_REQUEST (wrong loop kind) | RR.3 |
| /tasks 2 create mutations (createTask · createMission · 3 call sites for createTask: quick-add · adoptAi · goal-pace-chip) | `authedFetch` POST × 4 sites via the `lib/services/client/tasks.createTask` helper · raw `Response` returns + `r.ok` checks | `trpc.task.{create,createMission}.useMutation().mutateAsync(...)` · `createTaskFromAPI` service in task-actions.ts encapsulates inbox-default + service + Telegram-notify so REST + tRPC don't drift · the legacy `client/tasks` helper stays mounted for the other 3 pages that consume it (project-detail · plan-spawn · etc) | SS.1.3 |
| /tasks AI roiScore grading (fire-and-forget after quick-add) | `authedFetch` POST `/api/tasks/[id]/score` | `trpc.task.score.useMutation()` · `scoreTaskWithAI` service in task-actions.ts wraps `createStructuredAiResponse` · idempotency guard (`roiScore != 50` unless force) preserved · `AiUnavailableError` returns structured `{ok: false, error: "ai_unavailable"}` shape | **SS.2.3** |
| /tasks AI task generation (3-5 daily suggestions · `genAi()` button) | `authedFetch` POST `/api/ai/tasks` · HTTP status sniffing (429/502/503) for structured-error UX | `trpc.task.aiGenerate.useMutation()` · `lib/services/ai-tasks.generateAiTasks` returns a discriminated union (`ok` / `providers_failed` / `parse_failed`) · client branches on `result.kind` instead of HTTP statuses · rate-limit check stays on REST path (request-scoped) | SS.3.3 |
| /tasks bulk backfill (once-per-session auto-spawn from project plans) | `authedFetch` POST `/api/projects/backfill-tasks` · Envelope/unwrap dance for totalTasksSpawned | `trpc.task.backfill.useMutation()` · `lib/services/backfill-tasks.backfillProjectTasks` extracted (260 LOC service from inline route body) · staleness gates preserved (90d plan age · all-goals-stale) · idempotent via planData.steps[].taskId flag | SS.4.3 |
| **/tasks page is now 100% on tRPC** · authedFetch import removed (load() keeps scheduling discipline · fetch sites flow through trpc utils/mutations) | — | — | post-SS.4 |
| /journal page 2 reads (unified feed + metacognition card) | `authedFetch` GET × 2 inside `load()` + mount-effect | `utils.journal.feed.fetch({source, type, limit, days})` + `utils.journal.metacognition.fetch()` · 7th domain router added (`journal`) · `lib/services/journal-feed.ts` extracted (220 LOC service merging 4 thought-capture tables) | TT.3 |
| /brain/wisdom page 3 sites (feed read · saveEdit PATCH · curation action POST) | `authedFetch` × 3 (GET feed · PATCH content/confidence · POST deprecate) | `trpc.brain.wisdom.useQuery` (via `utils.brain.wisdom.fetch`) + `updateWisdom.useMutation()` + `actOnWisdom.useMutation({id, action})` · 8th domain router added (`brain`) · `lib/services/brain-wisdom.ts` extracted (180 LOC service + 3 custom error classes) | **UU.3** |

## Architectural notes

- **S.2** added the third domain router (`system`) · sets the
  precedent for future `/system/*` migrations. The shared
  `lib/services/system-health.ts` service is called by BOTH the
  legacy REST handler and the tRPC procedure · drift is structurally
  impossible.
- React Query inherits the per-input refetch and 2-min `refetchInterval`
  the previous `setInterval`-driven page had · less code, fewer bugs.
- **T.4** introduced the **invalidate-after-mutation** pattern · the
  cron-diagnostics page reads via tRPC but its `runNow` and `enableCron`
  mutations stay on REST (coexistence). After each mutation the page
  calls `utils.system.cronDiagnostics.invalidate()` which triggers
  React Query to refetch · same UX as the previous `await load()` path
  with less plumbing. Sets the template for partial migrations where
  mutations come later.
- **Z.3** introduced the **optimistic-cache-update** pattern · the
  ChatHistorySearch `deleteConvo` mutation drops the deleted row from
  React Query's cache immediately via `utils.chat.search.setData()`,
  then invalidates to reconcile with the server. Removes the prior
  fetch-race window where the operator saw the deleted row reappear
  briefly. Same shape as TanStack Query's standard optimistic-update
  recipe · sets the template for future delete/archive mutations.
- **Z.2** added the **4th domain router** (`chat`) for chat-domain
  procedures. Streaming endpoints (POST /api/ai/chat) stay excluded
  from tRPC migration · subscription support needs WebSocket infra.
- **JJ.2** introduced the **imperative-fetch-via-utils** pattern · the
  MessageEditControls history drawer fires on a button click (not on
  mount or on a known boolean), so `useQuery({enabled: open})` doesn't
  fit. The component calls `utils.chat.editHistory.fetch({messageId})`
  imperatively inside the click handler, then sets the result to local
  state. After a Save mutation succeeds, the cached query is invalidated
  via `utils.chat.editHistory.invalidate({messageId})` AND local cache
  is dropped via `setHistory(null)` so the next drawer open re-fetches
  fresh. Three transports for the same query: useQuery (auto-refetch),
  useQuery+enabled (deferred), `utils.fetch()` (imperative). JJ picks
  the right one per call shape.

## Pending surfaces (~46)

Categorized by domain · prioritized by churn frequency. Migrating
HIGH-churn first reduces type-drift risk on the surfaces we touch most.

### HIGH churn (migrate next)
- `/chat` page · multiple `useAuthedFetch` calls · core operator surface
- `/system/*` pages · health · errors · crons · logs (multiple)
- `/tasks` page + sub-panels (~10 useAuthedFetch sites)

### MEDIUM churn
- `/goals` · `/scoreboard` · `/journal` (3-5 sites each)
- `/brain` + brain subsurfaces (~8 sites)
- `/voice` · `/learn` · `/mastery` (2-3 sites each)

### LOW churn
- Legacy admin surfaces (rare changes · low value to migrate)
- One-off audit dashboards
- /api/cron/* endpoints (server-only · no client component)

## Excluded from migration

| Surface | Reason |
|---|---|
| `POST /api/nick/reason/stream` | SSE endpoint · tRPC subscriptions need WebSocket infra · scoped to H+ wave |
| Cross-system nickstire bridge (`callNickstire`) | Different repo's tRPC server · already uses tRPC proxy client pattern |
| Cron endpoints (`/api/cron/*`) | Server-to-server only · no client benefit |
| Public webhooks | Stable contracts · no client component |

## Coexistence pattern

All legacy REST endpoints stay mounted · operators on un-migrated
client paths continue to work. Migration is purely additive · zero
breakage.

## Rollback

Per-surface: revert the component change to use `useAuthedFetch`
against the still-mounted REST endpoint. No tRPC router edits needed.
Single-file revert.

Global: remove `<TRPCProvider>` from `app/(mastery)/layout.tsx`. The
tRPC handler stays mounted but no client consumes it. Useful if
React Query introduces a regression.

## Next milestone

Pick 1 HIGH-churn surface per wave (target: 1 surface per H+ wave when
the operator's making changes there anyway · piggyback on existing
work to minimize touch cost).

**Recommended next:** `/system/health` · low-risk · 1-2 fetches · sets
up tRPC for the rest of `/system/*`.
