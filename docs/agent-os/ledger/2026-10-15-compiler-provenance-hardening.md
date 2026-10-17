| Job id | Date | Job | Lanes | Status | PR / SHA | Next action or blocker | Lesson |
|---|---|---|---|---|---|---|---|
| 2026-10-15-compiler-provenance-hardening | 2026-10-15 | CI runs validate.mjs over every compiled skill package (drop-in canary, red on a planted draft and a misplaced package); source-to-skill step 8 says what V2 checks; scaffold.mjs refusal proven to stop before it writes | platform | MERGED | #3044 (2edf9d187) | none (merged as #3044; the owning session confirmed the content is on main) | an arm that asserts both directions of a refusal still let a refusal that carries on live (2 of 9 mutants): assert what the refused run did not write |

| Job id | After the PR opened (Codex, human) | Manager catches before it opened | Red-first (new tests red on unfixed code / new tests) | Mutation (killed / tried) | Cycle time (first dispatch to merge) | Rework pushes | Source |
|---|---|---|---|---|---|---|---|
| 2026-10-15-compiler-provenance-hardening | 1 finding: test-gap (a package that lost `provenance/source.json` was invisible to the gate) | UNKNOWN | 2 plants red on the real tree (a fresh scaffold, a `generated/` package); 7 per-file negatives added after the finding | 17 / 17 after the fix; 9-mutant sweep of the immutability refusal was 7 / 9 before one arm was added | UNKNOWN | 1 (the fix for the finding) | #3044 hand-over note |
