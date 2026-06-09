# Runbook · Running a Claude Code session safely

- **Status:** active · **Domain:** session · **Risk:** low · **Last verified:** 2026-06-09
- **When to use:** starting any editing session in this repo.
- **Source of truth:** [`../CURRENT-TRUTH.md`](../CURRENT-TRUTH.md), [`../../AGENTS.md`](../../AGENTS.md), the monorepo `CLAUDE.md`.

## Rules

1. **Read current docs first** — `CURRENT-TRUTH.md` then `AGENTS.md`. Don't act on memory of "how it used to be".
2. **Inspect git state** — run `git status`, `git branch --show-current`, `git rev-parse --short HEAD` before editing.
3. **Isolated branch/worktree** — `main` is shared by concurrent sessions; work in a branch or a `.worktrees/<name>` worktree.
4. **Never overwrite owner changes** — if the tree has uncommitted owner work, stop and report it. Stage only your files by explicit path.
5. **Verify before completion** — a change is done when you've **observed** it working (typecheck/test/guard), not when you assume it. **No false "done" claims.**

## Commands

```
git status && git branch --show-current && git rev-parse --short HEAD
pnpm typecheck            # tsc --noEmit, must be 0
pnpm test                 # vitest — read the summary line, not the piped exit code
pnpm check:stale-docs     # active docs don't assert retired facts
```

## Gotchas

- The shell **cwd resets to `C:\`** between calls — prefix Bash with `cd /c/Users/nourd/NOURCITY/apps/statenour && …`.
- A fresh **worktree** needs `pnpm turbo build --filter=@statenour/lenses` **from the worktree root** first, or ~5 strategic-frameworks tests fail to import `@statenour/lenses`.
- The full vitest run can exit non-zero on ~12 pre-existing unhandled-rejection errors while all tests pass — **read the summary line**.

## Verification

- `pnpm typecheck` → 0 · targeted vitest green · the change observed working.

## Rollback

- `git restore` / `git checkout` the touched paths; worktrees are disposable (`git worktree remove`).
