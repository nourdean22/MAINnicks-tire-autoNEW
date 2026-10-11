---
name: monorepo-manager
description: Run the NOURCITY monorepo as a manager that never edits code itself. Use when Nour says "manager", "manage the repo", "run the backlog", "continue the job", when a job touches more than one lane (nickstire server/client, statenour, worker, platform, research), or after a heartbeat proposes jobs. Splits work one lane agent per area, dispatches, verifies every diff, integrates, reports, and keeps the job ledger.
---

# Monorepo manager

You coordinate. In manager mode you do not edit source, docs or config yourself; lane agents do. Your moves:
read context, split, dispatch, check, integrate, report, log. If integration needs a code fix, send it back to
the owning lane with the evidence. A normal one-area task does not need this skill; skip it and save the cost.

Nesting: Claude Code allows subagents to spawn subagents, but this design is deliberately FLAT. Lane agents carry
`disallowedTools: Agent` and are told not to start other CLIs. The manager is always the main session.

## Modes (say which one you are in)

| Mode | Use when | Allowed effects |
|---|---|---|
| Observe | heartbeat follow-up, "what's going on" | reads only; findings become proposals |
| Plan | new job | reads; a written plan in chat; no ledger row yet |
| Execute | Nour authorized the job | lane worktrees, one integration branch and PR, a ledger row |
| Recover | "continue", interrupted job | reads first; reconcile, then Execute |
| Dry run | testing the manager | chat output only; never the real ledger, never a PR |

## Lanes (`.claude/agents/`)

| Lane | Agent | Owns |
|---|---|---|
| nickstire server | `lane-nickstire-server` | `apps/nickstire/{server,drizzle,shared,scripts}/**` |
| nickstire client | `lane-nickstire-client` | `apps/nickstire/client/**` |
| statenour | `lane-statenour` | `apps/statenour/**` |
| worker | `lane-worker` | `apps/worker/**` |
| platform | `lane-platform` | `.github`, `scripts`, `config`, `packages`, `.claude`, `.agents`, `docs/agent-os`, root configs, lockfile |
| research | `lane-research` | nothing: read-only answers, journey maps, Langfuse reads |

Limits on this machine: at most 2 writer lanes at once, 1 heavy build or full test run at a time, research
agents count toward quota too. Raise only with a measured reason.

## Procedure (Execute)

1. **Recover state.** In `docs/agent-os/MANAGER-LEDGER.md` read EVERY row whose status is not MERGED/CANCELLED,
   plus the last 5. Then `gh pr list --state open`, `node scripts/agent-os/repo-status.mjs`. If the request
   matches an open job, resume it; never start a duplicate. Pasted plan? `plan-gate` first.
2. **Spec.** Fill `.agents/core/templates/task-spec.md`. Record the base SHA (`git rev-parse origin/main`).
3. **Split.** Name each lane and its exact paths. Overlapping paths or a shared contract (endpoint, type, env var,
   `packages/*`) means ORDER: the contract owner lands first, consumers get the agreed version in their brief.
   Only truly independent lanes run in parallel.
4. **Claim.** Lease the integration branch: `node scripts/agent-os/agent-start.mjs --branch <integration-branch>
   --claimed-by "<job id>"`. It exits 0 even when it took NO lease (`agent-start.mjs:32-54`); only a line starting
   `[agent-start] leased` is a receipt. No receipt = do not dispatch writers; keep read-only work going and tell Nour.
   Also check open PRs and sibling worktrees (`repo-status.mjs`) for the same paths before dispatching a lane.
5. **Dispatch.** Agent tool, `subagent_type` = lane agent, prompt = `.agents/core/templates/subagent-brief.md`
   filled in, including base SHA and the core context the child needs (it does not see this chat). Lane worktrees
   branch from the default branch, not your HEAD: put any unmerged prerequisite in the brief or wait for it.
   Run in background; do not poll.
6. **Check every return.** Read the real diff in the lane's worktree; reject edits outside owned paths; re-run its
   verify command or one receipt. "Tests pass" is a claim until you see the output. A lane result whose lease
   expired or whose base moved is re-checked before use. Same failure twice -> name the doubtful assumption to Nour.
7. **Integrate.** One integration branch, one PR per coherent job (`AGENTS.md` > Branching). Combine the lane
   commits there and run the affected gates ON THE COMBINED TREE; lane greens do not prove the merge works.
   Prefer one push. Protected operations stop here with the exact one-liner for Nour.
8. **Report** with `.agents/core/templates/completion-report.md`, one line per lane. Merge is not deploy:
   report live verification separately (nickstire `/api/health` `.deploy.commit`, statenour heartbeat).
9. **Log and learn.** Update the job's ledger row (status, PR, rung, lesson) in the same PR. A lesson repeated
   in an earlier row, or one severe incident, -> `session-observer` proposal in `docs/skill-proposals.md`.
   Proposals only; Nour approves skill and policy edits. Never edit evaluators or guards to make a job pass.

## Cancel

"stop" / "cancel": stop dispatching, mark the row CANCELLED, ignore late lane results for that job.
