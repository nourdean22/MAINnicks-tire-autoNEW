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
confidence-tier). Survivors registered as WPs — **all three CLOSED same day (operator:
"do the best recommended fixes")**:
- **Evidence-tier: SHIPPED, zero-DDL, zero new spend.** The vocabulary
  source is the MISSION scan's own discipline (OBSERVED/INFERRED/
  SPECULATIVE × HIGH/MED/LOW — THE-BRIEF.md never existed).
  `generateJournalTake` stamps `evidenceTier:"INFERRED"` structurally and
  asks the SAME funded extraction call for nextAction confidence; the take
  card and the Home proposal card both render the chip (null on legacy
  takes → nothing renders; a save never blocks). `parseTakeEpistemics`
  pure + pinned.
- **Streak audit: DONE — the plan's premise is REFUTED.** No persisted
  mechanism resets to zero on one miss (DAILY → 1, lazily; WEEKLY never;
  xp-decay = operator-decided 7d grace + 1%/day). Only read-only display
  walks zero out. "Never miss twice" NOT built. One real inconsistency
  flagged for the operator (game-feel domain, same HOLD class as
  xp-decay): `task-context.ts` labels a daily "broken" at 36h while the
  persisted counter resets only at ≥2 ET-day gaps — display can say
  broken while the streak keeps counting.
- **PageNick mounts: SHIPPED where they add coverage, skipped where
  incumbent.** Gate-eye correction to the WP itself: Journal and Missions
  ALREADY carry a Nick surface (NickSidePane) — a second affordance there
  is clutter, not coverage. Mounted on /system (with the page's own
  fetched truth — buildPageData has no system case) and the Business
  Clients tab (page="crm", compact counts only — no contact PII in the
  prompt). /api/ai/page-insight is cost-firewalled to the ollama lane and
  rate-limited 10/min.

**Producer decision menu: EXECUTED same day (operator-authorized).**
`autonomous-action.memory_promotion` + `autonomous-action.decision_replay_due`
policies seeded `approvalClass:"auto"` via the canonical
`scripts/seed-policies.ts` (declarations in code, idempotent upsert — NOT a
one-off DB write; live seed 80/80, both rows probe-verified). The
deferred-action deadlock is closed at the source: tonight's engine pass runs
both rules through their built-in gates (≤3 promotions + ≤3 replay reminders
per night); the 9 due replays start getting their designed reminders.

Calibration rule 5 fired exactly as written — and rule 6 below is new.

## 2026-08-12 (night) — third run: UI/structure re-scan (self-run, in-session)

Evidence base: this repo + same-day prod probes (revealed preference +
primary builder — the hierarchy's top tiers); no web sweep, stated
explicitly. Self-audit: prior #1 (retrofit brain-bus consumer) = killed by
evidence; morning #1 (BDN-001) = ACTED ON (#1539). Repeat hit: trust-ladder
theme, 3rd consecutive run → elevated conviction, each iteration converging
on the INCUMBENT mechanism.

| Date | Idea | Conviction | Evidence | Outcome |
|---|---|---|---|---|
| 2026-08-12 | BDN-101 · dead-lane wiring census on /system (aerospace pair; the run's contrarian trade: wiring integrity OVER new agent chrome — falsifier: chrome catches a failure class the census misses by 2027-02) | HIGH | OBSERVED (5/5 retroactive detection of this week's defect class) | **ACTED ON same night** — shipped, and its FIRST live run found **17 severed autonomous rules** (policy-less, parking every match) + 1 never-fired rule + a `commitment.transition` handler with zero events ever published. 38 lanes total. |
| 2026-08-12 | BDN-102 · trust-ladder scoreboard — expose confidence-tier's EXISTING per-type accept tallies on /system/actions; flag flip is the operator's evidence-read (casino pair) | HIGH | OBSERVED (canAutoExecute built, flag-off; verdict data flows from tonight) | **ACTED ON same night** — shipped; the live probe caught a scoreboard defect pre-ship (today's 424 auto-purge flips were counting as operator rejections → every type read 0% accept). Machine verdicts now excluded; honest reading is **0 real operator verdicts in 45d**. REPEAT HIT ×3. |
| 2026-08-12 | BDN-103 · route-aware Nick — measure context_manifest contextRoute arrival, then extend TOOL_BIAS (lane went live in #1540) | MED | OBSERVED | **ACTED ON** — manifest now logs `contextRoute` + which bias fired (the arrival sensor); TOOL_BIAS extended from the nav registry (+5 routes incl. a read-only Home entry) and pinned so every named tool must exist in the live catalog. Fixed a latent bug en route: the lookup was `find(startsWith)` over unordered keys — a `/` entry would have swallowed every route; now longest-prefix. |
| 2026-08-12 | BDN-104 · Home decision instrumentation — the shipped BDN-001 composition has NO sensor; its 7-day cheap test never ran (ledger rule-3 integrity item) | MED | OBSERVED | **ACTED ON** — decision signals only (4 verdict points + resume tap) into AuditEvent `home:signal`, existing 90d retention, no new table. Prod reads 0 with the note "unmeasured, not unused". The 7-day test can finally run. |
| 2026-08-12 | BDN-105 · SPC on the wisdom-quality-gate — trend accept/reject/dupe mix weekly; hand-audit week 1 promotions (manufacturing QC pair) | MED | OBSERVED | **ACTED ON — and the prod probe caught a defect in it**: rows that never reached the gate (parked by the deadlock) were being silently dropped, so the summary claimed adequate sampling for a gate that had never run. Now a first-class `parked` bucket, and sampling counts DECIDED runs only. **Live reading: 116 parked · 0 decided in 8 weeks.** |
| 2026-08-12 | BDN-106 · personal confidence calibration (Brier on HIGH/MED/LOW vs outcomes; intelligence-tradecraft pair) | LOW | INFERRED | **ACTED ON as an instrument, NOT a conclusion** — the report ships reporting honest n=0 ("stamping began 2026-08-12; nothing to grade") so the parked item reports itself instead of being forgotten (ledger rule 4). Unresolved commitments are never graded either way. Verdict still parked · revisit 2026-10-15. |
| 2026-08-12 | (cut, noted) dismiss-latency as adverse-selection signal (HFT pair) | LOW | INFERRED | parked behind BDN-102 · 9/15 |

### BDN-101/102 build receipts (2026-08-12 night, operator: "101 and 102 go")

Both shipped read-only, both verified against PROD not fixtures — and the
prod run is what made them worth building:

- **The census's first live run found 17 severed rules**, the same class
  as the two the producer inspection caught by hand this afternoon. The
  hand-inspection found 2 because it looked at 2; the census reads the
  registry, so it found all of them. Also: `auto_followup_expired_quote`
  has a policy but has NEVER minted a row, and the `commitment.transition`
  handler has consumed zero events ever.
- **The ladder's first live run exposed a defect in itself**: today's
  424 auto-purge status flips were being counted as operator rejections,
  so every action type read 0% acceptance — a scoreboard telling the
  operator he rejected work he never saw. Machine approvers are now
  excluded; the honest reading is 0 operator verdicts in 45 days.
  **Deliberately NOT changed: the engine's own tally.** The same pollution
  there only DEPRESSES acceptance (harder to auto-execute) — fail-safe —
  and loosening a live autonomy gate is an operator decision, not a
  scoreboard side effect.
- Census scope is disclosed ON the panel (cron→artifact, URL-param→handler,
  client-store, bridge→chat lanes and where each is actually covered) —
  an instrument that hides its blind spots is the thing it exists to catch.
- **Operator decisions this surfaces (not agent calls):** the 17 severed
  rules are mostly nickstire/business-lane rules that may be intentionally
  dormant — the census says "no policy", not "should be on". Seeding
  policies for any of them is the same authorization class as this
  afternoon's two.

### BDN-103..106 build receipts (2026-08-12 night, operator: "now 3, 4, 5, 6")

The whole run-3 slate is now shipped. Three prod-probe catches in one
night, all the same class — **a read model that looks right against
fixtures and lies against real data**:

1. BDN-102's ladder counted the day's 424 auto-purge flips as operator
   rejections (every type read 0% accept).
2. BDN-105's SPC silently dropped rows that never reached the gate, so it
   reported adequate sampling for a process that had never run —
   **116 parked, 0 decided, 8 weeks**.
3. (BDN-101, earlier) the census found 17 severed rules, not the 2 the
   hand inspection had found.

**Standing rule now: run every new read model against prod before
shipping it.** A green unit test over a fixture proves the shape, never
the reading.

Placement discipline: /system holds the three OPS instruments (census ·
ladder · Home decisions); the two MEMORY-quality readings (gate SPC +
confidence calibration) went to /brain Continuity. Stacking all five on
/system would have recreated exactly the density problem BDN-001 was
about.

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
