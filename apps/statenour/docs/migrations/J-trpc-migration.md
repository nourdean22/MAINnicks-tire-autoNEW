# Migration · REST → tRPC

**Started:** Phase J (2026-05-18 PM · commit a37a4442)
**Strategy:** Strangler fig · coexistence · gradual surface-by-surface
**Status:** 5 / 50+ surfaces · ~10% complete · 3 domain routers (nick · operator · **system** ← added in S.2)

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

## Migrated surfaces (5)

| Surface | From | To | Commit |
|---|---|---|---|
| `/reason/history` | `useAuthedFetch<HistoryShape>` | `trpc.nick.history.useQuery` | J (a37a4442) |
| `/reason/telemetry` | `useAuthedFetch<TelemetryShape>` | `trpc.nick.telemetry.useQuery` | J |
| OperatorPulse component | `useAuthedFetch<PulseShape>` | `trpc.operator.pulse.useQuery` | J |
| CompoundChain component | `useAuthedFetch<CompoundShape>` | `trpc.operator.compound.useQuery` | J |
| `/system/health` | `useAuthedFetch` → `/api/system/health-report?range=X` | `trpc.system.healthReport.useQuery({range})` | **S.3** |

## Architectural notes

- **S.2** added the third domain router (`system`) · sets the
  precedent for future `/system/*` migrations. The shared
  `lib/services/system-health.ts` service is called by BOTH the
  legacy REST handler and the tRPC procedure · drift is structurally
  impossible.
- React Query inherits the per-input refetch and 2-min `refetchInterval`
  the previous `setInterval`-driven page had · less code, fewer bugs.

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
