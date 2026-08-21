# statenour-worker · Claude adapter

@AGENTS.md

That import is the service policy — what this process actually is, the env vars the code really
reads, and the fail-closed invariants are already in context; don't re-read the file. Deploy contract
(Railway IDs, rollback, failure modes): [`DEPLOY.md`](./DEPLOY.md) — read it before any deploy or
rollback, not for routine code work. Cross-cutting repo rules: root [`AGENTS.md`](../../AGENTS.md).

## Claude-specific

- **There is no test suite here.** The whole local gate is
  `pnpm --filter @statenour/worker check` plus a build. Say exactly that in your receipt rather than
  implying tests ran — an unqualified "verified" reads as a test pass that never happened.
- **`AGENTS.md` is canonical for the env contract.** It was verified against `src/` and
  `package.json`, not against prose. `DEPLOY.md` once listed `DATABASE_URL` /
  `NICKSTIRE_DATABASE_URL` as CRITICAL from an earlier design; that was corrected and it now defers
  here (`DEPLOY.md:43-45`), so the two no longer disagree. If you change the env contract, change
  `AGENTS.md` first, then `DEPLOY.md`.

<!--
  2026-08-21 AUDIT (docs/agent-audit/): this adapter referenced ./AGENTS.md with a markdown LINK,
  so the service policy auto-loaded in ZERO sessions. The @-import is cheap here — apps/worker/
  AGENTS.md is only ~885 tokens, the smallest and highest-quality policy file in the repo.

  apps/worker/AGENTS.md WAS redrafted here. It was graded A twice — by this audit and by a drafting
  agent — each after verifying a handful of claims and stopping, and both missed the same one: the
  doc said the render loop ran "every 2 min" while scheduler.ts:334 has been "*/15 * * * *" since
  #1696 (2026-08-19). Its "Last verified: 2026-08-04" stamp was never recomputed, so it advertised
  trustworthiness exactly where a fact had rotted. The rewrite fixes the cadence, replaces the date
  stamp with file:line citations, and flags an OPEN /health staleness bug. Sampling N of M
  falsifiable claims is not verification.
-->
