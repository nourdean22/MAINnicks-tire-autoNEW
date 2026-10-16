# Manager job metrics

One row per manager job, in the same file as the job's ledger row: `docs/agent-os/ledger/<job-id>.md` holds the ledger table, then
this table, each with one row (`MANAGER-LEDGER.md` says where rows live and how to view them; `.claude/skills/monorepo-manager/references/ledger-and-metrics.md`
says what to count). This file keeps the rules only; `node scripts/agent-os/ledger-render.mjs --metrics` prints the table.
The ledger says what happened; the metrics say how well the process worked, so `session-observer` can see a
pattern before it costs a third job. UNKNOWN is a valid cell and a guess is not: a number counts only if the source is a PR, a
commit body or a receipt. No personal data, no secrets.

Classes for findings: `bypass` (the real binary accepts what the change says it refuses), `test-gap` (a test or canary that cannot
fail, or a missing arm), `doc-claim` (a count, number or sentence the code contradicts), `scope` (files outside paths, unrelated
edits), `name-or-fact` (an identifier or external claim that does not resolve), `other`.

Columns, in order, exactly as `ledger-check` wants them (a stray pipe inside a cell makes 9 cells, so reword instead):
Job id, After the PR opened (Codex, human), Manager catches before it opened, Red-first (new tests red on unfixed code / new tests),
Mutation (killed / tried), Cycle time (first dispatch to merge), Rework pushes, Source.
