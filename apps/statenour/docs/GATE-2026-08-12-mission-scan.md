# GATE — 2026-08-12 MISSION Scan (bdnick.info "attention compiler")

Gated per `plan-gate`. Scan: 8 ranked findings (BDN-001..008 in
`docs/MISSION-CALIBRATION-LEDGER.md`), proposing a `NOW → DECIDE → EXECUTE →
REFLECT → TRUST` re-composition of the app. **Verdict: ~75% incumbent.** The
scan *observes* accurately (better than most prior external plans — it
self-flagged kill shots and admitted its fallback runtime), but most
prescriptions re-derive shipped work. One kill shot was CONFIRMED by probe,
one surgical defect was fixed, five genuinely-new slivers are registered as
work packages below.

## Already built (with receipts)

- **The four-question decision Home** — `components/home/home-console.tsx`
  header comment: 2026-07-25 Home consolidation, audit P1,
  **operator-approved scope**. Q1 health chip · Q2 decide
  (FollowUpsList + ProposedCommitments) · Q3 do-now (ExecutiveActionMatrix)
  · Q4 since-last-visit. The scan's NOW lane exists: the matrix synthesizes
  ONE briefing — the `ACTIVE ENGAGEMENT` branch is already a precise
  resumption cue for the active task.
- **Lifecycle-verb navigation** — `components/layout/nav-items.ts` is the
  single nav source (2026-06-18 IA reorg), sectioned
  capture→execute→reflect→money→operate; the More sheet renders the loop
  with ordinal badges (#1526, **shipped and prod-verified the same day as
  the scan**). The scan's "mixed taxonomy" critique reads the designed
  4-daily-tabs + verb-sections model as drift it isn't.
- **Metric-role separation** — `home-health-chip.tsx` `homeHealthState()`
  already enforces measured/unknown/degraded/broken; "SYSTEM · not yet
  measured" is the deliberate honest-unknown state (2026-08-04 false-green
  sweep), not a data-quality accident. NICK /100 is the pulse ticker's
  promise-integrity score, fixed for staleness in #1524.
- **Trust-ladder data model (half of it)** — `ApprovalRequest` already
  carries `riskClass` + `expiresAt` (schema:2838); the approvals surface is
  `/system/actions`. Receipts substrate: `ActionReceipt`
  (verificationPayload + sourceSystem + missionId), entity-audit,
  intelligence_outcomes ledger, brain-continuity. Duplication across
  activity surfaces is already registered in
  `docs/project/ORGANIZATION-WIRING-AUDIT.md`.
- **Journal → commitment chain** — WP-16: journal nextActions become
  `status="proposed"` commitments with sourceRef idempotency; accept/dismiss
  verdicts durable; outcome capture exists via the pulse-ticker resolve flow
  (`completeActiveCommitment`/`abandonActiveCommitment`).
- **Progressive-disclosure doctrine** — loading-skeleton / failure-renders-
  as-FAILURE / measured-zero-renders-nothing is the standing house contract
  on every Home card.

## Probe receipt — BDN-002 kill shot CONFIRMED

`scripts/probe-approval-queue-census.ts` (read-only, host printed:
`ep-quiet-wave-am320eo1-pooler...neon.tech`), run 2026-08-12:

- `approval_requests` pending_approval: **0** (2 failed rows total).
- The live "468" is **entirely `autonomous_action` approval="pending"**:
  468 rows · ages: 266 at 30-90d, 158 at 7-30d, 37 at 1-7d, 7 <1d ·
  by rule: memory_promotion 145, decision_replay_due 138,
  nick_action_archive_mission 63, nick_action_commit_journal 56,
  task_overload_alert 29, others ≤16.
- Same shape as the 179-commitment backlog (#1528): a machine-proposal
  queue with **no expiry and no sweep**. `approval_requests` has
  `expiresAt`; `autonomous_action` does not.

**Consequence:** do NOT build trust-ladder UI on this queue first. Queue
hygiene + an expiry/sweep design come first, and the bulk mutation is
**operator-authorization-only** (precedent: #1528).

## Shipped this session

- `components/home/home-identity-header.tsx` — "SYSTEMS OPTIMAL" was a
  health claim derived from queue counts alone: it ignored the Captures
  queue, could contradict HomeHealthChip on the same screen, and defaulted
  to green while queries were still loading. Now "QUEUES CLEAR", rendered
  only when all four queue queries have answered and all counts are zero.
- `scripts/probe-approval-queue-census.ts` — the reusable census probe.
- `docs/MISSION-CALIBRATION-LEDGER.md` — the persistent ledger the scan
  looked for and couldn't find; verdicts recorded there per BDN ID.

## Genuinely new — registered work packages (design review before build)

1. **WP: compact Home mode** (BDN-001/008) — flag-gated summary-first
   composition: decide lane capped at 3 + "view all", resume cue when no
   active engagement, existing queries only. Re-scopes an
   operator-approved composition → needs operator verdict on the default.
2. **WP: autonomous_action queue hygiene + expiry** (BDN-002) —
   **hygiene EXECUTED same day** (operator: "clean up the 468 queue").
   Gate-within-the-gate: the planned bespoke mutation was itself ~90%
   incumbent — `lib/system/stale-data-purger.ts` `purgePendingActions()`
   already encodes the exact policy (pending >7d → rejected/auto-purge)
   but is operator-tap-only, which is how the backlog grew. Executed via
   plan/execute scripts wrapping `purgeStaleCategory("pending_actions_7d")`:
   468 → 44 pending (424 flipped, reversible; receipts
   `docs/APPROVAL-QUEUE-CLEANUP-{PLAN,EXECUTED}-2026-08-12.json`; census
   re-run confirms 44, all ≤7d). **Sweep SCHEDULED same day**
   (operator: "schedule the purger"): the nightly `data-cleanup` cron
   now delegates to `purgeStaleCategory("pending_actions_7d")` — one
   policy, two callers (UI tap + cron); producer pinned incl. fail-loud
   by `tests/cron/data-cleanup-pending-actions.test.ts`. **Producers
   inspected same day — see the addendum below.**

## Addendum — producer inspection (2026-08-12, `probe-producer-rates.ts`)

The backlog was never hundreds of distinct proposals — it was a
**deferred-action deadlock** nagging nightly:

- **Mechanism (code-read, then prod-verified):** both rules declare
  `approval:"auto"`, but the engine is fail-closed
  (`autonomous-engine.ts:1069`) — with **no AutomationPolicy row** a rule
  defers to the queue instead of executing. Probe: policies for the two
  rules = **NONE** (98 `auto` policies exist for other rules). The
  deferred action never runs → the trigger condition never clears → the
  24h per-target cooldown mints ONE new pending row per stuck target per
  night, forever.
- **decision_replay_due = 3 decisions × 76 nights.** 228 rows ever from
  **3 distinct targets** (76 rows each). Its action is only a Telegram
  nag; the `reviewed` flag it waits on flips on the /decisions replay
  surface, which nobody visited. Current pressure: 9 unreviewed+due
  replays, oldest due since 2026-04-25; `take:3` caps it at 3 rows/night.
- **memory_promotion is structurally jammed.** 431 rows / 221 targets;
  **501 candidates** above its threshold (seenCount≥5, conf≥0.6) — top
  candidates are `nick_advice`/`system_alert`/`mastery_xp_event` rows with
  seenCount in the THOUSANDS (max 6,516) at confidence 1. Its two quality
  gates (wisdom dupe-guard + wisdom-quality-gate) and its convergence
  mechanism (drop confidence on skip) all live INSIDE the action — the
  rule was written self-limiting-by-execution before fail-closed gating
  existed, so deferral disables its own brakes.
- **Steady state today:** ~6-7 new pending rows/night engine-wide,
  auto-purged at 7d by the nightly sweep → queue floats around ~44, but
  the SAME stuck items cycle through it until acted on at the source.

**Operator decision menu (autonomy changes — never agent-initiative):**
1. Review or dismiss the 9 due decision replays (kills that producer's
   pressure at the source), and/or seed an `auto` policy for
   `decision_replay_due` — its action is exactly the nightly Telegram
   reminder it was designed to be.
2. Seed an `auto` policy for `memory_promotion` — the action is
   non-messaging (one Telegram per successful promotion), double-gated,
   and drains the 501-candidate pool at ≤3/night; without it the rule
   proposes forever.
3. Or mark either rule `forbidden` if its output isn't wanted — the
   engine then closes rows as `forbidden_by_policy` instead of parking
   them.
3. **WP: merged receipts timeline shell** (BDN-003) — read-only merge of
   entity-audit + action receipts in /system or /brain/continuity; typed
   adapters, no schema. ORGANIZATION-WIRING-AUDIT is the input.
4. **WP: contextual Nick chips** (BDN-004) — 2-3 source-local actions per
   primary surface over the existing PageContextBridge. MED conviction.
5. **WP: journal take outcome line** (BDN-007) — per-take
   captured→proposed→accepted→outcome state line on the existing card.

## Refuted / corrected

- "Nav teaches two organizational theories at once" — half-stale; the verb
  model is the operator's real loop (nav-items.ts comment) and #1526 had
  already promoted it visually. Demoting Money contradicts that loop.
- "Interface makes the operator perform the prioritization" — overstated;
  the matrix already computes one briefing + top-3 asymmetric targets.
- "Score presented as system health" — the separation exists; the one real
  conflation ("SYSTEMS OPTIMAL") is fixed above.
- "468 PENDING" as an approvals-legibility problem — it's a dead-queue
  hygiene problem; the approvals gate the scan wanted enriched is empty.
