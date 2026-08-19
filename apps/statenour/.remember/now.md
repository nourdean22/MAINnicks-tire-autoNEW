# NOUR OS — Session Buffer

**Updated: 2026-08-19** · Five fields, nothing else. If the SessionStart briefing
reports this file as stale, distrust everything below it and re-derive from source.

> **Maintenance contract.** This is agent-maintained. Update the five fields at the
> end of any session that changes the answer — it costs four lines. It went
> **114 days** without an update (2026-04-18 → 2026-08-10) and in that time became
> a source of two false beliefs, so the SessionStart hook now prints its age.
> An inventory you cannot verify is worse than no inventory: **delete, don't carry.**

## Current objective
Memory-truth wave SHIPPED as #1716 (2026-08-19, remote session; delivered via
GitHub API after the container lost push creds — honest attention labels off
the real seen_count column, telemetry quarantined from BOTH recall lanes via
one policy list, chat capture stamps conversationId + fans decisions/insights
into recall; two of the audit's own claims died under re-measurement first).
Same day: outcome-loop wave (twentieth) SHIPPED across #1711/#1714/#1715/#1718,
same session as the architecture-reimagine wave (nineteenth; canonical record
`docs/REIMAGINE-VERDICT-2026-08-19.md`). What landed: the intelligence ledger's
usefulness half is LIVE (recordOutcomeByContent contentHash bridge; rateDiscovery
"noise" = first writer; first-write-wins CAS at the update itself) · task
completion TEACHES — /missions completion opens the outcome dialog (#1714;
verified live on prod; the todo-desk first cut was UNMOUNTED dead code;
recurring loops never prompt, dismissal completes UNRATED per fatigue
literature), transported taskUpdateSchema → updateTask delegation →
checkTask, RATING_MULTIPLIER scales the auto-learn bump,
outcomeLesson becomes an embedded `task_lesson` BrainMemory, rating lands the
ledger outcome by title hash · reasoning conclusions re-enter recall (embedded
`reasoning_conclusion`, 90d TTL; budget stays honest — exact-category match
verified) · provenance categories excluded from nightly consolidation
(`reasoning_trace` merges were silently uncounting the $1/day budget).
Full entry: RECONCILIATION top.

## Last material decision
The 3-lens adversarial review caught the wave's own P0: the first cut was
BUILT-TESTED-UNWIRED — both new engines consumed Task.outcomeRating/outcomeLesson,
which had ZERO producers anywhere (no UI ever sent them; the "captured by the
completion UI" premise was false). The review round ADDED the producer (outcome
dialog + full PATCH transport), not just polish. Standing rule confirmed again:
grep for PRODUCERS of a column before building its consumer, and treat "the
columns exist" as evidence of nothing. Also: recordOutcome now carries the same
CAS guard as recordDecision — a SELECT-scoped filter alone leaves a two-stale-tabs
TOCTOU that can poison the recall-eval harvest.

## Known failed approaches
- **Consuming columns without a producer census (this wave, caught pre-merge).**
  `outcomeRating`/`outcomeLesson` existed in schema + checkTask + router zod for
  weeks — none of that means anything writes them.
- **Rebasing this branch onto main after #1698 — 8-commit replay conflicts.**
  Main mirrored the branch's own earlier state; merge (ours) was correct.
- **"git globs `[id]` like PowerShell does" — false.** `git ls-files` measures.
- **Counting raw mocked-model calls while the Phase-1 gateway is live — spills.**
  Assert through a category filter, never raw counts (#1532).

## Active blocker
**Operator actions:** ① legacy `manualPriorityOverride` census RAN 2026-08-19 —
exactly 1 row (DONE task "Get truck plates", override 15), verdict NO REMAP
NEEDED (skews only computeRiskAppetite's 21d window; self-expires 2026-09-08).
② The primary checkout remains on `session-end`, dirty. ③ Anthropic spend
authorization for the model bake-off (Ollama Cloud still the one funded lane).

## Next action
Remaining spine from REIMAGINE-VERDICT "Highest-leverage next moves" (① outcome
loop = DONE this wave): ② Commitment.status canonical vocabulary +
promise_integrity expired/in_progress fixes; ③ shared "open task" + "done today"
predicates (same treatment as the polarity fix); ④ Home progressive loading
(httpBatchStreamLink, bound task.list, visibility-gate the raw pollers); ⑤ one
status-tone module + 15 phantom-token repair + `--font-mono` bridge line.
Natural next producers for the outcome loop: execution-coach sandbox reflection
flow, missions one-tap. Flagged rot: consolidation merge never re-embeds the
keeper (stale-vector mismatch, every embedded category).
