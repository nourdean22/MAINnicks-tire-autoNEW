---
name: monorepo-manager
description: Run the NOURCITY monorepo as a manager that never edits code itself. Use when Nour says "manager", "manage the repo", "run the backlog", "continue the job", when a job touches more than one lane (nickstire server/client, statenour, worker, platform, research), or after a heartbeat proposes jobs. Splits work one lane agent per area, dispatches, verifies every diff, integrates, reports, and keeps the job ledger.
triggers: manager, manage the repo, run the backlog, continue the job, more than one lane, dispatch lanes, job ledger, heartbeat jobs, integrate lanes, verify every diff
---

# Monorepo manager

You coordinate. In manager mode you do not edit source, docs or config yourself; lane agents do. The one exception is the job's
own ledger and metrics rows (step 15). Your moves: read context, split, dispatch, check, probe, integrate, merge, report, log. If
integration needs a code fix, send it back to the owning lane with the evidence. A normal one-area task does not need this skill;
skip it and save the cost.

Nesting: Claude Code allows subagents to spawn subagents, but this design is deliberately FLAT. Lane agents carry
`disallowedTools: Agent` and are told not to start other CLIs. The manager is always the main session.

Why steps 7-10 and 12 exist: in the 2026-10-15 guard job every lane canary was green while the real hook let a DROP
through at array element 201. A lane's green proves the lane's imagination; your own probes test the adversary's.
Every upgrade is tied to a defect that job really had: [references/replay-2026-10-15.md](references/replay-2026-10-15.md).

## Modes (say which one you are in)

| Mode | Use when | Allowed effects |
|---|---|---|
| Observe | heartbeat follow-up, "what's going on" | reads only; findings become proposals |
| Plan | new job | reads; a plan in chat with two alternatives, the 10x option and kill criteria (step 2); no ledger row yet |
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

Limits on this machine: at most 2 writer lanes at once, 1 heavy build or full test run at a time; research agents, reviewers,
workflow fan-outs and background suites count toward both (four concurrent suite runs gave an OOM and 20 s timeouts). Raise only with a measured reason.

## Procedure (Execute)

1. **Recover state.** Read EVERY ledger row whose status is not MERGED/CANCELLED, plus the last 5:
   `node scripts/agent-os/ledger-render.mjs --open --tail 5` (rows live one per job in `docs/agent-os/ledger/`);
   run `node scripts/agent-os/ledger-check.mjs`; then `gh pr list --state open` and
   `node scripts/agent-os/repo-status.mjs`. A row that names a PR: `gh pr view <n> --json state`; a MERGED PR under an
   open row is stale, fix the row in your PR. A request that matches an open job resumes it; never start a duplicate. Pasted plan? `plan-gate` first.
2. **Spec.** Fill `.agents/core/templates/task-spec.md`. Record the base SHA (`git rev-parse origin/main`). A design choice gets two
   alternatives that differ in kind, the 10x option and kill criteria in writing first (Plan mode, [references/sessions-and-plans.md](references/sessions-and-plans.md)).
3. **Split.** Name each lane and its exact paths. Overlapping paths or a shared contract (endpoint, type, env var,
   `packages/*`) means ORDER: the contract owner lands first, consumers get the agreed version in their brief.
   Only truly independent lanes run in parallel.
4. **Claim.** Lease the integration branch: `node scripts/agent-os/agent-start.mjs --branch <integration-branch>
   --claimed-by "<job id>"`. It exits 0 even when it took NO lease (`agent-start.mjs:32-54`); only a line starting
   `[agent-start] leased` is a receipt. No receipt = do not dispatch writers; keep read-only work going and tell Nour.
   Also check open PRs and sibling worktrees (`repo-status.mjs`) for the same paths before dispatching a lane.
5. **Dispatch.** Agent tool, `subagent_type` = lane agent, prompt = `.agents/core/templates/subagent-brief.md` (v3)
   filled in: base SHA, RULED OUT, DESIGN decisions, fixtures, PITFALLS, the SELF-AUDIT demand and an explicit path-exception
   line. The child does not see this chat. Lane worktrees branch from the default branch, not your HEAD: put any unmerged
   prerequisite in the brief or wait for it. Run in background; do not poll. A message to a running session carries ONE
   decision and a first line of REPLY NEEDED or NO REPLY NEEDED; never ask twice ([references/sessions-and-plans.md](references/sessions-and-plans.md)).
   Set the Agent tool's `model` and `effort` from the brief's MODEL / EFFORT line (routing table in the template); a lane never picks its own.
   Run `node scripts/agent-os/skill-recall.mjs --file <brief>` and put its matches in SKILLS TO INVOKE FIRST.
6. **Check every return.** Read the real diff in the lane's worktree; reject edits outside owned paths (from the lane
   worktree: `node <your checkout>/scripts/agent-os/check-lane-paths.mjs --lane <lane> --base <base SHA>`, exit 1 = reject;
   exit 2 = not checked, an error or an EMPTY diff from a lane that owns paths, never a pass); re-run its verify command or one
   receipt. Every fact in a RETURN carries FACT, INFERRED or NOT CHECKED (how these map to step 9's labels: verify.md); send back a return without labels. "Tests pass" is a
   claim until you see the output. A lane result whose lease expired or whose base moved is re-checked before use.
   `check-lane-paths` flags an authorized exception as out of lane: compare each flagged file with the brief's PATH EXCEPTIONS. Review
   fixes go back to the same lane with SendMessage; it resumes with its context. A lane that builds a DB tool needs a real-engine
   sandbox receipt before any operator-facing step ([references/verify.md](references/verify.md)). Same failure twice -> name the doubtful assumption to Nour.
7. **Probe it yourself.** For any guard, gate, hook, validator or parser, run your OWN adversarial probes against the REAL
   binary, never only the lane's canaries: every numeric cap at cap-1, cap, cap+1 and with the bad item last, plus the
   `guard-red-team` classes. Send each bypass back as the exact input. [references/verify.md](references/verify.md)
8. **Check the names.** Any list a rule relies on (tool names, permission rules, env vars, rule ids, file or skill names) is
   resolved entry by entry against the live source, never by its author. Tool names: you run `ToolSearch select:` yourself
   (`lane-research` has no ToolSearch). Paths, PR numbers, flags, env vars, rule ids: a read-only `lane-research` agent. A
   mistyped native permission rule is a silent no-op. [references/verify.md](references/verify.md)
9. **Read the primary source.** A decision-critical external fact gets a short quote YOU read from the primary page, with URL
   and date, labelled FACT, STRONG INFERENCE or CLAIM. An agent's "not documented" is a CLAIM until you search the page.
   [references/verify.md](references/verify.md)
10. **Review before the PR opens.** Lenses find, skeptics try to refute each finding: `.claude/workflows/adversarial-review.js`
    (needs Nour's workflow opt-in; without it, the same lenses as `lane-research` calls, at most 2 at a time because they count
    toward the heavy-run limit, with any lens that must run code given to a `general-purpose` agent whose scratch is the OS temp dir only).
    [references/review-and-merge.md](references/review-and-merge.md)
11. **Integrate.** One integration branch, one PR per coherent job (`AGENTS.md` > Branching). Combine the lane commits there
    (lane commits can sit on an older main: cherry-pick them onto current origin/main, do not diff against it) and run the affected
    gates ON THE COMBINED TREE; lane greens do not prove the merge works. Prefer one push. A job that adds
    a skill also runs `skill-forge`'s `check <dir> --git`, and one that rewrites a skill's description `check <dir> --existing --git`,
    on the branch before the squash erases the commit order (a wording change inside a skill's body is exempt: edit it directly).
    Protected operations stop here with the exact one-liner for Nour.
12. **Consumer check.** Anything that enforces: prove the real consumer applies it, in a FRESH session (`assert-the-consumer`).
    Hooks and permission rules load from the PRIMARY checkout's settings, not a worktree's: test them after the primary has the change
    and confirm which settings the session loaded before blaming the change. Not reached -> the row says `tested, not live`, with an
    owner and a date. [references/verify.md](references/verify.md)
13. **Merge.** Only when authorized (Nour's word, a pasted-report job, or a docs-only PR; skill and policy edits wait for him):
    `node scripts/agent-os/merge-gate.mjs <pr> --sha <head you verified> --merge` pins the head, re-verifies every condition in
    the same process, holds while another PR has node or e2e in flight, and deletes the branch only after MERGED.
    [references/review-and-merge.md](references/review-and-merge.md)
14. **Report** with `.agents/core/templates/completion-report.md`, one line per lane, labels kept, and the highest evidence
    rung reached. Merge is not deploy: report live verification separately (nickstire `/api/health` `.deploy.commit`,
    statenour heartbeat).
15. **Log and learn.** Add `docs/agent-os/ledger/<job-id>.md` in the SAME PR: the job's ledger row as `MERGED` with PR cell
    `this PR` (never `pending`) and its metrics row under it; one file per job, so no sibling PR conflicts with it.
    A lesson repeated in an earlier row, or one severe incident, ->
    `session-observer` proposal in `docs/skill-proposals.md`. Proposals only; Nour approves skill and policy edits. Never edit
    evaluators or guards to make a job pass. [references/ledger-and-metrics.md](references/ledger-and-metrics.md)

## Cancel

"stop" / "cancel": stop dispatching, mark the row CANCELLED, ignore late lane results for that job.
