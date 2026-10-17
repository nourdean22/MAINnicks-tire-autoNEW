# PLAYBOOKS.md - step by step, wired to the skills that do each step

On demand. Find the playbook whose trigger matches, then follow its steps in order. Each step names the
skill to invoke (Skill tool, exact name). A playbook never restates a skill; it sequences them.
Multi-area job? Use the manager first: `.claude/skills/monorepo-manager/SKILL.md`.

## P1. Any non-trivial task (intake)

1. Fill `templates/task-spec.md` in your head: outcome, scope, constraints, authority, unknowns, proof.
2. Recover context: memory index, `apps/<app>/.remember/`, the manager ledger (`node scripts/agent-os/ledger-render.mjs --open --tail 5`), open PRs.
3. Pasted plan or audit? `plan-gate`. New table, cron, flag, tool? `prior-art-grep`.
4. Route: one area -> the matching playbook below. Several areas -> manager skill.
Proof: a spec you could hand to a stranger.

## P2. Bug fix

1. `systematic-debugging`: reproduce, find the root cause, grep every caller of what you touch.
2. `test-driven-development`: failing test first (`positive-control-first`: watch it fail on the unfixed code).
3. Fix once, in the shared code.
4. `verification-before-completion`, then P4.
Proof: the failing test now passes, and the original symptom is gone at the highest reachable rung.

## P3. New feature or UI

1. `agentic-council:journey-mapping` for a new screen or flow (skip it for a small change to an existing one); not installed here: write the journey table by hand in the brief from the route and its screens.
2. `brainstorming` -> one design, smallest version that does the core job.
3. `antislop` + `antislop-ui` + `antislop-layoutmobile`; dialogs -> `nickstire-ios-pwa-primitives`.
4. `test-driven-development` while building. New writer (header, env, column) -> `assert-the-consumer`.
5. Check it in the browser preview at phone width, then P4.
Proof: screenshot at 375px plus passing tests.

## P4. Ship a PR

1. App gate: `nickstire-verify` or `statenour-verify` (worker: `pnpm check` + `pnpm build`).
2. Hostile self-review of the full diff (`requesting-code-review` or `/code-review`). Fix what it finds.
3. Branch `<app>/<task>` | `docs/<task>` | `chore/<task>`. ONE push. Harness worktree? Push from the
   hook-free clone (memory `harness-worktree-commit-path`).
4. `gh pr create`, wait for green, `gh pr merge --squash`, delete the ref (`AGENTS.md` > Branching).
5. Merge is not deploy. Confirm the live commit (nickstire `/api/health` `.deploy.commit`; statenour heartbeat)
   only for the app the diff touched, then report with `templates/completion-report.md`.
Proof: PR link, merge SHA, check receipts, and the live check reported separately.

## P5. Research or report

1. Repo question: `graphify query` before Grep. Web: `anthropic-skills:deep-research` for multi-source work.
2. Recurring business report: the matching `*-report` skill (see `docs/reporting/REPORT-SKILL-SUITE.md`).
3. Ratios: `base-rate-check`. Rendered numbers: `empty-vs-error`.
4. Write it with `answer-first`. Every number carries its source.
Proof: each claim links to a file:line, a query or a URL.

## P6. StateNour AI or prompt change

1. `langfuse:langfuse`: pull the failing traces that motivated the change; not installed here: read `apps/statenour/docs/integrations/langfuse-observability.md` and use the probe route.
2. Build or extend a dataset from them (Langfuse dataset or `lib/evals/`).
3. Change the prompt or tool; keep the fabrication-defense stack intact (`apps/statenour/AGENTS.md` section 4).
4. Run the eval before and after; report both scores. Then P4.
Proof: before/after eval numbers on the same dataset.

## P7. Production incident

1. State: what is broken, since when, for whom. Read-only probes only (`TOOLS.md` > Production reads).
2. `systematic-debugging` on the evidence (Railway logs, Sentry, health endpoints).
3. Fix through P2 and P4. A prod write or env change needs Nour's explicit go.
4. Confirm the live behavior after deploy, then add a regression test or monitor.
Proof: live endpoint or log line showing recovery.

## P8. End of a wave or session

1. `statenour-wave-reconcile` (statenour) or update `apps/<app>/.remember/now.md`.
2. If the manager ran the job: add `docs/agent-os/ledger/<job-id>.md` holding the ledger row written as `MERGED` with PR cell `this PR` (never `pending`) and the metrics row under it, in the PR that merges.
3. `session-observer`: propose skill fixes for anything that went wrong twice.
4. Memory: run `LOOPS.md` > Memory loop.
Proof: ledger row and handoff note committed in the same PR.
