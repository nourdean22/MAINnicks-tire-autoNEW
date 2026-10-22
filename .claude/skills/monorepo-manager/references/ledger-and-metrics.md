# Ledger hygiene and job metrics (step 17, and step 1)

## The ledger row is written once, in the PR that merges it

## Where the rows live (since 2026-10-16): one file per job

Each job owns `docs/agent-os/ledger/<job-id>.md`: its one-row ledger table, then (if it has one) its one-row metrics table,
each under the header lines every existing file carries, nothing else. `MANAGER-LEDGER.md` and `MANAGER-METRICS.md` keep only
their prose; the tables are never stored. Why: every PR used to append to the same table tail, so a sibling that merged first
forced a second push of the loser (about 2.5 pushes per PR on 2026-10-15/16, each one billed). Two files never conflict.

- Add a job: create the file, `<job-id>` = yyyy-mm-dd-slug = the file name = the first cell of both rows.
- Read: `node scripts/agent-os/ledger-render.mjs` (add `--open --tail 5` for step 1, `--metrics` for the metrics table).
  Rows come out in job id order, which is date order, so "the last 5" means the 5 newest ids.
- A branch that still appended a row to the old table: after rebasing onto the split, take the old file from your branch
  (`git show <branch>:docs/agent-os/MANAGER-LEDGER.md > old.md`), run `node scripts/agent-os/ledger-migrate.mjs --ledger old.md
  --only <job-id>` (add `--metrics old-metrics.md` for the metrics row), then restore both prose files from `origin/main`.

## The ledger row is written once, in the PR that merges it

Ledger rows went stale as `pending` four times on 2026-10-15 (rows 32-34, reconciled in #3043,
and `2026-10-15-compiler-provenance-hardening`, still `pending` after #3044 merged). The cause is structural: a row is
written before the merge, nothing re-reads it after, and the next manager trusts it.

A row can only reach main through the merge of the PR that carries it. So write the row as its post-merge truth:

1. Status `MERGED`, PR cell `this PR`. Not `BUILT`, not `pending (<branch>)`. The number is recoverable at any time:
   `git log -S"<job id>" --format="%h %s" -- docs/agent-os/MANAGER-LEDGER.md docs/agent-os/ledger` prints the squash commit with `(#N)`.
2. Put anything that happens later in the Next cell with an owner and a date ("live check owed: <who>, <date>"). Move to
   `LIVE-VERIFIED` only with the receipt, in a later PR that carries other work (no PR just for a ledger cell).
3. A job whose PR will not merge in this session is not `MERGED`: write `BUILT` with the PR number, and the next manager's
   step 1 (`gh pr view <n> --json state`) resolves it.
4. `node scripts/agent-os/ledger-check.mjs` reads every job file, renders the table and fails on: no header or separator, a header with
   no rows, a job row below the table's end (after a blank line, or behind a `> ` or `- ` prefix), `pending`/`TBD`/`TODO` or nothing in the
   PR cell, a malformed or duplicate row, an unknown status. It also fails per file on: a git conflict marker, a file name that is not a
   job id, a row for another job, a header that drifted, a metrics row without 8 cells, any line that is not one of the two tables, and a
   table line left in either prose file. It warns on `BUILT`/`RUNNING`/`PLANNED` with `this PR` (true only after the
   merge) or with a PR cell that says `MERGED` (the status is stale). Exit 2 means a file or the directory could not be read.
   `scripts/agent-os/ledgerCheck.test.mjs` and `ledgerSplit.test.mjs` run it on the real tree in `pnpm agent:verify`, so a stale `pending` fails CI.
5. Two PRs that each add a job file never conflict. If a file does conflict, one PR edited another job's file: keep both sides' facts,
   never reword the other job's row beyond fixing a cell the facts have outgrown, and say which cell in the PR body.

## Metrics: one row per job

The metrics table (`node scripts/agent-os/ledger-render.mjs --metrics`; its rules and finding classes are in `docs/agent-os/MANAGER-METRICS.md`) is what `session-observer` reads. The ledger says what happened; the metrics say how
well the process worked, so a pattern shows up before it costs a third job. Fields (UNKNOWN is a valid value; a guess is not):

| Field | Count or measure |
|---|---|
| review findings by class | each finding after the PR opened (Codex, human) and each manager probe or review finding before it, per class from the fixed list in `MANAGER-METRICS.md`: `bypass`, `test-gap`, `doc-claim`, `scope`, `name-or-fact`, `other` (a word of your own, such as "instrument", is mapped into one of them, never added) |
| manager catches | how many of those the manager's own steps (8-12: relay, probes, names, sources, review) found before the PR opened |
| red-first count | new tests/canaries recorded RED against the unfixed code, out of new tests |
| mutation score | mutants killed / mutants tried, where a sweep ran |
| cycle time | first dispatch to merge, in hours |
| rework rounds | pushes after the PR opened |

The metrics row sits in the same job file, under the ledger row (header lines as in any existing file; a pipe inside a cell
makes 9 cells, so reword it). At the end of a wave, `session-observer` reads this file with the ledger:
a class that recurs across three jobs, or a manager-catch rate near zero, is a proposal.
