# GEMINI.md — NOURCITY monorepo (Gemini CLI adapter)

Canonical agent policy is [`AGENTS.md`](./AGENTS.md), imported below via the memory import
processor. `NOUR-COMMAND.md` is imported too as the default execution framework. Before editing
inside an app, read the nearest `apps/<app>/AGENTS.md`; root policy maps the route.

@AGENTS.md
@NOUR-COMMAND.md

## Gemini-specific

You get FEWER automated safety nets than a Claude session in this repo. What that changes:

- **No PreToolUse gate.** `scripts/agent-os/pretool.mjs` is wired only in `.claude/settings.json`
  and is Claude-only by design (`pretool.mjs:15`). Its 13 always-on blocking rules in
  `config/agent-os/policy.json` (+4 scoped to `.worktrees/night-shift-*`) — push-to-main, force-push, `git push` with an implicit
  destination, `git add -A`, `--no-verify`, `git checkout --`/restore, `git stash pop`,
  `git worktree remove`, recursive-delete of a worktree, `prisma db push --accept-data-loss`,
  `DROP`/`TRUNCATE`, `pnpm install` inside a junctioned worktree, writing a `.env` — are
  self-discipline here, not enforcement. Re-read that file's rule list before any git or DB
  command; nothing will stop you.
- **No Stop gate.** Nothing catches uncommitted work left on `main` at the end of your turn.
- **Skills do not auto-load.** `.claude/skills/*/SKILL.md` are plain markdown and still worth
  reading on demand — `prod-db-guard` before any DB-touching script, `harness-worktree-setup`
  when `tsc` reports "not recognized", `statenour-verify` / `nickstire-verify` before pushing.
- **Git hooks DO apply to you.** lefthook installs real `.git/hooks/pre-commit` and `pre-push`
  (per-app lint/typecheck on staged globs; `pnpm run build:affected` on push), so the push gate
  runs regardless of which agent staged the change. Never bypass it with `--no-verify`.

Add Gemini-only notes HERE; repository policy belongs in `AGENTS.md`.

<!-- Thinness + the @AGENTS.md pointer are enforced by scripts/agent-os/check-adapters.mjs:102-105
     (cap 40 lines), run via `pnpm agent:parity`, lefthook pre-commit, and CI. Before 2026-08-21
     this file said "Gemini-specific behavior: none yet" and had never been revised since its only
     commit (2026-08-04) — the missing content was the asymmetry above, which is the whole reason
     a Gemini adapter needs to exist at all. -->
