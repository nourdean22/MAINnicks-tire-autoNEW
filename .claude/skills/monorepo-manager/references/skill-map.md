# Skill map: the narrower skills the manager invokes, by exact name

Naming a skill is not invoking it (`skills-check.mjs` sends a turn back when the `Skills:` line names one without a Skill
call). Invoke each with the Skill tool at the step below. Where: `repo` = `.claude/skills/<name>/` in this repo (a test
checks each one exists); `machine` = `~/.claude/skills/<name>/` on NattyNour (superpowers and house skills; a fresh clone
does not have them, so say so and use the repo fallback named in the row).

| Step | Skill | When | Where |
|---|---|---|---|
| every turn | `using-superpowers`, `ponytail`, `karpathy-guidelines`, `i-have-adhd`, `verification-before-completion` | first tool batch of every working turn | repo |
| every turn | `answer-first` | every reply, report and PR body | repo |
| 1 Recover state | `stranded-branch-rescue` | a pushed branch or finished work with no merged PR | repo |
| 1 Recover state | `session-authority` | a checkout `worktree-setup.ps1` never touched (cloud) | repo |
| 2 Spec | `plan-gate` | a pasted plan, audit or roadmap | repo |
| 2 Spec | `prior-art-grep` | before any new table, queue, tool, flag, cron or env var | repo |
| 2 Spec | `brainstorming` | a new build or a vague ask | repo |
| 2 Spec | `writing-plans` | a multi-step plan with real tasks | machine (fallback: the task-spec template) |
| 6 Dispatch | `dispatching-parallel-agents` | two or more independent lanes | machine (fallback: SUBAGENT POLICY rule 5) |
| 6 Dispatch | `subagent-driven-development` | a lane per task with a review per task | machine (fallback: steps 6-7 here) |
| 7 Check every return | `systematic-debugging` | a lane or session fails twice for the same reason | repo |
| 8 Relay | `empty-vs-error` | a session reports a zero, "none" or "never" | repo |
| 8 Relay | `base-rate-check` | a session reports a ratio inside a filtered group | repo |
| 9 Probe it yourself | `guard-red-team` | any guard, hook, regex or policy | repo |
| 9 Probe it yourself | `positive-control-first` | any new test, canary or gate | repo |
| 9 Probe it yourself | `prod-db-guard` | any script that touches a database | repo |
| 12 Review before the PR opens | `requesting-code-review` | one reviewer on a small diff | machine (fallback: a `lane-research` lens) |
| 12 Review before the PR opens | `receiving-code-review` | EVERY Codex or reviewer round, before changing anything | machine (fallback: read each finding against the file first) |
| 12 Review before the PR opens | `differential-review` | a diff touching auth, payments, guards or customer data | machine (repo once PR 3227 merges) |
| 12 Review before the PR opens | `supply-chain-risk-auditor` | the diff changes a dependency or `pnpm-lock.yaml` | machine (repo once PR 3227 merges) |
| 13 Integrate | `nickstire-verify` | the combined tree touches `apps/nickstire` | repo |
| 13 Integrate | `statenour-verify` | the combined tree touches `apps/statenour` | repo |
| 13 Integrate | `skill-forge` | the job adds a skill or rewrites a skill description | repo |
| 14 Consumer check | `assert-the-consumer` | the job adds a writer: header, env var, column, hook, tool | repo |
| 15 Merge | `nickstire-shared-main-push` | pushing while sibling sessions run | repo |
| 15 Merge | `finishing-a-development-branch` | the branch is done and needs its landing decided | machine (fallback: merge-gate + teardown script) |
| 16 Report | `deploy-not-live` | a merged PR is not showing in production | machine (fallback: `production-health-report`) |
| 16 Report | `production-health-report` | a broad what-is-live read | repo |
| 17 Log and learn | `statenour-wave-reconcile` | the end of a statenour wave | repo |
| 17 Log and learn | `session-observer` | the end of a wave, or after a correction from Nour | repo |
| 17 Log and learn | `skill-fire-audit` | weekly, or when Nour asks which skills fire | repo |
