# bdnick Mission Calibration Ledger

Persistent ledger for MISSION-scan findings. The 2026-08-12 scan reported "no
prior persistent calibration ledger was found" — this file closes that gap.
Next scan: read this FIRST, then `GATE-2026-08-12-mission-scan.md` for the
receipts behind each verdict. Statuses follow the calibration rules at the
bottom; gate vocabulary (`plan-gate` skill) applies.

## 2026-08-12 — first-run baseline, gated same day

| ID | Finding | Status after gate | Evidence / next check |
|---|---|---|---|
| BDN-001 | Home should compile attention into Now / Decide / Resume | **OPEN · PARTIAL (~70% incumbent)** | Home already IS the operator-approved four-question decision page (`home-console.tsx`, 2026-07-25); the matrix computes one briefing + active-engagement resume cue. Genuinely new: decide-lane cap (≤3), summary-first density, resume cue when idle. WP 1 — needs operator verdict before changing the Home default. |
| BDN-002 | Approval queue needs a trust ladder | **KILL SHOT CONFIRMED → HYGIENE EXECUTED 2026-08-12** | Probe: the 468 was 100% `autonomous_action` approval="pending", 90% older than 7d; the `approval_requests` gate is EMPTY (0 pending) and already carries riskClass+expiresAt. Operator-authorized cleanup ran the INCUMBENT purger (`purgeStaleCategory("pending_actions_7d")` — not a bespoke mutation): 468 → 44 pending (424 → rejected/auto-purge, reversible, ids in `APPROVAL-QUEUE-CLEANUP-PLAN-2026-08-12.json`). Census re-run confirms 44, all ≤7d. **Sweep SCHEDULED 2026-08-12 (operator: "schedule the purger"):** the nightly `data-cleanup` cron (mega-evening fan-out, 03:00 UTC) now delegates to the same incumbent purger — one policy, two callers; producer pinned by `tests/cron/data-cleanup-pending-actions.test.ts` incl. fail-loud. Steady state: a pending autonomous action gets 7 days of review then auto-rejects. Trust UI = WATCH, now evaluable against a live, self-limiting queue. Producers memory_promotion + decision_replay_due still unexamined for proposal-rate sanity. |
| BDN-003 | One activity/receipt ledger should unify surfaces | **OPEN · PARTIAL** | Substrate exists (ActionReceipt, entity-audit, intelligence_outcomes, brain-continuity); duplication already registered in ORGANIZATION-WIRING-AUDIT. New = read-only merged timeline shell (WP 3). Do NOT port nickstire's DoD compiler (deep-upgrade gate 2026-08-03). |
| BDN-004 | Nick should act in context, not only in Chat | **OPEN · PARTIAL** | PageContextBridge already mounted app-wide (`app/(mastery)/layout.tsx`) + context-hints. New = per-surface action chips (WP 4). MED conviction stands. |
| BDN-005 | Navigation needs one lifecycle vocabulary | **REFUTED-IN-PART** | Nav is already single-source lifecycle-verb sectioned (`nav-items.ts`: capture/execute/reflect/money/operate, 2026-06-18) and #1526 promoted the loop visually (ordinal badges, prod-verified) the same day as the scan. Demoting Money contradicts the operator's real loop. Findability test = WATCH only. |
| BDN-006 | Health, attention, momentum, and unknown must be distinct | **CLOSED (one defect fixed; rest incumbent)** | `homeHealthState()` already enforces measured/unknown honesty ("not yet measured" is deliberate); NICK /100 is momentum (pulse ticker, staleness fixed #1524). The one real conflation — "SYSTEMS OPTIMAL" from queue counts, green-while-loading — fixed 2026-08-12 ("QUEUES CLEAR", measured-only). |
| BDN-007 | Journal needs outcome closure, not just extraction/promotion | **OPEN · PARTIAL** | captured→proposed→accepted/dismissed chain is live (WP-16, sourceRef idempotency); outcome capture exists via pulse-ticker resolve. New = per-take visible state/outcome line (WP 5). |
| BDN-008 | Progressive disclosure and calm color semantics should be default | **OPEN · MERGED into BDN-001** | Honest-state contract (skeleton / failure-as-failure / measured-zero-quiet) is the standing house pattern; remaining delta is summary-first density, same build as WP 1. |

**Scan calibration note:** this scan measured better than the 2026-08 plan
cohort — accurate file citations, self-flagged kill shots, admitted fallback
runtime — but was blind to same-day ships (#1524/#1526/#1528) and to the
operator-approved provenance of the compositions it proposed replacing.
Next scan should diff against `git log` for the trailing 7 days before
ranking findings.

## Calibration rules for the next scan

1. Promote a finding to `HIGH` only after observing behavior or a production
   artifact, not because an adjacent product announced it.
2. Promote to `REPEAT HIT` only if the same signal survives a later scan and
   the prior kill shot was not triggered.
3. Downgrade any finding whose cheap test fails, even if it still sounds
   strategically attractive.
4. Track accepted, rejected, and waiting findings separately; silence is not
   confirmation.
5. (Added post-gate) Gate against `plan-gate` incumbents BEFORE ranking:
   UPSTREAMS.md, CURRENT-TRUTH.md, the trailing week of `git log`, and this
   ledger.
