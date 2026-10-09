# NOUR-Bench

Repository-specific coding evaluation harness. The unit of success is a solved
NOURCITY task, not a public leaderboard score.

## Primary metrics

- cost per solved task
- human minutes per solved task
- verifier outcome
- retries and regressions
- wall-clock time

`cases.jsonl` starts with real historical tasks from this repository. Each case
pins the pre-change commit so agents can be compared from the same source state.

The initial cases are a seed, not a complete benchmark. Expand toward 20-50
cases across Nick's Tire, StateNour, worker, and shared tooling before using the
suite to select a default model.

## Case count (2026-10-09)

25 cases. By id prefix: 10 `nick-`, 8 `statenour-`, 2 `worker-`, 5 `repo-`.
By area: 11 Nick's Tire, 8 StateNour, 2 worker, 4 repo tooling, because the
seed case `repo-session-lease-001` is a Nick's Tire outbound-call task graded by
`apps/nickstire` tests. By difficulty: 8 easy, 13 medium, 4 hard.

- The worker has no test suite of its own, so its cases are graded by the
  repo-level tests in `apps/statenour/tests/repo/`.
- `worker-render-plan-001` comes from a 64-file squash commit (#2936). Only
  `apps/worker/src/{renderPlan,scheduler}.ts` are graded; the rest of that diff
  is unrelated reel and doc work.

## Running a case's verify commands

Grade a case in this order:

1. Start from a checkout of `base_commit`.
2. Apply the agent's diff.
3. Overwrite each verify test file with its `source_commit` version. Run this
   from bash, or through `cmd /c` on Windows:
   `git show <source_commit>:<repo-relative path> > <repo-relative path>`
   - Do not skip this step. On 2026-10-09, 14 of the 28 verify test files are
     ADDED at `source_commit`: a plain `base_commit` checkout has no such file,
     so the command fails whatever the agent did. The other 14 are CHANGED: the
     `base_commit` copy is the pre-fix test, which grades nothing. The
     validator prints each file's added or changed status.
   - Copy only the verify test files. Anything else they import is the agent's
     to write, which is why acceptance bullets name new interfaces.
   - Do not use a Windows PowerShell 5.1 `>` redirect: it re-encodes the file
     as UTF-16. The repo's PreToolUse hook also blocks a worktree-writing
     `git restore`.
   - Create the file's directory first if `base_commit` lacks it. No current
     case needs this.
4. Run every verify command from the repository root.

There are two forms:

```
corepack pnpm --dir apps/<app> exec vitest run <app-relative test paths>
node --test <repo-relative test paths>
```

The seed form `corepack pnpm exec vitest run apps/<app>/...` never ran. From the
root, pnpm fails with `Command "vitest" not found`, because the root package has
no vitest. From `apps/<app>`, vitest prints `No test files found`, because it
resolves the path from the app directory. `--dir` runs vitest inside the app,
with that app's config. `scripts/agent-os/*.test.mjs` files use `node:test`.

## Validating cases

```
node tools/nour-bench/validate-cases.mjs              # check cases.jsonl
node tools/nour-bench/validate-cases.mjs --self-test  # prove the checks fire
```

Run both after adding or editing a case. The validator reads git only. It never
checks out an old commit and never runs a case's tests. Exit 0 means no errors.
Exit 1 means a case is broken, or, with `--self-test`, that a planted defect was
accepted or a known-good control was rejected. It rejects a line that:

- is not JSON, or is not exactly `{id, difficulty, base_commit, source_commit,
  task, acceptance[], verify[]}` with full 40-hex SHAs, `easy|medium|hard`, and
  1-3 acceptance bullets;
- reuses an id from any earlier line;
- names a commit this repository does not have;
- has a `base_commit` that is not the first parent of `source_commit`. A
  merge's second parent is rejected too;
- has a verify command in any other form, or with a flag after the runner;
- has a path that is not a plain relative test file, or a repo-relative path
  after `--dir`;
- has a path missing at `source_commit`;
- runs vitest in an app whose `package.json` does not declare vitest at
  `source_commit`;
- has a runner that does not match the file's test framework, or a test file
  that cannot be read. A `node --test` file must import `node:test`; not
  importing vitest is not enough, because a statenour vitest file can rely on
  `globals: true` and import nothing.

It warns, without failing, when a verify test is identical at `base_commit` and
`source_commit`. The fix did not touch that test, so it probably passes before
any work is done. The validator does not evaluate an app's vitest `include`
globs.

When the fix's test imports a function or module that does not exist at
`base_commit`, name that interface in an acceptance bullet. Otherwise the case
grades whether the agent guessed a name.
