# AGENTS.md — NOURCITY monorepo

Two apps share this repo: `apps/statenour` (Railway → bdnick.info) and `apps/nickstire` (Railway → nickstire.org). **Per-app detail lives in `apps/<app>/AGENTS.md` — read that first for the app you're touching.** This file is only the cross-cutting rules that recur. Claude-specific extras: [`CLAUDE.md`](./CLAUDE.md).

## Branching — NEVER push `main` (operator rule, 2026-06-11)

- Work on named branches only: `nickstire/<task>` · `statenour/<task>` · `docs/<task>` · `chore/<task>`. Push the branch, open a PR; the **operator merges**. (`~/push-main.sh` is retired for agents.)
- Concurrent agent sessions share this repo — start from a fresh worktree: `git worktree add .worktrees/<name> -b <branch> origin/main`. Worktrees are shared surfaces too: `git log origin/<branch>..HEAD` before AND after pushing; disclose rider commits in the PR body, never rewrite them away.
- Stage **only your files by explicit path** — never `git add -A` · never `--no-verify` · never force-push shared history.
- Scope changes to the assigned task ONLY — no unrelated docs, generated reports, or sibling-session files.
- Final report: branch · SHA · changed files · checks run · PR link · intentional exclusions.

## Context routing

- `apps/statenour/**` → read `apps/statenour/AGENTS.md` first. Schema + migrations are hand-applied (`prisma/**`) — one wrong flag silently drops pgvector.
- `apps/nickstire/**` → read `apps/nickstire/AGENTS.md` first. SMS/VAPI = `server/**` · PWA UI = `client/**`.
- **Both apps run as standalone iOS PWAs**: `window.confirm/alert/prompt` are silently suppressed on the operator's phone — use in-DOM confirms (two-tap pattern).

## Verify gates

- The push gate = repo-root `.husky/pre-push` → `turbo build` for affected apps. Other printed checks (lint-baseline, prompt:size-check) can be RED but are NON-blocking — a green local test run is on you.
- statenour (from `apps/statenour/`): `pnpm typecheck` · `pnpm lint` · `pnpm test` · full gate `pnpm verify:hard`. Piping vitest to `tail` masks the exit code — read the summary line.
- nickstire (from `apps/nickstire/`): `pnpm run verify` (master gate). Full suite MUST be serial on Windows: `pnpm exec vitest run --pool=forks --poolOptions.forks.singleFork=true`.
- Fresh worktrees need `pnpm install --frozen-lockfile --filter "<app>..."` — WITH the `...` suffix (bare `--filter` skips workspace deps → phantom `clsx`/import failures).

## Commit Attribution

AI commits MUST include:

```
Co-Authored-By: <model name> <noreply@anthropic.com>
```

## Environment (Windows)

- Bash cwd resets to `C:\` between calls — prefix every command with `cd /c/Users/nourd/NOURCITY/... &&`.
- `Edit` old_string containing unicode (arrows, middots, emoji) often fails to match — use ASCII-only anchors from a fresh Read.
- Pre-push "IO error: provided value is too long when setting link name" / symlink warnings = non-fatal Windows-path noise; the build still passes.

## Memory / handoff

- Cross-session agent memory: `~/.claude/projects/C--/memory/MEMORY.md` (index + topic files) — concurrently edited by sibling sessions, re-read before editing. Per-app last-session handoff: `apps/<app>/.remember/remember.md`.
- statenour's own "brain" (BrainMemory + pgvector recall) is a product feature — separate from agent memory.
