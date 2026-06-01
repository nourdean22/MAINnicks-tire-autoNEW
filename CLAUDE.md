# CLAUDE.md — NOURCITY monorepo

Two apps share this repo: `apps/statenour` (→ Railway/bdnick.info) and `apps/nickstire` (→ nickstire.org). **Per-app detail + wave history lives in `apps/<app>/AGENTS.md` — read that first for the app you're touching.** This file is only the always-must-know cross-cutting gotchas (the ones that recur).

## Context routing — load the scoped context for what you touch (don't re-read the whole repo)
- **`apps/statenour/**`** (Railway · bdnick.info) → read `apps/statenour/AGENTS.md` first. XP/stats spine = `lib/mastery/**` · "brain" (BrainMemory/recall/people-intelligence) = `lib/brain/**` · tRPC API = `lib/trpc/routers/**` · schema+migrations = `prisma/**` → skill **statenour-migration** (hand-applied; one wrong flag silently drops pgvector). Before commit/push → skill **statenour-verify**.
- **`apps/nickstire/**`** (Railway · nickstire.org) → read `apps/nickstire/AGENTS.md` first. SMS/VAPI = `server/**` · PWA UI = `client/**`. Before commit/push → skill **nickstire-verify**; pushing beside a sibling session → skill **nickstire-shared-main-push**.
- **Any client/UI code (BOTH apps run as standalone iOS PWAs)** → `window.confirm/alert/prompt` are silently suppressed on the operator's phone; use an in-DOM confirm → skill **nickstire-ios-pwa-primitives** (applies to statenour too).
- **Cross-session brain** (decisions · wave history · durable gotchas) → `~/.claude/projects/C--/memory/MEMORY.md` (index + topic files). Per-app last-session handoff → `apps/<app>/.remember/remember.md`.
- **Pushing to shared `main`** → `bash ~/push-main.sh` (fetch→rebase→affected-build gate→push, auto-recovers from ref-lock races; never `--no-verify`/force).

## Shared `main` — concurrent sessions
- `main` is worked by **concurrent Claude sessions** (statenour + nickstire, under `apps/*`). `git fetch origin` before every push; `git log origin/main..HEAD` to see what rides along — commits that aren't yours are expected (they committed, they ship).
- The pre-push hook builds **both affected apps** (turbo). The other session's broken working tree can bounce your push — surface it with a self-contained prompt; **never `--no-verify`**, never force-push shared history.
- Stage **only your files by explicit path** (`git add apps/<app>/path …`), never `git add -A`.

## Verify gates (statenour · run from `apps/statenour/`)
- `pnpm typecheck` (tsc --noEmit · must be 0) · `pnpm lint` (**this is eslint — the real linter; there is NO `lint:source` script** despite the stale `statenour-verify` skill; ~359 `any` *warnings* are pre-existing/non-blocking — only `error`s fail) · `pnpm test` (vitest · ~2896 passing · piping to `tail` masks the exit code, read the summary line).
- **The real push gate = `.husky/pre-push` turbo `next build` ONLY.** lint-baseline + prompt:size-check print RED but are NON-blocking. A green local `pnpm test` is on you.
- Pre-push Windows warnings ("IO error: provided value is too long when setting link name" / symlink) = **non-fatal** Windows-path noise; the build still passes.

## Environment (Windows)
- The shell **cwd resets to `C:\` between calls** — prefix every Bash with `cd /c/Users/nourd/NOURCITY/apps/<app> &&` (else "not a git repository" / ENOENT).
- `Edit` `old_string` containing unicode (`→`, `·`, emoji, box-drawing `─`) often fails to match — use ASCII-only anchors or copy the exact bytes from a fresh `Read`.

## Memory / handoff
- This agent's cross-session memory: `~/.claude/projects/C--/memory/MEMORY.md` (index) + topic files — **concurrently edited by the other session, re-read before editing**. `apps/<app>/.remember/remember.md` = last-session handoff.
- statenour also has its OWN app-level memory ("the brain": BrainMemory + pgvector recall + BGE reranker) — that's a product feature, separate from this agent's memory.
- **`memory` MCP** (user-scope · official `server-memory` knowledge graph at `~/.claude/agent-memory.json`, cross-project · added 2026-05-31): use it for DURABLE structured facts worth recalling in any future session — `create_entities` / `create_relations` / `add_observations` / `search_nodes` / `read_graph`. Loads at session start, **empty until populated** — actively write key facts/decisions to it so it earns its place (else it's dead weight next to the markdown auto-memory).
