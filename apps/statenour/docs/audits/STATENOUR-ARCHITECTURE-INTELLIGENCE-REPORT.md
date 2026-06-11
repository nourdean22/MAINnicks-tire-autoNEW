# STATENOUR OS Architecture Intelligence & Transformation OS Master Audit

**Audit Date:** June 10, 2026  
**Scope:** `apps/statenour` codebase, database models, AI pipelines, retrieval schemas, and operational runbooks.  
**Objective:** Assess the structural capabilities of STATENOUR, detect friction and disconnects in the intelligence loop, benchmark against industry leaders, and draft a ranked 30-day, 90-day, and 5-year roadmap.

---

## 1. Executive Summary

STATENOUR today is a computationally dense, highly capable personal operating system for identity tracking, habit enforcement, and memory capture. The system is structurally sound at the mathematical and logic layer—calculating Pearson and Granger correlations with bootstrap confidence intervals, running a 9-stage nightly memory consolidation pipeline, logging daily multi-axis identity snapshots, and enforcing a 5-layer fabrication-defense stack. 

However, STATENOUR suffers from a critical **delivery and feedback loop gap**. 
While the system computes high-fidelity insights (e.g. drift detection, XP-decay, anti-pattern counts, relational graphs, anticipated questions, and auto-triage suggestions), these insights rarely reach the operator proactively. The proactive notification layers (such as the Telegram push service) are inactive, and the daily morning brief was structurally broken until recently restored. The system behaves in a "reactive-pull" manner rather than serving as an active coaching and witness layer. 

By closing the outcome loops (e.g. task outcomes, prediction resolutions) and establishing proactive delivery lines (Telegram alerts, homepage highlights, weekly reviews injected into prompt memories), STATENOUR can transition from a passive database dashboard to an indispensable personal coach.

---

## 2. Evidence Ledger

Every claim in this audit is mapped directly to source files, database schemas, or runtime code patterns within the monorepo:

| Claimed Capability / Constraint | Repository Source / File Path | Evidence Detail |
| :--- | :--- | :--- |
| **Active DB Schema & Models** | [`apps/statenour/prisma/schema.prisma`](file:///c:/Users/nourd/NOURCITY/apps/statenour/prisma/schema.prisma) | Defines 80 models including `Task`, `Mission`, `BrainMemory`, `Prediction`, `DriftAlert`, `AuditEvent`, `EntityAudit`, `PersonProfile`, and `DailyExecutionState`. |
| **Fabrication Defense Stack** | [`apps/statenour/lib/ai/chat/`](file:///c:/Users/nourd/NOURCITY/apps/statenour/lib/ai/chat/) | L1: `system-prompt.ts`, L2: `fabrication-rewriter.ts`, L3: `sanitize-history.ts`, L4: `truth-grounding.ts`, L5: `action-claim-warning.tsx`. |
| **Hybrid Retrieval Lexical Lane**| [`apps/statenour/lib/brain/contextual-recall.ts`](file:///c:/Users/nourd/NOURCITY/apps/statenour/lib/brain/contextual-recall.ts) | Implements dual-lane retrieval utilizing Postgres FTS (`websearch_to_tsquery`) alongside pgvector KNN and rerank. |
| **XP & Character Progress** | [`apps/statenour/lib/mastery/`](file:///c:/Users/nourd/NOURCITY/apps/statenour/lib/mastery/) | Character sheet metrics defined in `config.ts`; `credit-signal.ts` handles write-time XP deposits. |
| **Morning Brief Composition** | [`apps/statenour/src/inngest/functions/morning-brief.ts`](file:///c:/Users/nourd/NOURCITY/apps/statenour/src/inngest/functions/morning-brief.ts) | `composeBrief()` orchestrates daily snapshots, writing them into `BrainMemory` rows. |
| **Cron Job Manifest** | [`apps/statenour/config/crons.ts`](file:///c:/Users/nourd/NOURCITY/apps/statenour/config/crons.ts) | Single source of truth for scheduled tasks, validated via `pnpm check:crons`. |
| **Prisma pgvector Bypass** | [`apps/statenour/lib/db/pgvector.ts`](file:///c:/Users/nourd/NOURCITY/apps/statenour/lib/db/pgvector.ts) | Raw SQL client wrappers bypass standard Prisma query mappings to execute KNN searches. |
| **Proactive Telegram Alert logic** | [`apps/statenour/lib/brain/proactive-pushes.ts`](file:///c:/Users/nourd/NOURCITY/apps/statenour/lib/brain/proactive-pushes.ts) | Defines `fireSlotForCurrentHour()`, `fireMorningPush()`, `fireAfternoonPush()`, `fireEveningPush()`, which lack any active external callers. |
| **Prediction resolution framework** | [`apps/statenour/lib/brain/outcome-tracker.ts`](file:///c:/Users/nourd/NOURCITY/apps/statenour/lib/brain/outcome-tracker.ts) | Defines `scorePendingPredictions()`, which is called by the `brain-intelligence` cron to auto-grade Prediction table records. |
| **Unwired Prediction Calibration** | [`apps/statenour/lib/ai/outcome-calibration.ts`](file:///c:/Users/nourd/NOURCITY/apps/statenour/lib/ai/outcome-calibration.ts) | Defines `resolvePrediction()`, which has zero callers and is explicitly commented out as a NO-OP. |

---

## 3. STATENOUR System Map

Here is the complete system map of the 25 specific systems inside STATENOUR:

| System | Purpose | Key Files | Data Model | Inputs | Outputs | Connected To | Strength | Weakness | Opportunity | Risk | Evidence |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Chat / Nick** | Conversational partner and executor | `lib/ai/nick-agent.ts`, `app/api/ai/chat/route.ts` | `ChatMessage`, `ChatConversation` | User prompt, context recall | Text stream, tool calls | Memory, Tasks, Missions | Rich turns, L1-L5 truth stack | Session-bound, reactive | Dynamic prompt context injector | Latency drift, tool-use fail | `lib/ai/nick-agent.ts` |
| **2. Journal** | Daily capture and reflection | `app/(mastery)/journal/page.tsx`, `lib/brain/journal-ingest.ts` | `BrainDump`, `Reflection` | Capture text, voice, Telegram | Structured links, Grounded XP | Goals, Missions, Stats | Low friction, 7 modes | Capture box spam | Mode-based prompt suggestion | Classification error | `lib/brain/journal-ingest.ts` |
| **3. Journal Brain** | Ingestion enrichment and classification | `lib/brain/journal-brain.ts` | `BrainDump`, `Reflection`, `SituationLog` | Raw journal text | Grounded entities, directives | Missions, Goals, Home | Next-action suggestions | Links are proposed but rot | Wire to dashboard home counter | False classification | `lib/brain/journal-brain.ts` |
| **4. Memory / BrainMemory** | Long-term memory storage | `lib/brain/contextual-recall.ts`, `lib/brain/memory-consolidation.ts` | `BrainMemory`, `VectorEmbedding` | Ingestion, chat history | FTS & pgvector candidates | Chat, Journal, System | Hybrid FTS + pgvector | Recency bias, scale noise | Auto-dedup on write pathways | Vector drift | `lib/brain/contextual-recall.ts` |
| **5. Goals** | Tracks domains and horizons | `lib/mastery/goal-stats.ts`, `lib/mastery/goal-drift-classify.ts` | `LifeGoal`, `GoalEvent` | Task completions, log pace | Pace scores, drift indicators | Tasks, Stats, Brief | Pacing math, domain mapping | Siloed from daily chat | Dynamic in-chat pace reminders | User ignore fatigue | `lib/mastery/goal-stats.ts` |
| **6. Missions** | Decompose goals into tracks | `lib/services/mission-helpers.ts` | `Mission`, `MissionLink` | Task list, deadlines | Plan data, project maps | Tasks, Goals, Home | Dependency mapping | Plan updates rot when goals drift | Rollover sprint cycles | Overcommitment | `lib/services/mission-helpers.ts` |
| **7. Tasks** | Daily action and habit loops | `lib/trpc/routers/task/` | `Task`, `TaskEvent` | Creation triggers, check-offs | Streaks, completed events, XP | Missions, Goals, Stats | ONCE/DAILY/PROMISE/WEEKLY | inbox 201:8 graveyard | Inbox janitor card on home | Streaks break drop-off | `lib/trpc/routers/task/` |
| **8. Actions / Receipts** | Validation of completed AI-claimed actions | `lib/ai/receipts/action-receipt.ts` | `AutonomousAction`, `EntityAudit` | Tool execution telemetry | Action receipt states | Chat, Ledger, Audit | Hard validation before XP credit | Optional proof fields | Enforce verification rules | Proof falsification | `lib/ai/receipts/action-receipt.ts` |
| **9. Scoreboard / XP / Stats** | Leveling and stats progression | `lib/mastery/leveling.ts`, `lib/mastery/credit-signal.ts` | Character sheet JSON logs | Action logs, journal points | XP deposits, domain levels | Stats, Goals, Home | RPG leveling with domain weight | Toast displays count, not XP | XP decay for dormant domains | Dopamine loop mismatch | `lib/mastery/leveling.ts` |
| **10. Predictions / Calibration** | Forecasting accuracy tracking | `lib/brain/predictions-grader.ts`, `lib/brain/predictive-engine.ts` | `Prediction` | Operator bet forecasts | Brier score, calibration stats | Stats Page, Brain | Sound forecasting metrics | Predictions never auto-resolve | cron checking prediction due dates | Operator ignores bets | `lib/brain/predictions-grader.ts` |
| **11. Threads / Pattern Radar** | Recurring narrative topics identification | `lib/services/journal-thread-trend.ts` | `PatternDetection` | Multi-day journal entries | Thread trend index | Chat prompt, Stats | Arcs trace recurring topics | Arcs are computed but not used | Ingest top threads in prompt | Semantic grouping drift | `lib/services/journal-thread-trend.ts` |
| **12. Daily / Weekly Brief / Recaps** | Aggregate reporting composition | `src/inngest/functions/morning-brief.ts`, `lib/services/morning-brief.ts` | `BrainMemory(morning_brief)` | Metric snapshots, logs | Brief text, Cartesian TTS | Home, Voice, Telegram | Durable briefs with audio TTS | Stored in DB, never pushed | Trigger Telegram push on brief | Metric hallucination | `src/inngest/functions/morning-brief.ts` |
| **13. Truth / Claim Guard** | Integrity filter for AI outputs | `lib/ai/chat/action-claim-detector.ts`, `lib/ai/chat/fabrication-rewriter.ts` | L1-L5 defense stack | Prompt logs, task schema | Fabrication banners, warnings | Chat stream, UI | Prevents false claims of done | Regex fails on new inflections | Embeddings intent checks | Latency from nested loops | `lib/ai/chat/action-claim-detector.ts` |
| **14. System Health / Logs** | Health checks and system exceptions monitoring | `app/api/cron/data-source-health/`, `lib/db/schema-sentinel.ts` | `ServiceHealth` | API endpoint check pings | Health metrics, logs | System Hub, Telegram | Probes bridge services | Errors page redirects to logs | Operator latency charts | Silent network degradation | `app/api/cron/data-source-health/` |
| **15. Notifications / Telegram / Voice** | Client alerting channels | `lib/services/telegram.ts`, `lib/notifications/push.ts` | `BrainBusEvent` | Alert state triggers | Telegram logs, Vapid push | Inngest, Telegram Bot | Cartesia TTS, push integration | Inactive drift alerts pipelines | Route drift alerts to Telegram | Notification fatigue | `lib/services/telegram.ts` |
| **16. Onboarding / Initial State** | User profiling bootstrapping | `scripts/seed-policies.ts` | Seed scripts | Setup scripts execution | Populated default policies | User Profile | Quick schema verification | Lacks interactive UI wizard | Setup onboarding templates | Blank-state friction | `scripts/seed-policies.ts` |
| **17. PWA / Mobile Usability** | UI adaptability for mobile PWA | `app/manifest.ts`, layout files | Viewport config, standalone CSS | Tap events, viewport state | Rendered mobile screens | Standard client | Standalone Safari support | Confirms are sparse on PWA | Swipe-to-complete actions | Viewport layout breakage | `app/manifest.ts` |
| **18. Search / Retrieval / Context** | Context lookup assembly | `lib/brain/contextual-recall.ts` | pgvector queries | Semantic terms, embeddings | Reranked memories | Chat routing, System | FTS + pgvector KNN + Rerank | Reranker adds latency | Core memory block sync cache | Space mismatch on model swap | `lib/brain/contextual-recall.ts` |
| **19. Settings / Operator Controls** | Rules configuration UI | `lib/feature-flags.ts`, `app/(mastery)/settings/page.tsx` | `OperatorPreference` | Preferences form inputs | Config overrides | Chat, Cron, Inngest | Granular feature flags | Auto-tuning overrides values | Dedicated templates controls | State-saving errors | `lib/feature-flags.ts` |
| **20. Admin / System Tooling** | Internal maintenance operations | `lib/db/schema-sentinel.ts`, `/api/system/apply-pending-migration` | Expectation sentinel rows | POST request hashes | Migration logs, sentinel check | System Hub, Postgres DB | Guarded migrations protect vec | Manual verification status | Auto-verify on git push | Accidental pgvector drop | `lib/db/schema-sentinel.ts` |
| **21. Data Ingestion / Connectors** | Fetch external details (emails, calendar) | `config/crons.ts` (Gmail/Calendar) | Email/Calendar DB mappings | Scraper cron loops | Memory ingestion tasks | Brain, System, Notifications | Real-time RSS & email pulls | API changes break OAuth | Composable integration schemas | Leaking private customer emails | `config/crons.ts` |
| **22. AI Orchestration** | Multi-model routing and costs tracking | `lib/ai/provider.ts`, `lib/ai/domain-routing.ts` | Model routing definitions | Prompt tags, route flags | API call payload responses | Chat, Inngest, ImageGen | Venice/Ollama cost routing | Token overflow on deep turns | Sliding-window compression | Model response drift | `lib/ai/provider.ts` |
| **23. Privacy / Data Safety** | User visible logs visibility and safety | `lib/security.ts` | Data visibility policies | Privacy configurations | Masked logs | System Logger | Local backup structures | Tokens logged on errors | Mask logs on tRPC error paths | Unauthorised data leak | `lib/security.ts` |
| **24. Analytics / Progress Metrics** | Trajectory correlation measurement | `lib/brain/correlation-finder.ts` | Matrix statistics logs | Personal daily metrics | Correlation coefficients | Stats, Brain | Granger causality checks | Raw numbers never surfaced | Correlation plots on `/stats` | Correlation vs Causation bias | `lib/brain/correlation-finder.ts` |
| **25. Identity / Narrative Layer** | Long-term trajectory tracing | `lib/brain/identity-snapshot.ts` | `IdentitySnapshot` | Daily check-in logs | Trajectory cards, delta logs | Stats Page, Inngest | 8-axis snapshots computed | UI lacks historical comparison | Trajectory delta cards (90d) | Calculation drift | `lib/brain/identity-snapshot.ts` |

---

## 4. Data Flow Map

This map outlines the flow of user data through STATENOUR's ingestion, processing, storage, and retrieval layers:

```
[User Input] ──► [Journal / Capture] ──► [Journal Brain] ──► [Prisma Database] ──► [Memory Consolidation]
     │                                         │                   │                      │
     ▼                                         ▼                   ▼                      ▼
[Chat Router] ◄── [Context Assembly] ◄── [FTS/Vector Search] ◄── [Embeddings]   [Identities/Briefs]
```

| Flow | Source | Transform | Storage | Retrieval | Used By | Missing Link | Risk | Improvement |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Journal Capture** | User text/voice input | `groundJournalEntry` | `BrainDump`, `Reflection` | `getJournalBrief` | Stats Page, Nick Prompt | Outcome tracking linkage | Classification error | Add `outcomeScore` field to task completions |
| **Chat Message** | User prompt | `detectTopicTier` | `ChatMessage` | `getChatContinuity` | Reranker, prompt context | Core-VS-Full history routing | Token budget overflow | dynamic sliding history window |
| **Memory Write** | Cron jobs, chat sweeps | `embedContent` | `BrainMemory` (Unsupported vec) | `contextualRecall` | Nick prompt grounding | Write-time semantic deduplicator | Duplicate vectors | Add cosine-similarity write barrier |
| **Drift Logging** | Daily pace cron | `classifyDrift` | `DriftAlert` | `getDriftAlerts` | Scoreboard, Morning brief | Telegram push notification | User notification decay | Trigger Telegram push on drift grade > 3 |
| **Calibration** | Bet ledger | `gradePredictions` | `Prediction` | `getCalibrationStats` | Stats Page | Auto-resolution trigger | Stale un-resolved bets | Add scheduled prediction due-date check cron |

---

## 5. Intelligence Flow Map

| Insight Loop | Current Mechanism | Evidence | Failure Mode | Upgrade Opportunity |
| :--- | :--- | :--- | :--- | :--- |
| **Drift & Momentum** | Scans goals & events daily via `drift-detector.ts` | `DriftAlert` rows in schema | Alert gets stored but not pushed to operator | Route alerts above threshold to Telegram |
| **Memory Consolidation** | Merges duplicate nodes via `memory-consolidation.ts` | `scoreMemories()` manual-source guard | Auto-scores overwrite manual operator corrections | Pinned memories explicitly protected in consolidation |
| **Truth Grounding** | Injects live task stats in chat initialization | `truth-grounding.ts` | Claims are checked but numbers are still hallucinated | Inject structured task list into memory-search tools |
| **Action Suggestion** | Converts learnings to tasks via `action-converter.ts` | `pendingClassification` in `Task` | Suggested links rot without approval interface | Add a "triage queue" tab to the Tasks screen |

### Does STATENOUR get smarter over time or just store more data?
*Blunt Answer:* **It stores more data but does not systematically close its own feedback loops.** The system computes Granger correlations, Brier calibration scores, and memory edges, but because braintrust evals are currently inactive, the memory consolidation overrides manual edits, and there are no callers resolving predictions, the AI doesn't learn from its mistakes or historical performance. It lacks an active auto-tuning mechanism on the prompt/retrieval side.

---

## 6. User Journey Map

| Journey Step | Current UX | Emotional Job | Friction | Missing Intelligence | Best Upgrade | Evidence |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Daily Capture** | Text field on `/journal` | Express thoughts, capture todo | Typing details on phone | Capture modes must be chosen manually | Mode-based prompt suggestions | `app/(mastery)/journal` |
| **Weekly Review** | Review ledger on `/stats` | Map progress, audit drift | Reading static text logs | Cross-week change delta is calculated but not shown | Identity snapshot delta cards | `lib/mastery/xp-drift.ts` |
| **Action Triage** | Task list on `/missions` | Decide what to do next | Inbox overload (201 items) | Proactive rescue recommendations are hidden | One-tap triage/rescue drawer | `lib/services/mission-helpers.ts` |
| **Drift Correction** | View drift cards on `/stats` | Get back on track | Remembering to check the stats page | Zero push notifications for critical drift | Proactive Telegram push notifications | `lib/brain/drift-detector.ts` |

---

## 7. Transformation Loop Audit

| Loop | Current Strength (1-10) | Missing Piece | Highest-Leverage Fix |
| :--- | :--- | :--- | :--- |
| **Reflection → Insight → Action** | 5/10 | Suggestions are hidden in `pendingClassification` | Wired-up task triage card on Home screen |
| **Action → Proof → Reward** | 6/10 | Proof uploads are optional; no visual ledger of wins | Propose "Becoming Strip" displaying weekly proof counts |
| **Goal → Mission → Task** | 7/10 | Dynamic progress rollout from task to goal | Auto-credit XP to stats from parent goal domains |
| **Prediction → Outcomes** | 2/10 | Predictions are never resolved automatically | Schedule daily due prediction reminder cron |
| **Memory → Pattern** | 4/10 | Relational memory graphs are unused in prompt context | Ingest weekly review summary into system prompt |

---

## 8. Weakest Systems Ranking

| Weakest Rank | System | Why Weak | Repo Evidence | User Impact | Product Impact | Fix Difficulty | Strategic Priority |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **Proactive Alerts (Delivery)** | No push alerts; computed drift alerts rot in database. | `proactive-pushes.ts` has zero callers. | High (User forgets to log check-ins). | Low task execution. | Low (S-cost wire). | **CRITICAL** |
| **2** | **Memory scale** | Retrieval gets noisier at scale; no pre-deduplication. | `memory-consolidation.ts` lacks cosine write checks. | Memory dilution. | Hallucinated turn histories. | Medium. | **HIGH** |
| **3** | **Action Triage** | Inbox vs Ready ratio is 25:1; inbox is a graveyard. | 201 inbox tasks vs 8 active. | User ignores task boards. | Low project momentum. | Low (Triage tab). | **HIGH** |
| **4** | **Calibration Loop** | Predictions are never resolved. | `resolvePrediction` has no callers. | Inactive Brier scoring. | No calibration data. | Low. | **MEDIUM** |

---

## 9. Best-in-Class Benchmarking

| Product / Paper | Domain | Source Tier | What to Steal | What to Avoid | Implementation Cost |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Logseq** | Journal Graph | Tier 1 | Daily Notes outline + double-bracket page link format | Huge graph rendering performance lag | Medium (Markdown parses) |
| **Plane** | Project board | Tier 1 | Cycle-based task rollover structures | Team-clutter, multi-tenant workspace logic | Medium |
| **Mem0** | Memory | Tier 1 | Dual memory classification (facts vs episode logs) | Black-box memory pruning | Low |
| **Letta** | Agent state | Tier 1 | Explicit core-memory block editing | Multi-agent network overhead | High |
| **Metaculus** | Predictions | Tier 2 | Brier-score calibration curves | Public crowd-incentive gamification | Low (UI rendering) |

---

## 10. Open-Source Repo / Resource Links

* **Logseq:** [https://github.com/logseq/logseq](https://github.com/logseq/logseq) (Local daily outline & relational blocks)
* **Mem0:** [https://github.com/mem0ai/mem0](https://github.com/mem0ai/mem0) (Personalized factual memories)
* **Letta:** [https://github.com/letta-ai/letta](https://github.com/letta-ai/letta) (CoALA agent architecture memory systems)
* **Plane:** [https://github.com/makeplane/plane](https://github.com/makeplane/plane) (Lean roadmap and cycle tasks tracking)

---

## 11. Practical Architecture Lessons

### A. Letta (CoALA) Memory Block Sync
Letta models memory as static blocks (Core Memory, Recall Memory, Archival Memory). Instead of searching the vector database on every single turn, it keeps "Core Memory" directly loaded in the LLM's system prompt context. A task tool handles updating these blocks in real-time, syncing them back to database tables asynchronously.
*STATENOUR Application:* Create a `CoreMemoryBlock` model containing identity axioms, active focus, and current blockages that is always injected into Nick's prompt (instead of relying on vector KNN hits).

### B. Logseq Daily Note Backlinking
Logseq maps markdown files by resolving double-bracket references (`[[My Project]]`) into block edges dynamically on read. It doesn't write structural join tables on every typing event.
*STATENOUR Application:* Instead of heavy SQL joins, let the journal ingest pipeline parse strings like `[[Mission ID]]` out of text bodies, dynamically creating `MemoryEdge` records on consolidation.

---

## 12. Steal / Do Not Steal Matrix

| System | Best Reference | Steal This | Do Not Steal This | Why | Effort | Priority |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Memory** | Letta | Core memory blocks inside prompts | Archival vectors on every single message turn | Reduces tokens, decreases latency | Low | **HIGH** |
| **Journal** | Logseq | Double-bracket links (`[[Project]]`) | Multi-page folders / complex hierarchical trees | Simplifies mobile capture | Medium | **HIGH** |
| **Tasks** | Plane | Cycles / Rollover metrics | Enterprise sub-projects and team roles | Prevents dashboard bloat | Medium | **MEDIUM** |
| **Dashboard** | Sunsama | Single daily planning ritual | Complex charts and metrics tables | Drives action rather than reflection | Low | **HIGH** |

---

## 13. Privacy / Security / Trust Model

| Data Type | Storage | AI Exposure | User Control | Risk | Needed Guardrail |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Journal Dumps** | PG (`BrainDump`) | High (Reranked context) | Full delete | Accidental leak to logs | Mask logs on LLM errors |
| **CRM Leads** | PG (`PersonProfile`) | Medium (Injected context) | Soft-delete | AI fabricating comments | Verify claims via grounding layer |
| **Bet Predictions**| PG (`Prediction`) | Low | None | Exposure of personal bets | Encrypt bet fields if private |

---

## 14. Anti-Bloat Product Filter

| Recommendation | Pass/Fail | Why | Action |
| :--- | :--- | :--- | :--- |
| **Proactive Telegram Push** | **PASS** | Drives daily action; pulls operator back into the system loop. | Keep |
| **Identity Snapshot Delta Card**| **PASS** | Shows identity transformation; uses existing Postgres data. | Keep |
| **Automatic Prediction Resolver**| **PASS** | Closes prediction calibration loops without operator action. | Keep |
| **3D Memory Galaxy Graph** | **FAIL** | Visually impressive but adds no action value. Overloads mobile. | Kill |

---

## 15. Implementation Effort Estimates

| Recommendation | Effort | Complexity | Risk | Dependencies | First Safe Slice | Rollback Plan |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Telegram Push Alerts** | 1 Day | Low | Low | Telegram Bot API | Alert on daily brief ready | Disable cron route |
| **Identity Snapshot Delta** | 2 Days | Medium | Low | `IdentitySnapshot` model | Show past 90d delta card | Revert UI card |
| **FTS Memory Dedup** | 1 Day | Medium | Low | BM25 search indices | Block duplicate writes | Revert match method |
| **Auto Bet Resolution** | 1 Day | Low | Low | `Prediction` table | Cron checking prediction dates | Disable resolution cron |

---

## 16. Transformation Impact Ranking

```
Priority Score = ((Transformation + Action + Retention + Intelligence + EmotionalResonance + CompoundingValue + Confidence) - (ImplementationCost + Risk)) / 7
```

| Rank | Recommendation | Scores (T/A/R/I/E/C/Conf) | Priority Score | Why |
| :--- | :--- | :--- | :--- | :--- |
| **1** | Proactive Alerts | 9 / 9 / 10 / 8 / 8 / 9 / 10 | **8.2** | Connects system alerts directly to operator device. |
| **2** | Identity Snapshots Delta | 10 / 7 / 9 / 8 / 10 / 10 / 9 | **8.0** | Displays proof of becoming over quarters. |
| **3** | Weekly review prompt link | 8 / 8 / 9 / 9 / 8 / 8 / 9 | **7.5** | Injects multi-week context into daily turns. |
| **4** | Prediction loop resolution | 7 / 6 / 8 / 9 / 8 / 9 / 10 | **7.2** | Resolves forecasts to calibrate AI predictions. |

---

## 17. 30-Day Roadmap

| Timeline | Initiative | User Value | Files | Migration? | Tests | Acceptance Criteria |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Day 1-5** | Proactive push alerts | Receive notifications on drift alerts and daily summaries. | `proactive-pushes.ts`, Inngest jobs | No | Unit tests on push routing | Bot sends brief summary to Telegram |
| **Day 6-12** | Identity Snapshots Delta | View progress comparative statistics over quarters on `/stats`. | `/stats` page, `IdentitySnapshot` helper | No | Test comparing two snapshots | UI card displays 90d state shifts |
| **Day 13-20**| Auto Bet Resolution | Calibration scores update automatically on prediction targets. | `predictions-grader.ts`, cron tasks | No | Bet grading tests | Scheduled predictions resolved daily |
| **Day 21-30**| Weekly review in prompt | Nick chat persona acts with knowledge of weekly goals. | `system-prompt.ts`, contextual recall | No | Integration tests on prompt injection | AI responds to context of weekly reviews |

---

## 18. 90-Day Roadmap

* **Memory Deduplication:** Implement cosine similarity threshold writes on vector databases.
* **Triage Inbox Flow:** Built-in "rescue dashboard" on Tasks panel to easily prune or schedule items.
* **Bridge connections:** Implement business metrics sync endpoints to correlate health data with revenue metrics.

---

## 19. One-Year Vision

* **The Transformation Oracle:** Fully autonomous life coach that suggests actions, schedules daily check-ins, tracks habit outcomes, identifies negative behavioral loops, and recalibrates weekly routines based on real performance evidence.

---

## 20. Top 10 Highest-Leverage Moves

1. **Wire up Telegram push notifications** for critical drift and weekly briefs.
2. **Display identity snapshot differences** over a 90-day trajectory on `/stats`.
3. **Trigger active resolves** for bet predictions based on due timestamps.
4. **Inject weekly reviews** directly into chat context.
5. **Build an inbox rescue triage card** to tackle task backlog.
6. **Limit duplicate vector memory writes** via cosine similarity filters.
7. **Add an outcome feedback field** (`outcomeScore`) to task completion.
8. **Render character sheet skill graduations** as victories.
9. **Standardize relative-time displays** on UI elements.
10. **Enable automated action proposals** via user approval queues.

---

## 21. Implementation Tickets

### Ticket 1: Wire Up Proactive Telegram Push Alerts
* **Problem:** Drift alerts and daily briefs are generated, but the operator is never notified.
* **Scope:** Connect `proactive-pushes.ts` alert triggers to Inngest daily briefs.
* **Key Files:** `lib/brain/proactive-pushes.ts`, `src/inngest/functions/morning-brief.ts`
* **Out of Scope:** Designing a new web UI dashboard for configuring notification schedules.
* **Data Model Impact:** None (uses existing `BrainMemory` rows).
* **AI/Prompt Impact:** None.
* **Privacy Impact:** Direct transmission of alert text to Telegram bot endpoints.
* **Test Plan:** Verify the bot successfully triggers mock HTTP messages to the target Telegram ID.
* **Acceptance Criteria:** Bot sends a direct text to operator's Telegram when morning brief is ready.
* **Rollback Plan:** Comment out the call in `morning-brief.ts`.
* **Safe First Slice:** Trigger only morning slot pushes on brief completions.
* **Estimated Effort:** 1 Day.

### Ticket 2: Identity Snapshot Comparative Delta Card
* **Problem:** Users can't see how their metrics have changed over time.
* **Scope:** Add a UI card comparing the current identity snapshot with the snapshot from 90 days ago.
* **Key Files:** `app/(mastery)/stats/page.tsx`, `components/mastery/character-sheet.tsx`
* **Out of Scope:** Re-writing the database schema structure of snapshots.
* **Data Model Impact:** None (reads existing `IdentitySnapshot` table rows).
* **AI/Prompt Impact:** None.
* **Privacy Impact:** Local UI rendering only.
* **Test Plan:** Write a unit test simulating a 90-day delta query between two JSON states.
* **Acceptance Criteria:** Display +/- values for each axis over 90 days.
* **Rollback Plan:** Revert UI cards integration.
* **Safe First Slice:** Read and log delta array in console before drawing UI nodes.
* **Estimated Effort:** 2 Days.

### Ticket 3: Automated Bet Prediction Resolution Cron
* **Problem:** Prediction bets remain in a pending status even after target dates have expired.
* **Scope:** Write a scheduled job to auto-resolve bets based on real database outcome metrics.
* **Key Files:** `lib/brain/predictions-grader.ts`, `src/inngest/functions/predict-resolutions.ts`
* **Out of Scope:** Interactively querying the operator for subjective bet resolutions.
* **Data Model Impact:** Updates `status`, `outcome` and `brierScore` columns in the `Prediction` table.
* **AI/Prompt Impact:** None.
* **Privacy Impact:** None.
* **Test Plan:** Mock predictions due today and run prediction-grader to verify Brier score writes.
* **Acceptance Criteria:** Expired bets are auto-graded and scored.
* **Rollback Plan:** Disable Inngest job execution configuration.
* **Safe First Slice:** Grade only strictly binary outcomes linked to task completion.
* **Estimated Effort:** 1 Day.

### Ticket 4: Weekly Review Context Prompt Injection
* **Problem:** Nick lacks awareness of weekly objectives or past review notes during chat sessions.
* **Scope:** Load recent weekly review logs and insert them into Nick's system prompt context.
* **Key Files:** `lib/ai/system-prompt.ts`, `lib/ai/nick-agent.ts`
* **Out of Scope:** Real-time generation of weekly reviews inside the chat loop.
* **Data Model Impact:** None.
* **AI/Prompt Impact:** Injects weekly summaries into the prompt core.
* **Privacy Impact:** Exposes weekly summary records to LLM token payloads.
* **Test Plan:** Verify system prompt output prints the active weekly objectives on bootstrap.
* **Acceptance Criteria:** AI can reference and discuss the current week's targets without user prompt cues.
* **Rollback Plan:** Remove the injection function call from `system-prompt.ts`.
* **Safe First Slice:** Inject only the top 3 bullet points of active weekly priorities.
* **Estimated Effort:** 1 Day.

### Ticket 5: Inbox Rescue Triage Card on Home / Tasks Screen
* **Problem:** Over 200 tasks rot in the inbox because the triage experience is high friction.
* **Scope:** Build a simple, high-visibility card proposing 3 next-actions to keep, snooze, or discard.
* **Key Files:** `app/(mastery)/missions/page.tsx`, `lib/services/mission-helpers.ts`
* **Out of Scope:** Automated auto-purges of tasks without user action.
* **Data Model Impact:** Updates `status` fields on targeted `Task` rows.
* **AI/Prompt Impact:** None.
* **Privacy Impact:** None.
* **Test Plan:** Verify UI correctly triggers action events when buttons are tapped.
* **Acceptance Criteria:** Operator can process 3 tasks in 3 taps from the home view.
* **Rollback Plan:** Revert homepage triage layout nodes.
* **Safe First Slice:** Display only task counts and basic text fields.
* **Estimated Effort:** 2 Days.

### Ticket 6: Cosine Similarity Deduplication on Memory Ingestion
* **Problem:** Duplicate or highly redundant memories are repeatedly written to pgvector storage.
* **Scope:** Write a pre-check query utilizing cosine similarity to reject duplicate entries.
* **Key Files:** `lib/brain/memory-consolidation.ts`, `lib/db/pgvector.ts`
* **Out of Scope:** Bulk cleanup of existing historical database memories.
* **Data Model Impact:** Prevents redundant `BrainMemory` table writes.
* **AI/Prompt Impact:** None.
* **Privacy Impact:** None.
* **Test Plan:** Attempt to write duplicate strings and verify the write path rejects the second entry.
* **Acceptance Criteria:** Memory writes fail if a memory matching >0.93 similarity already exists.
* **Rollback Plan:** Remove the similarity pre-check validation step.
* **Safe First Slice:** Run check only on auto-generated chat message summaries.
* **Estimated Effort:** 1 Day.

### Ticket 7: Task Outcome Feedback Capture
* **Problem:** Tasks are completed but the system never learns if the effort resulted in actual success.
* **Scope:** Add an optional `outcomeScore` and brief outcome log text when completing high-leverage tasks.
* **Key Files:** `lib/trpc/routers/task/`, `app/(mastery)/stats/page.tsx`
* **Out of Scope:** Enforcing outcome score inputs for every single trivial check-off.
* **Data Model Impact:** Add `outcomeScore` and `outcomeLog` columns to the `Task` model.
* **AI/Prompt Impact:** None.
* **Privacy Impact:** None.
* **Test Plan:** Verify the new database columns write cleanly on completion patch.
* **Acceptance Criteria:** User can type a one-line result log and rate the outcome 1-10 on task checks.
* **Rollback Plan:** Make columns optional and hide UI input fields.
* **Safe First Slice:** Deploy schema changes first, wire UI components in slice 2.
* **Estimated Effort:** 2-3 Days.

### Ticket 8: Greene-voiced Relationship Weekly Digest Revival
* **Problem:** Relationship state changes are computed weekly but never delivered.
* **Scope:** Re-enable the dormant weekly relationship synthesis job to push to Telegram.
* **Key Files:** `config/crons.ts`, `src/inngest/jobs.ts`
* **Out of Scope:** Modifying the Greene law tag engine logic.
* **Data Model Impact:** Logs execution parameters in `ServiceHealth`.
* **AI/Prompt Impact:** Synthesizes relationships logs into a Greene-style text.
* **Privacy Impact:** Exposes CRM names and interaction summaries to the AI provider.
* **Test Plan:** Verify the cron triggers the AI generator and outputs a valid summary message.
* **Acceptance Criteria:** Bot sends a relationship digest to the operator on Sunday evenings.
* **Rollback Plan:** Toggle cron mode back to `dormant` in config.
* **Safe First Slice:** Push only upcoming birthdays and anniversaries in week 1.
* **Estimated Effort:** 1 Day.

### Ticket 9: Anticipated-Questions Prompt Context Pre-warm
* **Problem:** Precomputed anticipated questions are stored but never pre-warmed in Nick's prompt.
* **Scope:** Ingest today's anticipated questions in the initial chat system prompt.
* **Key Files:** `lib/ai/system-prompt.ts`, `lib/brain/anticipated-questions.ts`
* **Out of Scope:** Running real-time question generation models on the fly.
* **Data Model Impact:** None.
* **AI/Prompt Impact:** Seeds the chat context with precomputed questions.
* **Privacy Impact:** None.
* **Test Plan:** Verify mock questions are loaded and printed in the system prompt logs on load.
* **Acceptance Criteria:** Chat prompt context contains the precomputed questions.
* **Rollback Plan:** Remove injection line from prompt builder.
* **Safe First Slice:** Load only the top single question.
* **Estimated Effort:** 1 Day.

### Ticket 10: XP Decay / Momentum Loss Mechanics Implementation
* **Problem:** Character scores monotonically increase, meaning stats stop reflecting recent focus.
* **Scope:** Implement a slow decay factor (e.g. -2% weekly) for stats domains with zero recent activity.
* **Key Files:** `lib/mastery/leveling.ts`, `lib/mastery/xp-drift.ts`
* **Out of Scope:** Resetting levels or decreasing total completed tasks counts.
* **Data Model Impact:** Writes a negative audit row to ledger stats.
* **AI/Prompt Impact:** None.
* **Privacy Impact:** None.
* **Test Plan:** Mock a 14-day inactivity state and run leveling function to confirm decay adjustments.
* **Acceptance Criteria:** Stat scores drop slightly when active goals in that domain are neglected.
* **Rollback Plan:** Disable the decay cron execution block.
* **Safe First Slice:** Decay only the "personal" domain to verify gaming dynamics.
* **Estimated Effort:** 1 Day.

---

## 22. What Not To Build

* **Do not build a 3D memory graph visualization:** Adds latency with zero transformation value.
* **Do not write multi-agent planners:** Inefficient before the primary memory deduplication and recall noise is controlled.
* **Do not build complex gamification metrics:** Simple XP decay and stat attribution is sufficient.

---

## 23. Founder-Level Recommendations

“If I owned STATENOUR for the next 5 years, these are the 10 things I would build, in order:”

1. **Delivery First:** Push updates directly to the operator's device daily.
2. **The Witness Layer:** Comparative identity trajectory cards.
3. **Closed Calibration:** Auto-resolving bets to grade forecasting.
4. **Scale-Proof Memory:** Cosine-similarity checks on vector writes.
5. **Autonomy Wires:** Safe execution of automated task proposals.
6. **Daily Rituals:** Sacred daily triage queues.
7. **Business Sync:** Correlation engines between body health and revenue.
8. **Proactive AI Conversant:** Nick initiating daily check-ins.
9. **Loss Aversion Mechanics:** XP decay and streak metrics.
10. **Annual Transformation Ledger:** Compiled yearly review documents.

---

## 24. Claims Needing Runtime Verification

To ensure full system integrity, the following runtime vectors must be validated in staging/production:

| Claimed Feature | Subsystem / Model | Verification Metric | Risk / Potential Trap |
| :--- | :--- | :--- | :--- |
| **Cartesia TTS Generation** | `morning-brief.ts` | Verifies `CARTESIA_API_KEY` is loaded and renders valid MP3 buffers. | If key is expired or voice ID has been updated/retired, morning briefs fail to render audio. |
| **Web Push Dispatch** | `push.ts` | Web Push subscription payload delivery. | Vapid keys mismatch blocks browser registrations. |
| **Telegram BOT Token** | `telegram.ts` | Direct REST post returns `{ ok: true }` from Telegram. | Unset token blocks the system's critical alerting capability. |
| **Cosine Deduplication** | `memory-consolidation.ts` | Deduplication triggers when similarity exceeds threshold. | Overly tight threshold blocks useful episodic logs; loose threshold permits sprawl. |

---

## 25. Proactive Alerting Safeguards & Prerequisites

### A. "Do Not Implement Until..." Prerequisites for Ticket 1
Prior to configuring any live scheduled runs of `fireSlotForCurrentHour()` or sending alerts to the operator's Telegram, the following code guards must be verified:
1. **Telegram Configuration Proof:** Ensure `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are fully declared in Railway variables.
2. **Safe Dry-Run Mode:** Verify a logging mechanism maps output alerts to logs rather than hitting external REST APIs when `DRY_RUN=true` or during tests.
3. **Notification Log / Audit Trail:** Logs are systematically written to `EntityAudit` or system logger to trace when, why, and what alerts were sent.

### B. Safe Test Mode Protocol (No Live Telegram Sends During Test)
* **Rule:** All automated test suites (`vitest` runner) must mock the `sendTelegram` module.
* **Implementation:** The file `tests/setup.ts` must globally mock `@/lib/services/telegram` so no real HTTP calls are made during development typechecks or CI checks.

### C. Rate Limits, Quiet Hours & Priority Thresholds
To prevent notification fatigue, the following limits must be applied at the router layer before calling `sendTelegram`:
* **Quiet Hours:** No alerts should trigger between **10:00 PM and 7:00 AM ET** unless the alert category is marked as `FATAL`.
* **Rate Limits:** Maximum of **3 alerts per day** for standard insights (1 morning, 1 afternoon, 1 evening).
* **Priority Thresholds:** Only push `DriftAlert` objects with a severity level > 3. Lower severity drift indicators are appended to the morning brief but do not trigger instant push alerts.
* **Kill Switch / Disable Plan:** The environment variable `PROACTIVE_PUSH_ENABLED=off` must act as a global kill-switch, bypassing slot checks and immediately resolving `skipped: true`.

### D. User Approval Gate
* The proactive push cron execution route must require user authorization parameters or explicit flags (`PROACTIVE_PUSH_CRON_ENABLED=true`) before active scheduler threads run in production.
