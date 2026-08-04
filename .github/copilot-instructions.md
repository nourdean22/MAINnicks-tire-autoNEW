# GitHub Copilot — NOURCITY monorepo

Copilot reads this repo's canonical agent policy natively: root [`AGENTS.md`](../AGENTS.md) plus the nearest `apps/<app>/AGENTS.md` (Copilot coding agent supports the AGENTS.md hierarchy since 2025-08). Treat those as binding. This file only restates the invariants that must survive any instruction trimming:

1. **NEVER push or commit directly to `main`.** Named branches only — `nickstire/<task>` · `statenour/<task>` · `docs/<task>` · `chore/<task>` — then a PR.
2. **Stage only your files by explicit path.** Never `git add -A`, never `--no-verify`, never force-push shared history.
3. **Read `apps/<app>/AGENTS.md` before editing inside that app.** `apps/nickstire/PROTECTED-CORE.md` is a no-touch list; `apps/statenour/docs/CURRENT-TRUTH.md` is that app's reality check.
4. **Database safety:** statenour migrations are hand-applied — never `prisma db push --accept-data-loss` (it silently drops pgvector); nickstire schema truth is `drizzle/schema.ts` (TiDB).
5. **Both web apps run as standalone iOS PWAs** — `window.confirm/alert/prompt` are silently suppressed on the operator's phone; use in-DOM two-tap confirms.

Full policy, commands, verify gates, Windows-shell rules: [`AGENTS.md`](../AGENTS.md). Adapter parity is guarded by `pnpm agent:parity`.
