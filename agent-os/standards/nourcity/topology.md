# NOURCITY Topology

One pnpm + Turborepo workspace · three Railway services · one deploy branch (`main`).

| Path | Package | Stack | Deploys to |
|---|---|---|---|
| `apps/nickstire/` | `nicks-tire-auto` | Vite 7 + React 19 PWA client · Express 4 + tRPC 11 server · Drizzle 0.45 → TiDB Cloud (MySQL) | nickstire.org |
| `apps/statenour/` | `@statenour/web` | Next.js 16 App Router · Prisma 6.19 → Neon Postgres (pgvector via raw SQL) · AI SDK v6 · Tailwind 4 | bdnick.info |
| `apps/worker/` | `@statenour/worker` | Express 4 + node-cron. **No DB client** — every read/write over authenticated HTTP | Railway internal |

The two web products are **independent** (different frameworks, databases,
domains). They share only this repo, the tooling, `main`, a small bridge
contract, and the workspace packages.

## Workspace packages (`workspace:*`)

`@nour/utils` · `@nour/reel-engine` (Remotion) · `@nour/social-assets`
(Satori/resvg) · `@nour/gbp-publisher` · `@nour/meta-ads-architect` ·
`@nour/ai-capabilities` · `@nour/signal-forge` · `@statenour/lenses` ·
`@statenour/chrome-extension`

**Changes to `packages/` or `pnpm-lock.yaml` affect BOTH web apps.**

## Non-workspace directories

`camera-bridge/` · `MoneyPrinterTurbo/`, `last30days-skill/`, `ad-factory/`
(vendored) · `docs/` (cross-cutting)

## Retired — do not look for these

`apps/voice/` (removed 2026-08-03, service deleted 2026-08-05) · the
`perplexica-mcp` Railway sidecar (deleted 2026-08-05; `perplexica` +
`searxng-perplexica` are still live and are what the app calls) · `.husky/`
(lefthook replaced it) · `~/push-main.sh` (direct-`main` pushes are forbidden)

## Canonical policy

`AGENTS.md` at repo root is the cross-agent source of truth. Vendor files
(`CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.cursor/rules/*`)
are thin adapters. **Add policy to `AGENTS.md`; add only vendor-specific
behavior to an adapter.** `pnpm agent:verify` enforces this contract in CI.
