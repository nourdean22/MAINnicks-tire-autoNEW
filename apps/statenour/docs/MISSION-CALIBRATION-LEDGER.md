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

### Run-4 EXECUTION (same day, operator: "do them all") — outcomes per finding

All eight findings ACTED ON 2026-08-13, with the honest N/A legs recorded.
Three premise corrections surfaced DURING build (rule 6 keeps firing):

| ID | Outcome |
|---|---|
| BDN-201 | **ACTED ON** — `searchTools` (recovery search) + `invokeTool` (read-safe-only proxy, fail-closed via capability-registry, respects blocklist + circuit breaker + schema validation) always-loaded via prepare-tools; worked `Example:` blocks on 6 core/action tool descriptions; both snapshots regenerated. Pinned by `tests/ai/recovery-tools.test.ts`. |
| BDN-202 | **ACTED ON** — error-only reflection + ToolCallOptions passthrough in the barrel wrapper (`lib/ai/tools.ts`); tool-usage census (`lib/observability/tool-usage-census.ts` + panel on /system, pruner-confound disclosed on screen); nightly rewrite-DRAFTS cron `tool-description-rewrite` folded into mega-evening (≤3 tools, fast lane, drafts into BrainMemory — a human applies in code). **Eval-exporter leg INCUMBENT**: `harvest:evals` already folds failed tool calls via `caseFromFailedToolCall` (recall-corpus-builder.ts:237). |
| BDN-203 | **ACTED ON** — `scripts/recall-eval.ts` built (`pnpm eval:recall`): the live runner recall-eval.ts:13 claimed but never had; compares vector (`semanticSearch`, read-only — deliberately NOT `recallMemoriesForQuery`, which bumps lastSeen) vs lexical (`getLexicalMatches`, now exported) on SEED_CASES + harvested corpus. Hybrid lane out of scope (returns a rendered string, not keyed rows). |
| BDN-204 | **ACTED ON** — `ActionRule.plan?()` pre-receipt: filed at row CREATION (before any side effect), carried through defer/success/failure, judged beside the outcome (`outcomeVsPlan`) in both auto and approval lanes; implemented for the two live-auto rules (memory_promotion — plan names "skipped" as conformant; decision_replay_due); receipts feed now selects payload + surfaces plan fields; A/B harness gained frozen `preRegister()` (metric + decision rule + FUTILITY STOP) wired into vnext-prompt-ab. |
| BDN-205 | **ACTED ON** — Badge API approval count on the PWA icon (`components/hud/app-badge.tsx`, answered-queries-only, cleared never stale); approval **Edit verb** wired — the server had accepted `editedPayload` since the guardian shipped and the UI never sent it (gate-eye catch: the HumanInterrupt "Edit" verb was a one-sided incumbent). **N/A legs:** Remend (Streamdown `parseIncompleteMarkdown` already live, nick-message.tsx:194) and `updateTag()`/`refresh()` (invalidation here is tRPC/react-query, not Next cache tags). |
| BDN-206 | **ACTED ON, PREMISE PART-CORRECTED** — ★ live check: **no code path calls the DeepSeek API directly** (deepseek models run via Ollama Cloud `/v1`), so DeepSeek peak/off-peak + cache-hit pricing DON'T BIND current spend; off-peak cron moves dropped (and the real mega trigger is a Railway cron → operator-side anyway). The applicable half shipped: the ANTHROPIC ephemeral cache was being defeated per-minute by `relTime()`/`relFromNow()` in the system prompt — now 5-minute-bucketed (renderer.ts). Prefix audit recorded: true stable prefix = staticPrefix+inferredPatterns; volatile from position 5 (temporal) + JIT gate. WATCH: if the fast lane ever moves to api.deepseek.com, the off-peak/cache discipline re-opens. |
| BDN-207 | **ACTED ON, NARROWED** — `runCode` already existed (vm sandbox, no data access); the genuine delta shipped as `queryData`: same vm pattern + frozen read-only `api.call()` over a 12-tool whitelist, double-gated (whitelist + isReadSafeTool), 10s budget, 20k output cap. No lane restriction (blast radius bounded by read-only surface). |
| BDN-208 | **ACTED ON (measurement half)** — conditions capture at commitment completion/abandon (sleep/energy/stress/dayState → BrainMemory `commitment_condition`, fire-and-forget) + pure `conditionedCompletionStats` read model, pinned by tests. Self-review round extended capture to the CHAT-tool paths (`completeCommitment` + `markCommitmentBroken` — broken is the highest-signal class). R/A/G week gamification + AAR re-scoring deliberately NOT built (operator game-feel HOLD class) — revisit once per-condition data has ~30 days of rows. |

**Self-review round (same day):** four defects found in my own run-4 diff,
all fixed: ① the confidence-tier auto-execute branch OVERWROTE the
create-time `plannedOutcome` (the one lane where a machine-authorized fire
most needs its pre-receipt judged) — now merges `outcomeVsPlan` like the
other lanes; ② `searchTools` could find `queryData` but the recursion
guard made it un-invocable — a dead end with no actual cycle (queryData's
sandbox whitelist excludes invokeTool), now allowed + pinned by test;
③ queryData's 10s deadline timer was never cleared; ④ chat-path
commitment writes bypassed conditions capture (incl. `broken`). Also
verified live: the legacy mega route DOES read `EVENING_JOBS` (rewrite
cron fires tonight) and `MUTATING_PREFIX` catches none of the three
recovery tools (they survive the read-mode strip as designed).

## 2026-08-14 — fifth run: Nick Chat CONTENT/persona (two scans merged + gated)

Evidence base: 9 web searches + 3 primary fetches, plus a second independent
scan supplied by the operator. Both gated against `static.ts`,
`operator-rules.ts`, `spar-mode.ts`, `judge-eval.ts`, `nick-quality-evals.ts`
and the trailing week of `git log` BEFORE ranking. Full merge:
[GATE-2026-08-14-nick-chat-persona.md](GATE-2026-08-14-nick-chat-persona.md).

**Self-audit:** run-4 #1 (BDN-201) = **ACTED ON** (#1556). Repeat hits:
verification/judgment scarcity ×4 consecutive runs — conviction elevated;
frontier-only-evidence kill shot ×2 (BDN-201 → BDN-306), now treated as a
structural property of the fast lane rather than a per-finding caveat.

**GATE: the operator's persona ask is ~80% INCUMBENT.** OWNER AUTHORITY
(2026-07-05), 8 operator rules, TRUTH_RULE + server-side fabrication
verifier, SPAR, assertion-pressure gate all pre-exist. **REFUTED:** no
meaningful refusal layer remains to remove; perceived stonewalling is a
measurement gap, not a policy gap. The real hole: judge-eval scores
accuracy/actionability/brevity/tone/evidence — **none of them is obedience,
sycophancy, calibration, or persona.**

| Date | Idea | Conviction | Evidence | Outcome |
|---|---|---|---|---|
| 2026-08-14 | BDN-301 · per-lane persona census (15/15): Anthropic 309,815 convos / May 2026 — identical prompts yield different values per model (Sonnet 4.6 deference +0.14σ, warmth +0.17σ; Opus 4.7 caution +0.24σ, depth +0.23σ; 4 axes ≈15% variance). Nick runs ≥2 lanes, so every persona directive lands at a different gain. | HIGH | OBSERVED | **ACTED ON — NARROWED.** ★ Gate-eye catch on my own #1: lane capture was ALREADY INCUMBENT — `judge-eval.ts` has written `judgedBy="${provider}:${model}"` into every reply_judgment row since v10.0.412. The genuine delta is AGGREGATION, not instrumentation. Shipped `lib/observability/persona-lane-census.ts` as a read model over data already on disk (zero generation spend). Confound is first-class: groups by (lane × taskClass), total-variation distance on task mixes, `comparable:false` above 0.35, underpowered cells (n<5) shown-and-marked never dropped. Composite left at mean-of-5 so history stays comparable. 12 tests. |
| 2026-08-14 | BDN-302 · split estimative LIKELIHOOD from analytic CONFIDENCE (14/15 — forced pair: intelligence tradecraft ↔ market intelligence): `CONFIDENCE_CUES` blended both into one hedge token; ICD 203 requires them separate. ★ **BDN-106's Brier report was structurally ungradeable** — a Brier needs a probability and a hedge word is not one. | MED | OBSERVED | **ACTED ON — unblocks BDN-106.** `ESTIMATIVE_LIKELIHOOD` (ODNI seven-point scale verbatim) + `ANALYTIC_CONFIDENCE` (+ compact tail tag `[~30% · conf: high]` reusing the INLINE_CITATIONS bracket idiom, not a second syntax). `CONFIDENCE_CUES` stays exported but is NO LONGER INJECTED — the BROADEN_AND_SUGGEST treatment, pinned by test. Reader `lib/ai/vnext/truth/estimative.ts`: `parseEstimative` / `brierScore` / `summarizeEstimativeCompliance`; `brierScore` returns **null not zero** when ungradeable (BDN-105 lesson). ★ Size guard FAILED FIRST at 842 vs 827.5 ceiling — fixed by tightening prose, NOT by raising the bar. 22 tests. |
| 2026-08-14 | BDN-303 · contrarian trade (13/15, mandated): "labs are converging on less-sycophantic defaults, so apps can inherit directness" is likely WRONG in 12-24mo. GPT-5 cold→warm reversal + 4o reinstated in 24h (Aug **2025** — precedent, not fresh signal); GPT-5.5 goblin incident (OpenAI, Jun 2026) — a Nerdy-persona reward leaked into Codex, goblin mentions +175% then +3,881%, needing persona retirement + data filter + dev-prompt patch; Anthropic's own lineup DIVERGING on identical prompts. Position: own persona at the app layer; treat every model bump as a persona regression event with a blocking gate. Falsifier 2027-08: a vendor ships versioned contractual steerability AND cross-model variance <0.1σ. | MED | OBSERVED | RECORDED — no build. BDN-301's census is the instrument this trade needs. |
| 2026-08-14 | BDN-304 · trajectory grading over receipts (from the operator's second scan — its strongest item): grade tool selection, evidence freshness, approval-boundary correctness, recovery behavior, hidden tool failures, plan-vs-actual divergence. Answer-only judges reward lucky outputs and hide the mechanism. | MED | OBSERVED | NEW — WP, next slice. Extend the EXISTING receipt/`outcomeVsPlan` substrate; do NOT add an observability vendor before proving the native substrate cannot answer the question. |
| 2026-08-14 | BDN-305 · obedience + anti-sycophancy golden set (12/15): grep for `sycophan|refusal|obedien` across lib/tests/scripts returns prompt files and guardians, ZERO evals. Steal XSTest's PAIRED-CONTROL design (the +600 toxic controls are the load-bearing half), not the corpus: ~30 real directives Nick hedged on + 10 genuine two-tap-confirm controls, per lane. | MED | OBSERVED | NEW — WP, NOT built. Needs REAL traces; authoring cases from imagination would be a fixture-only eval (false-green lesson). |
| 2026-08-14 | BDN-306 · tool metadata is an untrusted claim (from the second scan — **missed entirely by scan A**): MCP annotations are hints that MUST NOT be trusted from untrusted servers; the capability registry, not the model-facing description, is the security authority. `lib/agent-bridge/mcp-server.ts` exists, so this is live surface. | MED | OBSERVED | NEW — WP. Local contract checks first; defer OAuth/remote-MCP enforcement. |
| 2026-08-14 | BDN-307 · delete-before-add prompt trim (11/15): context rot — 18 frontier models degrade 30-50% BEFORE documented limits, U-shaped position curve, coherent structure degrades attention MORE than shuffled. OWNER AUTHORITY's idx-0 placement protects against TRIMMING but not DILUTION. | MED | OBSERVED | **PARKED — deliberately NOT executed.** Nick's live prompt size was NOT re-measured this run (`measure-prompt-size.ts` hits live Neon). Ledger rule 6: measure the thesis number live before building on it. Trimming on an unmeasured premise is exactly the failure that rule exists to stop. |
| 2026-08-14 | BDN-308 · Verbalized Sampling for SPAR diverge (10/15, CLOSING): CHATS-lab/verbalized-sampling, Apache-2.0, ICML 2026 — training-free, model-agnostic, ORTHOGONAL to temperature, 1.6-2.1x diversity; mode collapse traced to typicality bias in preference data. SPAR step 1 already SPECIFIES "distinct bets, not rewordings" with no mechanism; VS is that mechanism. | MED | OBSERVED | WATCH — not adopted. ALL published gains are frontier-model; costs 5 candidate generations per diverge turn. Run the incumbent A/B harness first. |

**Gated as PARTIAL INCUMBENT (second scan), detail in the gate doc:**
ClaimLedger (claims.ts + known-truth-guard + fabrication verifier already
carry claim semantics) · regression bank (`harvest:evals` +
`caseFromFailedToolCall` + `eval:recall` shipped — the real delta is the
FROZEN HOLDOUT, and its read that the corpus is still synthetic is CORRECT
per BDN-203) · memory supersession (**BLOCKED** — 6 new schema fields, and
statenour DDL is hand-applied + protected; the second scan flagged neither)
· IntentContract (**REJECT as specified** — `ActionRule.plan()` +
`outcomeVsPlan` + `approvalClass` already implement the enforcing subset) ·
context budget (**NATIVE** — prepare-tools/chat-mode prune to
NICK_TOOL_BUDGET=24; cache prefix fixed in BDN-206) · MCP contrarian
(**REPEAT of BDN-207**, acted on 2026-08-13).

**Source-quality note:** the second scan's `code to copy` links were
spot-checked and are **real, not fabricated** — `openai/openai-knowledge-retrieval`,
the Cerebras fact-checker notebook, and the evaluation-flywheel doc all
resolve, and its "~50 failing traces" + train/val/test split match the
source (20/40/40). Its link discipline is better than scan A's and should be
copied forward.

### Run-5 second pass (same day, operator: "what u deliberately didnt do go i approve all")

All four deferred items revisited under approval. **Three built, one
REFUTED by its own cheap test.** Standing lesson recorded: *approval
removes the need to ASK; it does not remove the need to MEASURE.*

| ID | Outcome |
|---|---|
| BDN-307 (prompt trim) | **REFUTED — deliberately NOT built.** `measure-prompt-size.ts` needs live Neon and its safety wrapper correctly calls that a production write lane; the agent declined to set `CONFIRM_PROD=1` on its own reading that the script is read-only (that reasoning pattern is what caused the 870-row incident). Added `scripts/measure-static-layer.ts` — offline, zero risk, and Layer 1 is the only surface a trim would touch. **Live reading: Layer 1 = 13,274 chars / ~3,319 tokens against the repo's own 40,000-char guard (33% of ceiling).** Context rot operates at 100K+ token contexts, not a 3.3K-token system prompt. Calibration rule 3 applied. ★ The finding was scored payoff-3 in the morning FOR THIS EXACT UNCERTAINTY, and the measurement cashed that caution out correctly. |
| BDN-308 (Verbalized Sampling) | **ACTED ON — behind `NICK_SPAR_VS`, default OFF.** Only SPAR's DIVERGE step changes; attack/tension/converge byte-identical **by assertion**. ★ The containment test caught real drift in the agent's own draft (the variant had rewritten step 2 to "the strongest SURVIVING option") — that would have made any A/B measure two changes at once. Source fixed, not the test. Flag registered in `FLAG_REGISTRY` with the frontier-only kill shot recorded. |
| BDN-309 (universal media renderer) | **ACTED ON.** From the operator's media-workspace plan — ★ the FIRST pasted plan in 25 whose central premise SURVIVES the gate, verified against this checkout (the plan cited a different worktree's paths). Before: `<img>` for `image/*` and one undifferentiated paperclip for everything else, with no playback and no link. `ChatMediaPart` plays video/audio natively, types the rest, always offers a link, and never renders nothing. **Zero new dependencies** — the plan proposed Vidstack/Media Chrome; native `<video controls>` already covers scrub/fullscreen/PiP/captions. A player library belongs to the dock work (#2), not to "make files visible". ★ Agent self-correction on the record: an earlier claim that non-image parts "rendered as NOTHING" was WRONG — the paperclip branch existed at `chat-message-list.tsx:285`; the claim came from a grep truncated by `head -25`. |
| BDN-310 (memory supersession) | **AUTHORED, NOT APPLIED — the DDL half is operator-side.** Schema + `prisma/migrations/20260814120000_brain_memory_supersession/` written and `prisma validate` clean; the agent did NOT run it against Neon (hand-applied migrations, protected operation). Apply command + full rollback in the migration header. Concept added: `expires_at`=decay TTL, `deleted_at`=explicit removal, `last_seen`=last observed (bumped by recall, so it measures ATTENTION not confirmation) — none could say *"this was true, then stopped being true."* FK is `ON DELETE SET NULL` never CASCADE (a dangling pointer is detectable; a cascade erases the record that something changed); `supersedes` is a LIST because consolidation is the common case; **NO BACKFILL** — backfilling `valid_from = created_at` would manufacture a provenance claim never observed, the exact fabrication class TRUTH RULE prevents. |

**Media plan status: 1 of 8 built.** Remaining, with gate verdicts — #2
persistent cinema dock (**where a player dependency finally earns itself**:
queue, resume-across-navigation, chapters) · #3 "ask this video" with
timestamps (**highest StateNour-specific leverage**; `audio-transcribe` and
`videodb-sessions` routes already exist) · #4 provenance/status media cards
(**map onto `claims.ts`, do NOT build a parallel evidence structure**) · #5
multimodal composer · #6 focus/split-screen · #7 timestamp notes (**requires
explicit save-to-memory; never auto-persist a watched video**) · #8 visual
polish, last.

**Still WP, not built:** BDN-305 obedience golden set — still needs REAL
traces. Authoring cases from imagination would be a fixture-only eval, and
the operator's approval does not convert invented fixtures into evidence.

**Rotation reported EMPTY:** casino risk engineering ↔ capital allocation —
Kelly is real but the operator's "aggressive" is a register ask, not a
bet-sizing ask; every 2026 source returned was SEO content.

**Dropped for source quality:** the LLM cost-collapse lane (axis-intelligence,
aimagicx, packet.ai, gpunex — SEO farms). The tempting figure "DeepSeek
V4-Flash $0.14/M input" (our pinned fast lane) is SINGLE-SOURCE and
uncorroborated — do NOT act on it. Same call run 4 made on Ollama GPU tiers.

**TOO EARLY:** persona vectors / activation steering (arXiv 2507.21509) —
needs open weights + local activation access; operator GPU is an Intel Arc
iGPU (no CUDA) and both lanes are hosted APIs.

## 2026-08-14 (later) — media workspace arc + VideoDB live verification (BDN-309..321)

Executed on operator instruction across 8 merged PRs (#1570-#1578). Full
contracts registered in [CURRENT-TRUTH.md](CURRENT-TRUTH.md). Highlights
that change what a future scan should believe:

| ID | Outcome |
|---|---|
| BDN-309..317 | Media workspace, all 8 plan items. ★ The plan's premise SURVIVED the gate — the first pasted plan in 25 to do so. Deliberately NO player dependency at any point: native `<video>` covers scrub/fullscreen/PiP/captions, and the two items where a library was "supposed to earn itself" (dock, focus panel) did not need one. |
| BDN-318 | ★★★ `getTranscript` was DISCARDING every timing the API returns. Read `json.transcript ?? json.text` — `transcript` is not a key this endpoint returns — and threw away `word_timestamps`. Three features looked backend-blocked; the blocker was ours. |
| BDN-319 | Upload lane (`/api/ai/chat/media-upload`). Video accepted on `lane:"upload"`, never `inline` — accepting it without the lane would have silently base64'd video into chat rows. |
| BDN-320 | Transcript pane, five distinct empty states. Honest limit stated IN THE UI: url→videoId is session-scoped memory, so it says so after a reload rather than guessing a parse it could not verify. |
| BDN-321 | ★★★ **The VideoDB client had NEVER worked** — 4 bugs (singular paths · `{data,success}` envelope · 3-step presigned upload · **refusal inside HTTP 200**). ★★★ **Account balance is $0.00** — the remaining blocker is COMMERCIAL, not code. |

**★★★ SELF-AUDIT OF THIS ARC (operator asked; findings are about MY OWN
work, and they were real):**

1. **Four instruments shipped UNWIRED** — `summarizePersonaByLane`,
   `summarizeEstimativeCompliance`, `toEvidenceRef`,
   `reopenTargetFromKey` had no caller outside tests. The BDN-313 PR
   claimed media was claims.ts's "first real producer": true at the
   import level, FALSE in behaviour — nothing mints an EvidenceRef.
   Corrected in the source header rather than quietly patched.
   `scripts/report-nick-instruments.ts` now makes the two censuses
   runnable.
2. **★★★ A real defect in BDN-301's confound guard.** Nothing in the app
   records `taskClass` — judge-eval persists only `judgedBy` + `rubric`.
   Every row therefore arrives "unknown", both lanes get an identical
   one-bucket mix, total-variation distance is 0, and the guard reported
   `comparable: true`. **It would have certified a completely
   UNSTRATIFIED comparison as safe to rank on** — the exact failure it
   exists to prevent, reached from the opposite direction. Fixed: an
   all-unknown census is never comparable. Pinned by test.
3. **Dead code deleted**: `getTranscriptText` (a back-compat shim for
   callers that did not exist) and `__clearVideoRegistryForTest` (a test
   seam no test used).
4. **Docs were skipped across 8 PRs** — CURRENT-TRUTH had zero mention of
   the arc until this audit. `check:stale-docs`: 0 critical.

**Standing lesson: a measurement that cannot be invoked measures
nothing.** Grep for IMPORTERS of every new read model before calling it
shipped — this session criticised claims.ts for exactly this and then
reproduced it four times in one arc.

**★★★ LANDMINE — BDN-310:** the Prisma client now TYPES columns
(`valid_from`/`valid_until`/`last_verified_at`/`superseded_by_id`) that
the database does NOT have. The migration is authored and deliberately
NOT applied. Apply it before any code reads those fields.

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
