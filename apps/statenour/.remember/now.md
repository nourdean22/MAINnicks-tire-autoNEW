# NOUR OS — Session Buffer

**Updated: 2026-08-18** · Five fields, nothing else. If the SessionStart briefing
reports this file as stale, distrust everything below it and re-derive from source.

> **Maintenance contract.** This is agent-maintained. Update the five fields at the
> end of any session that changes the answer — it costs four lines. It went
> **114 days** without an update (2026-04-18 → 2026-08-10) and in that time became
> a source of two false beliefs, so the SessionStart hook now prints its age.
> An inventory you cannot verify is worse than no inventory: **delete, don't carry.**

## Current objective
Persona measurement arc COMPLETE — GATE-2026-08-14 fully executed, 13 PRs
(#1649-#1665, all content-verified on origin/main). Canonical record:
`docs/PERSONA-MEASUREMENT-ARC-2026-08-18.md` (PR chain, architecture, readouts +
caveats, runbook). Standing instruments now live: 8-axis judge (obedience/
nonSycophancy/calibration) · 14-scenario persona golden set
(`pnpm eval:live --filter=persona`, ~1c, suite mean 8.2 best) · harvest flywheel
(`pnpm harvest:persona`) · backfill (`pnpm backfill:persona`) · calibration
enforcer w/ k-sample (NICK_CALIBRATION_ENFORCER / NICK_CALIBRATION_K) ·
trajectory grader (trajectory_judgment rows) · catalog-claims verifier (in
pnpm test). Next candidates: yes-executes pending-offer state machine ·
one-shot-key expiry audit across other brain categories · Brier-evidence
accrual before any k-sample retune.

## Last material decision
Prompt prose is the WEAK lever, measured twice today: the retry regression
survived a verified-present prompt rule (1.1/10) and was fixed only by a
DETERMINISTIC re-delivery interceptor (5.1→10.0) — LLMs regenerate, never copy.
Same doctrine on calibration: the layer NEVER invents a probability (elicit →
validate through parseEstimative → honest notice on failure), and k-sample
dispersion may only DOWNGRADE stated confidence (first live fire: 40pt spread →
conf low). Composite semantics deliberately unchanged everywhere (mean-of-5,
pinned) to keep historical comparability. sideEffecting's scope = the field's
DOCUMENTED semantic (external state) — an invariant broader than the doc cried
wolf 26x and would have been excepted into blindness.

## Known failed approaches
- **Auto fast-forwarding the primary checkout from the scheduled sync — rejected as
  unsafe.** The primary sits on branch `session-end` with a dirty tree that may hold
  a sibling session's work. Fetch is safe; auto-merge is not.
- **"git globs `[id]` like PowerShell does" — false.** `git ls-files | xargs wc -l`
  remains the one trustworthy measure (see 2026-08-10 buffer for the full trap).
- **Trusting a pasted plan's own "VERIFIED" table — report A asserted "Prisma 7,
  verified via code read" against a catalog pinning `^6.3.1` (installed 6.19.3).**
  Re-derive even claims stamped verified by their author.
- **Counting raw mocked-model calls while the Phase-1 gateway is live — spills.**
  Shadow receipts ride the same `brainMemory.create`, unawaited, across
  `clearAllMocks`; assert through a category filter, never raw counts (#1532).

## Active blocker
**Operator actions:** ① the primary checkout (`C:\Users\nourd\NOURCITY`) remains on
`session-end`, behind `origin/main`, dirty — the daily graph rebuild indexes stale
truth; no script should resolve this. ② The 50-task fable/mythos/opus bake-off needs
Anthropic spend authorization + golden tasks pulled from real usage (prod reads) —
Ollama Cloud is still the one funded LLM lane (2026-07-22).

## Next action
DONE 2026-08-18 (sixteenth wave, 13 ships #1649-#1665): the full persona
measurement arc — see Current objective. STILL OWED / operator levers:
① first organic reply_judgment + trajectory_judgment rows accumulate from live
traffic — re-run `pnpm harvest:persona` after a week and curate anything new;
② `pnpm eval:live --filter=persona` is the pre/post instrument for ANY
prompt/routing change from now on (baseline table lives in the arc doc);
③ Brier flywheel: grade forecast outcomes as they resolve so the k-sample
numbers earn their empirical check; ④ yes-executes deterministic completion
(pending-offer state machine) is designed-not-built — own slice.
