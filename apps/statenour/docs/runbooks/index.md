# Agent runbooks — index

> **How to work safely in Statenour.** Structured operating knowledge for any AI
> session, not just facts. Typed catalog: [`lib/runbooks/catalog.ts`](../../lib/runbooks/catalog.ts).
> Guard: `pnpm check:runbooks`. Current truth: [`../CURRENT-TRUTH.md`](../CURRENT-TRUTH.md).

| Runbook | When to use |
|---|---|
| [statenour-current-truth](statenour-current-truth.md) | First thing — where Statenour runs, what's retired. |
| [statenour-claude-code-session](statenour-claude-code-session.md) | Starting any editing session here. |
| [statenour-migrations-and-deploys](statenour-migrations-and-deploys.md) | Any schema change, migration, or deploy. |
| [task-classifier-domain-missions](task-classifier-domain-missions.md) | Touching task classification / mission linkage / auto-learn. |
| [stale-doc-cleanup](stale-doc-cleanup.md) | A doc asserts a retired fact as current; or before adding a doc. |
| [action-honesty-and-receipts](action-honesty-and-receipts.md) | Chat finalization, tool results, anything Nick reports as done. |
| [memory-evals](memory-evals.md) | After changing a truth doc; checking Statenour still knows its truth. |
| [nickstire-vs-statenour-boundary](nickstire-vs-statenour-boundary.md) | Working across the monorepo without crossing app boundaries. |

The cron + jobs console already exists at `/system/crons` (manifest `config/crons.ts`,
verified by `pnpm check:crons`) — see those rather than a new surface.
- [Neon branching for safe experiments](./neon-branching.md) — branch-per-experiment, migration rehearsal, PITR drill (NL-6, 2026-07-28)
