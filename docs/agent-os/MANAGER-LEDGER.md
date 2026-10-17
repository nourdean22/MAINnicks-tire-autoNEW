# Manager ledger

Compact INDEX of jobs run by the monorepo manager (`.claude/skills/monorepo-manager/SKILL.md`). Not the source of
truth: PRs, `.completion/evidence.d/`, `.remember/` handoffs and git are. One row per job, updated in place by the
integrating session only. On start the manager reads every row not MERGED/CANCELLED plus the last 5.
No personal data, no secrets. Dry runs never write here.

Status: PLANNED | RUNNING | BLOCKED | BUILT | MERGED | LIVE-VERIFIED | CANCELLED | STALE
STALE = no owner session and superseded or untouched past the heartbeat's 3-day rule; the row says by what. Read it, then close or adopt it.

Where the rows live (since 2026-10-16): NOT in this file. Each job owns `docs/agent-os/ledger/<job-id>.md`, holding its
one-row ledger table and, under it, its one-row metrics table (see `MANAGER-METRICS.md`), nothing else. Two PRs that add
two files never edit the same line, so a sibling merging first no longer forces a second push.
- Add a job: create that file; copy the two header lines from any existing file; the row's Job id is the file name.
- Read the table: `node scripts/agent-os/ledger-render.mjs` (add `--open --tail 5` for the start-of-job read). Rows come
  out in job id order, which is date order. Nothing renders into the repo: this file and the metrics file stay prose.
- Check: `node scripts/agent-os/ledger-check.mjs` (CI runs it through `pnpm agent:verify`). It fails on a table line left
  in this file, a conflict marker, a file named anything but a job id, and every old row rule (see its header comment).
- A row from a branch that still appended to the old table: `node scripts/agent-os/ledger-migrate.mjs` (its header says how).
