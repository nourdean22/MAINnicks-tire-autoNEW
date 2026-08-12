# bdnick Mission Calibration Ledger

Persistent ledger for MISSION-scan findings. The 2026-08-12 scan reported "no
prior persistent calibration ledger was found" — this file closes that gap.
Next scan: read this FIRST, then `GATE-2026-08-12-mission-scan.md` for the
receipts behind each verdict. Statuses follow the calibration rules at the
bottom; gate vocabulary (`plan-gate` skill) applies.

## 2026-08-12 — first-run baseline, gated same day

| ID | Finding | Status after gate | Evidence / next check |
|---|---|---|---|
| BDN-001 | Home should compile attention into Now / Decide / Resume | **SHIPPED 2026-08-12** (operator: "finish the partial opens") | Decide lane now bounded: FollowUpsList + ProposedCommitments each render 3 with the house footer expander (count badges still tell the whole-queue truth). RESUME: the matrix briefing gains an open-loop branch — a DOING task that isn't the active engagement outranks new targets, with a one-tap resume link. NOW was already the briefing. SinceLastVisit was ALREADY capped at 3 rows (scan premise partly stale — `limit` only widened the count math). |
| BDN-002 | Approval queue needs a trust ladder | **KILL SHOT CONFIRMED → HYGIENE EXECUTED 2026-08-12** | Probe: the 468 was 100% `autonomous_action` approval="pending", 90% older than 7d; the `approval_requests` gate is EMPTY (0 pending) and already carries riskClass+expiresAt. Operator-authorized cleanup ran the INCUMBENT purger (`purgeStaleCategory("pending_actions_7d")` — not a bespoke mutation): 468 → 44 pending (424 → rejected/auto-purge, reversible, ids in `APPROVAL-QUEUE-CLEANUP-PLAN-2026-08-12.json`). Census re-run confirms 44, all ≤7d. **Sweep SCHEDULED 2026-08-12 (operator: "schedule the purger"):** the nightly `data-cleanup` cron (mega-evening fan-out, 03:00 UTC) now delegates to the same incumbent purger — one policy, two callers; producer pinned by `tests/cron/data-cleanup-pending-actions.test.ts` incl. fail-loud. Steady state: a pending autonomous action gets 7 days of review then auto-rejects. Trust UI = WATCH, now evaluable against a live, self-limiting queue. Producers INSPECTED 2026-08-12 (gate-doc addendum): both rules lack an AutomationPolicy row, so the fail-closed engine parks them nightly — a deferred-action deadlock (decision_replay_due = 3 decisions × 76 nights; memory_promotion has 501 jammed candidates whose quality gates live inside the never-executed action). Fix is an operator policy/review decision, not code. |
| BDN-003 | One activity/receipt ledger should unify surfaces | **SHIPPED 2026-08-12** | `components/brain/receipts-timeline.tsx` — the 3-source merged feed (`buildActionReceiptFeed`: entity-audit + autonomous-action + agent receipts) with status filter pills, folded into /brain Continuity exactly as ORGANIZATION-WIRING-AUDIT §6/§7 prescribed, superseding the entity-audit-only stream there (GlobalActivityStream file untouched, just unmounted — Home-console precedent). `receiptFeed` gained an optional limit input. Read-only, no schema. |
| BDN-004 | Nick should act in context, not only in Chat | **SHIPPED 2026-08-12 (as a re-wire, not new chrome)** | Gate finding: the contextual chips ALREADY EXISTED on 13 surfaces (task companion, decision replay, contradictions, command palette, push URLs, …) but all landed on an empty composer — the chat-v2 migration orphaned the `?q=` handler. Restored via `use-chat-deep-link-prefill` (accepts all three historical vocabularies q/seed/prompt + cid), PREFILL-ONLY by design (no page-load auto-send under the $0 doctrine; the old hook auto-sent). ~~Known gap: contextRoute/TOOL_BIAS stays dead~~ — **superseded same day by the small-stuff sweep below (#1540): the bridge no longer self-clears on /chat and stores `contextRoute` per page, so the route hint + TOOL_BIAS lane is live end-to-end.** |
| BDN-005 | Navigation needs one lifecycle vocabulary | **REFUTED-IN-PART** | Nav is already single-source lifecycle-verb sectioned (`nav-items.ts`: capture/execute/reflect/money/operate, 2026-06-18) and #1526 promoted the loop visually (ordinal badges, prod-verified) the same day as the scan. Demoting Money contradicts the operator's real loop. Findability test = WATCH only. |
| BDN-006 | Health, attention, momentum, and unknown must be distinct | **CLOSED (one defect fixed; rest incumbent)** | `homeHealthState()` already enforces measured/unknown honesty ("not yet measured" is deliberate); NICK /100 is momentum (pulse ticker, staleness fixed #1524). The one real conflation — "SYSTEMS OPTIMAL" from queue counts, green-while-loading — fixed 2026-08-12 ("QUEUES CLEAR", measured-only). |
| BDN-007 | Journal needs outcome closure, not just extraction/promotion | **SHIPPED 2026-08-12** | `insightsPreview` now joins the commitment proposed from each take (one indexed query by `sourceRef "journal-take:<entryId>"` — no such query existed anywhere) and the take card renders a lifecycle line: captured → proposed → active → done, with terminal states (× dismissed / expired / stale) stated, not implied. Extraction no longer looks like completion. |
| BDN-008 | Progressive disclosure and calm color semantics should be default | **SHIPPED with BDN-001** | Summary-first density on the Decide lane (one disclosure control per cluster, house expander pattern); honest-state contract was already standing house doctrine. |

**Small-stuff sweep (2026-08-12, operator: "wasn't there smaller stuff?"):**
① dead `/system/history` links on Home's since-last-visit rows (and inside
the unmounted GlobalActivityStream) → retargeted to the Continuity
timeline; ② the page-context bridge CLEARED its own payload on /chat —
anchors died in the same frame chat needed them — now /chat preserves the
source page's context and every page stores `contextRoute`, activating the
server's route hint + TOOL_BIAS lane (dead since Wave 30) end-to-end;
③ `?h=1` history-drawer deep-link honored; ④ the orphaned AUTO-SENDING
old deep-link hook deleted (a remount would have fired a model turn on
page load). Still operator-only: the BDN-002 producer decision menu (auto
policies / 9 due replays). Still consciously left: BDN-005 relabel
(WATCH), since-last-visit's silent-error state (deliberate), `?mode=flow`
(no flow mode exists in chat-v2).

**Scan calibration note:** this scan measured better than the 2026-08 plan
cohort — accurate file citations, self-flagged kill shots, admitted fallback
runtime — but was blind to same-day ships (#1524/#1526/#1528) and to the
operator-approved provenance of the compositions it proposed replacing.
Next scan should diff against `git log` for the trailing 7 days before
ranking findings.

## 2026-08-12 (evening) — second plan same day: "RETROFIT BUILD PASS"

An 8-phase unattended retrofit plan arrived hours after the BDN arc
shipped. **Gated, not executed** — full verdicts in
[GATE-2026-08-12-retrofit-pass.md](GATE-2026-08-12-retrofit-pass.md).
~85% incumbent/refuted: its thesis fact ("393 pending brain-bus events,
zero consumers") is the pre-2026-07-28 snapshot quoted in the cron
manifest — live probe shows **done: 1,558 · pending: 0**, drained to
within the 15-min cadence; its Phase-4 prerequisite `THE-BRIEF.md` does
not exist in the repo; Phases 3/6/7/8 prescribe surfaces that are native
or shipped this same day (#1526, #1535-#1540, AutomationPolicy +
confidence-tier). Survivors registered as WPs: evidence-tier fields
(needs a real vocabulary source + migration design), streak-semantics
audit (premise unverified, operator picks the model), PageNick mounts.
Calibration rule 5 fired exactly as written — and rule 6 below is new.

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
6. (Added after the retrofit-pass gate) A number quoted as the plan's
   thesis ("393 pending", "68 junk wisdoms") must be re-measured live
   before any phase is built on it — historical snapshots survive in code
   comments and prior audits long after the state they describe is fixed,
   and this failure shape has now recurred in three plans (#12, the
   architecture report, this one).
