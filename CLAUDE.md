# CLAUDE.md — NOURCITY monorepo

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Canonical cross-cutting agent rules live in **[`AGENTS.md`](./AGENTS.md)** — branch rule (NEVER push `main`), context routing, verify gates, Windows gotchas, memory locations. Everything there applies to Claude sessions verbatim.

@AGENTS.md

## Repo topology (refreshed 2026-07-14)

One pnpm + Turborepo workspace · **three** Railway services · one deploy branch (`main`). (Root `AGENTS.md` still opens with "two apps" — `apps/worker` was added since. `apps/voice` was RETIRED 2026-08-03, see below.)

| Path | Package | Stack · role | Deploys to |
|---|---|---|---|
| `apps/nickstire/` | `nicks-tire-auto` | Vite 7 + React 19 PWA client · Express 4 + tRPC 11 server · Drizzle ORM → TiDB Cloud (MySQL). Public tire-shop site + autonomous SMS/voice/AI ops + `/admin` console. | nickstire.org |
| `apps/statenour/` | `@statenour/web` | Next.js 16 (App Router) · Prisma 7 → Neon Postgres (pgvector/tsvector via raw SQL only) · AI SDK v6 · Tailwind 4. "NOUR OS" personal operating system + the Nick agent. | bdnick.info |
| `apps/worker/` | `@statenour/worker` | Express 4 + node-cron. Thin secret-gated cron dispatcher — forwards ticks over Railway's internal network to statenour-web `/api/cron/*`. No business logic, no DB client. | Railway internal |

The two web products are independent (different frameworks, databases, domains) — they share only this repo, the tooling, `main`, a small bridge contract, and the workspace packages.

**Workspace packages** (`packages/*`, consumed via `workspace:*`): `@nour/utils` (shared TS utilities) · `@nour/reel-engine` (Remotion video rendering) · `@nour/social-assets` (Satori/resvg asset generation) · `@nour/gbp-publisher` (Google Business Profile OAuth + posting) · `@nour/meta-ads-architect` · `@nour/ai-capabilities` · `@nour/signal-forge` · `@statenour/lenses` (49 strategic-reasoning prompt frameworks) · `@statenour/chrome-extension` (MV3 brain-capture). Changes to `packages/` or `pnpm-lock.yaml` affect both web apps.

**Non-workspace directories:** `camera-bridge/` (local shop-camera NVR → cloud bridge) · `MoneyPrinterTurbo/`, `last30days-skill/`, `ad-factory/` (vendored tool integrations) · `docs/` (cross-cutting docs; per-app docs live inside each app).

## Commands

Tooling: Node ≥ 20 · pnpm 10 (pinned via `packageManager`) · shared dep versions in `pnpm-workspace.yaml` `catalog:` (typescript, react, tailwind, vitest, prisma) · syncpack + sherif keep versions aligned. Git hooks are lefthook (`lefthook.yml`): pre-commit runs per-app lint/typecheck on staged globs; pre-push runs `pnpm run build:affected`.

Root shortcuts (`package.json`): `pnpm nick <script>` / `pnpm stn <script>` / `pnpm worker <script>` proxy into each app.

| Task | Command (from repo root) |
|---|---|
| Build what changed (= pre-push gate) | `pnpm build:affected` |
| CI-equivalent sweep | `pnpm ci:affected` (check + lint + test + build, `--affected`) |
| nickstire master verify gate | `pnpm verify:nick` (env → typecheck → lints → routes → prerender checks → test → build) |
| statenour full verify gate | `pnpm verify:state` (typecheck · lint · test · raw-SQL audit · cron manifest · stale-docs · prompt-size · `prisma validate`) |
| Dev servers | `pnpm nick dev` (Express + Vite, tsx watch) · `pnpm stn dev` (Next on :3001) · `pnpm worker dev` |

Single tests (run from the app directory):

- **nickstire** — `pnpm exec vitest run path/to/file.test.ts --pool=forks --poolOptions.forks.singleFork=true`. Serial mode is mandatory (parallel rotates import-timeout flakes on Windows) and shares ONE process across files — follow the test-hygiene rules in `apps/nickstire/AGENTS.md` §3 (unmock/unstub/env-restore in `afterEach`).
- **statenour** — `pnpm exec vitest run path/to/file.test.ts`. Build lenses first (`turbo build --filter=@statenour/lenses` from root) or strategic-frameworks imports fail. The suite exits 0 when green (measured 2026-07-28: 390 files, 4,419 passed, exit 0 — the old "passes but exits 1 on unhandled rejections" era is over); a non-zero exit is REAL. Caveat: exporting real API keys / prod DATABASE_URL into the shell reorders provider-chain tests and breaks the empty-DB smoke — run tests without sourced env.

## Per-app entry points (read before touching an app)

- `apps/nickstire/` → [`AGENTS.md`](apps/nickstire/AGENTS.md) (commands, layout, test hygiene) · [`CLAUDE.md`](apps/nickstire/CLAUDE.md) (operator context) · `truth_os.md` (what's live in prod) · `PROTECTED-CORE.md` (no-touch list) · `docs/CURRENT-TRUTH.md`.
- `apps/statenour/` → [`AGENTS.md`](apps/statenour/AGENTS.md) · `docs/CURRENT-TRUTH.md` (guarded by `pnpm check:stale-docs`) · `docs/RECONCILIATION.md` (wave-by-wave ship history) · `docs/runbooks/index.md`.
- `apps/worker/` → has its own `DEPLOY.md` deploy contract.
- **`apps/voice/` is RETIRED and fully removed (2026-08-03).** The Python LiveKit worker POSTed every turn to statenour `/api/agent`, a route deleted in `33a035257` (2026-06-03), and nothing in statenour reads `VOICE_BRIDGE_TOKEN` — the machine-caller auth path died with it. The Railway `statenour-voice` service is scaled to 0 replicas (config and env vars preserved). **The statenour half is gone too:** `app/voice/page.tsx` and `app/api/voice/token/route.ts` were deleted in `34b137be3` (#1317). The only surviving mention of `VOICE_BRIDGE_TOKEN` is `apps/statenour/.env.example`. Treat voice as fully retired — there is no orphaned surface left to decide about.

## Claude-specific extras

- Skills: read and apply the [ciitty](.agents/frameworks/ciitty/SKILL.md) skill framework. Before commit/push run **statenour-verify** / **nickstire-verify**. Schema changes → **statenour-migration** (hand-applied; one wrong flag silently drops pgvector). End of a statenour wave → **statenour-wave-reconcile**. Client confirm/alert/prompt UI → **nickstire-ios-pwa-primitives** (applies to statenour too). Shared-`main` pushes while sibling sessions run → **nickstire-shared-main-push**. "Turn this book/doc/repo into a skill" → **source-to-skill**. Working in a `.claude/worktrees/*` path (or `tsc` "not recognized") → **harness-worktree-setup** FIRST — those worktrees skip `worktree-setup.ps1`, so nothing runs until node_modules are junctioned. End of a wave, or after the operator corrects you → **session-observer** (propose-only; appends to [docs/skill-proposals.md](docs/skill-proposals.md), never edits a skill itself). All live in `.claude/skills/`.
- **Output shape — [answer-first](.claude/skills/answer-first/SKILL.md).** The operator reads on a phone, mid-task, usually while something is broken. Lead with the answer in the first sentence; number every procedure; put the receipt inline (`417 files, 4,670 passed, exit 0` — not "tests pass"). Delete "Hope this helps", "Great question", restated questions, and arrow chains. Readability outranks brevity: cut whole items, never compress sentences into fragments.
- **`memory` MCP** (user-scope `server-memory` knowledge graph at `~/.claude/agent-memory.json`, cross-project): write DURABLE structured facts/decisions to it (`create_entities` / `add_observations` / `search_nodes`) — it loads at session start and is dead weight unless populated.
