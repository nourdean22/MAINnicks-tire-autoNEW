# NOUR OS — Session Buffer

**Updated: 2026-08-20** · Five fields, nothing else. If the SessionStart briefing
reports this file as stale, distrust everything below it and re-derive from source.

> **Maintenance contract.** This is agent-maintained. Update the five fields at the
> end of any session that changes the answer — it costs four lines. It went
> **114 days** without an update (2026-04-18 → 2026-08-10) and in that time became
> a source of two false beliefs, so the SessionStart hook now prints its age.
> An inventory you cannot verify is worse than no inventory: **delete, don't carry.**

## Current objective
Memory-loop wave SHIPPED 2026-08-20 (one PR): ① the conversation compiler was
never starved — its output was EATEN (prod-measured: 283 conversations → 15
live summaries vs 158 soft-deleted by the nightly merge grinder; category now
consolidation-excluded, freshness guard replaces one-shot-forever, recompiles
REVIVE ground rows, nightly conversation-compile cron) · ② memory receipts
(turns persist recall into tokenUsage.recall; provenance answers receipt-first,
labeled receipt vs reconstruction) · ③ Backfill Studio lite on /brain health
(corpus = live DB; messageCount backfilled on prod — 45 drifted rows) · ④ first
temporal recall-eval cases + INSIGHT registry gap closed. Prior: memory-truth
wave #1716 (+#1719 reconcile), outcome-loop wave #1711/#1714/#1715/#1718,
architecture-reimagine wave (`docs/REIMAGINE-VERDICT-2026-08-19.md`).
Full entries: RECONCILIATION top.

## Last material decision
Measurement-first, again vindicated twice in one wave: ① the "compiler
starvation" theory died under a prod probe — the compiler RAN (125 digest
audits); the nightly merge grinder ATE its output (158 soft-deleted vs 15
live). ② The reviewer's SQL-eligibility fix would have silently excluded 5
conversations because the denormalized messageCount LIED (worst: counter=1,
real=15) — probed first, backfilled 45 drifted rows, re-probed to 0 liars,
THEN shipped the filter. Standing rule: when a counter/column is about to
become a WHERE clause, measure its truthfulness first. Also: self-audit
caught the sweep counting zero-write nights as "10 compiled" (void-return
all-clear-on-failure) hours after writing it — statuses now truthful.

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
Remaining spine from REIMAGINE-VERDICT (outcome loop + memory loop both DONE):
② Commitment.status canonical vocabulary + promise_integrity fixes; ③ shared
"open task" + "done today" predicates; ④ Home progressive loading
(httpBatchStreamLink, bound task.list, visibility-gate the raw pollers); ⑤ one
status-tone module + phantom-token repair. Memory-loop follow-ups: tap the
studio's "compile next 10" a few times (or let the nightly cron drain ~10/night)
to backfill the 283-conversation corpus; writer-side computeExpiresAt for
fan-out rows; consolidation merge still never re-embeds the keeper. Outcome-loop
follow-ups: sandbox reflection + missions one-tap as next rating producers.
