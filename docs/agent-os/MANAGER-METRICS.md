# Manager job metrics

One row per manager job, appended in the same PR as the job's ledger row (`.claude/skills/monorepo-manager/references/ledger-and-metrics.md`).
The ledger (`MANAGER-LEDGER.md`) says what happened; this file says how well the process worked, so `session-observer` can see a
pattern before it costs a third job. UNKNOWN is a valid cell and a guess is not: a number counts only if the source is a PR, a
commit body or a receipt. No personal data, no secrets.

Classes for findings: `bypass` (the real binary accepts what the change says it refuses), `test-gap` (a test or canary that cannot
fail, or a missing arm), `doc-claim` (a count, number or sentence the code contradicts), `scope` (files outside paths, unrelated
edits), `name-or-fact` (an identifier or external claim that does not resolve), `other`.

| Job id | After the PR opened (Codex, human) | Manager catches before it opened | Red-first (new tests red on unfixed code / new tests) | Mutation (killed / tried) | Cycle time (first dispatch to merge) | Rework pushes | Source |
|---|---|---|---|---|---|---|---|
| 2026-10-15-skill-compiler-flat-path | 4 findings, classes UNKNOWN | UNKNOWN (not counted then) | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | ledger row, #3041 |
| 2026-10-15-guard-mcp-coverage | 5 findings, classes UNKNOWN | UNKNOWN (not counted then) | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | ledger row, #3040 |
| 2026-10-15-compiler-provenance-hardening | 1 finding: test-gap (a package that lost `provenance/source.json` was invisible to the gate) | UNKNOWN | 2 plants red on the real tree (a fresh scaffold, a `generated/` package); 7 per-file negatives added after the finding | 17 / 17 after the fix; 9-mutant sweep of the immutability refusal was 7 / 9 before one arm was added | UNKNOWN | 1 (the fix for the finding) | #3044 hand-over note |
| 2026-10-15-guard-sql-lease-infra | not yet (PR in flight when this file was written) | 2: bypass (list cap stopped judging at element 200), scope (probes belonged in `denyExamples`, which needed one path exception) | red-first recorded in the 5 commit bodies read (of 7): 4 of 4 tests red, 1 of 1, 5 of 9, 6 of 114 | UNKNOWN (BREAKS arms exist; no score recorded) | UNKNOWN | UNKNOWN | commit bodies `c6165375f`, `8f6522e8f`, `6ba98aa6b`, `fe4ebf221` |
| 2026-10-15-manager-skill-upgrade | 12 Codex findings on the first commit (4 P1, 8 P2): 9 bypass of a gate, 2 instrument, 1 doc-claim; each fixed with a red-first test in the follow-up commit | 26 from the skeptic pass on skill-forge (9 bypass of a gate, 3 instrument or test-gap, 5 doc-claim, 9 procedure or overlap; tallied by hand), plus 9 mutation survivors turned into test arms (merge-gate 1, forge 7, workflow 1 equivalent clause removed) | 4 new test files red first on the unfixed tree: ledger 1 of 12 red (the real stale row), manager skill 1 of 11 red, forge 1 of 40 red; the merge-gate and workflow files were green on first run and relied on mutation | ledger-check 12 of 12, merge-gate 20 of 20 (19 of 20 first), workflow 9 of 9 (9 of 10 first), manager-skill check 8 of 8, forge 60 of 60 (53 of 60 first) | UNKNOWN | 2 after the PR opened (the manager notes, then the Codex fixes) | this PR; the skeptic was a `lane-research` agent, the mutation sweeps ran from a scratch harness |
