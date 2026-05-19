# Migration · REST → tRPC

**Started:** Phase J (2026-05-18 PM · commit a37a4442)
**Strategy:** Strangler fig · coexistence · gradual surface-by-surface
**Status:** 17 / 50+ surfaces · ~34% complete · 4 domain routers (nick · operator · system · chat with 9 procedures · 4 mutations) · invalidate-after-mutation pattern adopted (T.4) · typed-output inference pattern (Y.2 uses `inferRouterOutputs`) · optimistic-cache-update pattern (Z.3 uses `utils.x.y.setData()`) · lazy-on-open pattern (EE uses `enabled: open`) · read-shaped POST modeled as `.query()` (GG) · `.mutation()` pattern via `useMutation().mutateAsync()` (HH/II/JJ) · imperative-fetch-via-utils pattern (JJ uses `utils.x.y.fetch()` for on-click lazy fetch)

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
| MessageEditControls (edit + history drawer · 1 query + 1 mutation) | `authedFetch` PATCH/GET → `/api/ai/chat/edit/[id]` | `trpc.chat.editMessage.useMutation()` + `utils.chat.editHistory.fetch()` on click | **JJ.3** |

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
