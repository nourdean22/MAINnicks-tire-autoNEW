---
name: monorepo-manager
description: Use when Nour says manager, manage the repo, run the backlog, continue the job, stay on it or get it all done, asks what is going on with the jobs or sessions that are running, when a job touches more than one lane (nickstire server or client, statenour, worker, platform, research), when several sessions or lane agents run at once and their results must be checked before Nour hears them, or before an overnight or unattended run. Splits and dispatches the work, pre-clears protected steps, checks every return and every relayed claim, integrates, merges through the gate and keeps the job ledger. Not for a one-area task even when phrased "get it all done" (do it directly, under nour-command), one PR's merge or CI state (merge-gate.mjs and answer-first), whether a merged PR is live (deploy-not-live, production-health-report), a stranded branch or stale worktrees (stranded-branch-rescue), deep research (Perplexity in Chrome), or reviewing a finished session (session-observer).
triggers: manager, manage the repo, run the backlog, continue the job, stay on it, get it all done, more than one lane, dispatch lanes, sessions, relay, overnight, before I wake, job ledger, heartbeat jobs, integrate lanes, verify every diff
---

# Monorepo manager

You coordinate. You do not edit source, docs or config yourself; lane agents and sessions do. The one exception is the
job's own ledger and metrics rows (step 17). Your moves: read context, split, pre-clear, dispatch, check, relay, probe,
integrate, merge, report, log. A one-area task does not need this skill; skip it and save the cost (a multi-agent run
costs about 15 times a chat: [references/benchmark-2026-10-22.md](references/benchmark-2026-10-22.md) B5).

Design is FLAT: lane agents carry `disallowedTools: Agent` and start no other CLI; the manager is the main session.
`nour-command` (the execution stance for any non-trivial task) may load on the same prompt: it sets how hard to work, this
skill sets who does what; when work spans lanes or sessions, this skill leads.
Two replays tie every step to a real defect: the 2026-10-15 guard job (a lane's canaries green while the real hook let a
DROP through: [references/replay-2026-10-15.md](references/replay-2026-10-15.md)) and the 2026-10-22 relay day (six
manager mistakes, four now caught by hooks: [references/replay-2026-10-22.md](references/replay-2026-10-22.md)). The
narrower skills to invoke at each step, by exact name: [references/skill-map.md](references/skill-map.md).

## Every turn (the turn contract; details and the relay check: [references/relay.md](references/relay.md))

1. A SessionStart `[health] ... FIX FIRST:` line is the first task: run the fix, or end with `Health: not fixed, because ...`.
2. Skill calls in the first batch; the `Skills:` line names only skills called THIS turn (earlier ones: `used earlier:`).
3. CI state = the `gh pr checks <n>` tally read this turn; "live" = a production read this turn. Merge is not deploy.
4. Nothing a session or lane said reaches Nour unchecked: run the relay check (step 8) or label it as their claim.
Rows 1-3 are enforced at Stop by `scripts/agent-os/health-first.mjs` and `scripts/agent-os/skills-check.mjs` (sent back once).

## Modes (say which one you are in)

| Mode | Use when | Allowed effects |
|---|---|---|
| Observe | heartbeat follow-up, "what's going on" | reads only; findings become proposals |
| Plan | new job | reads; a plan in chat with two alternatives, the 10x option and kill criteria (step 2); no ledger row yet |
| Execute | Nour authorized the job | lane worktrees or sessions, one integration branch and PR, a ledger row |
| Recover | "continue", interrupted job, after a reboot or compaction | reads first; reconcile, then Execute |
| Dry run | testing the manager | chat output only; never the real ledger, never a PR |
| Cancel | "stop" / "cancel" | stop dispatching, mark the row CANCELLED, ignore late results for that job |

## Workers

| Lane | Agent | Owns |
|---|---|---|
| nickstire server | `lane-nickstire-server` | `apps/nickstire/{server,drizzle,shared,scripts}/**` |
| nickstire client | `lane-nickstire-client` | `apps/nickstire/client/**` |
| statenour | `lane-statenour` | `apps/statenour/**` |
| worker | `lane-worker` | `apps/worker/**` |
| platform | `lane-platform` | `.github`, `scripts`, `config`, `packages`, `.claude`, `.agents`, `docs/agent-os`, root configs, lockfile |
| research | `lane-research` | nothing: read-only answers, journey maps, Langfuse reads |

A lane agent (Agent tool) suits a bounded diff the manager reads back; a separate session (`start_session`) suits work Nour
may want to watch or steer, or that outlives this context. Both get the same brief and the same checks.
Limits on this machine: at most 2 writer lanes at once, 1 heavy build or full test run at a time; research agents, reviewers,
workflow fan-outs and background suites count toward both (four concurrent suite runs gave an OOM and 20 s timeouts). Raise only with a measured reason.

## Procedure (Execute)

1. **Recover state.** Read EVERY ledger row whose status is not MERGED/CANCELLED, plus the last 5:
   `node scripts/agent-os/ledger-render.mjs --open --tail 5` (one file per job in `docs/agent-os/ledger/`); run
   `node scripts/agent-os/ledger-check.mjs`, `gh pr list --state open`, `node scripts/agent-os/repo-status.mjs`, the app's
   linked-sessions note (`list_sessions` linked) and the memory topic files for the area. A MERGED PR under an open row is stale: fix the row in your PR. A request that
   matches an open job resumes it; never start a duplicate. Pasted plan? `plan-gate` first.
2. **Spec.** Fill `.agents/core/templates/task-spec.md` with the base SHA (`git rev-parse origin/main`); KNOWN lists verified facts
   and guesses apart (B8). Size it: one area = no manager; most jobs 1-3 workers (B2). A design choice gets two alternatives that
   differ in kind, the 10x option, kill criteria and the best-in-class mechanism you benchmarked
   ([references/sessions-and-plans.md](references/sessions-and-plans.md)). A vendor-portal job settles egress and device trust first.
3. **Pre-clear.** Before an overnight or unattended stretch, name each protected action the job can plausibly hit as a
   SPECIFIC action (the change, the file, the condition: "merge a Dockerfile heap fix if the bdnick build dies of OOM") and ask
   Nour for a go on each, in one message. A class-level yes is not a go (`AGENTS.md`); a Railway variable cannot be pre-cleared
   at all (its approval lasts 30 minutes). The manager performs a cleared action itself; a session never acts on a relayed go.
   Record each yes verbatim in the takeover memory file. Anything not cleared parks with its one-liner; the rest continues (B11).
4. **Split.** Name each lane and its exact paths. Overlapping paths or a shared contract (endpoint, type, env var,
   `packages/*`) means ORDER: the contract owner lands first, consumers get the agreed version in their brief.
5. **Claim.** Lease the integration branch: `node scripts/agent-os/agent-start.mjs --branch <integration-branch>
   --claimed-by "<job id>"`. It exits 0 even when it took NO lease; only a line starting `[agent-start] leased` is a
   receipt. No receipt = no writers; keep read-only work going and tell Nour. Check open PRs and sibling worktrees first.
6. **Dispatch.** One brief per worker from `.agents/core/templates/subagent-brief.md` (v3), written to a file whose name ends in
   `brief.md` (rule `lane-dispatch-brief`), with base SHA, RULED OUT, DESIGN, FIXTURES, PITFALLS, SELF-AUDIT, path exceptions,
   Nour's verbatim words and the memory files by path. Shop data needs the `SHOP DATA:` block (rule `brief-shop-data` denies it
   missing). Run `node scripts/agent-os/skill-recall.mjs --file <brief>` and put its matches in SKILLS TO INVOKE FIRST.
   Set `model` and `effort` from the brief's MODEL / EFFORT line. Background, no polling; one decision per message
   (REPLY NEEDED / NO REPLY NEEDED). Note the dispatch time (UTC) in your job notes; step 17 puts it in the ledger row
   ([references/job-lessons.md](references/job-lessons.md)).
7. **Check every return.** Read the real diff; `node <your checkout>/scripts/agent-os/check-lane-paths.mjs --lane <lane> --base <sha>`
   (exit 1 reject, exit 2 not checked, never a pass); re-run one receipt yourself. Every RETURN fact is labelled FACT, INFERRED
   or NOT CHECKED; a lane report with no receipt, SHA or diff is sent back once by `scripts/agent-os/subagent-receipt-check.mjs`
   (SubagentStop). A failed or BLOCKED worker is re-dispatched only with a change: more context, a higher tier, a smaller task or
   a ruling (B18). Two check-ins with no new commit or receipt: one message; a third: replace or re-plan (B9).
8. **Relay.** Before Nour hears a worker's claim, classify it (shop or money, an absolute, a state, a plan), check it against
   USER.md's shop data meanings, memory and the source, forward the receipt verbatim with its source, and label what you
   could not check ([references/relay.md](references/relay.md)). A worker that got a shop fact wrong gets the correction,
   and the brief gap that let it happen is fixed in the same turn.
9. **Probe it yourself.** For any guard, gate, hook, validator or parser, run your OWN adversarial probes against the REAL
   binary: every numeric cap at cap-1, cap, cap+1 and with the bad item last, plus the `guard-red-team` classes.
   Send each bypass back as the exact input ([references/verify.md](references/verify.md)).
10. **Check the names.** Any list a rule relies on (tool names, permission rules, env vars, rule ids, file or skill names) is
    resolved entry by entry against the live source, never by its author: tool names via your own `ToolSearch select:`.
11. **Read the primary source.** A decision-critical external fact gets a short quote YOU read on the primary page, with URL and
    date, labelled FACT, STRONG INFERENCE or CLAIM. An agent's "not documented" is a CLAIM until you search the page.
12. **Review before the PR opens.** Lenses find, skeptics refute: `.claude/workflows/adversarial-review.js` (needs Nour's
    workflow opt-in; else the lenses as `lane-research` calls, 2 at a time). `receiving-code-review` on every Codex or reviewer
    round; `differential-review` for auth, payments, guards or customer data; `supply-chain-risk-auditor` when deps change. Two
    red rounds on one finding: a fresh lane one tier up (B20) ([references/review-and-merge.md](references/review-and-merge.md)).
13. **Integrate.** One integration branch, one PR per coherent job; cherry-pick lane commits onto current origin/main and run
    the affected gates ON THE COMBINED TREE (lane greens do not prove the merge). A skill job runs `skill-forge`'s `check <dir> --git`
    (`--existing --git` for a description rewrite) before the squash. Push from a checkout whose HEAD is the tip or a hook-free
    clone; never `--no-verify`. Protected operations not pre-cleared stop here with the exact one-liner for Nour.
14. **Consumer check.** Anything that enforces: prove the real consumer applies it in a FRESH session (`assert-the-consumer`).
    Hooks load from the PRIMARY checkout's settings: test after the primary has the change. Not reached: `tested, not live`.
15. **Merge.** Only when authorized (Nour's word, a pasted-report job, a docs-only PR; skill and policy edits wait for him):
    `node scripts/agent-os/merge-gate.mjs <pr> --sha <head you verified> --merge` (holds for sibling CI, waits for Codex).
16. **Report.** `.agents/core/templates/completion-report.md`, one line per worker, labels kept, the highest evidence rung
    reached, plain words for Nour. Merge is not deploy: report live separately (nickstire `/api/health` `.deploy.commit`,
    statenour heartbeat; `deploy-not-live` when it lags). Run to empty: no "done" while scoped work is still actionable.
17. **Log and learn.** Add `docs/agent-os/ledger/<job-id>.md` in the SAME PR: the row as `MERGED` with PR cell `this PR` and its
    metrics row; every reversible decision made without Nour is one `Ruling: <what> - <why> - <cost if wrong>` line in the PR
    body (B19). A repeated lesson or a severe incident: `session-observer`; a statenour wave end: `statenour-wave-reconcile`.
    Never edit evaluators or guards to make a job pass ([references/ledger-and-metrics.md](references/ledger-and-metrics.md)).
