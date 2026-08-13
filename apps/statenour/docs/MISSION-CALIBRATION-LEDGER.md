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

## 2026-08-13 — fourth run: WEB sweep (five parallel research lanes)

Evidence base: five parallel web sweeps (OSS code sources · AI cost/capability
shifts · forced cross-domain pairs + contrarian trade · under-the-radar
adoption · tool intelligence, the last added on an operator steer toward
"tool usefulness + intelligence"). Run-3 deliberately had no web sweep; this
run is the complement. Gated per rule 5 against UPSTREAMS.md, this ledger,
and the trailing week of `git log` BEFORE ranking.

**Self-audit:** run-3 #1 (BDN-101 wiring census) = **ACTED ON** (#1547; first
live run found 17 severed rules). The whole run-3 slate BDN-101..106 =
ACTED ON. No silent disappearances. Repeat hits: none of this run's 8 are
prior-run repeats; the *verification-scarcity* macro theme recurs a 3rd run
and now carries external behavioral evidence (code-review time +441% vs
throughput +33.7% across 22k devs · FDE postings up ~10x · Patronus $50M /
Braintrust agent-eval launches Mar 2026) — the receipts/judge doctrine is
the appreciating asset, keep investing there.

**Gate-eye catch (rule 5 fired on this run's own #1):** the web sweep's top
candidate premise — "replace the flat 177-tool catalog with tool search" —
is FALSE against the repo. `app/api/ai/chat/prepare-tools.ts` +
`lib/ai/chat-mode.ts` already run mode + keyword/semantic pruning bounded by
`NICK_TOOL_BUDGET` (24), with always-on cores, action-intent/web-search
coherence forcing, conversation-tail family persistence, and a read-mode
hard strip. The genuine deltas are narrower: (a) **mid-turn recovery** — the
model has no way to pull a tool the pruner dropped (the 2026-07-15 comment
in prepare-tools.ts documents exactly this failure class; conversationTail
is a heuristic patch, not a recovery path); (b) **`input_examples`** —
grep: zero occurrences anywhere in lib/ai.

| Date | Idea | Conviction | Evidence | Outcome |
|---|---|---|---|---|
| 2026-08-13 | BDN-201 · tool-recovery + exemplars (OPEN, 14/15): add ONE meta-tool `search_tools(query)` (BM25 or the existing pgvector embeddings) over the pruned-out remainder as the mid-turn recovery path — side-effecting tools stay always-visible, never search-only — plus `input_examples` on the core + highest-failure tools. Anthropic-measured on the pattern: MCP-eval 49→74 (Opus 4), params 72→90, −85% tool-def tokens ([Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use), Nov 2025; third-party corroborated). Kill shot: all published deltas are frontier-model; small-model retrieval-hop recovery unproven — A/B on the existing harness (waves 5-9) before trusting it on the Ollama lane. | HIGH | OBSERVED | NEW — proposed, design review before build |
| 2026-08-13 | BDN-202 · failure-receipt tool self-improvement (OPEN, 13/15): receipts are the exact FP/FN corpus the production-proven single-pass description-rewrite recipe needs (arXiv 2606.30775: automated 79.2% F1 vs 79.4% hand-tuned, 120min→3.8min/tool; Trace-Free+ +60.9% StableToolBench, model-agnostic). Nightly cron drafts rewrites BEHIND the approval gate; + 3 SQL census views (never-invoked-90d → defer candidates · high-failure → rewrite queue · co-occurrence → merge candidates) extending the trust-ladder to tools; + error-only structured reflection (1 retry, ACL 2026 — never blanket self-critique, which costs +40% compute for ~0 on easy tasks); + failed/corrected receipts frozen into a ~50-case trajectory regression suite (Braintrust pattern). Kill shot: long-tail tools have 0-2 failure datapoints — batch by family; census zeros are confounded by TOOL_BIAS visibility (rule: instrument must see the target). | MED | OBSERVED | NEW |
| 2026-08-13 | BDN-203 · grep-first recall lane trial (CLOSING in coding, OPEN for personal memory, 12/15): agentic lexical search escaped coding agents — Amazon@AAAI 2026 beat vector RAG on FinanceBench correctness (30.40 vs 24.24); every major coding agent already dropped vectors. Trial a ripgrep/ILIKE tool-loop lane BESIDE BrainMemory pgvector on the recall-eval corpus; hybrid (lexical-first, vector fallback) is the honest endpoint. Kill shot: loses on paraphrase/no-shared-vocabulary recall; costs more tokens per query. Demote, never delete, pgvector. | MED | OBSERVED | NEW |
| 2026-08-13 | BDN-204 · pre-registration discipline (OPEN, 11/15 — BOTH forced pairs: scientific-reproducibility↔agent-verification, biotech-trials↔self-experimentation): gated agent actions file plan + expected outcome as a receipt BEFORE execution and verification judges against the pre-filed plan (registered-reports mechanism — closes "agent grades its own homework post-hoc"); self-experiments (prompt A/Bs, habits) get pre-registered metric + decision rule + FUTILITY KILL RULE (experiments currently die by abandonment, not decision — n-of-1 ABAB + washout, StudyU/arXiv:1911.00878); optional: hash-chain receipts (`prev_hash`, ~30 LOC — IETF draft-sharif-agent-audit-trail has the field list but ZERO adoption, take the mechanism not the spec). Relation to shipped work: evidence-tier chips (#1544) stamp epistemics POST-hoc; this is the PRE-hoc half. | MED | INFERRED | NEW |
| 2026-08-13 | BDN-205 · phone-first freshness/UI package (OPEN, 10/15): Next 16 `updateTag()`/`refresh()`/`revalidateTag(tag,'max')` on mutation paths — framework-native fix aimed at the recurring Pulse-stale bug class (2 prior incidents); shadcn first-party chat primitives (June 2026) — vendor `MessageScroller` + `Marker` into chat-v2 + Remend for broken streaming markdown; Badge API approval-count on the PWA icon + Declarative Web Push (no service worker — iOS 26 opens ALL home-screen sites as web apps by default); agent-inbox `HumanInterrupt` envelope (Accept/Edit/Respond/Ignore — "Edit" is the verb the approval gates lack). Kill shot: chat internals are operator-approved compositions — additive primitives only, no recomposition; ViewTransition/`<Activity/>` still React-canary. | HIGH | OBSERVED | NEW |
| 2026-08-13 | BDN-206 · DeepSeek pricing regime (CLOSING — time-bound, 9/15): peak/off-peak lands 2026-08-16 16:00 UTC, off-peak = HALF price, and US daytime is off-peak (peak = 01:00-04:00 + 06:00-10:00 UTC); cache-hit input $0.0028/1M = 50x on prefix-stability discipline for the fast lane (deepseek-v4-flash pinned since #1514). Fetched primary (api-docs.deepseek.com, 2026-08-13). Moves: verify prompt-prefix stability (stable system prompt + tool schemas BEFORE variable context), schedule batch/cron LLM work into US-daytime off-peak. Kill shot: DeepSeek stated 2026-08-06 it expects a "significant increase" overall — don't hard-code the cost model; peak=China-daytime signals capacity strain, watch latency. | HIGH | OBSERVED | NEW — act within days |
| 2026-08-13 | BDN-207 · contrarian trade (OPEN, 8/15 — the run's mandated forward trade): "MCP is the universal agent interface / USB-C of AI" (Linux Foundation donation 2025-12, AWS/Google/Microsoft platinum) is likely wrong within 12-24mo for CAPABLE agents. Cracks are behavioral: Perplexity CTO publicly moving off MCP to REST/CLIs (Mar 2026); Anthropic's own code-execution post cut a workflow 150K→2K tokens (−98.7%); Cloudflare Code Mode. Convergence flag: this + BDN-201's tool-search + CodeAct (+20% success, 12/17 models) are ONE force — flat JSON tool interfaces are dying at the high end. Position: keep MCP a thin transport (the bridge stays maintenance, not investment — consistent with the MCP-Apps WATCH row); invest tool effort in typed in-repo code APIs; candidate: one read-only `query(code)` tool over a frozen API surface for the 156 non-side-effecting tools (frontier lane only — small models writing orchestration code have a bigger blast radius). Falsifier: MCP ships a token-efficiency fix + a major consumer surface standardizes on it for capable agents by 2027-08. | MED | OBSERVED | NEW |
| 2026-08-13 | BDN-208 · conditions-aware commitments (OPEN, 7/15 — forced pair: special-ops training doctrine↔personal discipline): the Army never records a naked completion — Task/CONDITIONS/Standard (FM 7-0 T&EO). Add auto-captured conditions (sleep/load/travel from journal) to commitment completions and grade per-condition; pre-declared Red/Amber/Green weeks make a Red-week miss expected data, not failure (fixes the streak pathology the 2026-08-12 streak audit brushed — the 36h "broken" label vs ≥2-day persisted reset); 4-question AAR as the weekly-review template feeding this ledger. Kill shot: transfer untested; game-feel domain = operator HOLD class, propose don't build. | MED | INFERRED | NEW |

**Closing synthesis (run 4):**
- **Most underpriced:** verification/judgment scarcity — generation commoditized, judging didn't (review +441% vs throughput +34%; FDE hiring ~10x; 81% of enterprise leaders report MORE production issues from AI code while 92% called it production-ready). Third consecutive run pointing here; the receipts/judge/calibration doctrine is the moat.
- **Most actionable:** BDN-206 (days, zero build) then BDN-201's exemplar half (hours, schema-only).
- **Weirdest serious bet:** BDN-203 — grep demoting pgvector in a personal-memory system, backed by cross-domain benchmark evidence.
- **What everyone is missing:** the interface layer is consolidating on CODE, not protocols — the consequence not yet priced is that *already-authenticated access + verifiable receipts* become the scarce assets, not tool count. Same force explains why browser agents driving EXISTING human checkout/portals ($0.05-0.15/task, down ~10x) beat agentic-payment rails (x402: 100M+ txns but ~half meme-driven; OpenAI ACP Instant Checkout retreated Mar 2026 — rails real, demand absent, TOO EARLY, don't build).
- **Stale-frontier call-outs:** AP2/ACP/x402 integrations (above) · vector-RAG-as-default (conceded by every major coding agent) · FAQ/HowTo rich results (already DEAD in UPSTREAMS) · "EU killed iOS PWAs" (reversed Mar 2024 — a 2026 source still circulates the stale claim; do not re-ingest).
- **nickstire spillover (logged, not ranked — different app):** HVAC missed-call-recovery vendors publish the KPI frame (recovered-revenue-per-missed-call) that the open ledger item "VAPI leg ends at blind hand-off — no answer bit" needs; measurement-first, activation stays operator-gated.

**Scan hygiene note:** research-agent claims marked [S]/vendor were kept only
where a primary source or in-repo evidence corroborated; Ollama Cloud
GPU-time tier claims were dropped entirely (SEO-farm sources only). One
sweep pair returned an explicit null ("agent frameworks are necessary" has
no citable consensus holder — already a contested market, not a trade).

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
