# GATE — 2026-08-12 "RETROFIT BUILD PASS" (23rd gated plan)

An 8-phase unattended execution plan arrived hours after the MISSION-scan
arc (#1535-#1540) shipped. Gated per `plan-gate` — its own Phase 0 rule
("evidence that a phase already exists → extend, note, continue") is the
gate's mandate, applied before running anything. **Verdict: ~85%
incumbent or refuted.** Its "do not stop between phases" directive is
overridden by standing repo policy; nothing was executed except the
read-only diagnostic its own Phase 1 demanded.

## The thesis fact is dead — probe receipt

Plan: "a brain-bus event system that has accumulated 393 pending events
with zero consumers since late May 2026" (Phase 0 assumption; Phases 1+3
are built on it as "the single highest-leverage move").

- The 393 figure (task.completed 184 · brain_dump.finalized 161 ·
  cron.failure 23 · score.logged 20) is the **pre-revival snapshot quoted
  verbatim in `config/crons.ts:474-480`** — the state that ended
  2026-07-28 when `brain-bus-drain` shipped (every 15 min via the worker,
  handler registry → BrainMemory; durable-consumer tests in
  `tests/db/brain-bus-durable.test.ts`). The 2026-08-10 gate (#1481 memo)
  already refuted the same claim in plan #12.
- **Live probe 2026-08-12 (`scripts/probe-brain-bus-census.ts`,
  read-only, host printed): `done: 1558 · pending: 0` — most recent event
  processed `2026-08-12T18:45:01Z`.** The queue is drained to within its
  cron cadence. Phase 1's verdict, executed: nothing to triage, nothing
  to quarantine, no consumer to build.

## Per-phase verdicts

| Phase | Verdict | Receipt |
|---|---|---|
| 0 Discovery | **DONE — refutes the plan's own premises** | `THE-BRIEF.md` does not exist anywhere in the repo (glob-verified) — Phase 4's mandatory vocabulary source is a phantom. The "two duplicated activity surfaces" were consolidated TODAY (#1539, ReceiptsTimeline per ORGANIZATION-WIRING-AUDIT). HomeConsole is the operator-approved four-question page, compacted today. |
| 1 Queue diagnostic | **EXECUTED · queue healthy** | Probe above. |
| 2 Route renames + lifecycle vocabulary | **REJECT** | BDN-005 was refuted-in-part this morning: nav is already single-source verb-sectioned (capture/execute/reflect/money/operate, #1526 prod-verified) and the sections ARE the operator's real loop. Renaming ~36 muscle-memorized routes of a daily-use PWA is the exact churn the first gate declined; findability test remains WATCH. |
| 3 First consumer + unified ledger + Now/Decide/Resume Home | **NATIVE / shipped today** | Consumer: `brain-bus-drain` (live since 07-28). Unified ledger: `components/brain/receipts-timeline.tsx` (#1539, 3-source typed-adapter projection). Now/Decide/Resume: #1539 compact Home (briefing = NOW, capped Decide lane, resume branch). An event-sourced parallel Home would be a second system beside a live one. |
| 4 Evidence-tier + confidence tagging | **WATCH → WP** | The idea survives; the plan's execution path doesn't: its vocabulary source is phantom, the columns need a hand-applied migration (statenour policy), and the LLM-suggested default is a per-save model call against the $0-incremental doctrine. WP: operator names the real vocabulary source; nullable columns via `statenour-migration`; suggestion default only on an existing funded lane. |
| 5 Resilience-over-streak momentum | **WATCH → WP (premise unverified)** | Nobody has shown a reset-to-zero-on-miss in the live code; streak surfaces span Task.streakCount, the pulse ticker, and xp-decay (operator-decided loss-aversion design, #1476-era). Changing computed history needs its own audit + operator sign-off on semantics — "never miss twice" may fight the deliberately-chosen decay model. |
| 6 Per-type trust ladder (Audit/Assist/Automate) | **NATIVE** | `AutomationPolicy.approvalClass` (pending/auto/forbidden) IS the per-type ladder — live, 98 `auto` policies, fail-closed default (= "Audit"). The plan's stretch goal (auto-promotion after N successes) ALREADY EXISTS: `lib/ai/confidence-tier.ts` `canAutoExecute` promotes on operator-acceptance rate. The real open item is the #1538 deferred-action deadlock decision menu — operator's call, not a second vocabulary. |
| 7 In-context Nick (suggest-only) | **NATIVE / shipped today + WP leftover** | The propose→review→approve affordance IS the autonomous-action queue. 13 in-context entry points were re-wired today (#1539/#1540) incl. the context lane end-to-end. Remaining sliver: mount the existing `PageNick` inline component (today only on /knowledge) on more surfaces — the standing BDN-004 WP. |
| 8 Three-tier alerts + unknown state | **NATIVE** | `homeHealthState()` has exactly unknown/healthy/degraded/broken with honest-unknown ("not yet measured") since 2026-07-25/08-04, and the header's queue badge became measured-only today (#1535). |

## Genuinely new — registered, not built (design review first)

1. **WP: evidence-tier + confidence fields** on proposals/journal —
   blocked on the operator naming the real vocabulary source (THE-BRIEF
   does not exist) and on migration design. No per-save LLM spend.
2. **WP: streak-semantics audit** — first verify where (if anywhere) a
   miss resets to zero, then the operator picks between "never miss
   twice" and the existing loss-aversion decay. Historical data preserved
   either way.
3. **WP: PageNick mounts** on Journal/Missions/Business/System (carried
   over from BDN-004).

## Note for the next plan author

Three plans in one day now share the same failure shape: a thesis fact
lifted from a historical snapshot (the 393), a phantom prerequisite
(THE-BRIEF.md), and prescriptions for surfaces that shipped the same
morning. The calibration ledger (`MISSION-CALIBRATION-LEDGER.md`) and
the trailing week of `git log` are the two reads that would have caught
all of it before writing a single phase.
