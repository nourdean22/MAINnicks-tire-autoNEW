# Ledger hygiene and job metrics (step 15, and step 1)

## The ledger row is written once, in the PR that merges it

`docs/agent-os/MANAGER-LEDGER.md` rows went stale as `pending` four times on 2026-10-15 (rows 32-34, reconciled in #3043,
and `2026-10-15-compiler-provenance-hardening`, still `pending` after #3044 merged). The cause is structural: a row is
written before the merge, nothing re-reads it after, and the next manager trusts it.

A row can only reach main through the merge of the PR that carries it. So write the row as its post-merge truth:

1. Status `MERGED`, PR cell `this PR`. Not `BUILT`, not `pending (<branch>)`. The number is recoverable at any time:
   `git log -S"<job id>" --format="%h %s" -- docs/agent-os/MANAGER-LEDGER.md` prints the squash commit with `(#N)`.
2. Put anything that happens later in the Next cell with an owner and a date ("live check owed: <who>, <date>"). Move to
   `LIVE-VERIFIED` only with the receipt, in a later PR that carries other work (no PR just for a ledger cell).
3. A job whose PR will not merge in this session is not `MERGED`: write `BUILT` with the PR number, and the next manager's
   step 1 (`gh pr view <n> --json state`) resolves it.
4. `node scripts/agent-os/ledger-check.mjs` fails on `pending`/`TBD`/`TODO` in the PR cell, on a malformed row and on an
   unknown status; it warns on `BUILT`/`RUNNING`/`PLANNED` with `this PR`, which is true only after the merge.
   `scripts/agent-os/ledgerCheck.test.mjs` runs it on the real ledger in `pnpm agent:verify`, so a stale `pending` fails CI.
5. A sibling PR that appends to the ledger conflicts at the tail by construction. Resolve by keeping both rows; never
   reword the other job's row beyond fixing a cell the facts have outgrown, and say which cell in the PR body.

## Metrics: one row per job

`docs/agent-os/MANAGER-METRICS.md` is a table `session-observer` reads. The ledger says what happened; the metrics say how
well the process worked, so a pattern shows up before it costs a third job. Fields (UNKNOWN is a valid value; a guess is not):

| Field | Count or measure |
|---|---|
| review findings by class | each finding after the PR opened (Codex, human) and each manager probe or review finding before it, per class: `bypass`, `test-gap`, `doc-claim`, `scope`, `name-or-fact`, `other` |
| manager catches | how many of those the manager's own steps (7-10) found before the PR opened |
| red-first count | new tests/canaries recorded RED against the unfixed code, out of new tests |
| mutation score | mutants killed / mutants tried, where a sweep ran |
| cycle time | first dispatch to merge, in hours |
| rework rounds | pushes after the PR opened |

Append the row in the same PR as the ledger row. At the end of a wave, `session-observer` reads this file with the ledger:
a class that recurs across three jobs, or a manager-catch rate near zero, is a proposal.
