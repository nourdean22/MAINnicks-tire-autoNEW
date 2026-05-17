# Nour monorepo

Single repo · three Railway services · one bill.

## Apps

| Path | What | Deploys to |
|---|---|---|
| `apps/nickstire/` | Vite 7 + React 19 SPA · Express 4 + tRPC 11 server · Drizzle ORM · TiDB Cloud (MySQL) · the public tire shop site | Railway service `nickstire-web` → `nickstire.org` |
| `apps/statenour/` | Next.js 16 App Router · Prisma ORM · Neon (Postgres) · NextAuth · the operator admin / Jarvis surface | Railway service `statenour-web` → `statenour-admin.up.railway.app` |
| `apps/worker/` | Express + node-cron · imports `apps/statenour/lib/*` as workspace dep · runs all `/api/cron/*` + LLM orchestration + brain pipeline + SSE | Railway service `statenour-worker` (internal only) |

## Packages

| Path | What |
|---|---|
| `packages/shared/` | Cross-app TypeScript types only · bridge contract types · zero runtime code |

## Tooling

- **Node:** `>=20.0.0`
- **Package manager:** `pnpm@10.4.1` (pinned via `package.json` + Corepack)
- **Workspace:** `pnpm-workspace.yaml` covers `apps/*` + `packages/*`
- **Single root lockfile:** `pnpm-lock.yaml`

## Quick commands

```bash
# install once at the root
pnpm install

# work on a single app
pnpm --filter nickstire dev
pnpm --filter @statenour/web dev
pnpm --filter @statenour/worker dev

# shortcuts
pnpm nick dev          # = pnpm --filter nickstire dev
pnpm stn dev           # = pnpm --filter @statenour/web dev
pnpm worker dev        # = pnpm --filter @statenour/worker dev

# build everything in parallel
pnpm build:all

# nickstire's master gate (env + check + lint + tests + build)
pnpm verify:nick
```

## How the apps talk to each other

- `apps/nickstire/` exposes `/api/bridge/*` endpoints (auth via `STATENOUR_SYNC_KEY` header)
- `apps/statenour/` consumes them via `lib/nickstire/query.ts`
- `apps/worker/` reads from the same Neon DB as `apps/statenour/` · no direct HTTP between the two

## Migration history

This repo started as `nickstire`. The statenour-os codebase was merged in on 2026-05-17 as part of a Vercel → Railway migration. See:

- `docs/MIGRATION_AUDIT.md` (Phase 1)
- `docs/MIGRATION_PLAN.md` (Phase 2)

## Rules of the road

- **Both apps stay independently testable.** Don't add a hard dep from one to the other beyond the bridge contract and the `packages/shared/` types.
- **Don't share `lib/`.** Each app has its own `lib/`. No cross-app imports of internal modules.
- **Both apps' tests must keep passing on every PR.** CI runs `pnpm -r --parallel test`.
- **PROTECTED-CORE.md inside apps/nickstire/ still applies.** Read it before touching nickstire infra.
- **Statenour's `CLAUDE.md` agent rules live at `apps/nickstire/CLAUDE.md`** for the agent's nickstire context. Statenour's own agent context (the global personal-OS one) lives in `apps/statenour/` and the user's global `~/.claude/CLAUDE.md`.
