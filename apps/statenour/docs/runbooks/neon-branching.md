# Runbook · Neon branching for safe experiments

> 2026-07-28 (NL-6). Staleness markers per clarity-gate: [STABLE] safe to
> follow · [CHECK] verify against the Neon console before relying on it.

## Why this exists

Statenour's schema + migrations are hand-applied against ONE production
Neon database, and one wrong flag silently drops pgvector (standing
warning in AGENTS.md). Neon's branching gives a copy-on-write clone of
the full database in seconds — the safe place to rehearse a migration,
test a destructive cleanup, or let an agent session run against real
data WITHOUT the agent-destructive-script incident class (870 prod rows,
2026-07) ever recurring.

## The rules [STABLE]

1. **Any migration touching pgvector/tsvector columns gets rehearsed on
   a branch first.** Run the applier against the branch connection
   string, verify `\d`-level shape + a recall smoke query, THEN apply to
   main.
2. **Agent sessions doing data-shaping work get a branch, not prod.**
   The connection string handed to a subagent must be a branch string —
   never the primary. (Memory rule: never give audit subagents a prod
   connection string.)
3. **Branches are disposable — delete after the experiment.** They cost
   storage-delta; a forgotten branch is drift waiting to confuse a
   future session.

## How [CHECK — commands against current Neon CLI]

```bash
# create a branch from current main state
neonctl branches create --project-id <project> --name exp-<task>

# get its connection string (pass THIS to the experiment)
neonctl connection-string exp-<task>

# delete when done
neonctl branches delete exp-<task>
```

The Neon MCP connector (available in agent sessions) exposes the same
operations: `create_branch`, `get_connection_string`, `delete_branch`,
plus `prepare_database_migration`/`complete_database_migration` which
rehearse-on-branch by design — prefer that flow for agent-run
migrations.

## Point-in-time recovery [CHECK]

Neon retains history for PITR within the project's retention window
(plan-dependent — verify the current retention in the console before
assuming). Restore drill: create a branch AT a timestamp
(`neonctl branches create --parent-timestamp <iso>`), verify the
missing/damaged rows exist there, copy them forward with an explicit
INSERT…SELECT. Never restore by resetting main.

## What this does NOT cover

Neon branching is not a backup strategy against account-level loss —
[CHECK] confirm an external dump cadence (pg_dump to object storage)
exists before treating branches as the only safety net.
