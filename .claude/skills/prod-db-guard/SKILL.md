---
name: prod-db-guard
description: Use before running ANY script that touches a database from a worktree or local shell. Every worktree binds the PRODUCTION DATABASE_URL, so a "local" script hits prod — and a --dry-run flag is not a guard until a non-executing check proves it returns before the write.
---

# prod-db-guard

## The fact that makes this necessary

`scripts/worktree-setup.ps1` copies `DATABASE_URL` into every new worktree as a
**critical key**. There is no local database in a fresh worktree. A script you
run "just to see what it does" runs against production.

`.env` holds a production `DATABASE_URL` **but is not production config** —
never conclude runtime behavior by grepping it (see
`apps/nickstire/docs/runbooks/tidb-backup-restore.md`, Standing warnings).

## The incident this encodes

A prod-touching script was executed as *verification* — to confirm its guard
worked. The guard did not work. **870 production rows were deleted.** The
dry-run flag existed; it was checked after the delete path had already run.

Recorded in `apps/nickstire/docs/runbooks/tidb-backup-restore.md` and
`apps/statenour/docs/runbooks/neon-branching.md` — both apps carry the warning
because the incident class is not app-specific.

**Running a script is not how you verify a script.**

## Procedure

1. **Read the script before running it.** Locate every `DELETE`, `UPDATE`,
   `TRUNCATE`, `DROP`, and bulk `INSERT`.
2. **Prove the guard non-executing.** Trace the dry-run branch by reading it:
   confirm it `return`s or `process.exit`s *before* the first write, not after.
   A flag that only suppresses logging is not a guard.
3. **Confirm which database you are pointed at.** Print the host, do not assume.
   A worktree defaults to prod.
4. **Back up first for anything destructive.** The house pattern is a copied
   table named `_bak_<table>_<op>_<yyyymmdd>`, created before the mutation and
   left in place until the change is confirmed good.
5. **Get operator approval for a prod write.** Staged and reversible, stated as
   such. This is not an agent-initiative action.

## Verify read-only instead

Almost every "does this work in prod?" question has a read-only answer:

- `cron_log` — did the job run, when, with what result
- `GET /api/health` — uptime since container start
- `railway run --service MAINnicks-tire-auto -- <read-only query>`

Prefer these. They answer the question without a write path.

## Red flags — stop if you catch yourself thinking these

- "It's just a dry run."
- "I'll run it once to see what happens."
- "The script says it's safe."
- "I need to test the guard."

Each of these preceded the 870-row deletion. The correct move is a
**non-executing** check: read the code, or run it against a scratch table you
created for the purpose.

Related: [nickstire-tidb-ddl](../nickstire-tidb-ddl/SKILL.md) for the DDL
rules · `apps/nickstire/docs/operations/SCHEMA_DRIFT_RUNBOOK.md` for the apply
procedure.
