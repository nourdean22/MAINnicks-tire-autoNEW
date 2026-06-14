# STATENOUR Architecture Intelligence Report

> **Session:** 2026-06-10 · architecture map + best-in-class benchmark + transformation-priority roadmap
> **Repo truth:** worktree `statenour-architecture-intelligence` @ origin/main `4d12686c` · production = main → Railway `statenour-web` → bdnick.info (verified 200, `/api/health` healthy, db 250ms)
> **Method:** 5 read-only repo-mapping agents (file:line evidence) + 5 best-in-class research agents (24 products/repos, sources cited) + an adversarial claim-verification workflow (9 disputed claims re-grounded in code) + synthesis.
>
> **Epistemic status (clarity-gate):**
> - Repo claims are code-verified with `file:line` citations unless marked **UNVERIFIED**. Disputed claims were adversarially re-verified — see §20 Verification Register.
> - **Every effort and impact score in this document is an estimate `(est.)`, not a measurement.**
> - External-product claims carry confidence levels and source links; benchmark numbers from vendors are treated as marketing, patterns as signal.
> - Live production reads (task counts, radar zeros, alert counts) are point-in-time snapshots from `/api/health` on 2026-06-10 — they describe today, not a trend.
> - This is an audit/design document. Nothing in it was implemented this session; no migrations, no production writes.

---

## 1. Executive Summary

**STATENOUR is architecturally ahead of every open-source reference it was benchmarked against — and product-behind its own architecture.** The memory stack (3-lane RRF + FTS + graph + reranker) is richer than Mem0/Letta ship; the fabrication-defense stack (L1–L5) has no equivalent in any benchmarked chat product; the cron/receipt/approval substrate already *is* the durable-execution engine LangGraph exists to provide. The 2026-06-09 wiring wave closed most of the old reachability crisis (slash commands, reward toast, receipts feed — all verified live this session, contradicting stale audit docs).

**What remains is a loop-closure crisis, in five specific places (all code-verified):**

1. **Intelligence is generated but not delivered.** The prediction engine writes 1–4 Brier-scored forecasts *every day* (`lib/brain/predictive-engine.ts:233`) — the operator has never seen a track record. Journal takes generate a `nextAction` per entry — it dies in a BrainMemory display row, never becomes a Task (`lib/brain/journal-brain.ts:464`). Drift alerts fire — 26 sit unresolved with no triage affordance.
2. **Honesty is built but not enforced.** `canClaimDone()` exists, is tested, and has zero production call sites (`lib/ai/receipts/action-receipt.ts:161`). Receipts are written fire-and-forget; nothing reads them back before Nick claims "done."
3. **The proactive layer is silently fragile.** The morning brief broke when Wave AE deleted its durable producer and the Inngest replacement never persisted the row — `ready:false` in production today; fixed in-flight by a sibling session (`fb851113`) hours before this report. `withErrorCapture` previously hid a chat crash for weeks. Failures are captured, not *visible*.
4. **The execution funnel front-door is jammed.** 201 of 530 tasks sit in INBOX (8 ready, 2 doing) — a triage-design failure (no one-at-a-time flow, no honest Someday state), not a capture failure.
5. **The system's oxygen is journaling cadence — and it's low.** The Pattern Radar is empty not because its feeder is missing (it runs nightly at 22:00 UTC) but because fewer than 3 journal entries landed in 14 days (`lib/services/journal-convergence.ts:680`). Every downstream intelligence system starves quietly with it, and no surface says so.

**The strategy this report recommends:** close verified loops first (a week of S-effort wires), then install the three rhythm machines the benchmark says create durable transformation (one-at-a-time inbox triage · auto-rolling weekly cycle + a *delivered* Monday digest · journal→action→check-in), then upgrade memory from archive to metabolism (write-gate, bi-temporal history, FSRS review, pinned identity blocks), and only then build the genuinely new thing no benchmarked product has: **an agenda-carrying Nick that opens conversations from witnessed commitments.** Build nothing that adds surface without closing a loop (§17).

---

## 2. STATENOUR System Map

Status legend: **LIVE** (wired + receiving data) · **LIVE-quiet** (wired, output under-surfaced) · **STARVED** (wired, insufficient input) · **DORMANT** (built, unreachable/never invoked) · **PARTIAL**. Risk = what breaks or rots if untouched.

| # | System | Purpose | Key files | Status | Strength | Weakness | Opportunity | Risk |
|---|---|---|---|---|---|---|---|---|
| 1 | **Chat / Nick** | Conversational operator interface; ~113 tools; action blocks | `app/api/ai/chat/route.ts` (~1400 ln) · `lib/ai/chat/*` · `lib/services/chat/persist-assistant-turn.ts` | LIVE | Tool pruning 113→15-30 by mode; parallel prompt assembly; domain model routing; provider failover; AgentTrace/cost rows | Turn-stateless beyond recall (no cross-session agenda); god-route; 7 intelligence flags default-OFF; no per-message eval loop; no persona/spec switching | Specs picker · conversation FTS search (tsvector exists) · thumbs→Elo · annotation-reply · filter-chain refactor | Med: hottest path; complexity hides bugs (the `.match` class) |
| 2 | **Truth / Claim Guard** | Prevent fabricated actions/facts (L1–L5) | `lib/ai/system-prompt.ts` · `fabrication-rewriter.ts` · `sanitize-history.ts` · `truth-grounding.ts` · `action-claim-detector.ts` · `action-result-verifier.ts` | LIVE | 5 independent layers; shared verb vocab input/output; operator correction chip | Verb-regex (number-blind: "sent 3" passes if 1 sent); L4 grounds entity counts not derived claims | Numeric/entity-id cross-check in L5 | Low-Med |
| 3 | **Actions / Receipts** | Execute structured actions; record honest outcomes | `lib/ai/nick-agent.ts` · `lib/ai/agent-actions/*` · `lib/ai/receipts/action-receipt.ts` · `lib/services/action-receipt-feed.ts` | PARTIAL | Execution live; receipts written per side-effecting action (AuditEvent); `/receipts` command live in chat | **`canClaimDone()` orphaned — zero production call sites** (`action-receipt.ts:161`); receipts advisory-only; no undo affordance | Wire the gate at finalize (hedge or warn); undo from receipt | **High**: "done" can be claimed over failed actions |
| 4 | **Journal (capture)** | Raw thought → structured intelligence; 4 silos | `lib/brain/journal-ingest.ts` (`ingestJournal`) | LIVE | Instant capture, async enrich; extraction gates kill zombie tasks/commitments; 90s dedup; brain-bus emit | extractedItems is a JSON blob (no DB-level filtering); no semantic dedup beyond 90s | Daily-note spine; AI-filled typed fields (Tana) | Low |
| 5 | **Journal Brain** | Ground entries vs goals/missions; XP; takes | `lib/brain/journal-brain.ts` (`enrichJournalEntry`, `generateJournalTake`, `confirmJournalLink`) | LIVE-quiet | Real grounding (DB-inlined goals); idempotent XP sourceKeys; Telegram + web confirm both verified functional end-to-end | **take.nextAction never becomes a Task** (`journal-brain.ts:464`, display-only); **backfill never automated** (~990 historical rows unenriched per design doc — count UNVERIFIED in prod); resweep only 25/night | nextAction accept-chip; dialogic follow-up; operator-gated backfill run | Med |
| 6 | **Memory / BrainMemory** | Long-term operator knowledge; lifecycle | `lib/brain/memory-manager.ts` · `categories.ts` (201 registry keys, incl. 12 deprecated) · `memory-consolidation.ts` | LIVE | Confidence lifecycle (reinforce/promote/decay); nightly merge w/ soft-delete; graph edges; category registry validates writes | No write-time dedup/conflict gate; contradictions flagged never resolved; trusted sources never decay; no operator review queue | `commitMemory()` write-gate (Mem0); bi-temporal `validFrom/invalidAt` (Graphiti); FSRS review | **High** (slow rot): years-long store accumulating stale/contradictory facts |
| 7 | **Search / Retrieval** | Recall into every Nick turn | `lib/brain/contextual-recall.ts` (RRF over semantic+FTS+keyword + graph hop + reranker; 4k budget; wisdom slots) | LIVE | Above benchmarked-field median; real Postgres FTS lane; stage-level timing telemetry | **No ground-truth eval loop** — every weight (RRF [2,1,1], category scores, trust multipliers) is an unmeasured guess | Usefulness ratings → eval set → tune weights; 1-hop link-walk already exists — measure it | Med: blind optimization |
| 8 | **Tasks** | GTD pipeline, loop kinds, classification | `lib/trpc/routers/task/*` · `lib/ai/classify-task-linkage.ts` · `lib/services/task-rescue.ts` | PARTIAL | Classifier chokepoint w/ confidence gates + correction capture; TaskEvent append-only; WEEKLY recurrence; rescue strip | **201/530 in INBOX (live 2026-06-10)**; no one-at-a-time triage; no Someday state; no start≠deadline split | Things-style 4-exit triage + Snooze/Kill | **High** (UX): front door jammed |
| 9 | **Missions** | 6 GENERAL domain anchors + user projects | `lib/missions/domains.ts` · `mission-helpers.ts` | LIVE | Domain-first routing; anchor fallback means no orphan tasks; rescue strip + anchor links on /missions (verified) | No timebox/cycle concept; anchors absorb without forcing review | Weekly cycle (Linear) on top of anchors | Low-Med |
| 10 | **Goals** | Ladder, kinds, conviction/kill, drift detection | LifeGoal model · `goal-ladder.ts` · `goal-drift-classify.ts` + daily cron · GoalBoard on /stats | LIVE-quiet | Authoring-rich (conviction, killBy, identityLine, ladder rollup); drift detector cron fires | Engagement-poor (~1 active goal vs ~10 missions — snapshot, UNVERIFIED today); drift alerts' reach to operator unproven | Cycle-close prompts goal creation from high-momentum missions | Med |
| 11 | **XP / Scoreboard** | Credit signals → 33-stat character sheet | `lib/mastery/*` (`credit-signal`, `creditTaskStats`, `task-reward`, `xp-drift`) · /stats | LIVE | Write-time credit + nightly backfill, idempotent sourceKeys; **honest reward toast verified live on all 3 completion paths** (`missions/page.tsx:178-212`); xp-drift nudges | XP means nothing weekly (no cycle/velocity framing); no streak freeze valve; no consequence loop | Reframe as measurement: velocity, per-anchor grades, daily goal + streak w/ freeze | Med |
| 12 | **Predictions / Calibration** | Brier-scored forecasting | `lib/brain/predictive-engine.ts` · `outcome-tracker.ts` · `/api/cron/predict` (EVENING_JOBS) | **LIVE-quiet** | **Verified alive: creates 1–4 predictions/day, AI-scored resolution w/ brierScore + lesson; accuracy injected into Nick's prompt** (`outcome-tracker.ts:259`) | Operator-invisible: no track-record surface; no operator-*made* predictions; calibration plot deferred behind n≥10-resolved gate | Surface the existing rows; Nick-drafted operator predictions w/ personal base rates; auto-resolution | Med: a differentiator rotting unseen |
| 13 | **Threads / Pattern Radar** | Convergence clusters across journal silos | `lib/services/journal-convergence.ts` · `journal-threads.ts` · Inngest 22:00 UTC | **STARVED** | Feeder cron verified wired; full lifecycle (candidates→confirm→auto-join→dormancy) reachable | **Empty because <3 journal entries in trailing 14d** (`journal-convergence.ts:680` early-return); empty state is silent — looks broken, says nothing | Starving-state honesty on /market radar + journal-cadence nudge; lower bar only after cadence | Med |
| 14 | **Briefs (daily/weekly)** | Morning brief; weekly digest/review | `lib/services/morning-brief.ts` · `src/inngest/functions/morning-brief.ts` · weekly-digest/review crons | PARTIAL→fix in flight | 4-slice graceful-degradation compose; push + TTS channels | **Broken today (ready:false): Inngest compose never persisted; legacy producer deleted in Wave AE** — root-caused; fix `fb851113` landed on main this morning (verify post-deploy); weekly digest exists but isn't the Monday-drop ritual artifact | Monday drop: velocity/anchors/stale-people/calibration delivered to Telegram | **High** (trust): silent morning failure |
| 15 | **Notifications / Telegram / Voice** | Reach the operator without app-open | `lib/services/telegram.ts` · webhook · `lib/notifications/push.ts` (VAPID) · LiveKit voice + Cartesia TTS | PARTIAL | Telegram journal flows verified live; push tag-deduped; fatal-error aggregation every 10min | Telegram *rules* dormant; push silently dead if permission/VAPID lost; voice agent fragile (separate process, no healthcheck); **Google OAuth expired — calendar/drive ingest failing daily** (operator re-auth needed) | Make Telegram the delivered-artifact channel (Monday drop, stay-in-touch, check-ins) | **High**: OS is pull-only in practice |
| 16 | **Onboarding / first-use** | n/a (single operator) | minimal empty states; no command palette docs | BUILT-minimal | No tutorial bloat (operator preference honored) | No feature discovery → this audit found live features the *audit docs* thought were unwired | /system "what can I do" card generated from command registry | Low |
| 17 | **PWA / Mobile** | iPhone standalone primary surface | `app/manifest.ts` · `public/sw.js` · in-DOM confirm sweep (iOS) | PARTIAL | Manifest + shortcuts + 44px targets; iOS confirm-dialog sweep done in prior waves | Service worker behavior unaudited; no offline queue; draft loss on refresh | Offline capture queue for journal (later) | Med |
| 18 | **Settings / operator controls** | Tuning + autonomy gates | /settings · JournalBrainPanel (7 knobs) · people-scoring weights · AutomationPolicy + /system/approvals | LIVE | Fail-closed autonomy (approval queue); live-tunable journal knobs | NICK_* flags env-var-only (no UI); tuning panels poorly discoverable | Flag registry card w/ flip affordance (where safe) | Low-Med |
| 19 | **System health / logs / digest** | Observability + ops | `lib/services/system-pages.ts` · /system hub · cron-diagnostics · AgentTrace · `withErrorCapture` | PARTIAL | Rich KPI rollup; cron manifest + check scripts; digest cards (what-changed/evals/receipts) live | **26 unresolved alerts, no resolve/mute affordance**; `.catch(()=>default)` makes "empty" and "failed" identical; 20/21 dead devices pollute health; failures captured-not-visible | Alert triage endpoints + bulk UI; failure-as-artifact; archive dead fleet | **High** (alert fatigue: warnings lost credibility) |
| 20 | **Admin / system tooling** | Migrations, seeds, runbooks, checks | guarded `apply-pending-migration` · runbooks + `check:runbooks` · `check:crons` / `check:stale-docs` / `eval:memory` | LIVE | Guarded prod-write endpoints; truth-eval scoreboard; stale-doc guard | Checks are dev-run only (not scheduled); runbooks docs-not-interactive | Schedule the check scripts as a weekly cron writing a digest card | Low |

---

## 3. Data Flow Map

~80 Prisma models clustered by system; the interesting facts are the sinks and the starved readers.

**Capture in:** chat (113 tools, action blocks) · journal 4 silos (BrainDump/Reflection/SituationLog/DecisionReplay) · Telegram (`/dump`, check-ins) · Gmail/Calendar/Drive ingest crons (**Calendar/Drive currently failing daily — Google OAuth `invalid_grant`, operator re-auth required**) · nickstire business bridge · capture inbox (triage states).

**Core write spine (all LIVE):** `Task`/`TaskEvent` ← classifier chokepoint (`enrichTaskLinkage`) · `BrainMemory` (201 registry categories) ← journal-ingest, consolidation, digests, people-intelligence, chat post-process · `VectorEmbedding` (dual 768/1536, HNSW) ← embed-backfill + write-time · `mastery_xp_event` ← `creditTaskStats`/`creditFromSignal` (idempotent sourceKeys) · `Prediction` ← daily predict cron · `EntityAudit`/`AuditEvent` ← universal mutation audit + action receipts · `AgentTrace` ← every AI call · `CronJobLog` ← every cron.

**Verified-corrected edges (stale docs said otherwise):** F1–F5 commands → chat slash menu + interceptor (`interceptors.ts:355`) **LIVE** · task completion → reward toast (`missions/page.tsx:178-212`) **LIVE** · journal link confirm → Telegram webhook `jlink` + web LinkChip **LIVE** · predict cron → Prediction rows → accuracy → system prompt **LIVE**.

**Data sinks (written, weak/no reader — candidates for wiring or retirement):** `MasteryScore` (retired Apr 18, 20 orphan rows) · `DriftAlert` (26 unresolved, no triage affordance) · `SmartDevice`/`DeviceEvent`/`VisionEvent` (fleet dead since 2026-04-14; 20/21 offline polluting health) · `DailyEmpireSnapshot` (written nightly, no trend UI) · thinking-memory L7–L12 models (`StrategyLaw` partially read by Greene crons; `Contradiction`/`IdentitySnapshot`/`CausalChain`/`EnvironmentalSignal` — readers UNVERIFIED, likely dormant) · `RelationshipPlay` (schema only).

**Starved readers (reader exists, input missing):** Pattern Radar (needs ≥3 journal entries/14d — `journal-convergence.ts:680`) · calibration plot (gated n≥10 *resolved-and-seen*; rows exist, surface doesn't) · backfilled journal enrichment (≈990 historical rows unenriched — design-doc figure, UNVERIFIED in prod) · goal ladder rollups (engagement-limited).

**Cron map (verified shape):** ~36 active (mega-morning 9:00 UTC fan-out ≈14 jobs · mega-evening 03:00 UTC ≈16 jobs incl. predict/consolidate/autonomous-engine · weekly Sunday set) + Inngest-native singles (morning-brief 10:00, goal-pruner, goal-drift, journal-convergence 22:00, thread-dormancy, industry-pull, heartbeat) + 2 dormant (relationship-digest, decision-quality-drift). Wave-AE lesson encoded in `check:crons`: deleting routes without cleaning fan-out arrays once killed the whole morning fan-out for 2 days.

---

## 4. Intelligence Flow Map

The loop the product is supposed to run, with each edge's verified state:

```
CAPTURE (chat · journal · telegram · email) ──LIVE──▶ EXTRACT/TYPE (entryType gates, classifier)
   ──LIVE──▶ MEMORY (BrainMemory + embeddings)        [write-gate MISSING: no dedup/conflict resolution]
   ──LIVE──▶ RECALL (RRF+FTS+graph+rerank, 4k budget) [eval loop MISSING: quality never measured]
   ──LIVE──▶ PROMPT (8-piece assembly + truth grounding + accuracy context)
   ──LIVE──▶ ACTION (tools + action blocks) ──LIVE──▶ RECEIPTS (AuditEvent)
                                              └─MISSING─▶ ENFORCEMENT (canClaimDone: 0 call sites)
   ──LIVE──▶ XP/STATS (credit + toast)        [consequence loop MISSING: XP→nothing weekly]
   ──LIVE──▶ PREDICTIONS (1–4/day, Brier-resolved) ──MISSING──▶ OPERATOR (no track-record surface)
   ──LIVE──▶ TAKES (idea/challenge/nextAction) ──MISSING──▶ TASKS (nextAction is display-only)
   ──STARVED─▶ PATTERN RADAR (<3 entries/14d → silent empty)
   ──PARTIAL─▶ BRIEFS/DIGEST (morning brief persist bug, fixed in flight `fb851113`;
               weekly digest exists but is not a delivered ritual artifact)
   ──PARTIAL─▶ OPERATOR ATTENTION (Telegram flows live; rules dormant; push fragile;
               26 unresolved alerts = warnings without credibility)
        ▲
        └────────── the loop back to capture depends on the operator opening the app (PULL-ONLY)
```

Reading: every **LIVE** edge above is genuinely good engineering. The product gap is concentrated in the five **MISSING/PARTIAL** edges — all of which terminate at the same place: *the operator's attention and next action*. That is why §12 ranks delivery-and-loop-closure moves above any new intelligence.

---

## 5. User Journey Map

A day in the operating loop, with break points (live-verified where marked):

| Moment | Intended | Actual (verified) | Break |
|---|---|---|---|
| **Wake** | Brief arrives (push/Telegram/voice) | `ready:false` today; compose ran, persist didn't (fixed in flight `fb851113`); push silently dead if VAPID/permission lapsed | **Silent morning failure**; no alert says "brief missing" |
| **Capture** | Thought → Telegram/chat/journal in seconds | Strong: instant capture, async enrichment, gates | — (best part of the journey) |
| **Triage** | Inbox → committed/scheduled/someday | **201 in INBOX vs 8 ready** (live); no one-at-a-time flow; classifier chips wait for visits that don't happen | **Front door jammed** |
| **Execute** | Pick from small ready pool; complete; feel credit | Toast verified live (+XP/goal/streak); rescue strip live | Ready pool starved by triage break |
| **Reflect** | Journal entry → grounded link → take → next action | Grounding + confirm chips live (web+Telegram); **take.nextAction display-only** | Insight→action loop open |
| **Calibrate** | See predictions resolve; learn own base rates | Engine alive daily; **operator has no surface**; plot deferred behind n≥10 gate | Intelligence invisible |
| **Review (weekly)** | A delivered ritual: velocity, neglect, patterns, next cycle | weekly-digest/review crons exist; no auto-rolling cycle; no Monday-drop artifact; radar silently empty | **No rhythm machine** |
| **Relationship upkeep** | Stale people surfaced; promises tracked both ways | person-credit + open promises live; no stay-in-touch intervals; no owed-to-me ledger | Decay by default |
| **System upkeep** | Failures visible, alerts actionable | 26 unresolved alerts, no resolve button; OAuth expired failing daily ingest; 20 dead devices in health | **Warnings lost credibility** |

The journey verdict: capture and execution feedback are excellent; **triage, delivery, and review — the moments that convert capture into transformation — are where the journey breaks.**

---

## 6. Weakest Systems Ranking

Ranked by the Phase-2 criteria (transformation/action/intelligence/memory gaps · UX friction · reliability · disconnected/underused data · strategic importance · feasibility). Evidence is code/live-verified per §20.

| Rank | System | Why weak | Evidence | User impact | Product impact | Fix difficulty | Strategic priority |
|---|---|---|---|---|---|---|---|
| 1 | **Task inbox / triage** | Action gap at the front door: capture works, commitment doesn't; no mandatory-exit triage, no Someday, no snooze-exit | live `/api/health`: inbox 201 / ready 8 / doing 2 | Operator picks work from memory, not the system; graveyard guilt | The execution OS isn't trusted with execution | **S–M** | **P0** |
| 2 | **Honesty enforcement seam** | The product's core differentiator (receipts) stops one call short of enforcement | `canClaimDone` 0 call sites (`action-receipt.ts:161`); receipts fire-and-forget (`persist-assistant-turn.ts:463-479`) | "Done" claims over failed actions possible | Trust moat aspirational, not structural | **S** | **P0** |
| 3 | **Delivery / proactive layer** | Pull-only OS: brief persist bug (today), dormant Telegram rules, fragile push, no delivered weekly artifact, OAuth-expired ingest failing daily | C9 verdict; crons.ts dormant entries; TASKS.md OAuth item | The system only helps when visited | Retention ceiling; rituals never form | **S–M** | **P0** |
| 4 | **Journal→Action closure** | Insight generated, action not proposed: nextAction display-only; backfill never run; resweep 25/night only | C7 verdict (`journal-brain.ts:464`; tRPC-only backfill) | Sharp takes feel decorative | The "thinking partner" promise leaks | **S** | **P0** |
| 5 | **Predictions (operator loop)** | Underused existing data, maximal: daily Brier-scored engine with zero operator surface; no operator-authored predictions | C3 verdict (`predictive-engine.ts:233`, `outcome-tracker.ts:45-158,259`) | Operator never confronts own calibration | A core transformation-OS capability invisible | **M** | **P1** |
| 6 | **Memory quality control** | Memory gap: no write-gate, contradictions persist flagged-not-resolved, trusted-source immortality, no review queue, retrieval never evaluated | `memory-manager.ts:205-216` contradict(); 201 registry categories; no eval dataset | Recall gradually trusts stale/conflicting facts | Years-long compounding rot of the core asset | **M** | **P1** |
| 7 | **Weekly rhythm (cycles/review)** | No timebox machine; review-by-discipline instead of review-by-delivery | no cycle model in schema; weekly crons un-ritualized | Drift between intentions and weeks | The metronome of transformation missing | **M** | **P1** |
| 8 | **Pattern Radar** | Starved + silent empty state (downstream of journal cadence) | C2 verdict (`journal-convergence.ts:680` early-return; 0/0/0 live) | Looks broken; teaches operator to ignore it | Pattern-visibility promise unmet | **S** (honesty) | P1 |
| 9 | **Goals engagement** | Authoring-rich, usage-poor; drift alerts' operator-reach unproven | ~1 active goal snapshot (UNVERIFIED today) vs 10 missions | Identity layer under-expressed | Ladder/conviction machinery idle | **S–M** | P2 |
| 10 | **XP consequence** | Credit+toast live; no weekly meaning (velocity/grades), no streak mercy valve | C4 verdict (toast live); no cycle framing | Numbers without narrative | Motivation loop shallow | **S** | P2 |
| 11 | **System health triage** | Alerts unactionable; empty vs failed indistinguishable; dead fleet noise | 26 unresolved live; `.catch(()=>0)` patterns; 20/21 devices offline | Warning blindness | Real P0s will be missed | **S** | P2 |
| 12 | **Nick continuity/eval** | No agenda; no per-message eval loop; flags graveyard (7+ default-OFF) | route flags audit; no feedback aggregation | Re-explaining context; no compounding correction | Chat stays a very good oracle | **M–L** | P2 (becomes P0 in 90d as §13/§14 sequence) |
| 13 | Retrieval eval | Quality unmeasured (blind weight tuning) | no labeled set; weights hardcoded | Invisible | Optimization without ground truth | M | P3 |
| 14 | PWA/offline · settings UI · device fleet | Friction + noise items | sw unaudited; env-only flags; dead devices | Minor daily costs | Hygiene | S each | P3 |

---

## 7. Best-in-Class Benchmark Table

Scores are 1–10 `(est.)`. "Maps to" = the STATENOUR system the reference teaches. Confidence = how well the reference's mechanics were grounded (repo/docs fetched vs marketing).

| Reference | Maps to | What it is | Top steal | Transform | Action | Retention | Effort | Confidence |
|---|---|---|---|---|---|---|---|---|
| **Logseq** | Journal/Knowledge | OSS journal-first outliner; blocks as graph nodes; DB-version moved to typed nodes (tags-as-classes) | Daily-note capture spine; block-level entity links | 7 | 7 | 6 | S–M | High |
| **Obsidian (+spaced-rep plugin)** | Memory review | Local-first vault; plugin proves *note*-review queues (not flashcards) | Review queue over memories/insights; schedule-data-on-entity | 6 | 5 | 9 | S–M | High |
| **Tana** | Journal/Capture/Actions | Supertags = typed objects w/ AI-filled fields + per-type AI instructions; pivoted to "AI on a context graph" | AI-filled typed fields at capture; proposal-based AI writes | 8 | 9 | 5 | S–M | High |
| **Reflect** | Retrieval | Minimalist daily notes + graph-aware AI retrieval | 1-hop link-walk added to recall; day-anchored prompts | 5 | 6 | 5 | S | Med |
| **Anki (FSRS)** | Memory decay/review | Reference SRS; FSRS = Difficulty/Stability/Retrievability scheduling, `ts-fsrs` exists | FSRS-scheduled resurfacing of memories/decisions | 7 | 6 | 10 | M | High |
| **Mochi** | Memory review UX | Markdown SRS; deliberately 2-button | The 2-button ceiling: one tap or it won't be used | — | — | — | S | High |
| **Rosebud** (added) | Journal→Action | AI dialogic journaling; reflection→goal pipeline; 150k users | One grounded follow-up question at capture; action check-ins | 9 | 9 | 6 | S–M | Med |
| **Open WebUI** | Chat/Nick | Self-hosted chat; Filters (inlet/outlet middleware), Workspace Models, Elo eval loop | Filter-chain decomposition of the god-route; thumbs→Elo leaderboard | 6 | 6 | 7 | S–M | High |
| **LibreChat** | Chat/Nick | ChatGPT-parity OSS; message-tree forking, modelSpecs presets, memory-agent w/ validKeys | Named "Nick specs" picker; conversation search; `parentMessageId` now | 7 | 6 | 8 | S–M | High |
| **AnythingLLM** | Chat/Tools | Single-user-friendly LLM app; drop-in agent skills; scheduled agent runs | Tool manifests w/ config schema; scheduled Nick-runs | 7 | 8 | 6 | S–M | High |
| **Dify** | Chat eval loop | LLM-app platform; Annotation Reply = curated answers intercept similar future queries | Annotation-reply mini: corrections become permanent behavior | 9 | 5 | 6 | M | High |
| **Khoj** (added) | Proactivity | OSS "second brain" w/ Automations: scheduled standing queries pushed to user | Standing-instruction rows Nick executes on cron and delivers | 8 | 8 | 9 | S–M | Med-High |
| **Mem0** | BrainMemory writes | Memory layer; write-time ADD/UPDATE/DELETE/NOOP conflict resolution vs top-10 similar | The write-time conflict gate at one choke point | 9 | 5 | 7 | M | High (paper) |
| **Letta (MemGPT)** | BrainMemory identity | Agent server; pinned core-memory blocks the agent self-edits + sleep-time consolidation agents | 3–5 pinned operator blocks injected every turn; nightly consolidation cron | 9 | 6 | 7 | S–M | High |
| **Supermemory** | BrainMemory profile | Closed SaaS universal memory API; `profile()` standing context; temporal expiry | `expiresAt` on time-bound facts; pre-computed operator profile | 7 | 5 | 6 | S | Med-Low |
| **Zep/Graphiti** (added) | BrainMemory history | Bi-temporal knowledge graph: `valid_at`/`invalid_at`, invalidate-not-delete | Bi-temporal columns on BrainMemory; "what was true in January" as a query | 8 | 5 | 7 | S–M | High |
| **LangGraph** | Background agents | Graph orchestration w/ checkpointing + `interrupt()` HITL | The interrupt pattern **implemented on existing Inngest** (`step.waitForEvent`) | 8 | 8 | 7 | S–M | High |
| **n8n** | System ops | Workflow automation; error-workflows + run-history-with-retry | Failure-as-artifact: global `onFailure` → visible record + notify | 6 | 6 | 7 | S | High |
| **CrewAI** | (anti-pattern) | Role-based multi-agent crews | Only: role decomposition as sequential prompts; `expected_output` schemas | 4 | 4 | — | S | Med-High |
| **Flowise** | (anti-pattern) | Visual LLM-chain builder | Almost nothing — workflows-as-inspectable-data at most | 3 | — | — | — | Med-High |
| **Metaculus** | Predictions | Forecasting platform; operationalized resolution criteria; Brier track record UX | Nick-drafted predictions w/ resolution criteria + auto-resolution from task data | 9 | 7 | 7 | M | High |
| **Good Judgment / GJP** | Predictions | Calibration training research; <1hr training improved Brier 6–12% | Personal base rates from the operator's own completion history | 8 | 7 | 6 | S–M | High (primary source) |
| **Things 3** | Tasks/Inbox | The benchmark for inbox taming: mandatory-exit triage, Today/Anytime/Someday, start≠deadline | One-at-a-time 4-exit triage + an honest Someday state | 7 | 9 | 7 | S–M | High |
| **Todoist (Karma)** | XP/streaks | NL capture + karma points/streaks | Daily goal + streak **with vacation/freeze valve**; skip the points | 4 | 6 | 7 | S | High |
| **Linear** | Missions/cycles | "Momentum by default": auto-rolling cycles, triage-as-state, capacity from trailing velocity | Personal weekly cycle w/ auto-rollover + rolled-N× counter + capacity line | 9 | 9 | 8 | M | High |
| **Plane** | (reference impl) | OSS Linear-alike | Cycle/module schema shapes as free reference code | 3 | — | — | S | High |
| **Twenty** | People | OSS CRM "designed for AI"; per-record unified activity timeline | Per-person unified timeline on PersonProfile | 5 | 5 | 5 | M | High |
| **Monica** | People | OSS *personal* CRM; stay-in-touch intervals, gifts/debts ledger, life events | Stay-in-touch interval → Telegram brief; two-directional promise ledger | 6 | 8 | 8 | S–M | High |
| **Exist.io** | Stats/QS | Personal analytics; day-grained attributes; confidence-starred correlations; **the Monday email** | The delivered weekly digest ("Monday drop"); confidence stars on insights | 8 | 6 | 9 | S→M-L | High |
| **Gyroscope** | Stats | Auto-tracking aggregator; composite health score with explanations | Per-anchor grade *with what-changed explanation* (later) | 5 | — | — | M | Med |
| **Nomie** | Capture | One-tap subjective trackers (dormant OSS) | `#mood(7)` inline tracker notation in chat/journal; one-tap Telegram log row | 6 | 6 | 6 | S | High |
| **Metabase/Appsmith/ToolJet** | (anti-pattern) | Team BI / internal-tool builders | One invariant only: every dashboard number drills to its receipts | — | — | — | S | High |

---

## 8. Open-Source Repo / Resource Links

**Knowledge / Journal:** [Logseq](https://github.com/logseq/logseq) · [Logseq DB-version doc](https://github.com/logseq/docs/blob/master/db-version.md) · [Obsidian](https://obsidian.md) · [obsidian-spaced-repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition) · [Tana supertags](https://outliner.tana.inc/learn/features/supertags) · [Reflect](https://reflect.app) · [Rosebud](https://www.rosebud.app)
**Spaced review:** [Anki](https://github.com/ankitects/anki) · [FSRS wiki (ABC of FSRS)](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/ABC-of-FSRS) · `ts-fsrs` (open-spaced-repetition org) · [Mochi](https://mochi.cards)
**Chat:** [Open WebUI](https://github.com/open-webui/open-webui) ([Functions](https://docs.openwebui.com/features/extensibility/plugin/functions/) · [Evaluation/Elo](https://docs.openwebui.com/features/administration/evaluation/) · [Workspace Models](https://docs.openwebui.com/features/workspace/models/)) · [LibreChat](https://github.com/danny-avila/LibreChat) ([fork](https://www.librechat.ai/docs/features/fork) · [memory](https://www.librechat.ai/docs/features/memory) · [modelSpecs](https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/model_specs)) · [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm) ([custom skills](https://docs.anythingllm.com/agent/custom/introduction)) · [Dify](https://github.com/langgenius/dify) ([Annotation Reply](https://docs.dify.ai/en/guides/annotation/annotation-reply)) · [Khoj](https://github.com/khoj-ai/khoj)
**Memory:** [Mem0](https://github.com/mem0ai/mem0) ([paper](https://arxiv.org/abs/2504.19413) · [docs](https://docs.mem0.ai/core-concepts/memory-operations)) · [Letta](https://github.com/letta-ai/letta) ([memory blocks](https://docs.letta.com/guides/agents/memory-blocks/) · [sleep-time](https://docs.letta.com/guides/agents/architectures/sleeptime/) · [MemGPT paper](https://arxiv.org/abs/2310.08560)) · [Supermemory](https://github.com/supermemoryai/supermemory) · [Graphiti (Zep)](https://github.com/getzep/graphiti) · [LangMem](https://langchain-ai.github.io/langmem/) · benchmark-war caution: [Zep vs Mem0 dispute](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/)
**Orchestration:** [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence) · [Inngest waitForEvent](https://www.inngest.com/docs/features/inngest-functions/steps-workflows/wait-for-event) · [n8n error handling](https://docs.n8n.io/flow-logic/error-handling/) · [CrewAI](https://github.com/crewAIInc/crewAI) · [Flowise](https://github.com/FlowiseAI/Flowise)
**Forecasting:** [Metaculus scores FAQ](https://www.metaculus.com/help/scores-faq/) · [GJP training study (Chang/Chen/Mellers/Tetlock)](https://www.sas.upenn.edu/~baron/journal/16/16511/jdm16511.html) · [Stone 2023 automated calibration training](https://onlinelibrary.wiley.com/doi/10.1002/bdm.2334) · [Martin 2025 negative result](https://onlinelibrary.wiley.com/doi/full/10.1002/ffo2.199)
**Execution / People / QS:** [Things 3 guide](https://culturedcode.com/things/guide/) · [Linear cycles](https://linear.app/docs/use-cycles) · [Linear triage](https://linear.app/docs/triage) · [Plane](https://github.com/makeplane/plane) · [Twenty](https://github.com/twentyhq/twenty) · [Monica](https://github.com/monicahq/monica) · [Exist.io](https://exist.io) · [Nomie](https://github.com/open-nomie/nomie6-oss)

---

## 9. Architecture Lessons From Each Reference

One load-bearing lesson per reference — the thing to internalize even if nothing is copied verbatim.

1. **Logseq:** capture should never require a filing decision — the *day* is the default container and links do the organizing later. Its DB-version pivot (files → typed nodes) independently converged on Tana's model: **typed entities + tags-as-classes is the winning primitive**, and STATENOUR already has the storage half (Prisma entities); it lacks the linking half.
2. **Obsidian spaced-repetition plugin:** people demonstrably want to review *notes/beliefs*, not flashcards. Schedule metadata lives **on the entity itself** — a review system is 3 columns and a queue, not a subsystem.
3. **Tana:** "how does the AI know what a thing *is*?" → schema-on-tag: typed fields + **per-type AI instructions** + AI-filled fields at capture. And its pivot is market evidence: the value is *AI acting on a typed context graph*, not the notes app. Its **proposal-based writes** ("AI never changes your workspace without approval") is STATENOUR's own suggest-then-approve philosophy validated externally.
4. **Reflect:** three loops suffice for a one-person tool: frictionless capture → automatic association → AI synthesis. Also a warning: with no review loop and no action layer, notes still rot — capture+recall alone does not transform anyone.
5. **Anki/FSRS:** memory decay is a *solved modeling problem* — Difficulty/Stability/Retrievability with ML-fit parameters, available as a TS dependency. The review log (append-only rating events) is the ground truth that lets the scheduler improve. **Review and forgetting are one mechanism.**
6. **Mochi:** the UX ceiling for a solo human is **one binary tap**. Any review/confirm flow with more than two buttons will silently die on a phone.
7. **Rosebud:** the journal loop that changes behavior is **dialogic** (one follow-up question at capture, when motivation is hot) plus **closed-loop** (extracted commitments get scheduled check-ins). Analysis reports don't change behavior; questions and check-ins do.
8. **Open WebUI:** decompose the chat pipeline into **named, ordered, independently-testable middleware** (inlet/outlet filters) — the architectural antidote to god-route bugs (the `.match` crash class). And per-message thumbs + sibling regens = a free Elo eval loop over providers.
9. **LibreChat:** conversations are **trees, not lists** — add `parentMessageId` while it's cheap. Named "modelSpecs" (label + prompt fragment + model + tool toggles) solve persona-switching and model-switching with one mechanism. A deterministic small **key/value memory with fixed validKeys** complements semantic recall.
10. **AnythingLLM:** "agent + cron" belongs *inside* the assistant product. Tool registries should be **manifests with config schemas**, inspectable and toggleable, not code-only.
11. **Dify:** the conversation log is a **flywheel**: log → human annotation → curated answer intercepts future similar queries → hit-rate analytics. Every operator correction should become a permanent behavior patch.
12. **Khoj:** **standing instructions** ("every Sunday, review my week...") stored as rows and executed on schedule, with output *delivered* — the minimal viable form of assistant proactivity.
13. **Mem0:** the field converged on **write-time conflict resolution**: each new fact is judged against its top-K semantic neighbors (ADD/UPDATE/DELETE/NOOP) by one LLM tool-call. Without this gate, a years-long store rots into confident staleness. (Caveat from their own repo drift: verify the version; they may be moving to append+read-time reasoning for latency.)
14. **Letta:** the most important facts must be **unconditionally present, not probabilistically recalled** — small pinned, char-limited, self-edited memory blocks (operator profile / current arcs / persona) beat retrieval lotteries. Sleep-time consolidation works but with diminishing returns past ~daily.
15. **Supermemory:** (a) time-bound facts need `expiresAt`; (b) **black-box memory without operator visibility is the cautionary tale** — silent automatic contradiction resolution is precisely what a trust-critical personal OS must not do; (c) never put the operator's life memory on a closed SaaS.
16. **Graphiti/Zep:** **bi-temporal edges (`valid_at`/`invalid_at`), invalidate-don't-delete** — superseded beliefs are the *product* in a transformation OS ("what did I believe in January?" becomes a query). Fits STATENOUR's existing soft-delete idiom almost verbatim.
17. **LangGraph:** durable multi-step agents = checkpointing + interrupt/resume. **STATENOUR already owns this engine in Inngest** (`step.run` memoization, `step.waitForEvent`); adopt the *pattern* (pause for operator approval via the existing approval queue), not the framework.
18. **n8n:** ops maturity = **captured ≠ visible**. Every failure is an artifact with a retry affordance; every run is a row. STATENOUR's `withErrorCapture` swallowed a chat crash for weeks — exactly the failure n8n's error-workflow pattern exists to prevent.
19. **CrewAI:** at n=1, multi-agent crews are cost without constituency. Steal only: role passes as *sequential prompts* in one durable function, and zod `expected_output` schemas per background LLM step.
20. **Metaculus:** forecasting sticks when questions carry **operationalized resolution criteria + dates fixed at creation**, and the track record is a first-class page. STATENOUR's unfair advantage: it can **auto-resolve** predictions from its own task/receipt data — Metaculus needs human admins.
21. **Good Judgment:** under-one-hour calibration training reliably improved Brier 6–12%; the strongest component is **base rates / comparison classes**. STATENOUR can compute *personal* base rates ("you hit 4 of your last 9 self-imposed Friday deadlines") from data it already has — the killer single-user feature no platform offers.
22. **Brier literature:** use Brier (bounded, interpretable) not log score at n=1; show per-event feedback immediately (don't gate all feedback behind n≥10); **cadence beats sophistication**. Honest caveat: one 2025 study found calibration feedback alone insufficient — practice volume + reflection is what compounds.
23. **Things 3:** an inbox is a **holding pen with a mandatory exit** — one decision per item ("when will I start?"), four mutually-exclusive destinations, and an honest guilt-free **Someday**. Start date ≠ deadline keeps dates meaningful. Areas (= STATENOUR's 6 domain anchors) are the identity layer.
24. **Todoist:** abstract points are ignored; what survives is the **small daily goal, the streak, and the mercy valve** (vacation mode exists because unforgiving streaks make people quit). Punishment-shaped consequence gets routed around.
25. **Linear:** the deepest single lesson in the set — **remove ceremony from continuation**. Cycles close and roll *automatically*; unfinished work carries a visible rolled-count; capacity is forecast from trailing velocity. Consequence as *honest information*, not judgment. Triage is a state with four exits, including **Snooze**.
26. **Twenty/Monica:** relationships decay by default; the fix is a **stay-in-touch interval + a unified per-person timeline**. The promise ledger must be two-directional (owed-to-me too).
27. **Exist.io:** **the review must arrive** — the Monday email shows up whether or not you were virtuous, which is why people keep it for years. Every insight carries strength + a confidence rating (★★★☆☆) — honesty as a retention feature. Day-grained attributes are the substrate for correlations.
28. **Nomie:** subjective data gets logged only if it costs **one tap** (`#mood(7)` inline notation).
29. **Metabase (the only BI lesson):** every dashboard number must **drill through to its receipts** — no dead painted numbers.

---

## 10. Steal / Do-Not-Steal Matrix

| STATENOUR system | Best reference(s) | STEAL | DO NOT STEAL | Why | Effort (est.) | Impact (est.) | Priority |
|---|---|---|---|---|---|---|---|
| **Journal** | Rosebud + Tana + Logseq | Dialogic follow-up at capture; AI-filled typed fields; nextAction→proposal-accept→scheduled check-in; daily-note spine | Therapy positioning; outliner UI; graph eye-candy | Journal insight→action is the #1 stated gap; capture is already strong | S–M | 9 | **P0** |
| **Memory / BrainMemory** | Mem0 + Graphiti + Letta | Write-time conflict gate (`commitMemory()` ADD/UPDATE/INVALIDATE/NOOP) emitting receipts; bi-temporal `validFrom/invalidAt`; pinned operator blocks + nightly consolidation cron | Hard DELETE; black-box auto-resolution; external memory SaaS; the Letta runtime | Read side is already above field median; the write side has zero quality control | M | 9 | **P0** |
| **Memory review / decay** | Anki(FSRS) + Mochi + Obsidian | FSRS columns (S/D/dueAt) on reviewable entities; daily 3–5-item resurface feed; 2-button rating ("still true"/"stale"→archive); append-only review log | Decks/templates/optimizer UI; 4-button grading; study-session framing | Closes review + forgetting in ONE feature; `ts-fsrs` is a dependency, not research | M | 9 | **P0** |
| **Tasks / Inbox** | Things 3 + Linear triage | One-at-a-time triage (Today/Schedule/Anytime-per-anchor/Someday/Kill + Snooze), ~10/day quota, classifier pre-fills the suggestion; start-date≠deadline | Apple-polish chasing; checklist micro-structure | 201-item graveyard is a triage-design failure, not a capture failure | S–M | 9 | **P0** |
| **Missions / cycles** | Linear + Plane(ref) | Personal weekly cycle: pick ~8, auto-close+rollover Sunday, rolled-N× counter forces triage at 3, capacity line from trailing 3-week velocity | Teams/SLAs/initiatives hierarchy; cooldown weeks; estimates | Manufactures the weekly review as system behavior, not discipline | M | 9 | **P0** |
| **Briefs / review ritual** | Exist.io + Khoj | The Monday drop: delivered weekly digest to Telegram (velocity vs plan, anchor neglect, stale people, streak state, confidence-starred observations); standing-instruction rows | The 20-integration sync farm; causation-flavored copy | Reviews that must be initiated die; reviews that arrive get read | S–M | 8 | **P0** |
| **Chat / Nick** | LibreChat + Open WebUI + Dify | Named Nick-specs picker (persona+model+tools as rows); conversation FTS search (tsvector exists); `parentMessageId` now; thumbs→Elo over providers; annotation-reply mini (pinned corrections injected on similar queries); filter-chain decomposition of the god-route | Multi-user/RBAC; visual workflow builders; generic RAG; plugin marketplaces; in-app code editors | Nick is the strongest system; these close its eval-loop and persona gaps | S–M each | 7–9 | **P1** |
| **Predictions / calibration** | Metaculus + GJP + Brier lit | Nick-drafted predictions from the operator's own plans (resolution criteria + date at creation, one-tap confirm); auto-resolution from task/receipt data; personal base rates in the composer; per-event Brier feedback immediately; track-record page | Peer/community scoring; leaderboards; continuous distributions; time-averaged scoring | System is dead from creation+resolution friction; both can be automated away | M | 9 | **P1** |
| **Background agents** | LangGraph-pattern-on-Inngest + n8n | One durable weekly-review agent (`step.waitForEvent` on the existing approval queue); failure-as-artifact (global `onFailure` → visible record + notify); run-history rows with re-run | LangGraph/CrewAI/Flowise adoption; second persistence layer; visual canvases | Inngest already IS the durable engine; this is wiring, not building | S–M | 8 | **P1** |
| **People** | Monica + Twenty | Stay-in-touch interval on PersonProfile → surfaces in brief; two-directional promise/debt ledger; life events as durable memory; unified per-person timeline | Vaults/multi-user; opportunities pipeline; custom-object engine; field sprawl | Cheapest relationship-loop fix in the set; crons+Telegram exist | S–M | 7 | **P1** |
| **XP / Scoreboard** | Todoist + Linear + Exist | Small daily goal + streak **with freeze valve**; reframe XP as honest measurement (velocity, per-anchor grades with what-changed); staleness shadow instead of point fines | Karma points/levels/titles; punishment mechanics | XP-without-consequence isn't fixed by penalties; it's fixed by making XP *mean* something true weekly | S | 6 | **P2** |
| **Quantified self / stats** | Exist + Nomie + Gyroscope | Day-grained `attribute(day,name,value,type)` table fed by existing signals; `#mood(7)` inline notation; one-tap Telegram log row; correlations engine later (confidence-starred) | Integration farm before loops close; composite scores before attributes exist | Substrate first, correlations second | S→M-L | 7 | **P2** |
| **System health / ops** | n8n + Metabase invariant | Alert resolve/mute endpoints + bulk triage UI; cron-stalled as a CRITICAL alert; numbers drill to receipts; archive dead devices | BI dashboards; Appsmith/ToolJet | 26 unresolved alerts = the warning system has lost credibility | S | 6 | **P2** |
| **Knowledge / docs** | Logseq/Tana | Typed tags on memories (Decision/Lesson/Person-fact) with inherited fields; embedded live queries on mission pages (saved query: related journal+memories, 30d) | Graph visualization UI; plugin systems | Edges feeding retrieval beat graph pictures | M | 6 | **P2** |
| **Voice / channels** | Khoj posture | Telegram/WhatsApp as the second surface of the same brain (already mostly true); voice later | Rebuilding a voice platform now | Channel breadth < loop depth | — | — | P3 |

---

## 11. Implementation Effort Estimates

All estimates `(est.)` assume the existing stack (Next/Prisma/Inngest/pgvector/Telegram) and the patterns above; "First safe slice" = the smallest shippable, individually-verifiable step. Risk legend: prod-data / migration / AI-cost / UX.

| Recommendation | Effort | Complexity | Risk | Dependencies | First safe slice |
|---|---|---|---|---|---|
| Inbox triage flow (Things-style 4-exit + Kill + Snooze) | 2–3 days | Low–Med | Low (additive `SOMEDAY` status + `snoozedUntil` exists) | classifier (exists) | Triage card UI on /missions reading INBOX one-at-a-time, no schema change (map Someday→existing status or tag first) |
| Journal nextAction→Task proposal-accept | 1 day | Low | Low | journal_brain_take (exists) | Render existing takes' nextAction as an accept-chip that calls existing task.create |
| Dialogic follow-up question at capture | 1 day | Low | AI-cost: +1 small call/entry | enrichJournalEntry (exists) | One follow-up in the Telegram reply for `decision/planning` entries only |
| Scheduled commitment check-ins | 1–2 days | Med | Low | task data; cron substrate | Check-in question in the existing evening journal-checkin for takes accepted ≥3 days ago |
| Weekly cycle w/ auto-rollover | 2–3 days | Med | Low (1 additive table) | — | Cycle row + Sunday close-cron + "this week" strip on /missions; counter only, no UI polish |
| Monday-drop delivered digest | 1–2 days | Low | Low | weekly-digest cron (exists) | Repoint existing weekly-digest content at velocity/anchors/stale-people; deliver via existing Telegram path |
| FSRS resurface queue | 2–3 days | Med | Low (3 additive columns) | `ts-fsrs` | Pilot on BrainMemory `wisdom` category only: dueAt scheduling + a 3-item card on /brain w/ 2 buttons |
| Memory write-gate (`commitMemory()`) | 1 week | Med–High | AI-cost per write; behavior change | RRF recall (exists); receipts (exist) | Shadow mode first: log would-be ADD/UPDATE/INVALIDATE decisions w/o applying; review a week of receipts |
| Bi-temporal `validFrom/invalidAt` | 2–3 days | Med | **Migration (additive)** — hand-applied per policy | write-gate (pairs) | Columns + recall default-filter `invalidAt IS NULL`; backfill nothing |
| Pinned operator blocks | 2–3 days | Med | Prompt-size; behavior change | finalize-system-prompt (exists) | 2 blocks (operator-profile, active-arcs) hand-seeded, injected, read-only; self-editing later |
| Sleep-time consolidation cron | 2–3 days | Med | AI-cost nightly | write-gate receipts | Nightly job that only *proposes* merges/block-updates into the approval queue |
| Nick specs picker | 2–3 days | Med | UX | prompt fragments | `chat_specs` table + picker; 2 specs (Coach, Operator); no god-route refactor yet |
| Conversation search | 1 day | Low | Low | `searchable_tsv` exists on chat_messages | Search box on /chat reading existing tsvector |
| Thumbs→Elo provider leaderboard | 1–2 days | Low | Low | feedbackScore field (exists) | Persist (provider,model,mode) with each rating; digest card with naive win-rate first, Elo later |
| Annotation-reply mini | 1 week | Med | Behavior change; needs care w/ truth stack | pgvector (exists) | Pin-correction action that stores Q-embedding + canonical answer; inject as context (never hard-intercept) |
| Predictions revival | 1 week | Med | AI-cost; UX | Prediction model+Brier (exist) | Nick drafts ONE prediction in the weekly cycle close ("will you finish the 8 picked items?"), auto-resolves next Sunday |
| Durable weekly-review agent | 2–3 days | Med | Low | Inngest waitForEvent; approval queue (exist) | One function: gather→draft→waitForEvent(approval)→write receipt |
| Failure-as-artifact + run history | 1–2 days | Low | Low | Inngest onFailure | Global onFailure → SystemError row + Telegram aggregate; /system/logs row per cron run |
| Alert triage (resolve/mute/bulk) | 1 day | Low | Low (writes to own Alert rows) | — | `POST resolve` endpoint + button on /system/alerts |
| Stay-in-touch intervals | 1 day | Low | Low (1 additive column) | crons+Telegram (exist) | Interval column + morning-brief line "stale: X (6w)" |
| Day-grained attribute table | 2–3 days | Med | **Migration (additive)** | — | Table + 3 writers (tasks-done, mood if logged, journal count); no UI |
| Agenda store (agenda_item) v1 | 1 week | Med–High | Behavior change; prompt size | commitments/missions (exist) | Table + read-at-turn-start injection ("open agenda items") only; Nick-initiated outreach later |
| God-route filter-chain refactor | 2–4 weeks | High | Regression risk on hottest path | tests | Extract ONE outlet filter (receipts/feedback) behind the existing seam; stop there until measured |

**Explicitly major projects (do not start as side-quests):** full god-route decomposition; correlations engine over attributes; Nick-initiated conversations at full generality; voice.

---

## 12. Transformation Impact Ranking

Scoring `(est.)`: Priority = (2×Transformation + Action + Retention + Intelligence) − Cost − Risk, Confidence as tiebreak. 1–10 scales; Cost/Risk where 10 = worst. This is a judgment model, not a measurement — the *ordering* is the claim, not the arithmetic.

| # | Move | Transform | Action | Retention | Intelligence | Cost | Risk | Conf | Score |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Close-the-loop wire pack (verified gaps from §6: honesty gate at finalize, failure-as-artifact, alert triage, + the radar/brief fixes per §20 verdicts) | 7 | 7 | 7 | 7 | 2 | 2 | High | **31** |
| 2 | Journal→Action loop (dialogic follow-up + nextAction accept-chip + check-ins) | 9 | 9 | 6 | 7 | 3 | 2 | Med-High | **35** |
| 3 | Inbox liquidation triage | 7 | 9 | 7 | 4 | 3 | 2 | High | **29** |
| 4 | Weekly cycle + Monday drop | 9 | 9 | 8 | 6 | 4 | 2 | High | **35** |
| 5 | FSRS resurface/review queue | 7 | 6 | 10 | 8 | 4 | 2 | High | **32** |
| 6 | Memory write-gate + bi-temporal | 8 | 5 | 7 | 10 | 5 | 4 | High | **29** |
| 7 | Pinned operator blocks + sleep-time cron | 9 | 6 | 7 | 9 | 4 | 3 | High | **33** |
| 8 | Predictions revival (auto-resolving, base-rated) | 9 | 7 | 7 | 8 | 5 | 3 | Med-High | **32** |
| 9 | Agenda-carrying Nick (agenda_item store → Nick-initiated turns) | 10 | 9 | 9 | 9 | 6 | 4 | Med | **37** |
| 10 | Nick eval/persona pack (specs picker, search, thumbs→Elo, annotation-reply) | 7 | 5 | 8 | 8 | 4 | 3 | High | **28** |
| 11 | Stay-in-touch + promise ledger | 6 | 8 | 8 | 5 | 2 | 1 | High | **30** |
| 12 | Attribute substrate (+correlations later) | 8 | 6 | 9 | 7 | 5 | 2 | Med | **31** |

Reading the table honestly: **#9 (agenda) scores highest but carries the most design risk — it is the 90-day centerpiece, not the week-1 move.** The week-1 moves are #1–#4: cheap, verified-gap-closing, and they make every later move land on a system the operator actually feels.

What this ranking optimizes for (the brief's criteria): make the user act (2,3,4,9) · reflect (2,5,8) · see progress (4,12) · remember better (5,6,7) · sharper coaching (7,9,10) · patterns visible (12 + radar fix in 1) · reduce drift (4,9,11) · identity change (5,7,9) · indispensability (4,5,9,11).

---

## 13. 30-Day Roadmap

Sequenced so each week ships independently-verifiable slices; nothing depends on a migration except two flagged additive ones. All durations `(est.)`.

**Week 1 — the Wire Pack (close verified loops; all S):**
1. Wire `canClaimDone()` into `persist-assistant-turn` finalize: offenders → hedge the summary text (or prepend the existing verifier banner) + write the warn chip. The contract and tests already exist.
2. Journal `nextAction` → accept-chip on the entry receipt (calls existing `task.create`); decline = dismiss. (Tana proposal-write pattern; reuses suggest-then-approve idiom.)
3. Radar honesty: when `gatherJournalEntries < 3`, the /market radar tab and /system health show "starving — N entries in 14d, needs 3" instead of silent zeros; add a journal-cadence nudge line to the brief.
4. Alert triage: `resolve` + `mute-category-24h` endpoints + buttons on /system/alerts; bulk-resolve.
5. Failure-as-artifact: global Inngest `onFailure` → SystemError row + the existing 10-min Telegram error aggregate; run-history row per cron with re-run affordance.
6. Verify the `fb851113` morning-brief fix live post-deploy (ready:true next morning); **operator action: re-auth Google** (calendar/drive ingest failing daily).

**Week 2 — Inbox liquidation (S–M):**
7. One-at-a-time triage card on /missions: Today / Schedule (start date) / Anytime-under-anchor / Someday / Kill + Snooze; classifier pre-fills the suggested exit; ~10/day quota. Someday = honest holding state with weekly random resurfacing. Target: INBOX 201 → <50 by day 30 (operator-paced).
8. Operator-gated Journal-Brain backfill: dry-run count → batched run via the existing tRPC endpoint (AI-spend approval first; ~990 rows design-doc figure).

**Week 3 — the rhythm machine (M):**
9. Weekly cycle v1: cycle table (additive migration, hand-applied per policy) + Sunday close-cron + auto-rollover + rolled-N× counter (3 rolls → force-triage) + "this week" strip on /missions; capacity line from trailing 3-week completions.
10. Monday drop v1: repoint the existing weekly-digest cron at velocity-vs-plan, anchor neglect, stale people, streak state; deliver via existing Telegram path. Confidence-star any inferred observation.

**Week 4 — calibration becomes visible (M):**
11. Track-record card on /stats reading the *existing* Prediction rows (status, Brier trend, per-event feedback); link from the Monday drop.
12. Cycle-close drafts ONE operator prediction ("will you finish the 8 picked items? P=") with personal base rate shown ("you completed N of last M cycles"); auto-resolves next Sunday from task data.

Day-30 acceptance (per `acceptance-orchestrator`): inbox < 50 · first cycle closed+rolled · 2 Monday drops delivered · ≥1 operator prediction resolved with visible Brier · canClaimDone enforcing · alerts < 5 unresolved · brief ready:true streak ≥ 21 days.

---

## 14. 90-Day Roadmap

**Month 2 — memory metabolism + Nick eval loop:**
- `commitMemory()` write-gate in **shadow mode** (logs ADD/UPDATE/INVALIDATE/NOOP decisions as receipts, applies nothing) → review a week of receipts → enable. Bi-temporal `validFrom/invalidAt` columns (additive, hand-applied) with recall default-filtering current-only.
- FSRS resurface queue (pilot: wisdom + decisions): 3 columns + `ts-fsrs` + a daily 3–5 item card on /brain and in the brief; 2-button rating; "stale" decays toward archive. Append-only review log.
- Pinned operator blocks v1: `operator-profile` + `active-arcs` blocks injected into finalize-system-prompt (read-only first); nightly sleep-time cron *proposes* block updates + memory merges into the approval queue.
- Nick eval/persona pack: thumbs persisted with (provider, model, mode) → digest win-rate card → Elo later; conversation FTS search box (tsvector exists); `chat_specs` table + picker (Coach / Operator / Analyst); `parentMessageId` added to messages now (cheap, additive) — fork UI deferred.

**Month 3 — compounding + the differentiator:**
- Annotation-reply mini: pin-correction action stores Q-embedding + canonical answer; injected as authoritative context on similar queries (never hard-intercept — the truth stack keeps running).
- Stay-in-touch intervals + two-directional promise ledger; both feed the Monday drop and morning brief.
- Day-grained attribute table + 3 writers (tasks-done, mood if logged via `#mood(7)` notation, journal count). Correlations engine deferred until ≥6 weeks of attributes.
- **Agenda store v1** (`agenda_item`: standing intentions, witnessed commitments, unraised contradictions; state + escalation clock): read-at-turn-start injection only. Nick-*initiated* outreach (an agenda item opening a Telegram message) ships only after a month of passive agenda accuracy review.
- Durable weekly-review agent: one Inngest function (gather → draft → `step.waitForEvent` operator approval → execute + receipts) — hosts the cycle close, the Monday drop, and the prediction draft in one resumable run.

Quarter acceptance: memory write-gate live with receipts · ≥100 FSRS reviews logged · specs picker in daily use · agenda items injected every turn with ≥80% operator-judged accuracy (sampled) · all §13 metrics held.

---

## 15. One-Year Vision

Twelve months out, STATENOUR is no longer "an app the operator opens" — it is a **counterparty that shows up**:

- **Every capture is typed and consequential.** A journal entry lands → AI-filled fields type it → it backlinks to missions/people → one dialogic question sharpens it → any commitment in it gets a check-in date. Nothing captured is inert.
- **Memory has a metabolism.** New facts pass a write-gate (conflict-resolved against neighbors, receipted); beliefs carry FSRS decay and come up for 2-button review; superseded beliefs stay queryable bi-temporally ("what did I believe in January vs now" is a query, and the *delta* is the transformation record). 3–5 pinned blocks (who I am / what I'm becoming / active arcs) are in every prompt, self-maintained nightly.
- **The week runs itself.** Cycles auto-close and roll Sunday night; the Monday drop arrives in Telegram with velocity vs plan, anchor neglect, stale relationships, calibration deltas, and 1–2 confidence-starred observations. The operator doesn't *do* a weekly review; the system *delivers* one and asks three questions.
- **Nick keeps an agenda.** Standing intentions, witnessed commitments, noticed-but-unraised contradictions — each with state and an escalation clock. Some conversations are opened *by Nick*. Spaced repetition has become spaced *interrogation*: "three weeks ago you believed X; last week you did Y — which is true now?"
- **Calibration is a habit.** Each cycle close drafts 1–3 auto-resolving predictions with personal base rates shown; the track record page is the operator's judgment ledger; Brier trend is on the character sheet next to XP.
- **Honesty is structural.** No "done" without receipts (the gate is enforced at finalize, not aspirational); every background failure is a visible artifact; every dashboard number drills to its receipts; every AI memory-write is a receipt the operator can audit.

The north-star test for any new feature in year one: **does it close a loop (capture→action→verification→memory→review), or does it add surface?** Surfaces are done; loops are the product.

---

## 16. Top 10 Highest-Leverage Moves

In execution order (leverage = impact-per-effort × how much it unblocks downstream; scores in §12):

1. **Enforce the honesty gate** — call `canClaimDone()` at the finalize seam; hedge or banner offending summaries. One wire completes the product's moat. *(S · unlocks trust in everything else)*
2. **Journal nextAction → accept-chip Tasks** (+ one dialogic follow-up question at capture, + scheduled check-ins on accepted actions). Closes insight→action, the #1 stated weakness. *(S–M)*
3. **One-at-a-time inbox triage** (Today/Schedule/Anytime-per-anchor/Someday/Kill + Snooze, classifier pre-filled). Liquidates the 201-graveyard; makes "ready" trustworthy. *(S–M)*
4. **Weekly cycle with auto-rollover + the Monday drop.** The rhythm machine: continuation without ceremony, consequence as honest information, review as a delivered artifact. *(M)*
5. **Surface the living prediction engine** — track-record card, per-event Brier feedback, then operator-authored predictions with personal base rates and auto-resolution. The cheapest "new capability" in the set because the engine already runs daily. *(M)*
6. **FSRS resurfacing review** over memories/decisions with a 2-button rating — review and forgetting in one feature; retention impact 10. *(M)*
7. **Memory write-gate + bi-temporal invalidation** — stops years-scale rot at the source; receipts exhaust becomes the operator review queue; "what did I believe in January" becomes a query. *(M)*
8. **Pinned operator blocks + nightly sleep-time consolidation (proposals-only)** — identity stops being a retrieval lottery; the nightly pass is the missing maintenance loop. *(S–M)*
9. **Agenda-carrying Nick** — `agenda_item` store read at every turn; later, Nick opens conversations from witnessed commitments. The genuine white space no benchmarked product occupies; the thing that makes a "transformation OS" different from a very good chat wrapper. *(M–L · the 90-day centerpiece)*
10. **Nick eval/persona pack** — thumbs→win-rate/Elo across the 4 providers (a free natural experiment already running), conversation search, named specs picker, annotation-reply corrections that compound. *(S–M each)*

---

## 17. What Not To Build

Grounded in the benchmark (each item is something a reference product proves is bloat for a single-operator AI-native OS) and in STATENOUR's own audit history:

1. **No graph-visualization UI.** The most-copied, least-used feature in the knowledge category. Edges should feed *retrieval and embedded queries*, not pictures. (Logseq/Obsidian lesson.)
2. **No framework adoption** — not LangGraph, not CrewAI, not Letta-as-runtime, not Flowise. Inngest+Postgres already provide durable execution; frameworks would add a second persistence layer and API churn for negative net capability. Steal patterns only. (Cluster-A verdict.)
3. **No external memory SaaS** (Supermemory et al.). The operator's life memory must stay auditable, forkable, self-hosted.
4. **No multi-user anything** — RBAC, workspaces, sharing, marketplaces. Every hour there is an hour not spent on loops for the one user who exists.
5. **No visual workflow builder.** A single operator with a code agent edits code faster than dragging nodes. (Flowise verdict; its production record seals it.)
6. **No more BI dashboards / internal-tool builders.** Keep the one Metabase invariant (numbers drill to receipts) and stop. /system is already at 12 tiles — the audit shows intelligence *unsurfaced*, not surfaces missing.
7. **No new capture surfaces before loops close.** Capture is already strong (chat/journal/Telegram/email-ingest). Another input feeding a 201-item graveyard makes the graveyard bigger.
8. **No punishment mechanics in XP.** Overdue point-fines get routed around (Todoist lesson). Consequence = honest information (rolled-counters, capacity lines, staleness shadows).
9. **No E2EE / local-first re-architecture.** Single-user server-authoritative is correct here; E2EE would cripple Nick's server-side memory. (Reflect's structural tension.)
10. **No new default-OFF flag features.** 15 NICK_* flags with most defaulting OFF is already a feature graveyard pattern — a built-but-dormant capability is indistinguishable from an unbuilt one (this audit's central finding). New capability ships ON behind a small safe slice, or doesn't ship.
11. **No voice platform rebuild now.** Channel breadth < loop depth; Telegram is the second surface until the loops compound.
12. **No speculative new tables.** The audit found ~25 dormant/unknown models. The data model is ahead of the product — wire what exists before modeling what might exist.

---

## 18. Founder-Level Recommendations

1. **Declare a loop-closure quarter — no new systems.** The audit found ~25 dormant/unknown models, 7+ default-OFF intelligence flags, and multiple capabilities the *audit docs themselves* believed were unwired but weren't. Building is demonstrably not the constraint; reaching the operator is. Every sprint slot goes to closing a verified loop until §13's acceptance metrics hold.
2. **Adopt "delivered, not visited" as the product principle.** Every benchmarked product that retains users for years *arrives* (Exist's Monday email, Monica's reminders, Khoj's automations). Every intelligence output should terminate in a Telegram-delivered artifact or an in-flow chip — never solely in a page the operator must remember to open.
3. **Make loop-closure rate the one metric.** Insights→accepted actions→verified done; predictions resolved *and seen*; memories reviewed; alerts resolved. If a feature can't move this metric, it's surface (§17).
4. **Enforce honesty structurally, not aspirationally.** The receipts culture is the genuine moat — no benchmarked product has it. But a gate with zero call sites is a slogan. Wire `canClaimDone`, make failures artifacts, keep every number drillable to receipts.
5. **Patterns over frameworks, permanently.** Inngest+Postgres already provide durable execution; pgvector+RRF already out-retrieves the memory startups. The benchmark's strongest negative result: adopting LangGraph/CrewAI/Letta/Flowise here would be negative-net-capability. Steal the interrupt pattern, the write-gate, the FSRS math — as code in this stack.
6. **Respect the operator's attention ceiling.** One binary tap (Mochi), ~10 triage decisions/day (Things), 3–5 review items (FSRS), one follow-up question per journal entry (Rosebud). Any flow that exceeds the ceiling will silently die on the phone — the suppressed-`window.confirm` lesson generalized.
7. **Journal cadence is the system's oxygen.** The starving radar proved it: pattern detection, takes, grounding, threads, and ultimately the agenda engine all feed on capture volume. Anything that makes journaling more rewarding (dialogic follow-ups, visible takes→actions, grounded XP) compounds every downstream system. Protect it first.
8. **The transformation record is the product.** Bi-temporal memory ("what I believed in January vs now"), calibration trends, identity-vs-behavior deltas — these are what a "transformation OS" uniquely sells. XP and dashboards are renderings; the longitudinal, honest, queryable record of *becoming someone else* is the asset. Architect for it (invalidate-don't-delete, append-only events, receipts) in every decision.

---

## 19. If I owned STATENOUR for the next 5 years — the 10 things I would build, in order

1. **The honesty spine, completed** — receipts enforced at every claim ("done", numbers, memories written), failures as artifacts, every surface number drillable. Trust is the foundation everything else stands on.
2. **The weekly operating rhythm** — auto-rolling cycles + the delivered Monday drop. The metronome that converts intentions into a cadence the system runs even when the operator doesn't.
3. **The journal→action→verification loop** — dialogic capture, accept-chip proposals, scheduled check-ins. Reflection that reliably becomes behavior.
4. **The memory metabolism** — write-gate with receipts, bi-temporal history, FSRS-scheduled review, pinned self-maintained identity blocks, nightly consolidation. Memory that improves with age instead of rotting.
5. **The calibration ledger** — operator-authored, auto-resolving predictions with personal base rates; the track record as the operator's judgment résumé. (The engine already runs; make it a habit.)
6. **The agenda engine** — Nick as counterparty: standing intentions and witnessed commitments with escalation clocks; conversations Nick opens. The single largest differentiation opportunity found in this entire benchmark.
7. **Spaced interrogation of beliefs** — FSRS decay applied to self-beliefs and identity claims, with Nick re-validating against newer evidence and challenging contradictions ("three weeks ago you believed X; last week you did Y — which is true now?").
8. **The identity-trajectory model** — proof-of-becoming: stated identity (goal identityLines, pinned blocks) vs logged behavior (receipts, attributes), the gap measured, reviewed, and coached weekly.
9. **The correlation engine** — day-grained attributes across work/mood/sleep/people, confidence-starred observations in the Monday drop ("deep-work days follow morning workouts, ★★★☆☆").
10. **The self-tuning loop** — thumbs/annotations/review-logs re-fitting retrieval weights, prompt fragments, and FSRS parameters to *this* operator. The system that learns how to coach its one user better every month — the compounding moat a single-user OS can have that no multi-tenant product can match.

---

## 20. Verification Register

Adversarial verification workflow (9 claims, 9 Explore agents, run 2026-06-10 against worktree @ `4d12686c`). **4 scary claims from the mapping agents were refuted — the stale-docs trap is real: agents that read `ORGANIZATION-WIRING-AUDIT.md` (pre-wiring-wave) reported its findings as current.**

| # | Claim (from mapping agents) | Verdict | Corrected truth (evidence) |
|---|---|---|---|
| C1 | `canClaimDone()` is orphaned | **CONFIRMED** (high) | Defined+exported (`action-receipt.ts:161`), tested, **zero production call sites**; receipts written fire-and-forget (`persist-assistant-turn.ts:463-479`) |
| C2 | Pattern Radar feeder cron missing | **PARTIAL** (high) | Cron exists & wired (`config/crons.ts:113-119`, Inngest 22:00 UTC). Zeros caused by data gate: `<3` journal entries in 14d → early return before persist (`journal-convergence.ts:680-687`). Starved, not broken; empty state silent |
| C3 | Predictions have zero creation paths (dead) | **REFUTED** (high) | `/api/cron/predict` in EVENING_JOBS creates 1–4/day (`predictive-engine.ts:233-246`); resolved+Brier-scored (`outcome-tracker.ts:45-158`); accuracy feeds system prompt (`outcome-tracker.ts:259-284`). Gap = operator surface, not creation |
| C4 | XP credit has no completion-moment feedback | **REFUTED** (high) | Reward toast live on /missions for all 3 paths (`missions/page.tsx:178-212`); honest `formatReward` (never invents XP); shipped `46fb2739`/`43b63268` |
| C5 | F1–F5 commands unreachable from chat | **REFUTED** (high) | All 6 in SLASH_COMMANDS (`use-slash-commands.ts:84-89`); `resolveCommand` interceptor in send path (`interceptors.ts:355-378`); dropdown renders (`chat/page.tsx:2120-2177`) |
| C6 | Telegram journal-confirm is design-only | **REFUTED** (high) | Webhook handles `jlink` callbacks → `confirmJournalLink` (`telegram/webhook/route.ts:178-195`); web LinkChip confirm/reject live (`entry-row.tsx:407-465`) |
| C7 | Journal takes live; nextAction never becomes a Task; backfill never automated | **CONFIRMED** (high) | Take generated unless both knobs off (`journal-brain.ts:357-363`); nextAction display-only (`journal-brain.ts:464-477`, `entry-row.tsx:529-536`); backfill tRPC-only, no cron |
| C8 | "201 distinct memory categories" (also "138") | **CONFIRMED at 201** (high) | **201 keys** in the registry by deterministic count (incl. 12 deprecated); 138 was the pre-registry historical baseline (`categories.ts:5-8`). Two verifier agents hand-counted 204/205 — the awk key-count settles it, and the 1–2% disagreement itself illustrates why countables need deterministic checks |
| C9 | Morning brief broken in prod today | **CONFIRMED** (high) | `ready:false`, `composedAt:null` live at 12:50 UTC; Inngest `composeBrief` never persists the row; Wave AE deleted the legacy producer; stale comment claims it still exists (`morning-brief.ts:10-12`). **Fix `fb851113` landed on main 2026-06-10 08:31 ET — verify post-deploy** |

**Standing UNVERIFIED items (could not be checked read-only, flagged wherever used):**
- "~990 historical journal rows unenriched" — design-doc figure; prod count not queried (no prod reads beyond public `/api/health`).
- "~1 active goal vs ~10 missions" — prior-session snapshot; not re-queried today.
- Service-worker (`public/sw.js`) runtime behavior; thinking-memory L7–L12 model readers; `AutomationRule` authoring surface — marked likely-dormant, not proven.
- All effort estimates, impact scores, and priority arithmetic in §§7–16 are judgments `(est.)`, not measurements.
- Benchmark performance numbers quoted from vendors (Mem0/Supermemory/Open WebUI token claims) are self-reported; treated as directional only.

**Production safety attestation:** this session performed read-only investigation (public `/api/health` GETs); no production data was created, mutated, or deleted; no migrations were applied; no memories/tasks/chats/journal entries were touched; no secrets accessed; no transcripts dumped.
