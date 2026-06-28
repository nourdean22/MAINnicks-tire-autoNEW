# Reconciliation · statenour-os

> **Pending merge (2026-06-19):** All five PRs below now merged. Detail: [`docs/sessions/2026-06-19.md`](sessions/2026-06-19.md). New work tracked below.

> **Deep-disconnect audit (2026-06-21):** PR #266 (WP-1 AI Provider Registry), #267 (drop 13 dead models + 1 enum), branch `cleanup/drop-prisma-models` → merged to `main`. All verified in `**Last verified:**`.

> **Historical log** — entries are most-recent-first. The older entries far below reference now-**retired** deploy paths (the `codex/ollama-local` / `statenour-master` branches · Vercel · the standalone statenour-os repo), kept for lineage only and never current instructions. Current truth: [`CURRENT-TRUTH.md`](CURRENT-TRUTH.md) · production is `main` → Railway → bdnick.info.

**Last verified:** 2026-06-28 (post the **Obsidian Integration & Navigation Audit wave — PR #385, #387, and #388 merged**, three commits on `main`: ① `9d2b2f68` — implemented `generate-obsidian-canvas.ts` script to query active missions/tasks and output a clean Kanban-style visual whiteboard canvas file to the local Obsidian vault; ② `9bffd20e` — added administrative metadata fixer utility script `fix-obsidian-metadata.ts` to help align frontmatter keys; ③ `21fcf32b` — repositioned `HomeNickDock` to be inline at the top of the homepage below the coach banner (removing floating bottom layout conflict) and configured 5 bottom tab slots: Home (home icon), Chat (messagesquare icon), Missions, Journal, and More, completely resolving layout overlaps and touch-target spacing. Gates: typecheck 0 · eslint 0 · stale-docs STRICT 0 · pnpm test pass. Deploy: Railway statenour-web BUILDING.) **PRIOR:** 2026-06-21 (post the **deep-disconnect audit + schema cleanup wave — PR #267 merged**, three sequential commits on `main`: ① `c5336da8` — dead prop contract (`ChatEmptyState.onPick` removed + call-site), dead exports (6 files), 5 dead hooks/components deleted, 13 undocumented env vars promoted to `runtime` tier in `env.ts` + `.env.example`; ② `51dac1b3` — 22 legacy REST routes superseded by tRPC deleted (~1,210 LOC), 5 living routes verified and preserved (`/api/missions/[id]/retro`, `/api/coach/events/[key]/ack`, `/api/system/calibration/reviews/[id]/resolve`, `/api/relationships/[personId]/contextual-laws`, `/api/brain/wisdom/[id]/related`); ③ `859db0b5` — **13 dead Prisma models + 1 enum dropped** (`OperatorCheckIn`, `CommandResolution` + `CommandResolutionType`, `DailyEmpireSnapshot`, `WorkResult`, `StagedRecoveryItem`, `EnvironmentalSignal`, `DailyStrategy`, `AgentRun`/`AgentMemoryHit`/`AgentFeedback`, `ContentNode`, `FinancialTransaction`, `InvestmentHolding`) verified empty or absent via Neon production probe (8 NOT FOUND, 5 exist with 0 rows / 0 bytes), dangling relation fields excised from `DailyExecutionState`/`WorkItem`/`RecoveryActionLog`/`StrategicLaw`/`PromptVersion`, `prisma validate` clean, `DATA-MODEL.md` model-count updated 101→88, `CONSOLIDATION-PLAN-2026-05-16.md` annotated. Gates: typecheck 0 · eslint 0 · stale-docs STRICT 0 critical/0 warn · `pnpm test` pass (isolated pool) · pre-push turbo green · prisma validate. Deploy: Railway statenour-web BUILDING. **PRIOR:** 2026-06-19 (post the **Venice de-drift waves — PR #235 + #237 squash-merged + deployed**, Venice now fully retired across BOTH the runtime/control plane and the health/observability plane: #235 `93793d4c` — chat route HONORS a validated providerOverride (was void-discarded) with tool-mandatory python/action ollama-force precedence, header dot + diagnose-chat read real `providerHealth` (was the always-`{ok:false}` `veniceStatus` -> permanently-amber dot / always-DEGRADED diagnostic), `venice` dropped from the picker + `ProviderOverride` union, **env.ts boot-guard P0** (`aiKeys` VENICE_API_KEY->OLLAMA_API_KEY so a venice-only key no longer false-passes the at-least-one-provider gate), STRICT `check:stale-docs` wired into `verify:hard` + CI, + 6 regression tests; #237 `1f98f7f2` — de-Veniced the health/observability layer that still keyed AI-health off the unset VENICE_API_KEY: removed the false-RED deploy badge (`VENICE_API_KEY critical` in DEPLOYMENT_SECRET_CHECKS), tools-health/route ai-category -> anyOf(OLLAMA/OPENAI/GEMINI/ANTHROPIC), integration-quotas sole-Venice probe + card, telegram qwen3-vl -> Claude vision primary, knowledge-sync dead `callVenice` removed + BrainDump AI-classification DISABLED (operator decision: no provider re-point) + false-cron doc fixed, registry tombstone, nickstire dead `venice` DailyStats field. `veniceStatus` tRPC + `/api/ai/venice-status` REST route kept as inert stubs. Gates both PRs: tsc 0 (statenour+nickstire) · eslint 0 · stale-docs STRICT 0 critical/0 warn · `pnpm test` pass (isolated pool) · pre-push turbo green. Antigravity completeness-audit (PR #236, now closed) verified via 11-agent pass: accurate line-level but inflated severity — 1 already-fixed, 1 medium [the deploy badge], rest low/cosmetic/dead, zero runtime breakage.) **PRIOR:** 2026-06-19 (post the **Consolidated-Models Migration Registration wave — PR #217 opened**, this wave cherry-picked the parked operator commit `865febc9` onto a clean `main` and landed it as one conflict-free commit registering idempotent DDL for the 10 NOUR OS consolidation tables — `content_nodes` `contacts` `bookings` `agreements` `products` `orders` `financial_transactions` `investment_holdings` `short_links` `link_clicks` (backing /crm /wealth /finance /links) — in the `apply-pending-migration` MIGRATIONS map, plus a docs commit (this entry · `prisma/migrations-pending/README.md` parked-entry · `DATA-MODEL.md` model-count 80→101 · `AGENTS.md` stamp). DDL↔`schema.prisma` parity verified for all 10 tables (names/types/nullability/defaults/unique/indexes/FK onDelete); gates: typecheck 0, check:raw-sql clean, prisma validate, pre-push turbo build 4/4 green. **Registered ≠ applied** — operator applies via the guarded endpoint with key `20260618000000_consolidated_models`. Also this session (local, no commits): repo hygiene — pruned 5 stale registered worktrees + 21 orphaned `.worktrees/` shells, deleted 4 merged branches, rescued 4 reel-pipeline scratch scripts to `apps/nickstire/scratch/`. **Flagged · NOT fixed:** migration not yet applied to prod (operator step); a stale `/api/cron/semantic-dedup` doc reference (module exists but is unwired) surfaced in a backlog audit, deferred.) **PRIOR:** 2026-06-15 (post the **Audit Improvements, Portability & Concurrency Races wave**, this wave implements the 6 code audit recommendations: depth-3 security redaction overflow safety in sanitize-error and logger, relative path portability for operating guidelines, worktree setup branch-existence checks, check-stale-docs date synchronization, client double-submit guards on card/quick task creation, and server-side concurrent inbox creation serialized promise cache in TRPC routers. All gates pass: typecheck 0, lint 0, 3,515 tests green, build green.) **PRIOR:** 2026-06-15 (post the **Journal Insights Preview Router Tests wave — PR #138 merged**, this wave adds comprehensive unit and contract test coverage for the insightsPreview tRPC procedure inside the journal router. All gates pass: typecheck 0, lint 0, 3,515 tests green, build green.) **PRIOR:** 2026-06-14 (post the **Task Routing Matrix & Provider Fallback Hardening wave — PR #133 merged & PR #131 merged**, this wave defaults the primary Gemini model to `gemini-3.5-flash`, implements the complete 12-TaskType preferred routing matrix for fallback ordering, and fixes VAPI diagnostics case assertions. All gates pass: typecheck 0, lint 0, 3,510 tests green, build green.) **PRIOR:** 2026-06-14 (post the **Dopamine Loops & Brain Hub Tab Consolidation wave — PR #130 merged**, this wave implements reward visual feedback loops on `/missions` and resolves orphaned views by mounting them as tabs under `/brain`: ① dynamic level transition detection in `creditTaskStats` and Greene-flavored mastery tier details in `TaskReward` ② glassmorphic celebration overlay `LevelUpModal` + gold neon glow + floating `+N XP` `XpParticle` CSS animation on task completion ③ inline fire `StreakBadge` for daily task streaks ④ mounted `BrainHealthView` and `BrainContinuityView` as native PageTabs under `/brain` ⑤ updated redirects in `next.config.ts` so `/brain/health` redirects to `/brain?tab=health`, and updated deep links in `since-last-visit-card.tsx`, `memory-tab.tsx`, `tool-result-registry.tsx`, and `feature-status.ts`. Passes all gates: typecheck 0, lint 0, 3,497 tests green, next build green.) **PRIOR:** 2026-06-14 (post the **Autonomic Self-Healing Upgrades wave — PR #120 merged & PR #124 merged**, this wave implements database size-based vacuuming, stalled task auto-decomposition, and budget-aware provider reordering: ① Phase 2 DB Health size-based VACUUM ② Phase 5 Task Stalling Healer auto-decomposition ③ Budget-aware provider reordering ④ Manual Maintenance Route ⑤ Added unit test coverage for budget-aware fallback routing in `tests/ai/traced-aichat.test.ts`. Passes all gates: typecheck 0, lint 0, tests green.) **PRIOR:** 2026-06-13 (post the **Missions UI Polish & Task Decomposition wave — PR #119 merged**, this wave implements four UI/UX enhancements and the task decomposition pipeline on the Statenour /missions page: ① Phase 1: Dynamic Search Placeholder dynamically adapting based on active filters (kind + domain) ② Phase 2: Actionable "Ask Nick" Empty-State CTA button inside `EmptyMissions` that dispatches `"statenour:open-nick"` and initiates a goal-assessment query ③ Phase 3: Live Autonomic Engine Health Chip in the KPI bar of `mission-feed.tsx` showing pulses/statuses based on cron-healer logs ④ Phase 4: Auto-Decomposition Triggers via a Sparkles icon next to complex tasks in the task rows and inside `TaskEditSheet` ⑤ Passes all gates: typecheck 0, lint 0, tests green.) **PRIOR:** 2026-06-13 (post the **Autonomic Orchestrator wave — PR #117 merged**, this wave implements a comprehensive, 4-phase autonomic self-healing and optimization orchestrator: ① Phase 1: Self-healing background crons to automatically run up to 3 failed/never-run jobs and log P0/P1 alerts to the Coach Channel ② Phase 2: Database health engine executing bloat-based VACUUM on `CronJobLog` and pgvector index reindexing on `vector_embeddings` ③ Phase 3: Pipeline recovery rescuing claimed/running work items stale for >30m, alongside API quota circuit-breaker detections ④ Phase 4: Proactive log pruning (>30d) and task archiving (>14d), writing a clean audit log event ⑤ Wires route endpoint `/api/cron/cron-healer` and resolves client-side tone type mismatch. Gates at merge: tsc 0 · eslint 0 · check:crons clean.) **PRIOR:** 2026-06-13 (post the **Autonomous Cron Healer + Command Console Bridge + Chat Visual Kinetics waves — PR #115 merged**, this wave implements automated cron healing, interactive slash command control, and refined chat analytics: ① implement Autonomous Cron Healer route `/api/cron/cron-healer` to scan crons and trigger runManifestCron for failed/never-run jobs, capped to 3 per run, logging P0/P1 system-alerts to the Coach Channel ② expose `/triage-prune` (Raw SQL task archiver), `/db-vacuum` (VACUUM space reclamation), and `/run-cron <id>` in the command registry and hook, protected via custom `useConfirmDialog` modal client-side to bypass iOS PWA alert suppression ③ premium chat visual kinetics including latency color-coding and Reasoning Trace styling ④ full unit testing verification for the cron healer and command registry. Gates at merge: tsc 0 · eslint 0 · check:crons clean.) **PRIOR:** 2026-06-13 (post the **Stats blank-state fix + Stripe prices configuration + monorepo guidelines waves — PR #107 / PR #108 / PR #109 merged**, this wave secures and documents multiple workspace and deployment changes: ① resolve Tailwind CSS `.animate-in` namespace collision in `app/globals.css` and implement robust defensive states (`ErrorCard` and `EmptyState`) across `CharacterSheet`, `IdentityArcCard`, `BodySection`, and `CalibrationSection` on the `/stats` page, fully validated with custom mock scripts and Playwright screenshot test ② wire live Stripe Price IDs (`price_1Th8Gp36ZrIwRhqkVzY82ALt` and `price_1Th8Gq36ZrIwRhqk4FA8B2RW`) into `.env.example` in `apps/nickstire` and update `2026-05-30-nonstop-nick-design.md` with product details ③ upgrade root `AGENTS.md` to mandate the `ciitty` agent operating framework, outline branching/PR merge flow via `gh` CLI, document Windows PowerShell command chaining semicolon syntax, and detail worktree/branch cleanup. Gates at merge: tsc 0 · eslint 0 errors · vitest green · build green.) **PRIOR:** 2026-06-11 (post the **chat command surface cleanup + missions deep-linking + subtask-usage audit waves — PR #74 / PR #76 merged**, this wave resolves multiple backlog items: ① `/missions?taskId=` deep-linking fallback via `trpc.task.byId` when not preloaded client-side, verified in `ultron-task-schemas.test.ts` ② v2 prompt cutover porting `weekly-review` (capped to 800 chars) to `buildNickPrimeContext` / `renderRecentThinking` ③ `journal-brief` cache key aligned to operator's local Eastern Time (New York) to fix UTC rollover ④ UI cleanup: Reasoning Trace toggle renamed to "Reason" and styled subordinate, raw discipline/financial scores suppressed, smart replies cleaned, Edge feed ticker collapsed when urgent business context exists ⑤ subtask-usage audit cron route `/api/cron/subtask-usage-audit` implementing the ADR-0017 A1 gate (self-fires on/after 2026-06-22 to delete ADR-0017 + migration if unused), fully tested in `subtask-usage-audit.test.ts`, registered in `config/crons.ts` and wired to `EVENING_JOBS` in `src/inngest/jobs.ts`. Gates at merge: tsc 0 · 244 files/3341 tests · eslint 0 errors · check:crons clean · prompt size 54.0k chars with 10% headroom.) **PRIOR:** 2026-06-11 (post the **anticipated-wire wave — PR #61 squash-merged `bf7f82e5`**, the first statenour wave under the NEW branch+PR rule (2026-06-11: NO direct pushes to main — named branches `statenour/...` + PR, operator merges): ① the never-built `findAnticipated`/`precomputeAnswers` halves of Arc B F6 wired into chat as a brain-context block (cosine ≥0.85, reuses the prefetch embedding — zero hot-path embed calls; nightly NO-tools takes, TRUTH-RULE framing) ② FOUND+FIXED: the anticipate cron runs inside mega-EVENING (~10-11pm ET) keying the set to the ENDING day — every next-morning reader (brief tile, proactive pushes, the new chat match) silently got null since inception; yesterday-fallback in `loadTodaysSet` + the manifest's fictional standalone "7am UTC" schedule corrected to the folded convention ③ system prompt **62,112 → 54,272 chars** — `prompt:size-check` RED-on-every-push for weeks → PASS with 10% headroom (4-analyst trim audit: 3 content cards out of the always-on foundation · knowledgeDigest 2500→1000 [stale 2026-03-25 dossier copy] · tool-list dedup vs SDK schemas · uncapped Mastery line → top-15) + 9 truth fixes (4 dead advertised tools incl. `getRevenuePace`/`respondToLead` · false "113/150+ tools" counts · expired PIR-3908 · 12-vs-36mo warranty contradiction · 1,683→1,700 review canonicalization ×6) ④ adversarial-review closeout (3 P1): aiChat's provider-failure SENTINEL no longer storable as a precomputed answer (reject `provider emergency/none` — aiChat NEVER throws) · BROADEN_AND_SUGGEST fallback was INVERTED (directive returns empty ONLY on /strict-MINIMAL → retired from v1) · brief header "Tomorrow"→"Today" · SMS gate folded into the prompt cache key (4th slot `sms`) · detectors' lazy CJS require → static import (untestable under vitest; content-intent has zero imports). Gates at merge: tsc 0 · 243 files/3334 tests · build green · check:crons clean. Same evening also merged: sibling waves #58/#59 (Level-Up Directive `ff018d6d`) + nickstire #60/#62.) **PRIOR:** 2026-06-11 (post the **Execution Mode + Hidden High-Risk Warning upgrades** `1255c273`, `e9afbec8`, and `9816a0b6` —

- **Execution Mode (`1255c273`)**: Added focused task execution panel on `/missions` utilizing a memoized selector to prioritize tasks in "DOING" status, then queued tasks, then tasks from the Top Mission Today, real user projects, and general tasks. Includes callbacks for resume, pause, complete, snooze, block, edit, and exit.
- **Hidden High-Risk Warning & Filters (`e9afbec8` & `9816a0b6`)**: Implemented a warning banner when high-risk tasks are hidden by active search, loop-kind filters, domain filters, or focus mode.
  - Risk definition includes overdue tasks, stuck DOING (>2h), missed snooze resurfaces, promise checks (due today/soon/missing), stale tasks (>=7d/14d), invalid waiting, and high autoPriority. DONE, ARCHIVED, and CANCELLED statuses are explicitly excluded.
  - Exposes pure classification logic in `hidden-risk.ts` and renders a border alert box (rose/amber/zinc) with up to 3 preview items, "Queue after this" quick actions, and filter/session dismissal in `hidden-risk-warning.tsx`.
  - Upgraded test coverage with a renamed test suite `hidden-high-risk-warning.test.tsx` (12 tests) verifying component rendering, copy adaptation, and filter clearing.

Gates: tsc 0 · 3272 tests passed · build green · no database migrations, no production data mutation.)

**PRIOR:** 2026-06-10 (post the **"Nick remembers the week" ship** `98d783e1` — evolution-audit item #7: the Sunday weekly-review rows (cron wins/misses/patterns/focus in BrainMemory `weekly_review` + the ReviewWizard serve/surprise commitment) are now deterministically injected into the chat system prompt via a new CORE-tier engine `lib/brain/weekly-review-context.ts` `getWeeklyReviewContext()` — pure DB read · 14d window · 2-week continuity ("second week in a row…") · honest-empty (renders nothing when no review exists, never a stale week as current) · 800-char cap · tail rule forbids week-over-week claims beyond the rendered data. Previously these rows were reachable only via probabilistic vector recall. 8 new tests (`tests/brain/weekly-review-context.test.ts`) pin both writer shapes, malformed-metadata fallback, failure totality, clipping, query scope. Gates: tsc 0 · 236 files/3252 tests · eslint 0 errors on touched files · turbo build green. Disclosed: `prompt:size-check` was ALREADY failing on unmodified main (61,157 > 60k soft cap, non-blocking gate); this adds +802 capped chars → 61,959 (Venice hard ceiling 65k) — operator decision queued: trim a section or raise the soft cap. No migrations, no prod-data mutation.) **PRIOR:** 2026-06-10 (post the **chat-error closeout + evolution audit + Journey Engine wave** — 4 ships `91c198a1`/`d1c24209`/`9184c714`/`fb851113` (+ the sibling session's Next-Action `520063c6` between them), Railway SUCCESS on `fb851113`, bdnick.info 200, live-verified: the `.match` post-process crash fixed at its exact line + `/system/errors` redirect + honesty prompt rules; then the 7-agent product-evolution audit (founder report `docs/audits/STATENOUR-EVOLUTION-AUDIT.md`) + journal spec items A,B,D,E,F,G + the morning-brief durable-producer restoration + the scoreMemories manual-source guard. Gates: tsc 0 · 234 files/3228 tests · build green · no migrations, no prod-data mutation. Live-verified post-deploy: 4-line journal directive rendering on real data · "becoming" proof strip (58/wk) · 7-mode capture modal · 0 console errors). **PRIOR:** 2026-06-09 (post the **Wiring Wave** — connected the F1–F5 function services to live surfaces: receipts→chat finalize · /missions rescue strip + GENERAL anchors · /system/digest read-only cards · DAILY stat XP (advance-gated) · `/convert` knowledge→action. 7 ships `55ed38c4 → 14b6c225` on top of `43b63268`; tsc 0 · vitest 229 files/3195 tests · build green · no migrations, no prod-data mutation. One disclosed-not-changed finding: the reward toast's "+N XP" is `creditTaskStats`'s stat-COUNT not summed XP — see the top blockquote entry). **PRIOR:** 2026-06-06 (post the **Nick people-gate + WEEKLY recurrence + chat-honesty + PersonProfile source/phone/email wave** — 4 ships `c66bb09e`/`172bac8f`/`07089a9d`/`75e48458` (the 4th = the action-write verifier, REVISE #1) · migrations `0008`+`0009` APPLIED to prod (column-first, via the apply-pending-migration endpoint) · Batch-4 prod cleanup (deleted ghosts Fernando + "her"=Dania, re-homed note to Dania) · multi-agent behavioral review → disposition REVISE · full ship-by-ship in the top blockquote entry below + decision log in `~/.claude/projects/C--/memory/statenour-nick-behavioral-review.md`). **PRIOR:** 2026-06-04 (post the **code-review program (verified H1-H4/M1-M7 sweep)** — 9 ships, main RED→GREEN `c3067403`: H1 CI-typecheck-gap (added `check` script) · H2 prisma cross-OS cache-trap · M1 5 flags · M4 provider-docs + dead `activeProviderSupportsTools` · M5 6 `timeAgo` dups · 2 stale tests fixed (RED→GREEN) + 3 inert workflows deleted · ~9 dead `format.ts` exports + M6 refuted · H4 `task.ts` god-router split 1971→1278 (Power Atlas → `lib/trpc/routers/task/power-atlas.ts`, verbatim, FLAT paths) · M3 `ActionRule<T>` generic. tsc 0 · vitest 3007 (all pass) · build green. DEFERRED/leave: M2 (smart-home — unwired layer of a live feature, runner died Apr 14, op SKIPPED) · M7 (versions) · relative-time (needs 2-format decision) · router.test.ts flake. **Trust-audit advisory (nickstire price-decoy/warranty/testimonials + statenour-Nick numeric-marker gap) in MEMORY.** **PRIOR:** post the **Wave 2 surface-consolidation wave** — 5 tabbed/sectioned merges collapsed ~10 overlapping routes into 5 deep surfaces (/business=financial+funnel · /market=seo+radar · /brain=board+wisdom+reason · /stats=body+learn-loop [/life DELETED] · /content=drafts+history+social+outreach) behind a new `PageTabs` primitive (URL-synced `?tab=`, lazy-mount, query-string-preserving on switch). Every former page body moved VERBATIM into components; old routes 30x-redirect; internal links + the route-keyed registries (context-hints TOOL_BIAS / page-intelligence / page-visit) repointed to the consolidated set; + 2 UI fixes (home-composer dead mic/paperclip removed · /decisions dup sibling list dropped → ComparisonMatrix rows clickable via new `MatrixOption.href`). Verified per-merge in the consolidation worktree: tsc 0 · next build green (routes confirmed collapsed). origin/main `e36c5963`/`4e9e76f8`/`2a1e504d`/`70172fc6`/`b4602c27` + cleanup. **PRIOR:** post the **nick-intelligence + every-page-audit + chat-pipeline code-health wave** — chat-truth + 15 flag-gated intelligence features (default-OFF) + glm-5.1 model swap + an 8-bug proactive-staleness sweep + all 41 pages audited/unified, then a chat-pipeline code-health pass (5 SAFE simplifications); full ship list in the top entry below. **PRIOR:** 2026-06-02 the **hybrid-retrieval (Wave B) wave** — the deferred FTS recall win shipped: replaced `contextual-recall.ts`'s naive substring keyword lane (it only saw the top-300-by-confidence pool) with a true Postgres `ts_rank`/`websearch_to_tsquery` lexical lane over ALL memories + a candidate-pool union (naive `keywordScore` kept as a graceful fallback), backed by an additive expression GIN index `0007_brain_fts` APPLIED to prod Neon with **pgvector verified PRESENT before AND after** (separate table from `vector_embeddings`) · FTS smoke = 277 live matches · 1 ship `9edc1804` rebased onto the sibling's `edf1766d` after a 2nd ref-lock race · combined-tree turbo build green · bdnick.info 200/healthy · full entry below. **PRIOR:** post the **next-level intelligence wave** — 4 surgical brain upgrades [J consolidation soft-deletes merged sources to preserve evidence · I graph-aware recall via the dormant `MemoryEdge` graph · F XP-drift detection → coaching narration · G opt-in LLM-synthesized narrator] + nickstire $50→$49 price consistency · 6 ships `fae626ab → 68a8315f`, cherry-picked linearly onto the concurrent analyzer session's `54a45560` after a ref-lock race · combined-tree build green · live on bdnick.info (200 · healthy · DB-connected) · full entry below. origin/main ALSO carries that session's **7-analyzer suite + Mastra-V2 removal + Journal-Brain wiring** (`54a45560`, live-verified by them — their detail lives in MEMORY, not duplicated here). **PRIOR:** post the **task classification + scoring + confirm-chip wave** — rebuilt the create→classify→credit spine so every task correlates to mission+goal+stats and credits the character sheet on completion (NEW `classify-task-linkage` · one `enrichTaskLinkage` chokepoint on all create paths · `creditTaskStats` · `Task.statHints`/`pendingClassification`) · 8 ships `b9a60d4d → 2c4c376d` · migrations `0004`+`0006` applied to prod · gates fresh-verified (typecheck 0 · wave unit suites 35/35) · full entry below. **PRIOR:** post the **/people (Power Atlas) overhaul + QA wave** · /people now scores INFLUENCE XP for real reps — ledger deposits + power-plays credit `relationships`/`networking`/`persuasion`/etc. via the idempotent `creditStatXp` seam · classifier is suggest-then-approve (`pendingClassification` + role SSOT, no silent overwrite) · reads tasks via a real `Task.personId` FK · UI de-bulked · operator-tunable weights · shipped `d5c6f098` + QA `44a10079` · migration `0005` APPLIED to prod · XP backfill verified (13.9 XP, live-confirmed Dania +6.6) · QA fixed a CRITICAL iOS-PWA `window.confirm` dead-delete (→ two-tap, live-verified) + role-SSOT/soft-delete/WCAG. **PRIOR:** post the **Journal Brain redesign wave** · grounded journal enrichment — every capture now grounds against ACTIVE goals/missions, grounded-reclassifies into a real `entry_type` column, proposes a confirmable goal link, credits a grounded XP bonus + a bold idea/challenge "take", surfaced as an inline impact-receipt + link-chip with a 7-knob settings panel + Telegram ✓/✗ confirm + nightly resweep net · shipped to main `dc476e4e` · migration `20260601_journal_brain_foundation` APPLIED to prod Neon · backfill (~990 rows) operator-gated. **PRIOR:** post the **god-file split #3 + AI-tiering fix + cross-app optimization-audit wave** · split the chat-route god-file `app/api/ai/chat/route.ts` 1,884→1,442 ln — extracted 3 safely-separable modules (context-hints / finalize-system-prompt / build-model-messages), DELIBERATELY leaving the streaming + tool-loop orchestration core in place (it's a control-flow fn with shared state, NOT a flat collection — safety > line count) · `4aafd841` · typecheck 0 + chat tests 230/230. Fixed `detectTopicTier` (`7b86bf9d`): keyword-less ≥30-char messages were escalating to the all-29-engines `full` tier (silently defeating the ~60% context-saving) → now `core` (deep mode forces full upstream); tier-gating test corrected. Ran a measure-first **cross-app optimization audit** (perf/web-vitals · DB/queries · React-render · AI-cost, both apps, 4 parallel read-only agents): statenour's data/memo layers already mature; TOP ROI is nickstire's (framer-motion eager in the customer hydration path = the measured TBT-1090ms PSI culprit · phone `LIKE '%suffix'` 17-site full-scans → a `phone10` column · zero prompt-caching) → handed off to that session. Deferred statenour code fixes (fresh pass): GoalBoard card memo · chat-path injector parallelization. The #1 AI-cost win is a provider-routing **config** decision (Anthropic `cacheControl` is wired but dormant — Ollama is primary). **All 3 big god-files (tasks/system/chat) now split.** Gates green (typecheck 0 · vitest green · pre-push build OK) · 2 commits on origin/main. **PRIOR:** post the **god-file split #2 + Chrome-walk fixes wave** · split the worst statenour god-file `lib/trpc/routers/system.ts` (2,722→61 ln, 105 tRPC procedures) into 9 per-domain procedure-object files under `system/`, recomposed via object-spread keeping the FLAT `trpc.system.<proc>` namespace intact (`560525e2` · isolated worktree + briefed subagent · independently verified: 105/105 procedure parity · zero nesting · typecheck 0 = the interface gate · vitest **2919**); plus the two Chrome-walk fixes (`f6f1143b`): honest /financial revenue states (was a permanent fake "Loading…" when the nickstire bridge is down — the empty bridge is a config/ops root cause, flagged not code-fixable) + `os-snapshot.ts` scanners now exclude `.next-prod`/`standalone`. Gates green (typecheck 0 · vitest **2919** · pre-push build OK) · 2 commits on origin/main. **PRIOR:** post the **tech-debt cleanup wave (statenour)** · fact-checked the monorepo tech-debt report against the files, then executed only the statenour-owned wins (its money-path items are nickstire's — handed off): deleted the stale `soft-deleted-tasks-2026-05-16.md` (`34ad6fcd`) + split the 2,024-ln `lib/ai/tools/tasks.ts` god-file into 6 per-domain files + a 29-tool `tasksCoreTools`, recomposed verbatim into the SAME 46-key `tasksTools` export (`2728caa7` · built in an isolated worktree via a briefed subagent, independently verified — 46/46 keys + scope + gates). Report corrections: serializeRow is overstated (heterogeneous `.toISOString()`, API-path risk → skipped); provider-bypass is **31** files not 23. Gates green (typecheck 0 · vitest **2919**) · 2 commits on origin/main. **PRIOR:** post the **Ambition Engine P3 (increment 2) wave** · wired the rest of the dormant P3 columns into the /stats GoalBoard — `updateGoalSchema` now accepts `kind` (metric/milestone/narrative) + `conviction` (1-5) + `ambition` + `killCriteria`/`killBy` + `identityLine` (all migrated in P1, settable nowhere until now); the card gained authoring inputs + display chips (conviction flame · ambition tag · pre-committed kill-by · the Elon **idiot-index** hrs-per-%-moved · narrative identity line) + kind-awareness (kind badge · milestone "loops"→"milestones") · trajectory was already the pace-projection chip · `de898be3` · gates green (typecheck 0 · lint 0 new errors · vitest **2919**) · 1 commit on origin/main. **P3 functionally complete** (ladder + kinds + anti-stale authoring + trajectory); deeper per-kind layouts (a milestone checklist UI) remain a future refinement. **PRIOR:** post the **Ambition Engine P3 (increment 1) wave** · the dormant `parentGoalId`/`GoalLadder` self-relation (migrated in P1, wired nowhere) is now an end-to-end **compounding ladder**: pure `lib/mastery/goal-ladder.ts` (`validateParentLink` rejects self/cycle/inverted-horizon · `rollUpChildren` · cycle-guarded `ancestorChain` · 14 unit tests) + `updateGoal` validates the link before writing + `getGoals` attaches a `ladder` {parent, children, rollup} payload (defensive on partial selects) + GoalBoard parent-breadcrumb & children-rollup chips (tap-to-scroll) + sub-goals list + edit-mode parent selector (server-validated, rejection toasted) · `37106b6b` · gates green (typecheck 0 · check:crons clean · vitest **2919** = 2905 + 14) · 1 commit on origin/main. **PRIOR:** post the **Ambition Engine P2 wave** · the proactive **goal-drift detector** shipped — a daily Inngest cron (`goal-drift-detector` · `30 12 * * *`) scans active life-goals + their GoalEvent windows and fires priority-graded Coach Events (kind `goal-pace-shift`) on two signals: **deadline-risk** (P1 · deadline ≤14d · <80% progress · no movement this week) + **momentum-decay** (P2 · was active — ≥2 events in the prior 4wk window — then quiet this week · not yet 30d-stale) · acks on re-engagement (idempotent per goalId) · the drift math is the pure `classifyDrift` (`lib/mastery/goal-drift-classify.ts` · 9 unit tests) so it's verifiable in isolation · cron mirrors `goal-pruner` · cherry-picked from its worktree branch → `87a4a0cb` · gates green (typecheck 0 · check:crons clean · vitest **2905** = 2896 + 9) · 1 commit on origin/main. **PRIOR:** post the **Chrome polish wave** · verified the dania scrub LIVE (silent=0 · the only "dania" left is the operator's own goal description) then polished the live UI — rebuilt the bottom "System pulse" ticker to the Edge Feed form (killed the last 60s marquee + touch-dead hover-pause · `edfae490`+`5b31a92a`) + stale-goal CTA affordance & add-goal a11y label (`edfdf1b4`) · gates green (typecheck 0 · eslint 0-err · vitest **2896**) · 3 commits on origin/main. **PRIOR:** post the **relationship-nag scrub wave** · a clarity-gate audit of blunt/stale/sensitive auto-surfaced signals → removed the "Dania N-days-silent" nag from all **6 LIVE surfaces** (ticker `42d748fc` + narrator/chat-lane-check/blind-spot-detector→system-prompt/personal-pulse/pulse-route `0b044154`) + cleared the dead/dormant remainder `9b690019` (dead `daily_score` reads · dormant `dania_neglect`/`body_projection` Telegram rules · `strategic-triggers` marked dormant) — kept all legit person/identity plumbing · gates green (typecheck 0 · eslint 0-err · vitest **2896**) · 3 commits on origin/main. **PRIOR:** post the **deferred-items completion wave** · *"go on all deferred"* — score→reflection re-source (`b952fc37`) + Edge Feed ticker page-context emphasis & 24h snooze (`afc738f2`) shipped; **habit + chat write-time XP resolved as already-covered by clarity-gate** (habits are DAILY Tasks → auto-learn already credits them; chat is swept by the backfill — write-time would add a 2nd per-turn AI call on the chat hot path); ticker **AI-curation v2 + lane-health held** as premature (deterministic rank shipped today + unproven-weak; Guardian hard-rejected the naive version) · gates green (typecheck 0 · eslint 0-err · vitest **2896** · check:crons clean) · 2 commits on origin/main. **PRIOR:** post the **auto-mode evolution wave** · 3 force-ranked upgrades from the Sam-Altman pass, each clarity-gated + shipped — ① revived the dead `industry-pull` feeder as an inngest cron (`recallIndustryIntel` had fed the AI a stale table since the Wave-AE prune) · ② completed the XP ledger (NEW `creditFromSignal` door + write-time crediting for reflections — the daily-score replacement that fed ZERO XP — and decisions) · ③ rebuilt the global ticker (Edge Feed): killed the 55s marquee → one readable/tappable item + feed sheet + a Mastery lane · 4 commits `a5572ac5 → fcdb1b3a` on origin/main · gates green (typecheck 0 · eslint 0-err · vitest **2896** · check:crons clean · check:raw-sql 0 · build OK) · ticker design multi-agent-brainstorming-vetted. **PRIOR:** post the **Ambition Engine P1 (code)** wave · the goal→stat spine is live end-to-end — a goal-tagged task rep credits the goal's mastery stats (idempotent xpEvent log · no double-count), GoalBoard cards show stat chips in character-sheet colors, and the character sheet cites the goals feeding each stat · stats inferred from `goal.domain` so all existing goals light up with no backfill (declared `GoalStat` rows override · authoring is P3) · TDD-first (13 pure unit tests) · 2 commits `805e6173`+`ef691189` on origin/main; the prior wave's 2 local commits rebased to `dcc4e206`+`aec010e5` + pushed too — nothing local-unpushed · gates green (typecheck 0 · eslint 0-err · vitest +13 · check:raw-sql 0 · check:crons clean · prisma valid · pre-push build OK). **PRIOR:** post the **Bridge-contract sweep + Ambition Engine P1** wave · closed the dead-bridge-query class — `jobs_today`×2 · `pending_callbacks_count` · `customer_search` remapped to live nickstire handlers + a `nick-bridge-query-contract` CI guard so it can't recur · budget gate fail-open→fail-safe · system-prompt stale-revenue fallback via `readNickRevenue` · 6 silent-failure breadcrumbs · 5 Inngest-native crons registered · `/tasks`→`/missions` + `/mastery`→`/stats` nav migration (16 files + ⌘K + orb) · mastery **coaching lens** on the /stats side-pane · **Ambition Engine P1** schema (8 `life_goals` cols + `goal_stats` join + self-relation) + migration `0003` **applied to prod via a new guarded `/api/system/apply-pending-migration` endpoint** · 12 commits `a8100a36 → e285e9dc` on origin/main + a local post-review hardening pass · gates green (typecheck 0 · 2877 vitest · check:crons clean · prisma valid) · code-reviewer found 0 P0/P1. **PRIOR:** post the **Stats-consolidation + tech-debt** wave · /scoreboard+/goals → ONE personal `/stats` (business stripped to nickstire admin per operator) · 13 stale `/goals` links retargeted · 4 pre-existing test failures fixed (suite **2875/2875**) · tech-debt wave: Inngest double-fire guard + revived dead stale-leads alert (→ `leads_urgent`) + dead `/mastery` nav removed · 6 commits `a695c174 → 25e31b0a` on origin/main · gates green. **PRIOR:** post Wave Z · recall-freshness fix + dead-lane sweep + retro→journal · 4 commits `d535550c → b48c6e8a` · write-time `embedding_vec_1536` dual-write closes an up-to-7-day chat-recall staleness gap · prod backfill padded 1,599 rows · +5 `CONTEXT_CATEGORIES` recall lanes · `mission_retro` now a 5th `/journal` source · ADR-0023 · 6 "Sam plan" items verified already-built + `decision→goals` migration rejected · gates green. **PRIOR:** post Wave Y · Mastery Layer Stage A completion + NickSidePane v2 multi-turn surface chat · 10 commits in two sub-waves · `c3cdf504 → 47c0598c` (today's continuation: `f03ab83b → 47c0598c`) · Coach Channel grew from 5 → **9 writers** (added eval-regression P0 · correlation-alarm P1 · creation-spike-detect P1 · decision-quality-drift P0) and from 1 → **5 surface mounts** of NickSidePane (was /tasks only · now /tasks /goals /journal /brain /scoreboard — each with its own coachSurface + localStorage thread + per-page presets) · Phase 5 FULL shipped multi-turn surface chat (`/api/ai/side-pane-chat` stateless streaming · client owns thread · ephemeral Anthropic cacheControl on enriched system prompt) · `lib/ai/page-data.ts` gained 4 new surface cases so multi-turn replies on the new surfaces are grounded (was `default: return ""` blind) · reflect-categories cron registered weekly Sun 03:00 UTC · all gates green (typecheck 0 · vitest 185/2812 · turbo pre-push build passed on every push). ADR-0022 documents the Coach Channel pattern + NickSidePane v2 architecture. Tasks #74 #81 #82 closed. On top of Wave X.h · ChatComposer chrome extraction · 1 commit · `/chat` `page.tsx` 2866 → 2756 LOC (−111 net). On top of Wave X.g · bridge-page polling refactor + BridgeShell extraction · 2 commits · −98 LOC net. On top of Wave X.f · activation wave. On top of Wave X.e · −926 LOC consolidation. **Repo:** monorepo `nourdean22/MAINnicks-tire-autoNEW` · branch `main` · statenour at `apps/statenour/` · **Deploy:** Railway (`statenour-web-production`) · **Versioning:** post-`v10.0.X` — commits are `feat · statenour · …` · **Tests:** 2812 across 185 vitest files · **Prod schema:** 31 migrations applied.

> ## 2026-06-15 · Audit Improvements, Portability & Concurrency Races wave · 13 files
>
> This wave implements the 6 code audit recommendations:
> - **Security Redaction Hardening**: Implemented depth truncation safety boundary (`depth > 3`) in `sanitize-error.ts` and `logger.ts` to prevent credential/sensitive data leaks in deep subtrees, with full unit test verification.
> - **Path Portability**: Replaced absolute local paths with relative links in documentation files, and migrated `ciitty` operating framework rules into the repository at `.agents/frameworks/ciitty/SKILL.md`.
> - **Worktree Branch-Existence Lock**: Modified `worktree-setup.ps1` to detect branch existence locally and remotely via `git rev-parse` before checking out, dynamically creating new branches if missing.
> - **Document Metadata Sync Check**: Patched `check-stale-docs.ts` to validate date stamp synchronization between `AGENTS.md` and `RECONCILIATION.md`.
> - **Double-Submit Guards**: Guarded quick-add and inline task addition in `page.tsx` with client-side submitting lock state.
> - **Server-Side Concurrency Serialization**: Implemented an in-memory Promise-cache map `pendingInboxCreations` in `task.ts` to serialize per-domain Inbox mission creations.
> - **Testing & Verification**: Verified that typecheck, eslint lints, 3,515 vitest unit tests, raw-sql audits, crons checks, prompt-size limits, and prisma validation all pass.
>

> ## 2026-06-15 · Journal Insights Preview Router Tests wave · 1 file · PR #138 merged
>
> This wave adds comprehensive unit and contract test coverage for the insightsPreview tRPC procedure inside the journal router:
> - **Comprehensive Unit & Contract Tests**: Added complete coverage for the `insightsPreview` procedure in `lib/trpc/routers/journal.ts`, verifying empty states, JSON parsing, error recovery/fallback, mappings for all four parent types (`brainDump`, `reflection`, `situationLog`, `decisionReplay`), and title length clipping.
> - **Testing & Verification**: Verified that typecheck, all 3,515 unit tests, and production `next build` pass cleanly.
>

> ## 2026-06-14 · Task Routing Matrix & Provider Fallback Hardening wave · 3 files · PR #133 & PR #131 merged
>
> This wave defaults the primary Gemini model to `gemini-3.5-flash`, implements the task-specific routing matrix, and fixes VAPI diagnostic test assertions:
> - **Primary Gemini Model Default**: Default model set to `gemini-3.5-flash` in the provider config.
> - **Task Routing Matrix**: Implemented `getPreferredOrderForTask(taskType)` mapping all 12 task types to optimized provider sequences in [provider.ts](file:///apps/statenour/lib/ai/provider.ts) to ensure consistent telemetry and fallback chain sorting.
> - **Comprehensive Provider Registry Tests**: Created [provider.test.ts](file:///apps/statenour/tests/ai/provider.test.ts) verifying availability, quota circuit breakers, context reordering, and budget fallback reordering with 6 test suites covering 12 routing pathway variations.
> - **VAPI Test Adjustments**: Adjusted VAPI smoke test assertions to perform case-insensitive comparison on the problem field in `vapi-test-new-tools.ts`.
> - **Testing & Verification**: Verified that typecheck, all 3,510 unit tests, and production `next build` pass cleanly.
>

> ## 2026-06-14 · VAPI Warm Transfer & Admin Dashboard cleanup waves · 17 files · PR #132 & PR #128 merged
>
> This wave implements SIP DIAL bridging for warm transfers and cleans ALG invoice/revenue metrics from the admin dashboard:
> - **VAPI Warm Transfer Bridging**: Switched from SIP REFER to SIP DIAL bridging in `server/routers/vapi.ts` and `server/services/vapi.ts` to resolve silent failures during transfers.
> - **Overview & Revenue Dashboard Cleanup**: Removed Average Ticket, invoice counts, weekly summaries, and unpaid invoices from overview/settings/today cards to match the register/collection system. Disabled the Revenue tab, defaulting to Shop Pulse.
> - **Tire Order Deletion & Status Toggle**: Added delete and payment status toggle mutations in `gatewayTire` router and wired UI actions with delete confirmDialog guards.
> - **Customer Tire Page Upgrade**: Upgraded customer tire landing page conversion and decision layouts to improve readability and visibility under counter conditions.
> - **Testing & Verification**: Verified typechecks and frontend console cleanliness.
>

> ## 2026-06-14 · Google Gemini Fallback Integration wave · 4 files · PR #129 merged
>
> This wave integrates Google Gemini into the core fallback chain:
> - **Gemini Fallback Integration**: Added `@ai-sdk/google` dependency and wired up `gemini-2.5-flash` in the provider configuration.
> - **Telemetry & Monitoring**: Updated the provider health dashboard in `lib/ai/provider-health.ts` to monitor Gemini availability, error rates, quota limits, and real-time latency.
> - **Testing & Verification**: Verified that all 3,493 tests pass and the full pnpm verify:hard gate remains green.
>

> ## 2026-06-14 · Dopamine Loops & Brain Hub Tab Consolidation wave · 12 files · PR #130 merged
>
> This wave implements the strategic blueprint Section 6 dopamine visual loops on `/missions` and integrates `BrainHealthView` / `BrainContinuityView` under `/brain`:
> - **Level-Up Engine**: Added `levelUp` detection to `creditTaskStats` comparing pre- and post-XP boundaries.
> - **Visual Kinetics**: Built glassmorphic `LevelUpModal` overlay, floating `+N XP` `XpParticle` upward animation, and inline fire `StreakBadge` for streaks.
> - **Brain Tabs Consolidation**: Mounted `BrainHealthView` and `BrainContinuityView` as PageTabs under `/brain`, resolving orphaned views.
> - **Routing & Deep Links**: Updated redirects in `next.config.ts` so `/brain/health` redirects to `/brain?tab=health`. Updated deep links in `since-last-visit-card.tsx`, `memory-tab.tsx`, `tool-result-registry.tsx`, and `feature-status.ts`.
> - **Testing & Verification**: Verified that typecheck, all 3,497 unit tests, and production `next build` pass cleanly.
>

> ## 2026-06-13 · Missions UI Polish & Task Decomposition wave · 11 files · PR #120 merged
>
> This wave implements four UI/UX enhancements and the task decomposition pipeline on the Statenour /missions page:
> - **Dynamic Search Placeholder**: Adapts the filter search placeholder dynamically based on active filter kind and domain.
> - **"Ask Nick" Empty-State CTA**: Added an actionable button in `EmptyMissions` that dispatches a custom event opening the Nick side panel with a goal-assessment query.
> - **Autonomic Healer Health Chip**: Rendered a live, pulsing, glassmorphic health status chip in the KPI header representing database and cron recovery status.
> - **Auto-Decomposition Trigger**: Wired an inline sparkles icon and task edit sheet button to trigger TRPC task decomposition via the AI tasks service.
> - **Testing & Verification**: Verified that all components compile, lint, and build cleanly, and successfully passed the full `verify:hard` gate. Checked visual states in Chrome.
>

> ## 2026-06-13 · Autonomic Orchestrator wave · 5 files · PR #117 merged
>
> This wave implements the comprehensive 4-phase Autonomic Orchestrator for background cron healing, database maintenance, runner pipeline recovery, and triage pruning:
> - **Phase 1: Cron Self-Healing**: Scans and heals up to 3 failed/never-run cron jobs, posting P0/P1 coach events.
> - **Phase 2: DB Health Engine**: Executes bloat-based `VACUUM` on `CronJobLog` and reindexes `vector_embeddings` using standard connection pooling.
> - **Phase 3: Pipeline Recovery**: Automatically resets stale (claimed/running >30m) work items and tracks upstream API quota depletion circuit-breakers.
> - **Phase 4: Resource Triage**: Deletes cron job logs older than 30 days and archives tasks untouched for >14 days. Writes `cron:data_cleanup_completed` AuditEvent.
> - **Wiring & Types**: Integrated the orchestrator into GET `/api/cron/cron-healer` and fixed the client-side `tone` parameter type warning in `app/(mastery)/chat/page.tsx`.
> - **Testing & Verification**: Built a comprehensive test suite `tests/cron/autonomic-orchestrator.test.ts`. Passed `verify:hard` (tsc 0, lint 0, 3,491 tests green).
>
> ## 2026-06-10 · chat-error closeout + evolution audit + Journey Engine wave · 4 ships
>
> One session, two waves, all deployed + live-verified on bdnick.info (Railway SUCCESS on `fb851113`). The sibling session's Next-Action extraction (`520063c6`, item C) landed between them and this wave built directly on it.
> - **`91c198a1` · chat:post-process `.match` crash CLOSED** — localized to the content-feedback step's `as unknown as string` cast on a parts-only prior assistant message (`content: undefined` → `priorText.match()` threw, silent under withErrorCapture, recurred for weeks). New total helper `lib/ai/chat/message-text.ts` (`messageContentToText`, 6-case test incl. the exact undefined regression). Also: FORBIDDEN-PHRASES narrowed so SPECIFIC tool-unavailability is honest+encouraged + TOOL UNAVAILABILITY / TOOL CONFIRMS ACTION rules in HONESTY+RESPECT · dead `/system/errors` → redirect to `/system/logs` (+hub hint+RUNBOOK refs). Closeout doc: `docs/audits/CHAT-ERROR-CLOSEOUT.md`.
> - **`d1c24209` · closeout doc verification stamp** (deployed SHA + live-verify results).
> - **`9184c714` · Journey Engine wave (journal spec items A,B,D,E,F,G)** — 7-mode capture (Dump/Daily Debrief/Battle Log/Decision Replay/Pattern Breaker/Win Proof/Future Self; `entryTypeHint` rides captureThought→ingestJournal, operator mode outranks blind classification) · ImpactReceipt honest empty states (Analyzing…/Legacy/no-link) · brief→4-line operator directive (COMPOUNDING/STALLED/WATCH/MOVE; signals now include drift+goals+missions+entry summaries; cache key `:v2`) · thread arc trend (pure `journal-thread-trend.ts`, strict ≥2/wk AND accelerating bar, 6 tests; "strengthening · N/wk" chip + arc line) · `journal.proofStack` + "becoming" strip on /journal · `journal.latestNextAction` + "NEXT MOVE · from your journal" strip on home. Arc-radar AI cost/opportunity lines deliberately deferred (need a cached cron seam — no fabrication).
> - **`fb851113` · morning-brief durable producer + memory guard + founder report** — Wave AE deleted `/api/cron/morning-brief` = the ONLY writer of BrainMemory(morning_brief) → prod read `ready:false` daily while Inngest push/audio worked off an in-memory fallback; `composeBrief()` now upserts the row (reader-aligned NY-date keys). `scoreMemories()` excludes `source:"manual"` (operator curation must not erode). `docs/audits/STATENOUR-EVOLUTION-AUDIT.md` = 7-agent product audit: ranked backlog + 5-year top-10 + the env-flag HOLD table.
> - **Live-verified post-deploy:** /journal renders the 4-line directive on real data + the becoming strip (58 proofs/wk, +53 vs last, by-domain) + mode buttons in the capture modal; home NEXT MOVE strip correctly self-hides (no takes carry nextAction until entries are enriched post-`520063c6`); 0 console errors; morning-brief row write verifiable after the next 10:00 UTC run.
> - **Flagged · NOT fixed (operator-gated):** `NICK_AUTONOMY=off` (51 approvals rotting · proactive spine dead) · proactive Telegram push module has ZERO callers (phone always silent) · 201→211 tasks in inbox, no triage ritual · `NICK_IMPORTANCE_RECALL`/`NICK_CONTRADICTION_CLEANUP` default-off · XP decay unwired · `resolvePrediction` zero callers (Brier loop open) · task outcome capture needs an additive migration · nickstire bridge business-correlation shims return `[]`. All ranked with recommendations in the evolution-audit doc.
>
> ## 2026-06-09 · Wiring Wave — F1–F5 services connected to live surfaces · SHIPPED
>
> The F1–F5 function wave (entry below) shipped to main as `43b63268` (Railway-deployed · bdnick.info 200), which left the new services mostly API-only. The Organization+Wiring Audit (`docs/project/ORGANIZATION-WIRING-AUDIT.md`) found them correct but unreachable, and the motivation loops wired-but-invisible. This wave connected them to real surfaces, ONE wire at a time, each committed + verified separately (typecheck 0 · targeted + full suite · `check:stale-docs` 0 · `check:runbooks` clean · build green). No new tables, no migrations, no prod-data mutation, no hidden autonomy.
> - **`07381ff7` (in 43b63268) · Wire #1 chat interceptor** — F5 commands reachable in chat via a 1-branch `resolveCommand`-gated interceptor (exact-match → no hijack) + 6 slash-menu entries.
> - **`46fb2739`/`43b63268` · Wire #2 reward toast** — honest task-completion reward on /missions; BOTH updateTask (DONE) and checkTask return an optional `reward` only when credit occurs; `formatReward` pure + tested, never fabricates XP.
> - **`55ed38c4` · Wire 1 receipts → chat finalize** — `persist-assistant-turn` writes an `action_receipt` AuditEvent per side-effecting executed action (existing ActionReceipt contract); `action-receipt-feed` merges that 3rd source + dedupes by receiptId. Failed actions visible; advisory-only (never blocks chat). +tests (success/failure/no-false-done).
> - **`68c1c98b` · Wire 2 /missions rescue strip + GENERAL anchors** — read-only `task.missionsHygiene` = buildTaskRescue + buildDomainAnchors (busiest-first · domain fallback); a self-hiding `missions-rescue-strip` shows findings + per-domain open-counts. Suggestion-only, never auto-moves; GENERAL anchors PROTECTED. +mapper tests.
> - **`8cf50229` · Wire 3 /system/digest cards** — `system.{changeDigest,memoryEvals,receiptFeed}` (DRY-extracted `buildMemoryEvalReport`) + a read-only `/system/digest` page (what-changed · truth evals · recent receipts) + a HubCard; memory-evals route simplified to the shared builder. +tests.
> - **`ab360f55` + `46d8803c` · Wire 4 DAILY stat XP** — DAILY check-offs (updateTask→WAITING) skipped the DONE-credit block → 0 XP. `isDailyCheckoff` gates a per-day idempotent `creditTaskStats`; the reward rides back + toasts. Hardened (`46d8803c`) to fire ONLY on a strict `lastCompletedAt` advance — unchanged/older/edit-only credit nothing (unit-proven). No double-credit (perDay sourceKey). ONCE/WEEKLY/PROMISE unchanged.
> - **`882b65c5` + `14b6c225` · Wire 5a knowledge→action `/convert`** — `convertToAction` (pure · was zero-caller) now has one suggestion-only surface: a `/convert <thought>` command (+`/action` alias, + slash-menu entry) proposing a next move + flagging sensitive intents requiresApproval. NEVER writes. Wire 5b (people→stats) audited as ALREADY wired via `lib/mastery/people-credit.ts` (ledger deposits + power-plays credit relationships/networking/persuasion) — not rebuilt.
> - **Verify (final):** typecheck 0 · vitest **229 files / 3195 tests** all pass · `check:stale-docs` 0 critical · `check:runbooks` clean · `pnpm build` green. 7 ships `55ed38c4 → 14b6c225` on top of `43b63268`.
> - **Disclosed finding (NOT changed — operator-gated):** the reward toast renders `formatReward`'s `xp` as "+N XP", but `creditTaskStats` returns the COUNT of stats credited, not the summed XP (its documented + tested contract). For single-stat DAILY (Wire 4) count≈XP; the gap shows on multi-stat goal tasks (the pre-existing DONE/checkTask paths, live since `43b63268`). Recommended fix: return the summed XP from `creditTaskStats` (truthiness preserved → no caller breaks; only `credit-task-stats.test.ts`'s 3 count assertions change). Left untouched to respect "don't change XP math / no unrelated cleanup".
>
> ## 2026-06-09 · useful function wave (F1-F5) · SHIPPED to main `43b63268` · 6 ships
>
> Re-scoped the remaining intelligence roadmap (operator: replace the abstract upgrades with practical functions). Built on branch `statenour-truth-intelligence-wave` (continuing past the pushed `c4716a90`), **NOT pushed to main** — awaiting an owner deploy decision. Services + tests first; reuse existing models (NO new tables, NO migrations); every mutation explicit/receipt-backed; no chat-route bloat. Understand phase ran as a 6-agent read-only workflow; an adversarial 4-lens review workflow ran over the diff. Each function gated tsc 0 + targeted vitest.
> - **`dc5696c1`** — re-scoped `docs/project/NEXT-INTELLIGENCE-WAVE.md` to the Top-5 function wave (deprioritized generative confirm cards, jobs dashboard, broad knowledge→action, governed-memory migration).
> - **`a38f2d98`** — **F1 Claude session importer**: `lib/services/session-import.ts` (pure section-aware `parseSessionLog` → title/repo/branch/commits/phases/files/checks/blockers/migrations/prod-actions/warnings/next-steps + needsOwnerApproval + prodMigrationOrDeployPending flags; `importSession` persists to the EXISTING SessionReport table, suggestion-only — never auto-creates tasks) + owner POST route + 12 tests.
> - **`ff2d4cb6`** — **F2 system change digest**: `lib/services/system-change-digest.ts` reuses parseLatestReconciliation + runMemoryEvals + scanContent + RUNBOOKS + an HONEST Railway-aware deploy identity (never asserts an unverifiable deploy) + owner GET route + 12 tests.
> - **`b4c5505e`** — **F3 task rescue scanner**: `lib/services/task-rescue.ts` pure `classifyRescue` (pending/legacy-inbox/stale/no-next-action/general-maybe-specific; GENERAL anchors PROTECTED) reusing isInboxMission/isGeneralAnchor; read-only owner GET + 12 tests.
> - **`63edff7b`** — **F4 action receipt feed**: `lib/services/action-receipt-feed.ts` maps EntityAudit (via getGlobalActivity) + AutonomousAction (FAILED actions visible) onto the EXISTING ActionReceipt contract (integrate, not duplicate) + owner GET + 9 tests.
> - **`faca5995`** — **F5 personal command shortcuts**: `lib/ai/chat/command-registry.ts` pure parse/resolve + 6 commands (/today /rescue /what-changed /import-session /receipts /stale) calling the F1-F4 services, runnable via owner POST `/api/system/command`; NOT wired into the live chat streaming seam (concurrent session in that path) — thin interceptor hook is a documented follow-up. 15 tests.
> - **Verify:** typecheck 0 · `check:stale-docs` 0 critical · `check:runbooks` clean · `check:crons` clean · `eval:memory` 22/0 · vitest **225 files / 3155 tests all pass** · `pnpm build` green. No migrations, no prod data touched, nothing pushed.
> - **Deferred:** wire F5 into the chat interceptor (one tested hook) · F1 confirm-create via createTask · `/today` "3 tasks + current mission" enrichment (today-compound is counts-only) · 2 advisory provider warns in the SHARED root README.
>
> ## 2026-06-09 · truth + intelligence wave · stale-context quarantine + guard + memory evals + runbooks + action receipts + knowledge→action · 6 ships
>
> A two-objective system-quality wave run in the `statenour-truth-intelligence-wave` worktree (off `main` `acad664b`, isolated from the concurrent session). **Objective A — truth cleanup:** future agents were at risk of being steered to retired deploy paths (Vercel · `codex/ollama-local` · `statenour-master` · the standalone `statenour-os` repo · the `C:\Users\nourd\NOUR-OS` path) by docs/config that still read as current. **Objective B — intelligence:** added reliability/trust infrastructure (truth scoreboard · operating runbooks · action-honesty receipts · knowledge→action). Every ship gated tsc 0 + targeted vitest; full matrix at the end green. **No production data mutated · no migrations · not yet pushed/deployed (owner decision).** Phase-1 audit: `docs/audits/truth-cleanup-2026-06-09-stale-report.md`; plan: `docs/project/NEXT-INTELLIGENCE-WAVE.md`.
> - **`01c5438c`** — truth cleanup + guard. NEW `docs/CURRENT-TRUTH.md` (one-screen truth: location · `main`→Railway→bdnick.info · what's retired · SoT hierarchy · "provider/model truth lives in `lib/ai/provider.ts`, not prose"). Quarantined `docs/project/{MASTER-CONTEXT,UPGRADE-PLAN}.md` → `docs/archive/historical-v{7,8}/*-HISTORICAL-DO-NOT-EXECUTE.md` (git mv + pointer stubs left behind so links resolve). Fixed in place: `config/repos.ts` statenour-os entry relabeled RETIRED standalone (was active/core/bdnick.info + a stale statenour-master CI-mirror note; /system/repos test mocks the module → no live-value dependency) + monorepo entry now names both apps; `AGENTS.md` dead resume path + CURRENT-TRUTH pointers; `AGENT-CONTRACT.md` "current state" pointer; BUSINESS-LANDSCAPE + ARCHITECTURE + chat-route-walkthrough provider hardcodes → point to code; CHANGELOG intro + V10-PLAN snapshot + gmail-setup env step; HISTORICAL banner on CONSOLIDATION-PLAN; RETIRED header on the dead `scripts/pre-push-check.sh`. NEW `scripts/check-stale-docs.ts` + `pnpm check:stale-docs` (critical retired-deploy terms hard-fail under `STALE_DOCS_STRICT=1`; provider hardcodes warn; whole-file exemption for archive/adr/dated/bannered + per-line ±2 for wrapped prose) + `tests/lib/check-stale-docs.test.ts` (14). Result: 0 critical (2 advisory warns in the SHARED monorepo-root README, left untouched).
> - **`335c3d80`** — `docs/project/NEXT-INTELLIGENCE-WAVE.md`, the ranked engineering plan.
> - **`4ef690dc`** — **memory evals / truth scoreboard** (P5). `lib/evals/{memory-eval-types,memory-evals,memory-eval-runner}.ts` (23 evals · 10 categories) + `scripts/run-memory-evals.ts` (`pnpm eval:memory`) + owner GET `app/api/system/memory-evals/route.ts` (read-only, degrades gracefully) + `tests/lib/evals/memory-evals.test.ts` (15, incl a real CURRENT-TRUTH.md drift guard). `gradeDoc` checks a truth doc TEACHES facts (forbidden NOT applied to docs); `gradeAnswer` is negator-aware for free-form answers; runner is pure (no DB/API). Scoreboard: 23 total · 22 pass · 0 fail · 1 manual.
> - **`04c54f32`** — **agent runbooks foundation** (P6). `lib/runbooks/{types,catalog}.ts` (8 active runbooks) + `docs/runbooks/*.md` (+ index) + `scripts/check-runbooks.ts` (`pnpm check:runbooks`, reuses the stale-doc scanner) + `tests/lib/runbooks.test.ts` (6). Lit up the 4 runbook-grounded memory evals.
> - **`5988d3f0`** — **action receipts guard** (P7, additive). `lib/ai/receipts/action-receipt.ts` — normalized `ActionReceipt` + `toReceipt()` + `canClaimDone()`; side-effecting-ness reuses the tool catalog (`getToolMeta`, broadened to `*_write`) + `MUTATION_ACTIONS`. A side-effecting result without a confirmed `ok` is "partial" (never asserts done without proof). `tests/ai/receipts/action-receipt.test.ts` (15). NOT yet wired into the live finalize seam.
> - **`7a082b77`** — **knowledge→action converter** (P8). `lib/knowledge/action-converter.ts` — pure heuristic, suggestion-only (no writes); chat/journal/memory/decision → task/rule/experiment/decision/memory/ignore; tasks get a `nextPhysicalAction`; sensitive/destructive intents flagged `requiresApproval`. `tests/lib/knowledge/action-converter.test.ts` (11). UI wiring deferred.
> - **DEFERRED (in NEXT-INTELLIGENCE-WAVE.md):** P9 generative confirm cards · P10 jobs console (already exists at `/system/crons` — improve via runbook) · receipts finalize-wiring · converter UI surface · 2 advisory provider warns in the shared root README.
> - **Verify (full matrix):** typecheck 0 · `check:stale-docs` 0 critical (strict exit 0) · `check:runbooks` clean (8) · `check:crons` clean · `eval:memory` 22 pass/0 fail · vitest **220 files / 3093 tests all pass** · `pnpm build` green.
>
> ## 2026-06-06 · Nick people-gate + WEEKLY recurrence + chat-honesty + PersonProfile source/phone/email + action-write verifier · 4 ships + Batch-4 prod cleanup
>
> Operator reported 3 bugs on bdnick.info (the chat auto-added shop callers / a pronoun-ghost "her" into the personal Power Atlas; tasks only did ONCE/DAILY; Nick fabricated task-status + nagged). Root-caused via 3 read-only code-explorers, fixed, migrated, prod-cleaned, runtime-verified — then a **multi-agent behavioral review** (Skeptic / Constraint-Guardian / User-Advocate · disposition **REVISE**) re-scoped the broader "Nick refinement" ask. Each ship gated tsc 0 + tests + turbo build green, landed attempt 1 via push-main.sh.
> - **`c66bb09e`** — (1) **people-creation gate:** `resolvePersonByName` (lib/brain/person-profile-fuzzy.ts) rejects pronoun/non-names (`isNonName`) + a `createIfMissing` flag; the conversation digest is now MATCH-ONLY (no auto-creating shop contacts) + no longer overwrites a curated `relationship`; `person.update` is edit-only; NEW `person.create` that ACTION_CATALOG tells Nick to ASK before using ("never add shop callers"). (2) **WEEKLY recurrence:** `LoopKind += WEEKLY` + `Task.recurring_days Int[]` + a 7-day weekday picker in task-edit-sheet + `checkTask` snoozes a WEEKLY task to its next listed weekday (reuses the WAITING+snoozedUntil task-resurface cron); pure `lib/loops/weekday.ts`. **Migration `0008_task_weekly_recurrence` APPLIED to prod.** (3) **chat-honesty:** NEW `task.status` agent-action (Nick CHECKS instead of fabricating "is it done") + an always-on HONESTY+RESPECT system-prompt block. tsc 0 · +10 new tests (isNonName guard + weekday math) · affected suites green · next build green.
> - **`172bac8f`** — HONESTY+RESPECT reword (multi-agent REVISE): FACTS-vs-COACHING lanes (verify facts or "can't confirm — want me to pull it?"; engage fully on coaching) + empty-tool-result handling + RESTORED the unprompted push-on-the-work (the first wording risked a yes-man). Prompt-only.
> - **`07089a9d`** — **PersonProfile `source` / `phone` / `email`** (#5 of the REVISE backlog): `source` (operator|agent|digest · set-once on create, never overwritten on match/update) makes shop-vs-personal STRUCTURAL; phone/email captured in the /people add+edit form + a read-only origin line. Resolver stamps them on create; NO new match-tier (phone-as-key DEFERRED — no phones exist yet · YAGNI · resolver match-logic untouched). **Migration `0009_person_source_contact` APPLIED to prod.** tsc 0 · /people verified 0 console errors.
> - **`75e48458`** — **action-write verifier** (REVISE #1 — the last item judged worth building now): Nick's `action`-block writes run in deferred background and bypassed the SDK-tool fabrication guard (`detectActionClaimsWithoutTools`/`environment-verifier` see only `capturedToolCalls`), so a mutation that silently FAILED while Nick's prose claimed completion never warned the operator. NEW pure `lib/ai/chat/action-result-verifier.ts` (`detectFailedActionClaims`) consumed in the deferred `executeActions` block emits a `chat_claim_warn` row (the EXISTING correction-chip path: claim-warnings.ts → /api/ai/chat/claim-warnings → action-claim-warning.tsx) when a MUTATION action failed AND the prose claimed completion; gated by `detectActionClaims` (suppresses the people-gate ask-first guard + hedged prose) + a `MUTATION_ACTIONS` set (failed reads excluded). No added latency (stays deferred), no per-action DB re-read; `traceId` threaded into `DeferredBackgroundCtx`. tsc 0 · +8 new tests · 166 chat tests green · build-gated push landed attempt 1.
> - **Prod data (no commit):** Batch-4 cleanup via Claude-in-Chrome — deleted the 2 ghosts (`Fernando Romero` = shop lead; `her` = operator-confirmed Dania, a pronoun mis-log), re-homed the note to Dania's leverage notes (reversible soft-delete); roster 9→7, NEEDS-INFO 2→0. + logged +10 RelationshipLedger deposits for Manny & Mash (operator: "holding it down, little contact needed").
>
> **Flagged · NOT fixed (REVISE backlog → `~/.claude/projects/C--/memory/statenour-nick-behavioral-review.md`):**
> - **#1 action-write verification — SHIPPED `75e48458`** (see ship list above). The v1-predicted "post-write row check inside `executeActions`" was SUPERSEDED — handlers already return `success:false`, so the existing flag was wired to the existing `chat_claim_warn` correction-chip via the deferred path (no per-action DB re-read, no latency). `environment-verifier.ts` confirmed the WRONG layer (its `capturedToolCalls` = `ev.steps` = AI-SDK streamText tools ONLY, NOT the action-block writes through `executeActions`).
> - **#6 dynamic fact-check grounding** (`fact-check.ts` proper-noun allowlist is hardcoded → stale, missed "Fernando") · **#8 narrow paid-provider routing** (latency — NOT a global pre-send LLM pass, which the repo already built + left OFF for 2×-latency reasons) · **#9 undo affordance** for people adds — all marginal; rec = stop the high-value push here.
> - **~70% of the proposed "Nick v1 contract" already existed** (L1-L3 fabrication stack · CoVe · pre-stream-regen · confidence-tier code-gate) — the review correctly redirected to the specific gaps above.
> - **Migration deploy-ordering lesson:** when a migration's APPLY may be auto-mode-gated, confirm the apply-auth BEFORE pushing the column-reading code (0008 slipped the classifier; 0009 was blocked → operator per-action-authorized → applied).

> ## 2026-06-04 · code-review program (verified H1-H4 / M1-M7 sweep) · 9 ships · main RED→GREEN
>
> Operator: *"check the accuracy of this [code-review ledger]… then go on all… fix it all."* A prior 6-agent code-review (run on a throwaway clone) was first-hand re-verified against source, then the safe + risky-but-gated findings shipped. Every ship gated tsc 0 + red-green vitest + turbo build green; rebased past the concurrent nickstire session through 4 ref-lock races. **Two findings CORRECTED mid-flight (verify-don't-trust):** H1 "ZERO CI typecheck" was overstated (gap real but narrower — nested statenour workflows exist, just inert); M5 "12 identical dup helpers" was wrong-premise — they're 18 DIVERGENT relative-time helpers (only 6 byte-identical, safe to merge).
> - **`f6b601c9`** — H1: added `"check": "tsc --noEmit"` to statenour `package.json` so CI's `turbo run check` stops silently SKIPPING statenour's typecheck (it had only `typecheck`; siblings all define `check`; `next.config ignoreBuildErrors:true` meant build missed types too → type errors could land on main). Proven via turbo dry-run. + H2: dropped `node_modules/.prisma/**` from turbo build OUTPUTS (platform-native binary; cross-OS cache-restore = silent corruption; build runs `prisma generate` unconditionally). + dropped `.env*` from `globalDependencies` (busted whole cache on secret rotation).
> - **`9e1f5a18`** — M1: registered 5 load-bearing flags in `lib/feature-flags.ts` (`NICK_PRIME_PROMPT` · `ENABLE_SPECIALIST_ROUTING` · `NICK_HIGH_SPEC_GATE` · `NICK_CHAT_INTENSITY` · `INNGEST_MEGA_V2`) — read via raw `process.env` but invisible to `/system/migrations`+`getFlag()`. Additive; call sites untouched.
> - **`4fab8138`** — M4: corrected stale "Venice primary" → Ollama-primary across README + `docs/ARCHITECTURE.md` + `.env.example` (real chain `[ollama,venice,openai,anthropic]`); deleted the redundant stale `.env.template` (+ its security-audit allowlist entry); collapsed 3 contradictory provider-order comments in `provider.ts`. + deleted dead `activeProviderSupportsTools()` (0 callers).
> - **`cdc03631`** — M5 (safe subset): 6 byte-identical `timeAgo` copies → `relativeTimeSeconds`/`relativeTimeMinutes` in `lib/utils/datetime.ts` via aliased imports (zero behavior change).
> - **`bdac0102`** — **fixed 2 stale RED test suites → main GREEN** (17 failing → 0): `smart-now.test.ts` asserted pre-Wave-2 routes (`next.config` redirects `/plan`→`/stats`, `/tasks`→`/missions`); `looks-like-brain-dump.test.ts` imported `looksLikeBrainDump` from its OLD path (moved to `lib/ai/chat/brain-dump-detector`). No runtime logic touched. + deleted 3 INERT nested workflows (`apps/statenour/.github/workflows/{ci,pr-review,mirror-to-master}.yml` — GitHub runs ROOT workflows only + trigger branches absent on origin = doubly-inert vestige of the standalone statenour-os repo).
> - **`d35da9bf` + `c3067403`** — removed all ~9 dead `format.ts` exports (0-caller-verified repo-wide; `format.ts` now = `clamp`/`formatDate`/`toSentenceCase`). + **M6 REFUTED**: the reasoning smart-tier "empty context" concern is false — smart (`reasoning/engine.ts:712`) sets context then falls through to the universal `if(!context)` fanout catch-all guarding ALL tiers (@971/@991 are extra thorough/deep-only pre-fallbacks). Added a clarifying comment, no patch.
> - **`66c74215`** — **H4: split the 1971-LOC `lib/trpc/routers/task.ts` god-router** → 20 Power Atlas (people/relationship/ledger/power) procedures extracted VERBATIM to `lib/trpc/routers/task/power-atlas.ts` (715 LOC), spread back (`...powerAtlasProcedures`) so `trpc.task.*` paths stay FLAT (zero behavior change; `updatePowerBalance` body byte-identical pre/post; build green). task.ts → 1278 LOC. Mirrors the `system`-router spread pattern. (`reorderMission`/`reorderTask`/`accept|dismissTaskClassification` KEPT — task-domain, were interleaved.)
> - **`1c6d84b1`** — M3: `ActionRule` was `any`-typed (the 20-rule autonomous-engine fires real Telegram/email side-effects with no compile-time shape check) → `ActionRule<T>` generic + `defineRule<T>` existential wrapper; each rule's `action(item)` now checked vs its `trigger()`. Type-only (identity cast; `any` net −2).
>
> **Flagged · NOT fixed (honest):**
> - **M2 (smart-home automation) HELD — investigated, NOT dead.** `lib/brain/automation-engine.ts` is the UNWIRED automation layer of a LIVE feature (SmartDevice/DeviceCommand/AutomationRule used by 15 files incl `lib/trpc/routers/system/devices.ts`; Tuya env present). Real device control runs through an EXTERNAL Python `local-agent/` that DIED Apr 14 (`app/api/devices/retire-stale/route.ts:8`); cameras have NO pixel pipeline (`snapshotUrl` always null; V380s P2P/no-RTSP). Operator chose SKIP (needs their hardware). Wire-vs-delete = open. Revive-runbook in MEMORY.
> - **M7 version drift — LEAVE** (aligning lucide/recharts/vitest/streamdown = untested major-version bumps, low gain).
> - **Relative-time full standardization** — needs a TWO-format house-style decision (short-horizon ops + long-horizon relationship timelines); a one-format rule would degrade month/year views. Operator left it.
> - **`tests/ai/agents/router.test.ts` intermittent flake** — passes 17/17 ISOLATED (this tree AND base), fails in the full single-fork run (mock-order pollution hypothesis). NOT from this work (proven); "pre-existing-before-session" unconfirmed. Joins the ~12 unhandled-rejection errors as test-isolation debt → the full suite EXITS 1 with all tests PASSING (read the summary line, not `$?`).
> - **TRUST AUDIT (advisory · operator-gated · NOT code).** A trust-calibrator+clarity-gate pass found nickstire INTEGRITY landmines — used-tire **$25** (web/Google schema) vs **$60** (phone/SMS/IG/voice/chatbot), a documented decoy (`truth_os.md:8-11`) → bait at booking; 36-mo warranty still in `llms-full.txt` vs 12-mo canon; hardcoded "Verified Google Review" testimonials + gbpContentGenerator fabrication (FTC risk); marketing "redo it free" vs invoice "ALL SALES FINAL" — plus a statenour-Nick gap (the verified/unverified marker covers ACTION claims but NOT numeric/data claims; CoVe + self-consistency flag-OFF). Detail in MEMORY `statenour_2026-06-04_code-review-verified.md`.

> ## 2026-06-03 · nick-intelligence + every-page audit + chat-pipeline code-health · ~5 ships
>
> Operator: *"fix nick chat + upgrade the tool calls + find anything else… give deep-reasoning live-data access… go through EVERY surface of EVERY page, make uniform, no deficit, don't break anything… then: what about the code underneath?"* Three threads, all flag-gated or behavior-preserving, prod byte-unchanged until a Railway flag flips.
> - **`db697237`** — nick-intelligence pass: chat-truth fix (Nick stopped flagging its OWN citations as fabrication; 5 tool-name corrections + a CI poka-yoke), the **`AI_PROVIDER=ollama` prod-stall fix** (that env var hard-pinned one provider + DISABLED failover → a stalled chat; DELETED, verified fixed live via Claude-in-Chrome), 15 `NICK_*` intelligence features (importance-recall · CoVe · contextual-retrieval · proactive autonomy [FAIL-CLOSED, /qa-gated] · anticipatory recall · reflection trees · contradiction cleanup · episodic split · outcome learning · self-consistency · multi-agent-auto · event-triggers · deep-reasoning · verified-regen · confidence-tier — each behind an env flag, default-OFF, wired to a real consumer), an 8-bug **proactive-staleness sweep** (recency floors / age ceilings / entity stopwords / honest relabels / freshness tags so no surface asserts stale data as present-tense), and the **glm-5.1** model swap (operator-chosen strongest+least-restricted; vision split to qwen3-vl; tool-calling verified live). 12 flags ON Railway, 3 held (verified-regen / confidence-tier / one more) by operator choice.
> - **`54df18b7`** — deep-reasoning LIVE-DATA access: the reasoning engine can't call tools, so deep turns reasoned blind to current numbers; now a compact `getDashboardSummary()` real-business snapshot is prepended to the reasoning context (best-effort, skip-on-fail) so `NICK_DEEP_REASONING` could be turned ON without the downside. Enabled.
> - **`c3281343` + `5717a107`/`a89f7e92`/`7319657d` + `1e2329bd`** — every-page audit (all 41 pages, 5 read-only audit waves): `/system` hub-grid pruned 33→12 cards (dead redirect/404/colliding cards removed, Calibration+Reviews restored), dead cross-links + orphan `system/status/` deleted; **14 pages migrated to the canonical `StandardPage`/`PageHeader`** (`description` widened `string`→`ReactNode` for live-metric subtitles); plus functional-deficit fixes (body weigh-in freshness, outreach neutral default segment, content/history `undefined/undefined`, retired `/habits` redirect).
> - **`4fa6255b`** — iOS-PWA dialog sweep: 11 controls used `window.confirm/prompt/alert` (silently dead in the operator's standalone PWA) → migrated to the in-DOM `confirm-dialog.tsx` primitives.
> - **`e4c5633a`** — chat-pipeline code-health pass (*"the code underneath"*): a read-only code-explorer audit produced a 12-item backlog; shipped the 5 SAFE behavior-preserving wins — route.ts python-execute regex dedup + `genBase` hoist · provider.ts Venice+Ollama quota-breakers collapsed into one `makeQuotaBreaker` factory (~40ln) · reasoning/engine.ts 6 repeated dynamic-import blocks → one shared module-scope `tracedAiChat`. tsc 0 · 919 ai tests green · build gate green, landed attempt 1.
> - **chat↔rest-of-statenour connectivity audit** — read-only trace of every seam (tools→bridge, brain recall, mastery, business-intel, persist-back) found 2 real wiring bugs, both fixed: `getProjections`'s 30-day revenue projection was a 1-DAY window (the `revenue_range` bridge query was sent a `{since}` filter the nickstire handler ignores — it reads `{from,to}` defaulting to today → Nick's annual projection was today×12; fixed `lib/ai/tools/goals.ts` to send the real 30-day span) + bridge env-key drift (`fetchShopSnapshot`/`fetchShopHealth` read only `BRIDGE_API_KEY`, but the live Railway key is `STATENOUR_SYNC_KEY` — snapshot silently used the slow fallback, health returned null; unified both onto a shared `resolveBridgeConfig()` matching the canonical `queryNick` client). 4 lower findings deferred + documented; 6 seams verified healthy. Detail in `nick-intelligence-pass.md` §10.
> - Reference/operating guide written: `docs/nick-intelligence-pass.md` (flag table · on/off/rollback commands · fail-closed safety model · model/provider chain · staleness patterns · §9 code-health backlog).
>
> **Flagged · NOT fixed (honest):**
> - **`preferLargeContext` sort (provider.ts) — left untouched.** A code audit called it a dead no-op; verify-don't-trust: `PROVIDERS` leads with the Venice+Ollama tag-team, so if Venice is index 0 that sort genuinely reorders Ollama to the front and is load-bearing. Not changed pending proof.
> - **Code-health backlog deferred (7 items, all SAFE)** — GSC-prefetch + customer-shape-hint extractions out of route.ts, `customerShapeRegex` module-hoist, `looksLikeBrainDump` relocate, `DeferredBackgroundCtx` derived-boolean removal, `buildMessageParts` helper; 1 RISKY (collapse the standard-tier critique branch via tier-config). Better done in a fresh-context pass; recorded in `nick-intelligence-pass.md` §9.
> - **3 flags held OFF** by operator choice (verified-regen trades streaming for a slower full-generate; confidence-tier removes the human-approval gate).
> - **Runtime not fully driven** — flag behaviors + the new chat paths are tsc-0 + suite-green + (some) Claude-in-Chrome-verified live, but the auth-gated personal-chat surfaces are verified by construction, not every-path-driven (same auth-gated-personal-data line as prior waves).
> - **Optional `PageSkeleton`** shared loading slot — still open (pure uniformity polish, no deficit).

> ## 2026-06-02 · hybrid retrieval — real Postgres FTS lexical lane (Wave B) · 1 ship + 1 prod migration
>
> The deferred Wave-B recall win, picked up + shipped (operator: *"B hybrid-retrieval (Neon migration)"*). `contextual-recall.ts` ran 3-lane RRF (semantic + keyword + category), but its "keyword" lane was `keywordScore` — naive JS `.includes()` substring matching over ONLY the top-300-by-confidence candidates loaded for the turn, so a perfect lexical hit (a person's name, an error code like "F25e", a SKU) on a mid-confidence memory was never even loaded → couldn't win. Replaced that lane with a TRUE Postgres FTS over ALL non-deleted/conf>=0.3 memories, UNIONed its hits into the candidate pool (the starvation fix), and fed `ts_rank` as the lexical lane (naive `keywordScore` kept as a graceful fallback when FTS errors or returns empty). The code degrades to a seq-scan pre-index (caught → falls back), so it shipped deploy-safe AHEAD of the migration. Verify-don't-trust: a fresh-worktree `tsc` tripped on an unbuilt `@statenour/lenses` (sibling code) — a build-order artifact, NOT my code; the real gate `turbo build` (which builds lenses first) passed 3/3.
> - **`9edc1804`** — B · FTS lexical lane. NEW `getLexicalMatches` (`ts_rank` + `websearch_to_tsquery`, OR-across-topics) + pure unit-tested `buildLexicalTsQuery` (4/4) in `contextual-recall.ts`; candidate-pool union; lane swap `useLexical ? sLexical : sKeyword`. Plus the `0007_brain_fts` registry entry in `app/api/system/apply-pending-migration`, `prisma/migrations-pending/0007_brain_fts/migration.sql`, and `scripts/apply-brain-fts.ts` (prod apply with pgvector before+after guards). Disjoint from the concurrent analyzer/home-chat session; rebased onto their `edf1766d` after a 2nd ref-lock race; combined-tree turbo build green (3/3 tasks).
> - **migration `0007_brain_fts` APPLIED to prod Neon** (via `scripts/apply-brain-fts.ts` · `railway run --service statenour-web`) — an ADDITIVE expression GIN index on `brain_memories.content`. **pgvector verified PRESENT before AND after** (the index is on a SEPARATE table from `vector_embeddings`, so it cannot touch pgvector — the operator's #1 fear, hard-guarded: the script aborts if `vector` is missing either side); index confirmed present; FTS smoke (`tire or revenue or oil`) = **277 live matches**; recorded in `_prisma_migrations` (drift-safe).
>
> **Flagged · NOT fixed (honest):**
> - **App-level lane not driven live** — the data layer is proven (277-match FTS run against prod Neon), but `getContextualMemories` fires only on an auth-gated personal chat turn, so the in-app lane is verified by construction + the live SQL, not by a driven turn (same auth-gated-personal-data line as prior waves; operator's in-app trigger).
> - **RRF lane weights unchanged** — kept `[2.0, 1.0, 1.0]` (semantic-dominant); a real `ts_rank` lane could justify a re-tune, but that needs measurement → left conservative (the win is the real ranking + the pool union, not a weight change).
> - **Deploy SHA not marker-pinned** — bdnick.info 200/healthy; `9edc1804` auto-deploys but no health-marker distinguishes it (same known limitation).

> ## 2026-06-02 · next-level intelligence (recall + memory + proactivity) + nickstire $49 · 6 ships
>
> Operator: *"achieve next-level intelligence and get it programmed into statenour… go above and beyond."* A 2-stream research pass (internal intelligence audit + external SOTA, both filtered to Ollama+pgvector) found statenour's brain already strong (RRF + cross-encoder rerank · 9-stage consolidation · fabrication defense) — so this was 4 SURGICAL upgrades in a clean lane disjoint from the concurrent analyzer-suite session, not a rebuild. Every commit tsc-0; full suite **2950 pass** (the 12 cold-run unhandled-rejections proven flaky — a pre-existing teardown race in `tasks-auto-inherit.test.ts`, absent on the warm re-run AND on the baseline; not in my import graph). Verify-don't-trust corrected the plan twice mid-flight: R2's "recency×importance scoring" was already implemented (dropped, no double-count), and R1's "HNSW full-table-scan" was a candidate re-score not a scan (reframed).
> - **`fae626ab`** — J · `mergeMemories` SOFT-deletes consolidated sources (`deletedAt`) instead of hard-deleting. 2026 research ("Useful Memories Become Faulty…") shows LLM consolidation that destroys source evidence can drop recall below a no-memory baseline; recall already filters `deletedAt:null` so what's recalled is UNCHANGED, but originals stay recoverable. `pruneNoise` left hard-delete (genuine GC: expired/conf<0.1/dupes).
> - **`a65ca22e`** — I · graph-aware recall. `contextual-recall.ts` now traverses the `MemoryEdge` graph (written nightly by connect()+cross-pollinate, never READ until now): a 1-hop expansion off the top-2 recalled memories surfaces the strongest linked memories as a "Connected" section. Safe-by-construction — append-only + try/catch + capped (≤2 anchors, ≤3 links, 150 chars) + dynamic-imports relational-graph (no cycle); the public recall interface is UNCHANGED (so the sibling's `system-prompt.ts` merges clean).
> - **`f0ad8498`** — F · XP-drift detection. NEW `lib/mastery/xp-drift.ts` compares each stat's recent-7d rate vs trailing-28d baseline (reuses `xpEventTotalsSince` — DB-side GROUP BY, no new query/migration) and flags clear decays/surges; the narrator surfaces the top finding as a coach/analyst narration. Conservative thresholds + a 20-XP baseline floor so it never cries drift on noise.
> - **`fe766df2`** — G · opt-in LLM-synthesized narrator. `synthesizeNarration` feeds the combined signal vector to a fast Ollama call for ONE compound observation the per-signal templates can't produce. Gated behind `NARRATOR_LLM_SYNTHESIS=1` (OFF by default — the ticker is byte-unchanged until enabled), ≥2-pattern-gated, hour-cached, best-effort. Never replaces a template voice.
> - **`5f03ffac` + `68a8315f`** — nickstire · VAPI receptionist + igAutopost $50→$49 conventional oil (the only price surfaces still on $50; igAutopost's compliance gate would have REJECTED a correct $49 post). ⚠ the LIVE VAPI assistant needs a `vapi.updateAssistant` re-push for $49 to be SPOKEN — the code deploy alone doesn't update the dashboard-managed assistant.
> - Ship path: isolated worktree `statenour/next-level-intelligence` → cherry-picked onto the sibling's `54a45560` after their push won a ref-lock race → combined-tree build re-gated green (cleared a stale `.next/types` deleted-route validator) → ff-pushed `54a45560 → 68a8315f`. Files fully disjoint from the analyzer session (their analyzers/chat-route/system-prompt/deps vs my recall/consolidation/mastery/ultron).
>
> **Flagged · NOT fixed (honest):**
> - **B (hybrid `tsvector`/BM25 retrieval lane) deferred** — the biggest remaining recall win, but it needs a hand-applied Neon migration, NOT run concurrent with the live sibling session. Next-session pickup (coordinate the migration window).
> - **G ships OFF (env-gated)** — its narration quality is unproven; flip `NARRATOR_LLM_SYNTHESIS=1` to evaluate (template voices remain the floor).
> - **Runtime behaviors not live-executed** — the graph "Connected" section, the drift narration, and the $49 spoken quote read personal Neon data / need the assistant re-push; verified by construction + tsc + full suite, not driven live (the auth-gated personal-data line, held same as the sibling).
> - **Deploy SHA not marker-pinned** — bdnick.info is 200/healthy/DB-connected (booted clean on the combined tree), but my changes add no health-marker, so `68a8315f`-vs-`54a45560` can't be distinguished from /api/health. Build-gate + proven-live base = sound, but not marker-proven.

> ## 2026-06-01 · task classification + scoring + AI-review finish + confirm-chip · 8 ships · 2 prod migrations
>
> Operator: *"tasks feel a little generic when it creates one… auto-classifies into the generic Inbox or Missions without taking a look at whether they correlate to a mission, goal, or feed stats… look at the scoring system + settings + everything."* Root-caused to 4 layers — a mission-ONLY classifier · a create path that bypassed it · `goalId`-null tasks credited nothing · auto-learn's `MasteryScore` domain strings never matched the 33 stat keys, so task XP was silently orphaned — plus 2 latent bugs (the /check route never lifted goals · DAILY completions were inert). Rebuilt the create→classify→credit spine end-to-end, then ran an AI code-review and shipped every recommended fix incl. a suggest-then-approve confirm-chip.
> - **`b9a60d4d`** — register `0004_task_stat_hints` (no schema change · pre-apply; the two-phase deploy that dodges the Prisma SELECT-all "column doesn't exist" trap).
> - **`1ee0f765`** — the core: NEW `lib/ai/classify-task-linkage.ts` correlates **mission + goal + stats** (was mission-only; an AI call via `tracedAiChat` with a deterministic keyword-overlap `fallbackLinkage`) fired from ONE `enrichTaskLinkage` chokepoint on EVERY create path (gap-fill · atomic compare-and-set) · `creditTaskStats` credits the character sheet on EVERY completion (goal stats → statHints → `goal.domain` inference · idempotent `sourceKey` · scaled by `taskStatMultiplier`) — closing the orphaned-domain bug · `Task.statHints` column · `0004` APPLIED to prod.
> - **`12ce290e`** — enrich treats ALL `/inbox/i` mission variants as unclassified + a zero-target goal-progress guard (#2/#3 from the AI review).
> - **`272405ff`** — M3: `credit-task-stats.test.ts` pins the crediting orchestration (exactly-once · priority order · multiplier scaling).
> - **`2c8030a4`** — P3a: /missions quick-add now relies on the server enrich; the redundant client-side classify+attach block + the dead `classify-task-mission` module DELETED (server enrich is the single classifier).
> - **`084a38ef`** — M1 (SQL-aggregated xpEvent totals · was an in-JS sum) + M2 (`createTaskAndEnrich` seam).
> - **`825e9fba`** — register `0006_task_pending_classification` (pre-apply).
> - **`2c4c376d`** — confirm-chip: a low-confidence (0.3–0.6) mission match PARKS on `Task.pendingClassification` and surfaces a /missions accept/dismiss chip — mirrors /people's suggest-then-approve · migration `0006` applied to prod (operator-authorized).
> - Gates (FRESH — re-verified on shipped `origin/main` this session): typecheck **0** · the wave's unit suites **35/35** (scoring-config 6 · credit-task-stats 8 · goal-stats 16 · classify-linkage 5). 8 commits `b9a60d4d → 2c4c376d`, interleaved on shared main with the concurrent /people wave (its `44a10079` is an ancestor of the final `2c4c376d`).
>
> **Flagged · NOT fixed (honest, verified):**
> - **confirm-chip on-screen render is unverified.** Verified by construction (column live · `pendingClassification` surfaces through `task.list` · accept/dismiss mutations typecheck · chip renders off that field) but never seen on screen — the live Ollama classifier was decisive (≥0.6 or null) across 6 prod test tasks and never produced a 0.3–0.6 result to land in the park band.
> - **Biggest lever is DATA, not code.** Only ~2 life-goals exist and both are unconfigured (target = 0) — the spine has little to correlate against until real goals are authored. Code-complete; operator action.
> - **`lib/mastery/goal-stats.ts` perDay day-key uses UTC, not the ET `today()`** — a narrow 8pm–midnight-ET double-credit edge in `creditTaskStats`'s `{perDay}` path. Left for the statenour-session owner to avoid a cross-session collision on the mastery files (per the agent-memory handoff).

> ## 2026-06-01 · /people (Power Atlas) overhaul + QA pass · 4 ships + prod migration
>
> /people went from a siloed, unscored CRM to a real part of the mastery system
> (operator: *"feels generic… results aren't tracked/scored into XP… doesn't read
> tasks to correlate to a mission/goal/stats… UI looks bulky"*). Measure-first
> profiling of prod drove the plan — the feature would have launched empty otherwise.
> - **Overhaul (5 phases)** `d5c6f098` — `lib/mastery/people-credit.ts` (NEW · ledger
>   deposits + power-plays credit the INFLUENCE & PEOPLE stats via the idempotent
>   `creditStatXp` seam — deliberately NOT `goal-stats.ts`, to dodge the sibling's
>   task-classification rewrite) · classifier rewritten **suggest-then-approve**
>   (`pendingClassification` + role SSOT `lib/brain/person-roles.ts`, no more silent
>   overwrite) · reads tasks via a real `Task.personId` FK ("open promises" panel) ·
>   UI de-bulked (stats above the fold · 5 empty cards folded · dup Greene sidebar
>   removed) · operator-tunable weights (`components/settings/people-scoring-panel.tsx`)
>   · `task.backfillPeopleXp` mutation · rebased clean onto the sibling's statHints.
> - **Migration `0005_people_overhaul` APPLIED + recorded on prod Neon** — `pending_classification`
>   col + `Task.person_id` FK (onDelete SetNull) + index; the promiseTo→personId backfill
>   matched 0 rows (profile-predicted — only "self"×2).
> - **XP backfill RUN + verified** — 16 historical deposits → 13 `relationships` (10.0 XP)
>   + 3 `networking` (3.9 XP); confirmed live in the UI (Dania +6.6 XP chip).
> - **QA pass `44a10079`** — parallel a11y audit + code-review found+fixed a CRITICAL:
>   `window.confirm` person-delete was silently dead in the iOS **standalone PWA** (the
>   operator's phone) → two-tap inline confirm, **live-verified** ("delete"→"sure?",
>   no delete on first tap). Plus `updatePerson.role` z.string()→z.enum (role SSOT leak),
>   `getPeopleIntelligence` missing `deletedAt:null` (soft-deleted people leaked into
>   Nick's prompt every chat turn), `dismissClassification` swallow→throw, WCAG (trust
>   tier as text not color-only · XP-chip aria-label · live regions · 44px targets).
> - Gates: typecheck 0 · 89 mastery + 12 people-credit tests · pre-push build OK · all
>   surfaces live-verified on bdnick.info via Chrome. Shipped via `~/push-main.sh`
>   (auto-race-recovery helper built this wave; landed through 5-session shared-main churn).
>
> **Flagged · NOT fixed (deliberate, verified — not gaps):**
> - `lib/mastery/credit.ts` upsert last-write semantics — shared by EVERY crediting path (journal/decision/task); defensible (idempotent on row identity; only re-prices on a deliberate backfill re-run). Blast radius too high for a polish pass.
> - Codebase-wide clickable-row nested-interactive-role pattern (MissionCard/GoalBoard convention) — refactoring one row = layout risk + inconsistency; address repo-wide or not at all.
> - mentor/mentee → `networking` stat map — judgment call, no correctness impact.

> ## 2026-06-01 · Journal Brain redesign (grounded enrichment) · 2 ships + prod migration
>
> The Journal went from a generic dead-drop to a grounded thinking instrument
> (operator: *"the Journal feels generic… results aren't tracked/scored into XP…
> doesn't read tasks/missions/goals/stats"*). Full phased redesign, "Approach A"
> unified async enrichment pass. Capture stays instant; a fire-and-forget pass
> grounds each entry vs ACTIVE goals/missions (inline candidates, NO embeddings —
> goals aren't embedded + the set is tiny), grounded-reclassifies (real `entry_type`
> column wins over the legacy JSON blob), proposes a confirmable goal/mission link
> (auto-confirm ≥0.8 credits now · below → "proposed", credits on ✓), credits a
> grounded XP bonus to the linked goal's stats (`baselineXp×weight×groundedMult`,
> idempotent `goal-journal:<id>:<stat>`), and generates a bold idea + sharp challenge
> ("take"). Baseline XP (Phase 0 `b5cf8b9a`) already credits every capture.
> - **Phase 1-3 + engine** — `lib/brain/journal-brain.ts` (enrich + `confirmJournalLink`
>   + `creditGroundedGoalXp` + `generateJournalTake` + `resweepUnenriched` + Phase-3
>   `backfillJournalBrain`) · wired into `journal-ingest.ts` (fire-and-forget, `notifyTelegram`)
>   · `lib/trpc/routers/journal.ts` (`receipt` DERIVED from ledger · `confirmLink` ·
>   get/updateSettings · `backfillBrain`) · `journal-feed.ts` (grounding cols + batched
>   goal-title, no N+1 + SQL `entry_type` push-down) · `entry-row.tsx` (link chip +
>   impact receipt) · `journal-brain-panel.tsx` (7-knob settings) · resweep into
>   `cron/mastery-xp`. Rebased 3× through shared-main churn.
> - **Telegram link-confirm** — propose-time inline ✓/✗ + `handleCallback jlink:c|r:<silo>:<id>`.
> - **Migration `20260601_journal_brain_foundation` APPLIED to prod Neon** (`spring-art-47050555`
>   via run_sql_transaction: 6 cols × 4 silos + 8 FKs + 9 indexes + `journal_settings`). ⚠ Phase 0
>   had shipped the schema cols WITHOUT applying → prod journal reads were likely erroring until
>   this apply. **Lesson: schema + migration must ship together.**
> - Deleted orphaned regex classifier `lib/journal/classifier.ts` (no importers).
> - Gates: typecheck 0 · pre-push affected build OK · push head `dc476e4e`. UI built by 2 scoped
>   subagents, diffs verified. Used PowerShell git (Cygwin fork failures) + cleared worktree `.next`
>   (a nested-artifact explosion was hanging Next's file-tracer at "Finalizing").
>
> PROFILE (prod, 2026-06-01): 990 journal rows — **435 brain_dumps** (median 96 chars, p95 701,
> only 2.3% under 40 → qualityFloor=40 validated) + 215 reflections + 331 situation_logs + 9
> decision_replays. **⚠ only 1 ACTIVE goal vs 10 active missions** → grounding value is thin until
> more goals exist.
>
> **Flagged · NOT fixed (operator-gated / deferred):**
> - **Backfill (~990 rows) not yet run** — heavy Ollama; `journal.backfillBrain` dryRun→drain, or the nightly resweep auto-drains brain_dumps. Operator-gated.
> - ✅ **mission→goal stat crediting — DONE this wave** — `resolveCreditGoal` routes a mission-linked entry to the mission's parent goal (`mission.lifeGoalId`) in both the live pass + confirm, so the 10 active missions earn XP, not just the 1 standalone goal (the profile's top lever, shipped same wave).
> - Deep brain-consolidation (drift/threads INTO the pass) — YAGNI; they already work as separate /journal surfaces.
> - Migration left in `migrations-pending/` (not promoted to migrations/ + not in `_prisma_migrations`) — the hand-applied intermediate; promote later.

> ## 2026-05-31 · God-file split #2 (system.ts) + Chrome-walk fixes · 2 ships
>
> A live Chrome walk of statenour (operator: *"do a chrome walk of everything"*)
> verified this session's work IN PROD — the idiot-index chip, the full P3
> authoring panel (parent/kind/conviction/identity/kill-by/ambition), and AI
> tool-calling after the tasks.ts split (Nick called a moved `goals.ts` tool and
> answered grounded) — all green, zero console errors. It surfaced two pre-existing
> issues, both fixed in `f6f1143b`:
> - **`app/(mastery)/financial/page.tsx`** — the MONEY page showed a PERMANENT
>   "Loading revenue data…" whenever month revenue was 0, i.e. it lied when the
>   nickstire bridge was down. Now splits the states (loading / feed-unavailable /
>   genuine $0). ROOT CAUSE of the empty bridge = config (STATENOUR_SYNC_KEY on
>   Railway and/or nickstire's `revenue_range` handler) — flagged, not code-fixable.
> - **`lib/observability/os-snapshot.ts`** — all 5 source scanners excluded `.next`
>   but not `.next-prod`/`standalone`, inflating LOCAL cron runs. Added both. (No
>   prod effect; the /brain `monster_file_count` P0 is a REAL signal, not noise.)
>
> Then the **`system.ts` god-router split** (`560525e2`) — the worst god-file, the
> one driving that P0. The 2,722-ln `systemRouter` (105 tRPC procedures) → 9
> per-domain procedure-object files (`system/{health,cron,autopilot,prompts,quality,
> schema,devices,agents,notifications}.ts`), recomposed in a **61-ln** `system.ts`
> via object-spread: `router({ ...healthProcedures, ...cronProcedures, … })`. **FLAT
> namespace preserved** — every procedure stays `trpc.system.<proc>` (NOT nested,
> which would change client paths + break call sites). Verbatim byte-range move,
> zero behavior/input-schema/middleware change, 105→105 procedures. Built in an
> isolated worktree via a briefed subagent, then independently verified: procedure
> parity, no-nesting grep, and **typecheck 0 = the interface gate** (client
> `trpc.system.*` call sites compile against the router type) + full vitest 2919.
> Cherry-picked onto main; pre-push build OK.
>
> (Concurrent **a11y session** shipped `d85888ba` WCAG 2.2 AA both apps +
> `useFocusTrap`/`useReducedMotion` hooks + `59032991` mobile hero + merge
> `03e80d67`; fact-checked ACCURATE. Verified gotcha: a worktree branch pushed
> `HEAD:main` SKIPS the pre-push build — no upstream — so a later `main` push
> re-gates everything.) **Remaining god-files:** chat route (1,884 ln) · provider
> centralization (31 callers).
>
> ## 2026-05-31 · Tech-debt cleanup (statenour) — report fact-check + tasks.ts god-file split · 2 ships
>
> A monorepo tech-debt report (from the nickstire session) listed Sprint-1 wins.
> Fact-checked its statenour claims against the files first (the worktree report it
> produced earlier had real errors): **most held, two didn't** — serializeRow's "77×
> across 3 files" is literally true (system-pages.ts 28 + -b.ts 27 + runner-state.ts
> 22), but the `.toISOString()` calls are heterogeneous (current-time / epoch /
> non-null / nullable), so a single `serializeRow` helper doesn't fit + it sits on
> the API-response path → **skipped** (overstated ROI); provider-bypass is **31**
> files not 23. The money-path wins (formatDollars 5×-contradictory, Stripe webhook
> `any`, payments test) are all `apps/nickstire/` → handed off to the owning session.
>
> **`34ad6fcd`** — deleted the stale `soft-deleted-tasks-2026-05-16.md` restore log
> (389 ln in the app source root). The one clean zero-risk win.
>
> **`2728caa7` · `tasks.ts` god-file split** (interface-preserving) — the 2,024-ln
> single `tasksTools` const (46 AI tools) → 6 NEW per-domain files
> (`goals`/`missions`/`habits`/`health`/`finance`/`calendar` · 7+3+3+1+1+2) + a
> 29-tool `tasksCoreTools` kept in tasks.ts (now 1,292 ln), recomposed verbatim:
> `tasksTools = { ...tasksCoreTools, ...goalsTools, … }`. Pure mechanical MOVE, zero
> behavior change; the public `tasksTools` export keeps the EXACT 46 keys. Dropped
> one unused `detectBlindSpots` import from tasks.ts (still used in brain.ts). Built
> in an **isolated worktree** (a concurrent `a11y-hardening` session was live) via a
> briefed subagent, then **independently verified** (diff scope · 46/46 key count ·
> recomposition spread · typecheck 0 · full vitest 2919 · verbatim spot-check) before
> cherry-picking onto main.
>
> Gates green: typecheck 0 · vitest **2919** · pre-push build OK. 2 commits on
> origin/main. **Remaining tech-debt (sequenced for fresh context):** the chat-route
> (1,884 ln) + system-router (2,722 ln / 105 procs) god-files · provider
> centralization (31 call-sites) · the nickstire money-path hand-off.
>
> ## 2026-05-31 · Ambition Engine P3 (increment 2) — kinds + anti-stale authoring · 1 ship
>
> Operator: *"can u do both at the same time? or all?"* → did all the remaining
> P3 in one wave (NOT parallel agents — kinds/authoring/trajectory all edit
> goal-board.tsx, so parallel would only conflict; one focused pass = one verify
> + one ship). Wires the rest of the dormant P3 columns (P1-migrated, settable
> nowhere) into the /stats card.
>
> **`de898be3` · kinds + anti-stale authoring** (+191/−2) — `lib/services/goals.ts`:
> `updateGoalSchema` now accepts `kind` (metric|milestone|narrative enum) +
> `conviction` (1-5) + `ambition` (tenx|incremental) + `killCriteria` + `killBy`
> (DateTime, converted like deadline) + `identityLine`; all nullable so the edit
> panel can clear them. `components/goals/goal-board.tsx`: (1) **authoring** — the
> edit panel gained a kind selector, conviction picker, identity-line input,
> kill-criteria + kill-by date, and an ambition toggle; (2) **display** — a
> conviction flame chip, ambition tag, pre-committed kill-by chip, the Elon
> **idiot-index** (hrs invested ÷ % moved · derived, no column), and the identity
> line for narrative goals — all in the card's existing chip language; (3)
> **kind-adaptive** — a kind badge on non-metric goals, milestone goals relabel
> "loops"→"milestones", narrative goals surface the identity line while the
> metric/target chip falls away naturally (no target).
>
> Trajectory was already the existing pace-projection chip; the idiot-index
> completes the Elon "question the requirement" set. **P3 is now functionally
> complete** (ladder + kinds + anti-stale authoring + trajectory). Built in place
> on main. Gates green: typecheck 0 · lint 0 new errors · vitest **2919**. 1
> commit on origin/main → Railway. Future refinement: dedicated per-kind card
> layouts (a real milestone checklist UI) + the `lastChallengedAt`
> question-the-requirement ritual button (column exists, no UI yet).
>
> ## 2026-05-31 · Ambition Engine P3 (increment 1) — the compounding goal ladder · 1 ship
>
> Operator: *"go"* (build P3). P3 is the spec's broadest phase ("ladder +
> trajectory + UI polish"); a code survey found the `parentGoalId` / `GoalLadder`
> self-relation shipped in the P1 migration but **referenced nowhere** — a dead
> column. Scoped increment 1 to wiring it end-to-end (the defining "compounding"
> feature), TDD-first; trajectory + kind-adaptive cards deferred to later increments.
>
> **`37106b6b` · the ladder** (+426/−5) — NEW pure `lib/mastery/goal-ladder.ts`
> (14 unit tests): `validateParentLink` (rejects self · cycle, via a cycle-guarded
> `ancestorChain` walk · inverted horizon, where the parent must be ≥ the child's
> horizon) + `rollUpChildren` (childCount · doneCount · avgChildProgress).
> `lib/services/goals.ts`: `updateGoalSchema` accepts `parentGoalId` (null unlinks);
> `updateGoal` validates the link before the write (builds id→horizon + id→parent
> maps from active goals); `getGoals` fetches `parent` + alive `children` per goal
> and attaches a `ladder` {parent, children, rollup} payload — **defensive**
> (`children` may be absent on a partial select / mock; the lone test break was
> exactly this, fixed at the source not the mock). `components/goals/goal-board.tsx`:
> ladder UI in the card's existing language — a violet parent-breadcrumb chip + a
> sky children-rollup chip (both tap-to-scroll to the linked card via the existing
> hash-anchor pattern) + a sub-goals list in the expanded panel + a parent `<select>`
> in edit mode (server-validated; rejection surfaced in the toast).
>
> Built in place on main (not a worktree — the native worktree tool wants an explicit
> "worktree" ask, and in-place + TDD kept the tree buildable for the concurrent
> nickstire session). Gates green: typecheck 0 · check:crons clean · lint 0 new errors
> · vitest **2919** (2905 + 14). 1 commit on origin/main → Railway. **Remaining P3:**
> kind-adaptive cards (metric/milestone/narrative) · trajectory · the
> conviction/killCriteria/identityLine authoring (those columns are also still dormant).
>
> ## 2026-05-31 · Ambition Engine P2 — proactive goal-drift detector · 1 ship
>
> Operator: *"get back to it"* — shipping the P2 work built + fully verified on a worktree
> branch last session. The **goal-drift detector** is the proactive complement to
> `goal-pruner`: where the pruner only flags goals already 30+ days idle, this catches
> drift EARLIER, on two signals, and acks itself when a goal re-engages.
>
> **`87a4a0cb` · goal-drift detector** (+330 · 3 new files + 2 registration lines) — NEW
> `lib/mastery/goal-drift-classify.ts`, a pure side-effect-free `classifyDrift(input) →
> DriftVerdict | null`: **deadline-risk** (P1) = deadline ≤14d & progress <80% & 0 events
> this week · **momentum-decay** (P2) = ≥2 events in the prior 4-week window & 0 this week &
> <30d since last activity. Thresholds (RECENT_DAYS 7 · PRIOR_DAYS 28 · DEADLINE_SOON_DAYS
> 14 · DEADLINE_PROGRESS_FLOOR 80 · MIN_PRIOR_EVENTS 2) are grounded defaults, tunable. NEW
> `src/inngest/functions/goal-drift-detector.ts` — daily cron `30 12 * * *` (30min after
> `goal-pruner` so the two goal scans don't collide) — scans active `lifeGoal`s + their
> GoalEvent windows → `recordCoachEvent({ kind: "goal-pace-shift", … })` deep-linked to
> `/stats#goal-<id>`, surface `goals`; acks the event on re-engagement, idempotent per
> goalId, best-effort writes. Registered in `config/crons.ts` + `src/inngest/functions/index.ts`.
> NEW `tests/lib/mastery/goal-drift-classify.test.ts` (9 tests). Reused the existing
> `CoachEventKind` member `goal-pace-shift` — the closed union already anticipated P2.
>
> Shipped via **cherry-pick** from the local `worktree-ambition-p2-drift` branch onto main
> (clean linear history — no merge bubble on shared main); the diverging commit on main was
> the other session's `c883caa6` (nickstire callback fix · zero file overlap). Worktree
> removed + branch deleted after the push landed; added `.serena/` + `.claude/worktrees/` to
> root `.gitignore` (tooling dirs were untracked-and-committable on shared main). Gates green:
> typecheck 0 · check:crons clean (30 active schedules · under cap · all reachable) · vitest
> **2905** (2896 + 9). 1 commit on origin/main → Railway. **Ambition Engine P3** (goal
> authoring · stat-ladder · kind-cards) remains.
>
> ## 2026-05-31 · Chrome polish wave — bottom-ticker Edge Feed rebuild + a11y/CTA touch-ups · 3 ships
>
> Operator: *"go check it out in chrome for more polishing."* Walked the live site
> (confirmed the dania scrub took — `silent`=0; the only "dania" is the operator's own
> goal description, correctly untouched), then fixed what the walk surfaced.
>
> **`5b31a92a` + `edfae490` · bottom "System pulse" ticker** — the LAST 60s CSS marquee
> with `hover:pause` (banner-blindness + dead-on-touch — the exact pattern the Edge Feed
> redesign already removed from the top ticker; a lone item even rendered twice
> side-by-side). `5b31a92a` stopped the lone-item double; `edfae490` rebuilt it to match
> the top — ONE static item, priority-first (warn>win>info>mute), fade-on-change,
> tap-to-open pulse feed (UPWARD), visible 24h snooze (was forever-dismiss). Ambient
> scale kept (`min-h-[32px] sm:h-5`, 10px) so the layout's bottom reservation (chat
> safe-area + pb) is unchanged; a11y landmark preserved; A3 test updated to lock the
> marquee removal.
>
> **`edfdf1b4` · two touch-ups** — the P2 stale-goal coach card now reads "tap to review
> or archive at the goal" (it deep-links to the goal's one-tap archive — not a dead-end,
> just an unclear affordance); the icon-only add-goal Plus button got
> `aria-label="Add goal"` (the lone genuinely-unlabeled button on /stats — the
> char-sheet category toggles were already labeled by content + aria-expanded; the
> a11y-tree's "7 unlabeled" was an artifact, the live probe found exactly one).
>
> Gates green: typecheck 0 · eslint 0-err · vitest **2896**. 3 commits on origin/main.
>
> ## 2026-05-31 · Relationship-nag scrub wave — kill the "Dania silent" ambush across all surfaces · 3 ships
>
> Operator: *"yes [scrub the other dania surfaces] but also search for more shit
> that needs scrubbing /clarity-gate."* A read-only code-explorer audit mapped the
> CLASS of blunt/stale/sensitive auto-surfaced signals (the score-nag + dania-silent
> pattern). Found 10; scrubbed the 6 LIVE, cleared the 4 dead/dormant, kept all
> legit plumbing.
>
> **`42d748fc` · ticker dania-silent item** — the first surface, caught by live
> Chrome verification (also covered in the deferred-items entry below).
>
> **`0b044154` · 5 more LIVE surfaces** (+9/−200) — the same regex "Dania N days
> silent" nag was auto-surfacing on: `narrator.ts` ("Dania gap Nd" coach line +
> trigger patterns + the input), `chat-lane-check.ts` (a chip under EVERY chat
> reply), **`blind-spot-detector.ts`** (highest blast-radius — the blind spot fed
> `blind-spot-pinner` → pinned into the TOP OF EVERY SYSTEM PROMPT; removed the
> Dania-only loop + its orphaned `neglectedPeople` query), `personal-pulse.ts` (the
> "<name> silent Nd" LIFE chip + its 2 person-silence queries + "dania"-as-a-role-
> enum), and `app/api/ultron/pulse/route.ts` (the `life.daniaSilent`/`topSilent`
> name exposure in the cached payload). Kept (clarity-gate): person-name resolvers,
> intent/lane routing, promiseTo fields, the "married to Dania" identity facts the
> AI prompt needs.
>
> **`9b690019` · dead/dormant remainder** (+9/−118) — dead `daily_score` reads in
> `ultron-ticker.ts` + `plan-day/route.ts` (retired system, always null/[]); the
> dormant `dania_neglect_nudge` + `body_projection_weekly` (hardcoded 186-lb)
> Telegram rules in `autonomous-engine.ts` (engine has no caller since Wave AE —
> removed so a re-wire can't resurrect them); marked `strategic-triggers.ts` DORMANT
> (no caller; documented the score-shim revival trap rather than deleting 521 lines
> of Greene-trigger logic).
>
> Method note: the audit's value was tracing the CONSUMER GRAPH, not the string — a
> grep-and-delete would have missed `blind-spot → pinner → every system prompt`, the
> worst path (not a visible chip). Also surfaced that the prior wave's
> `strategic-triggers` re-source (`b952fc37`) was cosmetic — the module is dead.
>
> Gates green: typecheck 0 · eslint 0-err · vitest **2896**. 3 commits on origin/main.
>
> ## 2026-05-31 · Deferred-items completion wave — re-source + ticker page-context/snooze · 2 ships
>
> Operator: *"go on all deferred."* Closed the deferred refinements from the
> auto-mode wave. Two of them clarity-gate resolved to *already-covered* (no
> redundant code shipped); the AI-curation v2 is held as premature.
>
> **`b952fc37` · score→reflection re-source** — three detectors still read the
> retired daily-score source (`recentScoreSnapshots` / `identity_snapshot`):
> · `timelines.ts` `computeInputs` — deleted the now-dead score inputs
> (`todayScoreLogged`/energy/focus/discipline); the items that consumed them were
> already removed in the 812c0a32 ticker cleanup, so the reads were pure dead
> weight. · `strategic-triggers.ts` "no business action today" — swapped
> `dailyScoreToday` for live `reflectionLoggedToday` (`prisma.reflection.count`,
> date format mirrors the writer in `journal-reflect.ts` + `narrator.ts`) + fixed
> the stale "no score" detail text. · `nour-state.tsx` `detectState` — dropped the
> always-default score-derived energy/discipline (so `on_fire`/`low_energy` could
> never fire) → state driven by the LIVE signals already in state (drift alerts,
> active commitments, habit-rate); `on_fire` revived via strong habit completion.
> No `/api/health` change. +28/−40.
>
> **`afc738f2` · Edge Feed ticker — page-context emphasis + 24h snooze** —
> client-only (no server feed change). · **Page-context:** the global strip
> soft-boosts the lanes relevant to the current page (shop/market on
> /money+/scoreboard+/funnel, mastery/brain on /stats+/goals, brain/industry on
> /brain+/radar+/seo) — applied as a tiebreaker AFTER mode+severity, so an urgent
> item still leads globally. · **24h snooze:** the top strip's X is now a 24h
> snooze (opt-in `ttlMs`), not a permanent mute, so live/recurring lanes
> (market, shop) return tomorrow instead of being silently lost forever; the
> shared dismiss hook migrated `Set`→`Map` gracefully (legacy string-array
> entries preserved as forever; bottom ticker unchanged).
>
> **Resolved by clarity-gate (no code shipped):** · **habit write-time XP** —
> habits were retired as a model; they're DAILY Tasks now (`/api/habits` POST is a
> no-op), so completing one credits XP via the task→auto-learn path already. ·
> **chat write-time XP** — already swept by the mastery-xp backfill; write-time
> would add a 2nd per-turn `attributeText` AI call on the `persistUserTurn` hot
> path (the importance scorer is already there) for marginal immediacy. The XP
> ledger is effectively complete.
>
> **Held (not shipped, with rationale):** · ticker **AI-curation v2** — the
> deterministic rank shipped *today* and isn't proven weak; the Guardian
> hard-rejected the naive version (`createStructuredAiResponse` bypasses the
> budget guard). Revisit only with evidence + full guarding
> (`tracedAiChat`+`trackGeneration`+pinned `gpt-4o-mini`+themes-only+`inngest`).
> · **lane-health visibility** — touches the server feed builder for lower value
> than the "better-empty-than-generic" floor already provides.
>
> Gates green: typecheck 0 · eslint 0-err · vitest **2896** · check:crons clean.
> 2 commits on origin/main.
>
> ## 2026-05-31 · Auto-mode evolution wave — feeder + XP ledger + Edge Feed ticker · 4 ships
>
> Operator: *"go in auto mode and apply every single upgrade to help evolve us."*
> Three force-ranked upgrades from the Sam-Altman pass, each clarity-gated +
> verified + shipped.
>
> **`a5572ac5` · ① revive the industry-pull feeder** — a correctness bug, not a
> feature: the cron was deleted in the Wave-AE prune, so `recallIndustryIntel()`
> (`system-prompt.ts:847` · `/api/ai/plan-day` · `/intel`) had been feeding the
> AI a stale `BrainMemory(industry_intel)` table. Revived as an inngest-native
> cron (`src/inngest/functions/industry-pull.ts`) calling `pullIndustryFeeds()`
> daily 08:00 UTC (~10 live sources post the 2026-05-02 probe; already
> timeout-guarded + per-source error-safe).
>
> **`9444ec2c` · ② complete the XP ledger** — NEW `lib/mastery/credit-signal.ts`
> `creditFromSignal(signal, ev)`: the single write-time door routing
> habit→`attributeHabit` + journal/decision/chat→`attributeText` → `creditStatXp`
> (idempotent per sourceKey, shared with the backfill; noise floor preserved).
> Wired at BOTH reflection create paths (`journal-reflect.ts` + `reflect/route.ts`)
> + the decision service. The gap it closed: daily REFLECTIONS — the daily-score
> replacement — fed ZERO XP by any path (the backfill doesn't sweep them). +6
> unit tests. (No-goal tasks already credited via auto-learn — never the gap.)
>
> **`fcdb1b3a` · ③ Edge Feed ticker** — killed the 55s marquee (wallpaper +
> unreadable/untappable on a phone, hover-gated controls) → ONE readable item
> (≥13px) on a ≥40px tap-strip that opens a full feed sheet; severity-first;
> fade-on-change (no continuous scroll); visible dismiss. + a **Mastery lane**
> surfacing Ambition Engine momentum (top riser this week + closest-to-level).
> Design vetted via multi-agent-brainstorming; a11y test updated (40px ≥ the
> 32px HIG floor + marquee assertion).
>
> **Flagged · NOT fixed (deferred refinements):**
> - score→reflection re-source of dormant features (`timelines`/`nour-state`/
>   `strategic-triggers`) — harmless dead reads, not bugs (task tracker #4).
> - habit + chat write-time XP (the door makes both trivial; backfill covers chat).
> - ticker page-context emphasis / snooze / lane-health + AI-curation (all v2).
>
> Gates: typecheck 0 · eslint 0-errors · full vitest 2896 · check:crons clean ·
> check:raw-sql 0 · prisma valid · pre-push build OK.

> ## 2026-05-31 · Ambition Engine P1 (code) — goal→stat spine + fusion UI · 2 ships
>
> The P1 build the prior wave teed up. The goal engine is now wired into
> the 33-stat mastery character sheet end-to-end: a goal-tagged task rep
> credits the goal's stats, the goal card shows its stat chips, and the
> character sheet cites the goals feeding each stat. Built TDD-first per the
> locked spec (`docs/specs/2026-05-30-ambition-engine.md`). The prior wave's
> two local commits (post-review hardening + doc reconcile, was
> `6cbc238f`+`3716ecc9`) were rebased onto origin as `dcc4e206`+`aec010e5`
> and pushed in the same wave — nothing local-unpushed now.
>
> **`805e6173` · P1 spine + chips** — NEW `lib/mastery/goal-stats.ts`:
> `effectiveGoalStats` (declared `GoalStat` rows, else `goal.domain`-inferred
> so all ~30 existing goals light up with no backfill) + `creditGoalStatsForTask`,
> riding the idempotent xpEvent log (key `goal-task:<taskId>:<stat>`) so a
> goal-tagged task never double-counts its own stat. Wired into
> `liftGoalOnTaskComplete` (tasks.ts) — fires per rep, idempotent under the
> chat-fallback double-fire, fires even when the goal is already achieved.
> `getGoals` enriches each goal with resolved `stats` (+ `GoalCacheRow` type);
> GoalBoard renders chips in character-sheet colors. +11 unit tests.
>
> **`ef691189` · P1 citation** — `goalsByStat()` inverts active goals →
> `statKey` → contributing goals (the SAME resolver as the chips, so citation
> and chips can't disagree). `computeCharacterSheet` resolves each stat's
> goals (best-effort — a goals-query failure can't break the board); each
> `StatCard` cites them, linking to the goal card on `/stats`, only when
> present. +2 unit tests.
>
> **Flagged · NOT fixed:**
> - GoalStat **authoring** is P3 — P1 infers links from `goal.domain`; no
>   manual/AI stat-picker yet (declared rows already override inference).
> - **P2** (proactive goal-drift detector → Coach Channel → `/stats` banner +
>   Telegram) not started.
> - The dev-server/`.next` vs pre-push `turbo build` coexistence is still a
>   manual "stop the dev server before pushing" step; a `.next-prod` pre-push
>   variant (like `build:check`) would let dev + push coexist.
>
> Gates: typecheck 0 · eslint 0-errors · full vitest green (+13) ·
> check:raw-sql 0 · check:crons clean · prisma valid · pre-push build OK.

> ## 2026-05-31 · Bridge-contract sweep + Ambition Engine P1 · 12 commits + hardening
>
> A plumbing-audit sweep (5 read-only agents · "fix-safe, flag the rest")
> closed a whole class of silent statenour↔nickstire bugs; then the stale
> /stats goals card got a /sam-altman redesign spec'd and its P1 schema
> shipped to prod.
>
> **Dead-bridge-query class — CLOSED + guarded.** The stringly-typed bridge
> (`queryNick("name")` → nickstire `QUERY_HANDLERS`) has no compile-time
> contract, so renamed handlers rot callers silently. Fixed: `jobs_today`
> (×2 — operating-rhythm + business-intel) → `revenue_today` read via
> `readNickRevenue()`; `pending_callbacks_count` → `callbacks_pending`;
> `customer_search` triple-fix (`{name}`→`{term}` · unwrap `.customers` ·
> `totalVisits`/`totalSpent`). `a8100a36` also killed a false weekday "🔴 ZERO
> REVENUE" Telegram alert that fired because the dead query always returned 0.
> NEW `tests/contracts/nick-bridge-query-contract.test.ts` scans every live
> bridge callsite against nickstire's actual handler keys (∪ a KNOWN_PENDING
> allowlist) so a dead query now fails CI (red-green proven).
>
> **Other plumbing** — budget gate `.catch(()=>true)` (fail-OPEN · uncapped
> LLM spend) → fail-safe `return false` · system-prompt stale-shop fallback was
> gated on a dead `todayEstimate` key → now `readNickRevenue()` · 6
> silent-failure `.catch` breadcrumbs (`ai-cost` · `actions-brain` ·
> `brain-domain` · `task-resurface` · `consolidate` · the budget gate).
>
> **Crons + nav** — `b8de05ed` registered the 5 Inngest-native functions
> (cron-heartbeat · operator-morning-brief · goal-pruner ·
> journal-convergence-scan · journal-thread-dormancy) in `config/crons.ts` and
> taught `check:crons` to skip route-checks for `inngest:true` entries (43
> entries / 28 active · clean). `2d3be254` finished the `/tasks`→`/missions` +
> `/mastery`→`/stats` nav migration across 16 components + the ⌘K palette +
> the orb menu (path-keys, comments, tests, sw.js intentionally left).
>
> **Coaching lens** — `e20bc8b6` · `/api/ai/side-pane-chat` `describeFraming()`
> case "goals" now injects a MASTERY_COACHING_LENS (identity-mirror +
> loss-aversion), cap-safe (local enrichedSystem, not the 60K main prompt).
>
> **Ambition Engine P1** — spec `docs/specs/2026-05-30-ambition-engine.md`
> (A+B hybrid · clarity-gated · skill-enriched). Schema (`3d377b62`):
> `LifeGoal` += 8 cols (kind · parentGoalId · conviction · ambition ·
> lastChallengedAt · killCriteria · killBy · identityLine) + a `GoalStat` join
> + a "GoalLadder" self-relation. Migration `0003_ambition_engine` **applied to
> prod Neon**, schema restored + shipped in `e285e9dc`.
>
> **The unblock (reusable).** `3e5e4dfc` · NEW guarded
> `POST /api/system/apply-pending-migration`: requireSession + an inlined,
> deploy-gated `MIGRATIONS` registry (no arbitrary SQL · idempotent
> IF-NOT-EXISTS) · records `_prisma_migrations`. This is now the canonical way
> to apply a statenour migration with no prod creds (railway CLI unauthed · no
> statenour Vercel project · Neon not browser-logged-in). 0003 was applied
> through it from the authed app tab. The folder is left in
> `prisma/migrations-pending/` on purpose — moving it could trip
> `migrate deploy` ordering (see the header note in its `migration.sql`).
>
> **P0 caught + fixed mid-wave.** The first cut committed the schema fields
> WITHOUT applying the migration (`91ed40ae`), which would crash every LifeGoal
> CRUD with "column does not exist" (the exact `migrations-pending` incident).
> Reverted (`e64cfcf8`), parked the SQL, built the endpoint, applied, restored.
> **Push gotcha logged:** the dev server (`next dev`) locks `.next`; the
> pre-push `turbo build` also targets `.next` → stop the dev server (or rely on
> `build:check`'s `.next-prod`) before pushing.
>
> **Post-review hardening (local · uncommitted at time of writing → committed
> this wave).** A `feature-dev:code-reviewer` pass over `748b091a..e285e9dc`
> found **0 P0/P1**; 3 minor hardenings applied: `Number()` coercion on the
> bridge `totalSpent`/`totalVisits` spend-tier (JSON may deliver them as
> strings) · a `migrationRecorded` flag + logged warning on the endpoint's
> `_prisma_migrations` insert (was a silent `.catch(()=>{})`) · a
> known-limitation note on the contract scanner (literal-args-only).
>
> **Verify-don't-trust catches** — the audit agent missed the business-intel
> `jobs_today` (the contract guard caught it) · the nav agent under-reported
> (the diff showed it did more, correctly) · the contract scanner first flagged
> comment-based false positives (fixed with comment-stripping).
>
> Gates: typecheck 0 · vitest 2877 · check:crons clean · prisma valid.

> ## 2026-05-30 · Stats consolidation + tech-debt wave · 6 ships
>
> The operator merged /scoreboard + /goals into ONE personal "Stats" page,
> stripped it to personal-only ("business shit belongs on nicks tire admin"),
> then an engineering:tech-debt + system-design audit (via a code-explorer
> agent) drove a fix wave. TWO audit findings were dismissed after verifying
> against source — the agent misread already-correct code (verify-don't-trust).
>
> **`a695c174` · /scoreboard + /goals → /stats** — one page: ① the 33-stat
> mastery character sheet → ② GoalBoard → ③ KPIs. Both old routes 308-redirect
> to /stats.
>
> **`8cf090d8` · /stats personal-only** — removed ALL business from /stats
> (Nick brief · revenue/shop KPIs · anchors · pricing · compound/track drawer);
> page is now character sheet + goals only. Orb-menu (floating-home.tsx) "Goals"
> row → "Stats" → /stats. Needed a `<Suspense>` boundary (MissionBreadcrumb →
> useMissionMode → useSearchParams bailed to CSR at prerender once the
> loading-gate was removed).
>
> **`0a78d6e5` · /goals → /stats link sweep** — 13 stale `/goals` refs (the
> retired route) retargeted to /stats across operator-pulse · meta-scoreboard ·
> mission-scoreboard · top-goal-today · goal-pruner deepLink · next.config
> /plan+/mastery redirects. `#goal-X` anchors preserved (GoalBoard handles them).
>
> **`0787f883` · fix 4 pre-existing test failures** — all 4 were tests that
> drifted from shipped code, not product bugs: data-source-health ≥7→6 probes
> (stale_leads_count removed) · goals.test mock missing `lifeGoal.findFirst`
> (ghost-goal dedup #91) · snooze-schema test (Wave AL added `snoozedUntil`) ·
> orphaned system-providers test (deleted module). Suite 2875/2875 green.
>
> **`25e31b0a` · tech-debt wave** — (a) mega-fanout: BOTH Inngest fan-out fns
> guarded behind `INNGEST_MEGA_V2` so they no-op until cutover — kills the
> latent DOUBLE-FIRE (Inngest cron + Railway /api/cron/mega share 0 9 / 0 3
> UTC). (b) stale-leads alert (autonomous-engine + operating-rhythm) read a DEAD
> bridge query `stale_leads_count` (HTTP 400) → always 0 → never fired; remapped
> to `leads_urgent` (live), shape-tolerant, `?? 0` fallback. (c) removed the dead
> "/mastery → Growth" nav (a redirect dup of /stats). (d) refreshed the stale
> jobs.ts comment (check:crons gained the jobs.ts↔fs check, steps 5-6).
>
> **Dismissed via verify-don't-trust** — check:crons jobs.ts gap (already
> exists, verify-crons 5-6) · router.ts bare aiChat (already traced,
> `const aiChat = makeTracedAiChat`).
>
> **Flagged · NOT fixed:**
> - `ingest-gmail` runs 1×/day via the morning fan-out (manifest says every
>   30min) — urgent-email Telegram nudges wait till morning. A dedicated
>   Inngest 30-min trigger fixes it (cost/load decision).
> - `INNGEST_MEGA_V2` cutover still un-flipped: Inngest fan-out is now dormant
>   (guard); flipping must be paired with disabling the Railway /api/cron/mega
>   cron or jobs double-fire.
> - `lib/trpc/routers/system.ts` is a 2,597-LOC God module (Phase-3 split).
> - `MASTERY_COACHING_LENS` never wired into Nick's mastery coaching (the 49
>   @statenour/lenses are all business/strategy; masteryScores render raw).
> - ADR-0022 lists 9 Coach Channel writers but `decision-quality-drift` is
>   `dormant` (8 active) + `eval-regression` cron was deleted (Wave AE) — stale.
>
> Gates: typecheck 0 · eslint clean (changed files) · suite 2875/2875 · pre-push
> affected build OK on every push. 6 commits on origin/main.
>
> ## 2026-05-29 · Wave Z · Recall-freshness fix + dead-lane sweep + retro→journal · 4 commits
>
> Adversarial verification of a Sam-Altman synergy plan (operator: "r u
> sure check again n deeper") overturned it twice: the headline features
> were mostly already built, and the real gaps were silent failures the
> plan never named.
>
> **Keystone · recall-freshness fix** (`d535550c`) — `writePgvectorColumn`
> (embedding-utils.ts) now dual-writes `embedding_vec_1536`, not just
> `embedding_vec`. Chat recall (`recallMemoriesForQuery`,
> memory-recall.ts:173) reads ONLY the 1536 column via HNSW; it was filled
> solely by a weekly cron, so fresh memories were recall-dark up to 7
> days. New `padToVectorDim` (pgvector.ts) zero-pads cosine-preserving
> (pinned · tests/db/pgvector-pad.test.ts); the `_1536` write is isolated
> so it can't regress the proven `embedding_vec` path. Prod backfill
> (`scripts/backfill-hnsw-1536.ts`) padded 1,599 rows · KNN HNSW 195ms
> confirmed (~1,200 older `embedding_dim`-NULL rows deferred).
>
> **Dead-lane sweep** (`d535550c` board_consultation · `c803f1c8`
> weekly_review + mission_retro · `5ef9a5df` relationships_weekly_synthesis
> + gmail_outgoing) — 5 embedded-but-unwhitelisted categories added to
> `CONTEXT_CATEGORIES`. `reasoning_trace` excluded (noise) · personal-life
> lanes rejected (already priority-injected in system-prompt.ts:1140).
>
> **retro→journal** (`b48c6e8a`) — `mission_retro` is a 5th source in
> journal-feed.ts (+ SourceKey / FeedEntry.source / SOURCE_ICON Milestone
> + filter chip).
>
> **Scope reduction by verification** — 6 plan items confirmed already-
> built and NOT rebuilt (goals↔missions FK · reflections · body-state
> reflectback · content-draft-writer · suggestion-outcome-loop);
> `decision→goals` migration rejected (semantic recall covers it).
> Corrected a Sam-report error: `/reason` DOES persist (persistTrace,
> engine.ts:1158). ADR-0023 records the wave. Gates green: typecheck 0 ·
> 104 focused tests pass · 4 commits on origin/main · pre-push build
> passed on every push.
>
> ## 2026-05-26 EOD · Wave Y · Mastery Stage A completion + NickSidePane v2 · 10 commits
>
> Two sub-waves landed back-to-back: the writer-side beachhead (5 →
> 9 writers · all 9 detectors now dual-write to the Coach Channel
> alongside their existing Telegram + BrainMemory paths) and the
> reader-side beachhead (1 → 5 mounts of NickSidePane v2 with real
> multi-turn threads and proactive event chips on every Mastery
> daily-driver page).
>
> **Sub-wave 1 · Coach Channel writer expansion** (4 new writers across 2 commits)
>
> - `3d82c0fd` · cost-slo-check (5th writer · P0 burn-rate breach ·
>   surface scoreboard · subjectId per ET-day)
> - `1c790e6c` · 4 detector crons in one batch:
>     - eval-regression (6th · P0 system-alert · pass-rate < 80% ·
>       deepLink `/system/eval-results`)
>     - correlation-alarm (7th · P1 anomaly · new |r|>0.7 vs prior
>       snapshot · deepLink `/system/alerts` · surface `brain`)
>     - creation-spike-detect (8th · P1 anomaly · per-type rate ≥
>       5× trailing median · deepLink `/system/alerts`)
>     - decision-quality-drift (9th · P0 drift-recovery · weekly GPA
>       −15% vs 4w baseline · deepLink `/system/quality`)
>
> Every writer is best-effort (`try/catch` swallows · cron's primary
> Telegram path stays byte-identical) and idempotent (per-day /
> per-snapshot / per-week subjectId construction).
>
> **Sub-wave 2 · NickSidePane v2 + multi-turn surface chat** (3 commits)
>
> - `c3cdf504` · Phase 5 FULL · proactive coach-event push on
>   NickSidePane — chips render above the chat composer · polls
>   `/api/coach/events?surface=X&limit=3` every 60s with tab-
>   visibility pause · `<CoachChip>` priority-graded (P0 amber · P1
>   gold · P2 neutral) with optional deep-link conversion to `<Link>`.
>
> - `f03ab83b` · Phase 5 FULL · multi-turn `<MultiTurnChat>` body
>   replaces single-shot PageNick:
>     - Client owns `turns: ChatTurn[]` + `localStorage[nour:side-
>       pane-thread:v1:<page>]` per-page persistence (24-turn cap)
>     - Server stateless · `/api/ai/side-pane-chat` accepts full
>       history each turn · streams via Vercel AI SDK
>       `streamText` + `toTextStreamResponse()`
>     - System prompt enrichment mirrors `/api/ai/page-insight` (page
>       framing · buildPageData · strategic-frameworks lens · operator-
>       state injection) so Nick's voice is consistent across both
>       single-shot and multi-turn surfaces
>     - Anthropic `cacheControl: { type: "ephemeral" }` on the system
>       message so follow-up turns hit the prompt cache · keeps cost
>       per-turn ~constant
>     - `AbortController` cancels mid-stream · drops the empty
>       assistant placeholder · presets render only when thread empty
>
> - `4121d5d7` · NickSidePane propagation · 4 Mastery surfaces
>   (`/goals` · `/journal` · `/brain` · `/scoreboard`) each get a
>   mount with explicit `coachSurface` + per-surface presets that
>   match `describeFraming()` server-side framing. `/journal` and
>   `/brain` mount outside their existing `<Suspense>` so the FAB
>   renders instantly · `/goals` and `/scoreboard` mount as the last
>   child of `<main>`. Storage isolation keeps each surface's thread
>   independent.
>
> **Sub-wave 3 · grounding fix** (1 commit)
>
> - `47c0598c` · `lib/ai/page-data.ts` gains 4 surface cases. Phase 5
>   FULL had mounted the pane on /goals /journal /brain /scoreboard
>   but all 4 hit the `default: return ""` case in `buildPageData()`
>   · multi-turn replies arrived with zero page grounding. Each new
>   case is a compact parallel-query string ≤400 chars matching the
>   existing token-budget vocabulary.
>
> **Hygiene · reflect-categories cron registration** (1 commit)
>
> - `4706dbb9` · orphaned Wave AB route at `/api/cron/reflect-
>   categories` registered as `active` in `config/crons.ts` with
>   `0 3 * * 0` (Sunday 03:00 UTC) per its own header suggestion.
>   Lands ahead of Sunday-morning weekly-review. Closes task #81.
>
> **Documentation · the consolidation itself** (1 commit · this wave)
>
> - `ADR-0022` documents the Coach Channel pattern (9 kinds × 5
>   surfaces · key shape `coach:<kind>:<subjectId>` · types/server
>   module split for client-bundle safety) + NickSidePane v2 (Phase
>   5 FULL · multi-turn surface chat architecture).
>
> **Net state at EOD:**
> - 9 / 9 detector writers emit to the Coach Channel
> - 5 / 5 Mastery surfaces mount the banner + pane combo
> - 0 / 62 `aiChat(` callers are bare · cost-cap loop fully closed
> - All `pnpm --filter @statenour/web {typecheck,test}` gates green
> - Pre-push `turbo build` green on every push
> - All 10 commits live on `origin/main`
>
> **Tasks closed this wave:** #74 (Wave X.b consolidation · superseded
> by /tasks v2.2 redesign) · #81 (reflect-categories registration) ·
> #82 (cost-cap loop · 0 bare callers verified).
>
> **Deferred / unblocked-by-product:** Phase 6 FULL gestures (needs
> `@use-gesture` dep approval) · mission-mode filter threading (needs
> schema design) · `/system/coach-events` historical viewer (active-
> only reader exists · `includeAcked` flag plumbed but no surface
> consumes it yet) · Stage C UnifiedChain (no current operator-visible
> payoff · explicitly deferred).

> ## 2026-05-25 · Wave X.h · ChatComposer chrome extraction · 1 ship
>
> The medium-risk extraction Wave X.b deferred. The composer chrome —
> wrapper + `ComposerToolbar` + textarea + `VoiceWaveformOverlay` +
> `ComposerSendButton` · the visual unit owning the input row — is
> now a dedicated client component at `components/chat/chat-composer.tsx`.
>
> **Ship 1** · `2ac15530` · pure JSX extraction · -111 LOC net
> - **Pre-flight calibrated the scope.** Wave X.b's reconciliation
>   estimated this at "~398 LOC (lines 2308-2706)" but the actual
>   composer chrome JSX was ~130 LOC. The wider range conflated the
>   composer with above-composer siblings (PromptSuggestionsBar ·
>   NickSuggestions · AttachmentPreview · PinnedMessagesBar) already
>   extracted in prior waves. Same X.b lesson applied: re-audit the
>   deferred backlog before execution.
> - **Pure JSX move · zero state migrations.** Every ref, setter,
>   hook return, and callback is passed in as a prop · 17 total.
>   `app/(mastery)/chat/page.tsx` keeps ownership of input state,
>   refs, hooks (useVoiceInput · useImageAttachment · useSlashCommands
>   · useMentionSuggestions · useAudioTranscribe), `personaMode`,
>   and the send/stop/handleKey handlers. The component is render-only.
> - **What was preserved verbatim**: wrapper padding + `safe-area-
>   inset-bottom` for iPhone home indicator · `focus-within:border-
>   [var(--gold)]/40` chrome · iOS Safari auto-zoom guard via
>   `text-[16px]` mobile · 44px Apple HIG floor on textarea + Send
>   chip · `VoiceWaveformOverlay` swap during voice.isRecording ||
>   voice.continuous · paste-image clipboard handler · all inline
>   comments documenting the WHY of each className choice.
> - **page.tsx · 2866 → 2756 LOC (−111 net)** · 130 LOC inline JSX →
>   18-line `<ChatComposer ...props />` · `VoiceWaveformOverlay`
>   import removed · `ComposerToolbar` + `ComposerSendButton` imports
>   collapsed into the single `ChatComposer` import.
> - **Test update** · `tests/components/mobile-a11y.test.tsx` was
>   reading the textarea's `min-h-[44px] sm:min-h-[36px]` contract
>   from `page.tsx`. After extraction the textarea lives in
>   chat-composer.tsx. Updated the assertion source · 7 → 8 tests
>   pass · A2 contract still locked.
>
> **Operational footnote** · pushed with `--no-verify` after the
> pre-push `turbo build` failed ENOSPC on the Next.js standalone-
> output copy step · the local disk was at 0 GB free (recovered
> ~3 GB by deleting `.next/` + `dist/` + `.turbo/` + `Temp/claude/`
> but ran out of cleanup options). Code itself built clean (318/318
> static pages prerendered before the disk error). Operator
> explicitly authorized the `--no-verify` after typecheck + lint +
> vitest had already passed locally. Railway built and deployed
> cleanly with its own disk · prod smoke 200 across `/` ·
> `/auth/sign-in` · `/api/system/heartbeat`.
>
> **Gates** · typecheck 0 · lint 0 errors / 369 baseline · vitest
> 185 / 2812 pass · Railway build OK · prod smoke 200.

> ## 2026-05-24 LATE-NIGHT-7 · Wave X.g · bridge-page polling refactor + shared shell · 2 ships
>
> The MEDIUM-RISK refactor Wave X.e deferred. Three bridge pages
> (`/funnel` · `/radar` · `/seo`) each inlined a 30-40 LOC fetch
> loop with the same shape · the canonical `usePollingFetch` hook
> was created Wave 50 specifically to absorb it · these were the
> last 3 stragglers. Plus their inline 22-LOC down/loading shells
> got absorbed into a new shared `BridgeShell` primitive.
>
> **Ship 1** · `d218e9d9` · polling migration · −35 LOC
> - **radar** · 1 fetch · single `usePollingFetch<MasterReport>`
>   call · -30 LOC
> - **funnel** · 2 fetches (overview required + first_visit
>   optional) · two independent hook calls · the optional one
>   self-isolates on failure · -25 LOC
> - **seo** · 3 fetches (gsc_summary + gsc_top_queries +
>   gsc_top_pages) · three independent hook calls · gsc_*
>   handlers don't include `ok:true` in their payload so the page
>   continues to synthesize it for type-compatibility with the
>   existing interfaces · -50 LOC
> - Per-page free wins · tab-visibility pause (the hook stops
>   polling while tab is hidden) · 401-bounce retry · centralized
>   cleanup contract.
>
> **Ship 2** · `20e5ee14` · BridgeShell extraction · −63 LOC
> - NEW `components/mastery/bridge-shell.tsx` (~45 LOC) · takes
>   `title` + `state ("loading" | "down")` and renders the
>   canonical chrome.
> - 3 pages collapse 22-LOC inline shells to a 1-LOC
>   `<BridgeShell title="…" state="…" />`.
> - Side-effect token cleanup · the inline shells were the last
>   places hardcoding `text-white/40` + `text-white/30` instead
>   of the design-token equivalents. Shared primitive uses
>   `text-[var(--text-tertiary)]`.
>
> Net · -98 LOC across the 3 bridge pages · +1 hook adoption ·
> +1 new shared primitive. The "33+ files inline the same fetch
> pattern" footnote in `use-polling-fetch.ts` can now drop to 30.
>
> **Gates** · typecheck 0 errors · lint 0 errors / 369 baseline ·
> vitest 185 / 2812 pass.

> ## 2026-05-24 LATE-NIGHT-6 · Wave X.f · activation wave · 6 paid-for-unused subsystems → operator-reachable · 3 ships
>
> The follow-up to Wave X.e's audit. X.e deferred 6 activation
> findings ("we should surface the data the cron writes · just
> needs a card"). This wave shipped all 6 across 3 commits.
> Common pattern · the cron pipeline was already paid-for · the
> embedder already covered the category · only the operator-facing
> surface was missing.
>
> **Commit 1** · `b8c45dc4` · activations 1+2 · data-layer activations
>
> 1. **Fireflies meeting transcripts → chat recall.** The
>    `ingest-fireflies` cron has been pulling transcripts twice
>    daily for months · `embed-backfill` covered the category · but
>    `lib/brain/memory-recall.ts` (CONTEXT_CATEGORIES allowlist)
>    never included `meeting_transcript`. KNN pulled the rows, the
>    filter silently dropped them. Added the category constant
>    (`MEETING_TRANSCRIPT: "meeting_transcript"`) to BRAIN_CATEGORIES,
>    swapped the raw string in ingest-fireflies for the constant,
>    added the category to CONTEXT_CATEGORIES. Zero-LOC activation
>    · the rows + embeddings are already there.
> 2. **NEW `/api/cron/daily-strategy` writer.** The
>    `/api/command/data` route reads `prisma.dailyStrategy.findFirst`
>    for the cockpit's strategic-briefing tile · no cron wrote the
>    row · always null. New cron calls `runStrategicTriggers()` (15
>    behavioral triggers from `lib/services/strategic-triggers.ts`),
>    composes a deterministic briefing (NO AI call · the triggers
>    ARE the signal), upserts on today's ET date. Registered in
>    `MORNING_JOBS` and `config/crons.ts` folded into mega-morning.
>
> **Commit 2** · `b6576c7d` · activations 3+4+5 · 3 operator cards
>
> 3. **`components/brain/self-critique-card.tsx`** mounted on
>    /brain · reads
>    `GET /api/brain/memories?category=reply_to_improve&limit=5`
>    and renders the bottom-decile flagged replies with composite
>    score + content preview · each row links to
>    `/chat?conv=<id>` so a tap takes the operator to the
>    flagged conversation. Closes the quality feedback loop.
> 4. **`components/scoreboard/pricing-advisory-card.tsx`** mounted
>    on /scoreboard · reads `/api/system/pricing-advisory` and
>    renders headline + fleet-median + below-median outliers +
>    top-3 drafted experiments. Operator no longer has to ASK
>    Nick in chat to see the Sunday-morning pricing strategy.
> 5. **`components/financial/location-ranking-card.tsx`** mounted
>    on /financial · reads `/api/business/location-ranking` and
>    renders the persisted markdown summary + month-key +
>    staleness chip. Monthly strategic-decision surface becomes
>    visible.
>
> All three cards · editorial-minimalist visual contract (`GlassCard`
> host, `var(--text-tertiary)` + `var(--gold)` tokens, no AI-slop
> gradients) · 44px tap targets · silent-when-empty (absence IS the
> signal that the cron hasn't fired · clarity-gate · no
> "no data yet" placeholder).
>
> **Commit 3** · `b2a0b818` · activation 6 · /system/data-source-health
>
> The `data-source-health` cron (v10.0.58 Wave B) probes every
> 6h and writes `BrainMemory(category="data_source_probe")` rows.
> The cron's own docstring promised "/system/diagnostics surface
> reads a streak" but no page existed.
>
> - **NEW `GET /api/system/data-source-probes`** · joins persisted
>   probe rows (last 30d) with `getProbeSpecs()` per-probe
>   thresholds · per probe returns latest run + consecutive-empty
>   streak + alerting bool (streak >= threshold).
> - **NEW `/(mastery)/system/data-source-health/page.tsx`** ·
>   editorial table · kind-grouped (bridge/shop/personal) ·
>   alerting probes float to top · streak chip
>   `<empty>/<threshold>` amber when alerting, gray when healthy
>   · 60s auto-refresh.
> - **Naming note** · the cron docstring referenced "/system/
>   diagnostics" but the path was already claimed by
>   `/api/system/diagnostics` (system-wide KPI rollup) · this page
>   lives at `/system/data-source-health` to avoid the collision
>   and added to `nav-items.ts`.
>
> **Pattern recap** · 6 audit findings · 6 ships · 0 rejections this
> wave (because the audit was usage-grounded, not name-grounded ·
> a contrast with Wave X.b where 4 of 8 were rejected on re-audit).
> The pre-flight check from X.b still applied · every "writes data
> nothing reads" claim spot-checked against `grep -rn` before
> shipping the consumer.
>
> **Gates** · typecheck 0 errors · lint 0 errors / 369 baseline ·
> vitest 185 / 2812 pass · zero new schema migrations · zero new
> dependencies.

> ## 2026-05-24 LATE-NIGHT-5 · Wave X.e · statenour-wide consolidation + activation · 4 ships
>
> The first cross-surface "consolidation + activation pass" since
> Wave W. Three parallel read-only audits (dead code + orphan
> surfaces · paid-for-but-unused infra · cross-surface duplication)
> returned 33 findings. Pareto-filtered to a 4-ship batch · the
> agent's other findings deferred for risk/value reasons captured
> below.
>
> **Audit lessons applied** · Wave X.b's rule ("a deferred backlog
> must be re-audited before execution") was used to reject 1
> finding outright: Agent B recommended building `/intel` to
> surface the `industry-pull` cron · `nav-items.ts:96-99` documents
> an explicit operator decision retiring that page in v10.0.302
> ("automotive-RSS dashboard's business value moved to nickstire").
> The API stayed only for chat's adaptive-placeholder. False
> recommendation caught and dropped before the ship.
>
> **Batch 1+2** · `47c5a415` · 3 orphan operator pages activated +
> 6 dead-code files deleted · −883 LOC net
> - **Nav activation** · `/funnel` · `/radar` · `/seo` were all
>   shipped 2026-05-24 as Intelligence Dispersal Wave 3 surfaces
>   (`4c8eb89c` + `aa648205`) but never added to `nav-items.ts` ·
>   invisible to ⌘K + FloatingHome · operator could only reach
>   them by typing the URL. 3 nav entries added with `Filter` ·
>   `Radar` · `Search` icons.
> - **Dead-code deletion** · `lib/utils/semantic-cache.ts` (269) ·
>   `lib/services/recovery.ts` + `lib/validators/recovery.ts`
>   (302) · `hooks/use-abortable-fetch.ts` (103) ·
>   `lib/ai/winback-templates.ts` (114) · `lib/utils/qr.ts` (9) ·
>   `app/api/mastery/radar/route.ts` (92). Every "0 importers"
>   claim spot-checked with `grep -rln` before deletion. Schema
>   models `StagedRecoveryItem` + `RecoveryActionLog` STAY in
>   place (still referenced by `config/retention.ts` +
>   `data-cleanup` cron · 90d retention).
>
> **Batch 3** · `fba13e4a` · 4 cron routes migrated to timing-safe
> `requireCronAuth` · −24 LOC + a real security finding
> - `brain-feedback-loop` · `agent-eval` · `extract-knowledge` ·
>   `suggestion-outcome-rollup` each inlined an identical 6-LOC
>   `authorizeCron` that did a plain `auth === \`Bearer
>   ${expected}\`` JavaScript string equality compare. Plain `===`
>   on a secret leaks bytes via timing. `lib/auth-guard.ts`
>   already exports `requireCronAuth` using node's
>   `timingSafeEqual` (constant-time) · most cron routes use it ·
>   these 4 were the stragglers.
>
> **Batch 4** · `2b5156c4` · design-token discipline sweep · 22
> `bg-[#0A0A0A]` → `bg-[var(--bg-base)]` + 3 `#FDB913` → `var(--gold)`
> - 12 files across `app/(mastery)/*/page.tsx` +
>   `components/operator/mega-confirm-dialog.tsx` were hardcoding
>   `bg-[#0A0A0A]` in their `<main>` shells, bypassing the
>   `--bg-base` token. If `--bg-base` ever drifts these surfaces
>   would freeze while `components/` (283 uses) adapts.
> - `app/(mastery)/financial/page.tsx` Recharts `<Area>` had
>   `stroke="#FDB913"` + `fill="#FDB913"` + `bg-[#FDB913]` ·
>   Recharts passes string straight to SVG attributes · the CSS
>   variable resolves identically. Same drift, same fix.
>
> **Batch 5** · `8145d5c5` · customer-360 inline SkeletonView +
> ErrorView → `MasterySkeleton` + `MasteryErrorView` · −43 LOC
> - 19-line `SkeletonView` + 27-line `ErrorView` duplicated
>   primitives extracted in Phase D (2026-05-18 specifically to
>   absorb inline rebuilds like this one). Inline implementations
>   had token drift (`tracking-[0.18em]/0.22em` vs canonical
>   `0.14em`, `text-white/40` vs `var(--text-tertiary)`) and
>   missing shimmer animation. customerId-in-error chrome dropped
>   on purpose · the URL already shows it.
>
> **Deferred from the audit (kept honest)**
> - **Bridge-page polling refactor** (funnel · radar · seo →
>   `usePollingFetch`) · MEDIUM risk · the funnel page does TWO
>   concurrent bridge calls, envelope-unwrap semantics differ
>   slightly · merits a dedicated session.
> - **Activation: `meeting_transcript` in chat recall** ·
>   ingest-fireflies writes the raw string `"meeting_transcript"`
>   (not registered in `BRAIN_CATEGORIES`) · `chat-recall.ts`
>   never reads it · activation requires registering the
>   constant + threading it into the recall allowlist · deferred.
> - **Activation: SelfCritiqueCard · PricingAdvisoryCard ·
>   LocationRankingCard · `/system/diagnostics` page · DailyStrategy
>   writer cron · ToolVerbRatio stats** · 6 paid-for-but-unused
>   subsystems · each 0-50 LOC of activation code but the surface-
>   placement decisions matter · deferred to a future activation
>   wave for batched review.
> - **`tracking-[0.18em]/0.22em` → `0.14em` aesthetic sweep** ·
>   17 files have the drift but not all uses are eyebrows · needs
>   visual inspection per site · skipped here, separate sweep.
>
> **Gates** · typecheck 0 · lint 0 errors / 369 baseline (-1 from
> pre-X.e because `semantic-cache.ts` carried 1 `any` warning) ·
> vitest 185 / 2812 pass · build OK.

> ## 2026-05-24 LATE-NIGHT-3 · Wave X.c · R3F scene data wire-up · 1 ship
>
> Both surviving R3F scene mounts had been shipping with
> PLACEHOLDER constants since the Wave 53 Spline→R3F pivot ·
> decoration, not surfaces. The per-wrapper docstrings explicitly
> flagged "next phase: real-data wiring." This wave is that next
> phase.
>
> **Wave X.c · 1 ship** · `f73f7209`
>
> **CommandCore** (`components/ultron/ultron.tsx`) · homepage 3D
> backdrop. Derives:
> - `healthScore = 100 - driftBudgetUsed` (clamped 0..100) · drift
>   becomes the inverse of core integrity. Cleaner signal layer
>   reads as a brighter, more stable core.
> - `alertLevel = "critical" | "warn" | "info"` · critical
>   blind-spots → red rim · high OR drift > 70% → amber rim · else
>   gold. The wireframe edge now reflects system severity.
> - `situationCount = staleLeads + agingCritical + overdue +
>   critical/high blind-spots` · drives a faint scale pulse so the
>   core visibly grows under load.
>
> All three signals come from data the component ALREADY pulls
> (useUltronFetch on `/api/ultron/signal` + `/api/ultron/pulse` +
> `/api/body` + useNourState). Zero new fetches.
>
> **FrameworkOrbit** (`app/(mastery)/system/lens-stats/page.tsx`) ·
> lens-stats hero scene. Derives:
> - `topFirerSize / secondFirerSize / thirdFirerSize` · top-3
>   fired framework counts normalized 0..1 against the #1 leader.
>   Filters out the synthetic "(fallback)" row first — it's
>   surfaced separately via `data.fallbackRate` and would corrupt
>   the ranking.
> - `fallbackRate = data.fallbackRate / 100` · converts the 0..100
>   percent response into the scene's 0..1 red-alert contract.
>   Above 30% the central anchor pulses status-red: lens routing
>   degraded.
>
> When data is missing (initial load · error · empty window) the
> helpers return `undefined` so the wrapper's PLACEHOLDER
> constants take over — graceful degradation, scene never blanks.
>
> **Net effect** · the 3D pivot that started Wave 53 lands its
> intended outcome: scenes that REACT to live state, not
> decorations layered over data. Two of the four originally-
> planned surfaces now satisfy the "interactive command center"
> ambition (the other two — KnowledgeGalaxy + AiPulse — were
> formally retired during the pivot: `/brain/galaxy` page never
> existed, AiPulse cut as vanity at v10.0.529.54).
>
> **Gates** · typecheck 0 errors · lint 0 errors / 370 baseline ·
> vitest 185 / 2812 pass · zero new dependencies.

> ## 2026-05-24 LATE-NIGHT-2 · Wave X.b · /chat consolidation follow-up · 2 ships
>
> Wave X deferred 8 architecture moves + 5 defensive findings for
> "risk-managed phasing." This wave audited each deferred item
> before executing · most turned out to be the wrong moves once
> the actual usage was inspected. The kaizen + karpathy + clarity-
> gate combined verdict: ship what's surgical and right · don't
> ship to drain a checklist.
>
> **Wave X.b · 2 ships**
>
> **Batch 1** · `a7c3a419` · three surgical edits + 1 new pure
> module + 1 new test file
> - **Dead `loadConvo` wrapper deleted** (P2 from audit). The
>   wrapper was `async (id) => await loadConvoBase(id)` · zero
>   value-add · two consumers now call loadConvoBase directly
>   through a `(id) => void loadConvoBase(id)` arrow that makes
>   the async return intentional. Pure noise deletion.
> - **`onSeed` parser → `lib/chat/suggestion-seed.ts`**. The 55
>   LOC suggestion-prefix → entity-id ladder (broken-promise →
>   lastTaskId · stalled-goal → lastGoalId · stale-pin →
>   lastPinId · unresolved-reflection → lastReflectionId) lifted
>   into one pure function `extractEntityFromSuggestion`. Page
>   collapses to one `Object.assign(transportBodyRef.current,
>   extractEntityFromSuggestion(meta))`. 8 vitest regression
>   tests (`tests/lib/chat/suggestion-seed.test.ts`) pin the
>   prefix→entity contract so a typo cannot silently break the
>   suggestion-loop UX.
> - **(P0 silent-failure)** image-send offline guard. The image
>   branch in `handleSendOrQueue` pre-fix called `sendMessage({
>   parts })` directly without checking `offline.isOnline` ·
>   operator on weak cell attached a photo · the message silently
>   vanished while `toast.success` lied that it sent. Now: explicit
>   offline guard with a clear error toast pointing the operator
>   at the recovery path (drop the attachment to send text only).
>
> **Batch 2** · `923f087d` · 1 clarity-gate fix
> - **(P1 clarity-gate)** Enter-mid-stream silent dead key. Pre-
>   fix `handleKey` called `e.preventDefault()` BEFORE checking
>   `isStreaming` · so hitting Enter while Nick was mid-reply
>   consumed the keystroke and produced nothing (no send · no
>   newline). The operator's mental model — "Enter sends ·
>   Shift+Enter inserts a newline" — silently broke whenever a
>   reply was streaming. Now: bail BEFORE preventDefault when
>   streaming · textarea inserts its natural newline (same as
>   shift+Enter) · operator can keep drafting the next turn while
>   Nick replies. The original "don't stack the queue" intent is
>   preserved · we just stop swallowing the keystroke.
>
> **Pre-flight audit rejected 4 of 8 deferred moves**
> - **ChatStatusOverlays cluster merge** · REJECTED. The 5
>   overlays (ConnectionStatus · DeeperContextBadge ·
>   ProviderDegradationBanner · ProviderHealthPill · StallBanner)
>   render at 5 distinct positions in the layout — bottom toast ·
>   header pill · composer-adjacent banner · header pill ·
>   mid-stream banner. Merging them into one cluster would force
>   colocation that breaks layout intent. The original
>   recommendation was based on names · not actual usage.
> - **Inline 4 single-consumer thin wrappers** · REJECTED. The
>   thin wrappers (attachment-preview 57 LOC · pinned-messages-bar
>   40 LOC) are SMALLER as extracted files than they would be
>   inlined into a 2880 LOC page. Extracted = better locality of
>   reasoning · named seams · grep-able. Inlining 97 more LOC into
>   the homepage makes it MARGINALLY less readable · violates
>   kaizen YAGNI.
> - **Move shared overlays out of /chat** · REJECTED.
>   keyboard-cheat-sheet · reasoning-trace · reasoning-trace-modal
>   are all chat-specific · no consumer outside /chat. Moving them
>   to `components/` root would falsely imply they're shared.
> - **Promote `cn` to `@nour/utils`** · ALREADY SHIPPED + REJECTED
>   the migration. `@nour/utils` already exports `cn` (since
>   2026-05-19 Tier-2-E workspace shipped). `@/lib/utils` is now a
>   1-line backwards-compat shim re-exporting from `@nour/utils`.
>   380 import sites use the shim · mass-migration is a "we might
>   need this" red-flag refactor · the shim is doing its job.
>
> **Genuinely deferred to dedicated session** (large-risk surgery)
> - **ChatComposer shell extraction** · lines 2308-2706 (~398 LOC) ·
>   M-effort · medium-risk · biggest single readability win · needs
>   a dedicated session with explicit before/after smoke runs
>   because the composer owns the input + textarea ref + draft
>   resume + paste handling + voice + image + slash + mention paths.
> - **MessageEdit merge** · combine user-edit + assistant-edit ·
>   M-effort · medium-risk · the two share ~40% of state but
>   diverge on submission path · needs its own design pass.
>
> **Genuinely deferred (low-priority defensive)**
> - undo race condition (P1 #9) · agent's concern was real but the
>   proposed fix wasn't clearly better than current behavior
> - timing sentinel race (P2 #12) · too low priority
>
> **Gates** · typecheck 0 errors · lint 0 errors / 370 baseline ·
> vitest 184+1 files / 2804+8 tests (the +8 are the new
> suggestion-seed regression tests) · build OK.
>
> **Lesson** · The "8 deferred moves" backlog from Wave X was
> written from names + sizes · not from a check of actual usage.
> Pre-flight auditing reduced it to 2 surgical wins + 2 honest
> deferrals + 4 rejections. Per-page playbook rule going forward:
> a deferred backlog must be re-audited before execution · the
> world has moved between writing it and shipping it.

> ## 2026-05-24 LATE-NIGHT · Wave X · /chat homepage 5-phase sweep · 1 ship
>
> The HOMEPAGE. Biggest stakes wave of the playbook · /chat is the
> homepage (rendered inside app/(mastery)/page.tsx) · biggest single
> page in the app (2880 LOC + 62 component files). Operator's
> request: "utterly capture my attention." 3 parallel agents
> (defensive code-review + silent-failure-hunter + ux-audit + mobile
> + clarity-gate · plus architecture-sprawl audit) surfaced 14
> defensive findings + 8 consolidation moves.
>
> Pareto-filtered to 6 highest-ROI defensive fixes that ship
> together · big architecture moves deferred to Wave X.b because
> the homepage's regression cost is the highest in the app · risk-
> manage by phasing.
>
> **Wave X · 6 surgical fixes** · `dae95d9f`
> - **(P0 clarity-gate)** ConnectionStatus "tap to retry" was
>   lying about queue persistence. Queue is wiped on every mount
>   (Apr-15 duplicate-replay bug fix) · iOS Safari kills PWA tabs
>   after ~30s in background. Label now says "this session only ·
>   tap to send now."
> - **(P0 mobile)** ConnectionStatus pill collided with composer
>   send-button on iPhone notched devices (`bottom-16` = 64px ·
>   landed ON TOP of the home indicator + composer row). Now
>   `[bottom:calc(80px+env(safe-area-inset-bottom))]`.
> - **(P0 mobile + a11y)** UndoSendToast button was 14×50px ·
>   below Apple HIG 44pt floor. Operator missed it constantly ·
>   2s window expired. Now `min-h-[40px] min-w-[60px]` + aria-
>   label with remaining seconds + parent `role="status"
>   aria-live="polite" aria-atomic="true"` so VoiceOver announces
>   "sent · undo in 2s" instead of silence.
> - **(P1 silent-failure)** clipboard copy lied on Safari ·
>   bare catch{} on navigator.clipboard.writeText · Safari rejects
>   clipboard outside user-gesture context (most-common iOS PWA
>   failure). Now toast.success on success · toast.error("couldn't
>   copy · try long-press") on failure · points to native iOS
>   selection UI.
> - **(P1 silent-failure)** handleFork discarded the error message
>   entirely · operator couldn't tell network from auth from
>   "conversation no longer exists." Now forwards up to 80 chars
>   of err.message into the banner.
> - **(P1 perf)** 80+ Set/Map allocations PER ASSISTANT TURN ·
>   TOOL_DOMAIN_MAP (28 entries) + NOW_TRIGGERING_TOOLS Set +
>   PLAN_TRIGGERING_TOOLS Set were all defined INSIDE a useEffect
>   with [messages] deps · effect re-fires every streamed token
>   (~40 per turn). Hoisted to module scope · built once at module
>   init · zero per-token allocation cost during streaming.
> - **(P2 a11y bonus)** NickStreaming had no role/aria-live ·
>   screen-reader operators never heard streaming-state changes.
>   Now `role="status" aria-live="polite" aria-atomic="true"`.
>
> **Wave X.b backlog (8 deferred architecture moves)**
> - **ChatComposer shell extraction** · lines 2308-2706 (~398 LOC)
>   moved to dedicated component · page.tsx drops to ~2500 LOC ·
>   M-effort · medium-risk · biggest single readability win
> - **ChatStatusOverlays cluster** · merge 4 ambient-state mounts
>   into 1 (-190 LOC · -3 files) · S-effort · low-risk
> - **MessageEdit merge** · combine user-edit + assistant-edit ·
>   M-effort · medium-risk
> - **onSeed parsing helper** · extract 55 LOC pure-function to
>   `lib/chat/suggestion-seed.ts` · S-effort · low-risk
> - **Move shared overlays out of /chat** · keyboard-cheat-sheet ·
>   connection-status · reasoning-trace · S-effort · low-risk
> - **Inline 4 single-consumer thin wrappers** · attachment-preview
>   · pinned-messages-bar · S-effort · low-risk
> - **Promote `cn` to `@nour/utils`** · standardization · S
> - Plus the 5 deferred P1/P2 defensive findings from the audit
>
> **Per-page playbook now has 6 pages of evidence:**
> /settings (P+Q · 9 → 7) · /journal (R+S · 22 → 13) · /tasks
> (U · 22 → 12) · /brain (V · 17 → 10) · cross-surface (W · 4
> phases) · /chat (X · 22 → 6 phase-1 · 8 deferred to X.b). The
> Pareto-survival rate dropped to ~28% on Wave X because
> homepage risk-management forces tighter filtering — that's the
> right discipline. Wave X.b can ship the rest after Wave X bakes
> for 24h.
>
> **Aggregate stats across the 8-wave playbook arc (P through X):**
> - Total findings audited: ~120
> - Total fixes/wire-ups shipped: ~85
> - Pareto-survival rate: ~70% average · 28% on homepage (X)
> - Tests: 2795 → 2804 (+9 net)
> - Pages elevated: /settings · /journal · /tasks · /brain ·
>   /chat (+ cross-surface) · /knowledge + /system root touched
>   in Wave W consolidation
>
> Gates: typecheck 0 errors · lint 0 errors / 370 baseline · vitest
> 184 files / 2804 tests · build OK · prod smoke 200 on 3 endpoints.

> ## 2026-05-24 NIGHT · Wave W · cross-surface consolidation + activation · 4 ships
>
> The operator's request: combine /knowledge + /system root + /brain
> sub-pages into one next-level move (save /chat for last since it's
> also the homepage). 2 parallel planning agents (infinite-gratitude
> pattern + similarity-search-patterns lens + clarity-gate principle
> + using-superpowers protocol) returned a 5-phase plan. Operator
> approved option A · all 4 ship-phases plus the planning wave.
>
> The unifying discovery: statenour has paid-for `/api/brain/search-
> hybrid` (RRF + FTS + KNN cosine on pgvector HNSW · live since
> v10.0.90) wired to NOTHING the operator uses daily. The cross-
> surface theme isn't "build a unifier" — it's "delete the duplicates
> AND wire the paid-for substrate to the operator's eye." Net LOC
> change across Wave W is NEGATIVE.
>
> **Wave W Phase 1 · /system root strip** · `669c3e9d` · -82 LOC
> Pre-fix /system root rendered a two-column Devices + Nick brain
> panel grid + an Integrations panel BELOW SystemHubGrid. All three
> duplicated data ALREADY surfaced by the hub-grid's per-domain
> cards. Wave 52 had already deleted 3 sibling debug-dump cards for
> this exact reason · this finishes the job. SystemHubGrid IS the
> page now · the attention-strip lifts degraded surfaces above their
> groups so live signal is preserved.
>
> **Wave W Phase 2 · universal hybrid spotlight** · `d3cb3ae0` · +139 LOC
> Cmd+K palette now does semantic search across brain_memory +
> chat_message in addition to navigation. 250ms debounce · AbortCon-
> troller · top-5 RRF-fused hits in a "From your brain · N" group
> ABOVE the action groups (semantic-then-actions reading order).
> Each hit deep-links to its source (brain_memory →
> /brain/wisdom?focus= · chat_message → /chat#id). Silent degrade
> on fetch failure · cmdk's local action-filter still works. The
> most expensive idle infrastructure in the repo (22 days of
> pgvector embeddings) finally activated.
>
> **Wave W Phase 3 · operator-state landing router** · `e59371fd` · +159 LOC
> Substrate-only ship · pure function `chooseLanding(snapshot)` +
> tRPC procedure `system.landingRecommendation` + 7 new vitest cases
> covering the 5 rules:
>   · drift ≥ 0.6 → /system (triage open work)
>   · capacity ≤ 0.25 → /journal (reflect before pushing)
>   · mood=energized + momentum ≥ 0.5 → /tasks (ride the wave)
>   · focus < 0.3 + capacity > 0.5 → /brain/board (strategy time)
>   · neutral → null (no specific signal)
> UI placement (chip on HQ) deferred to /chat wave because the
> homepage IS /chat and the 2026-05-18 PM brainstorm explicitly
> rejected chip-strip clutter · placement decision belongs in the
> /chat redesign context.
>
> **Wave W Phase 4 · unified recall inbox** · `1eca229e` · +448 LOC
> The largest substrate addition. `lib/services/recall-inbox.ts`
> mirrors the proven `system-hub.ts` parallel-read pattern · fans
> out to 4 paid-for readers (pins · link-review · contradictions ·
> active-alerts) in parallel · per-source try/catch isolation so one
> broken reader can't break the inbox. New `brain.recallInbox` tRPC
> procedure. New `<RecallInboxPanel />` component (175 LOC) mounted
> in /brain Zone 1 ABOVE InsightRibbon. Editorial-minimalist · per-
> group "see all →" link drills to source page · silent across all
> 4 sources on clean morning. Operator's daily ritual: 3 page-visits
> → 1 panel.
>
> **Architectural patterns surfaced for the playbook:**
> - **Aggregator-thinking is the leverage**. /brain is the
>   convergence layer where Waves S/T/U paid-for helpers go to die
>   invisibly. The most leveraged moves fuse 2-4 helpers into one
>   operator-facing surface. recall-inbox fuses 4 · learning-velocity
>   scoreboard fuses 4 (Wave V) · calibration tile fuses 2 (Wave V).
> - **Substrate-first when UI placement is contested**. Phase 3
>   shipped the pure function + tRPC procedure without committing
>   to UI placement · operator can later decide where the chip goes
>   without rebuilding the substrate.
> - **Net-negative LOC is the kaizen tell**. Phase 1 deleted 82 LOC ·
>   the rest of Wave W added ~750 LOC of substrate (services +
>   procedures + tests + UI). Total net: ~+670 LOC but zero new
>   schema · zero new cron jobs · activates 3 idle endpoints.
>
> **Flagged · NOT done in Wave W (Wave W.b candidates)**
> - KnowledgeRefreshPanel relocation /knowledge → /system/cron-
>   diagnostics (inline component · extract first)
> - Brain sub-page consolidation (reflections + identity-trajectory
>   + link-review folded as panels on /brain) · need to
>   extract panel components first
> - Knowledge embeddings activation · the /knowledge page still uses
>   substring LIKE search · need to verify knowledge files are
>   vectorized in `vector_embeddings` then add knowledge_file source
>   to search-hybrid
> - Landing-router chip placement decision · defers to /chat wave
>
> **Per-page playbook now has 5 pages of evidence + 1 cross-surface
> wave:** /settings (P+Q) · /journal (R+S) · /tasks (U) · /brain (V) ·
> /brain + /system + /knowledge (W). Pattern: 4 parallel agents ·
> Pareto-filter to 50% · ship with substrate-first discipline.
>
> Gates: typecheck 0 · lint 0 errors / 370 baseline (+1 pre-existing
> any in Phase 2 new code) · vitest 184 files / 2804 tests (+7 from
> Phase 3) · build OK · prod smoke 200 on 3 endpoints after each
> phase.

> ## 2026-05-24 LATE-EVENING · Wave V · /brain 5-phase sweep · 1 ship
>
> 4th page to receive the per-page playbook (after /settings P+Q ·
> /journal R · /tasks U). /brain is structured differently — a 199 LOC
> hub routing to 6 sub-pages · total 2173 LOC. Scoped audit to the
> hub + wisdom (697 LOC) + link-review (330 LOC). 2 parallel review
> agents (defensive + feature-mining via infinite-gratitude) · 17
> findings · Pareto-filtered to 7 defensive + 3 features.
>
> **Wave V · 10 changes** · `1f7dd3ae`
>
> Defensive:
> - **(P0 silent-failure)** link-review staleness banner · pre-fix
>   load() catch only toasted · candidates stayed at last value with
>   no visible signal · now: persistent loadError banner with retry.
> - **(P0 clarity-gate)** link-review setTimeout state-mutation ·
>   pre-fix 240ms departure animation mutated `candidates` directly ·
>   phantom row after navigate-back · now: invalidate cache + load().
> - **(P0 stale-closure)** link-review decide() empty useCallback
>   deps · now: real `[decideMutation, utils, load]` declared.
> - **(P1 clarity-gate)** wisdom native confirm() silently
>   suppressed in iOS PWA · Deprecate button did nothing · now:
>   useConfirmDialog hook (same fix as nickstire admin Wave 110-139
>   + OVERDRIVE-1).
> - **(P1 code)** wisdom localStorage no try/catch · Safari private
>   mode + iOS Lockdown Mode crashed the page · now: try/catch on
>   read + write.
> - **(P1 a11y)** wisdom curation buttons keyboard-hidden by
>   md:opacity-0 · now: + md:focus-within:opacity-100 (Tab focus
>   reveals).
> - **(P2 perf)** brain hub 60s polling redundant with event-bus ·
>   maturity header was re-rendering every 60s for zero new data ·
>   dropped the interval · event-bus is the ONLY refresh path.
>
> Feature wire-ups (Phase 5 · infinite-gratitude):
> - **#6 Identity-delta narrative line** · violet inline banner in
>   Self-Model zone reads `yesterday → today: velocity rising 62→71`
>   etc. Reads IdentitySnapshot.deltaFromLast populated by 04:30
>   identity-refresh cron · new `brain.identityDelta` procedure ·
>   silent on empty.
> - **#5 Learning-velocity scoreboard** · 4-cell tile at top of
>   Self-Model zone · headline "brain +22% vs 30d ago · health
>   78/100" + per-metric tiles. Reuses existing
>   `trpc.journal.learningVelocity` (Wave S) · zero new server work.
> - **#2 Calibration tile** · new tile in Predictions zone next to
>   PredictionStreaksCard. Shows verdict (well-calibrated / drift /
>   unknown) + mean Brier + hit-rate + claim-vs-reality gap. Wires
>   `summarizeCalibration` + `Prediction.brierScore` (populated by
>   outcome-tracker cron for ~22 days · zero UI prior). New
>   `brain.calibrationSummary` procedure.
>
> **Aggregator-thinking insight from Wave V:**
> /brain is the convergence layer where Waves S/T/U paid-for
> helpers go to die invisibly. The most leveraged moves are
> aggregators that fuse 2-4 helpers into one operator-facing
> surface (e.g. learning-velocity scoreboard = 4 helpers in one
> tile). This is the next-page pattern: when picking elevation
> candidates, prefer "this aggregates N existing helpers" over
> "this surfaces 1 new helper."
>
> **Flagged · NOT fixed (Wave V.b candidates · 8 deferred items)**
> Defensive: 5 competing filter surfaces on /brain/wisdom (M
> redesign) · 1-button flex-wrap dead-weight (cosmetic) ·
> Feature-mining M-effort: nightly consolidation report strip ·
> decay-candidates triage panel · decision-quality GPA sparkline ·
> hidden-correlations drawer · anticipated-questions hit-rate ·
> 4 deeper sub-pages (board · reflections · health ·
> identity-trajectory) not yet audited.
>
> **Playbook now has 4 pages of evidence:**
> /settings (Wave P+Q · 9 findings → 7 fixes) · /journal (Wave R+S ·
> 22 → 13) · /tasks (Wave U · 22 → 12) · /brain (Wave V · 17 → 10).
> Average ~50% Pareto-survival rate per page. Recommended next
> candidates: /chat (heaviest interaction · stream + tool calls) ·
> /knowledge (Drive ingest · less audited) · /system root.
>
> Gates: typecheck 0 errors · lint 0 errors / 369 baseline · vitest
> 184 files / 2797 tests · build OK · prod smoke 200 on 3 endpoints
> post-deploy.

> ## 2026-05-24 EVENING · Wave U · /tasks 5-phase sweep · 1 ship
>
> Operator's request: apply the 5-phase per-page playbook to /tasks
> (the daily-driver · 1350 LOC). Dispatched 4 parallel agents via
> infinite-gratitude pattern (code-reviewer + silent-failure-hunter +
> ux-audit/frontend-design/mobile/clarity-gate + feature-mining) ·
> 22+ findings synthesized · Pareto-filtered to 8 defensive + 4
> feature wire-ups · shipped in one commit. clarity-gate principle
> applied to every "VERIFIED" claim (spot-checked actual schema +
> helper exports before building).
>
> **Wave U · 12 changes** · `1034df11`
> Defensive (Phase 1-4):
> - **(P0 silent-failure)** `loop-stream.tsx` onRowDrop · drag-to-
>   reorder was swallowing server rejection while the hook's generic
>   "Saved." toast fired on success · operator dragged a row, saw it
>   move, got "Saved." on reject, then snapped back 60s later with
>   no explanation. Now: try/catch + reportClientError + explicit
>   "Reorder failed · snapping back" toast + immediate onReviewChange.
> - **(P0 silent-failure)** `loop-stream.tsx` runBulk · first-rejection-
>   aborts-rest behavior · operator selected 10, task 3 failed, tasks
>   4-10 silently skipped. Now: per-iteration catch + accumulated
>   failedIds + single summary toast ("7 of 10 completed · 3 failed").
> - **(P0 ux)** `loop-stream.tsx` bulkDelete · pre-fix confirm only
>   fired for counts > 5 · 2-5 task selections wiped silently. Now:
>   any count ≥ 2 confirms.
> - **(bug)** `loop-stream.tsx` domainFilter casing · `work` filter
>   never matched `BUSINESS` tasks · alias mapping only lived in the
>   picker, not the filter compare. Aliased both sides.
> - **(ux-F5)** `now-operator-bar.tsx` · AnimatedCounter on 3 status
>   counters fired on every visibility-change · plain tabular-nums
>   spans · same fix as /journal Wave R.
> - **(ux-F4)** `task-filters.tsx` · 3 redundant filter-state surfaces
>   collapsed to 1 (page-level ActiveFiltersStrip is canonical).
> - **(ux-F7)** `loop-row-item.tsx` · "+ subtask" tap collision on
>   iPhone (3 abutting 44pt circles) · button relocated from
>   collapsed row to expanded action panel.
> - **(ux-F12 a11y)** `loop-stream.tsx` · section headers had
>   aria-hidden hiding structural cues from VoiceOver · now
>   role="heading" aria-level={3}.
>
> Feature wire-ups (Phase 5 · infinite-gratitude):
> - **(#2) Capacity meter in header** · `loop-stream.tsx` · useNowSignals
>   was already computing capacityRemainingMin + allocatedMin +
>   overcommitted · never rendered. New one-line meter above
>   NextMove · amber when overcommitted with "Nh Nm over" inline.
> - **(#4) Streak-at-risk countdown chip** · `loop-row-item.tsx` ·
>   DAILY rows with streakCount ≥ 3 enter warning window at 24h
>   since lastCompletedAt · turn red at 30h · 6h until 36h break
>   threshold per task-context.dailyBrokenStreaks bucket. Render-
>   time math · no helper.
> - **(#5) Subtask roll-up on parent row** · `loop-stream.tsx` +
>   `loop-row-item.tsx` · existing `+N sub` chip shifts to "+N sub ·
>   X/N" with color band (emerald 100% · gold ≥50% · zinc <50%) ·
>   new `doneChildCountByParent` map alongside the existing total +
>   open maps.
>
> **Findings flagged · NOT fixed (deferred to next wave)**
> - Stale-closure in auto-gen AI tasks effect (page.tsx:573-587) ·
>   deeper rewrite · localStorage key-write must move into success
>   branch · skipped this wave for risk-limit.
> - useDebouncedReload race condition (page.tsx:365-471 +
>   hooks/use-debounced-reload.ts:49-67) · loadingRef short-circuits
>   abort path · deeper rewrite.
> - addTask double-submit guard missing (page.tsx:748-815) · iOS
>   double-tap can create duplicates · needs submittingRef pattern.
> - getInbox concurrent race (page.tsx:608-628) · two parallel
>   addTask calls before inboxRef populates can create duplicate
>   Inbox missions · cache promise instead of resolved id.
> - Optimistic cascade flip ARCHIVED-exclusion mismatch (page.tsx:
>   894-904).
> - F2 sticky section headers stack/overlap on by-status sort ·
>   CSS-expert work.
> - F8 IntelPanel badge signalCount gating · scoreboard hidden when
>   operator has zero overdue · badge should reflect "anything
>   interesting in here today" not just overdue.
> - F10 "stuck · re-frame?" chip is non-interactive · either wrap in
>   button or drop the "?" copy.
> - F11 pinned-band gradient vs section flat-line · 3 divider styles
>   compete · cosmetic.
> - 3x localStorage `catch{}` in togglePin + AI-gen gate · Safari
>   private mode silently fails.
> - Feature-mining candidates #1 (effort-drift chip) · #3 (ghost-nick
>   next-step) · #6 (overdue-promise confrontation) · #7
>   (abandonment-pattern badge) · #8 (time-of-day fit label · already
>   half-shipped) · all M-effort · deferred to Wave V.
>
> **Playbook update:** the 5-phase per-page sweep template now has
> 3 pages of evidence (P+Q on /settings · R on /journal · U on /tasks).
> Per-page audit finding density: /settings ~9 · /journal ~22 ·
> /tasks ~22 (with 4 parallel agents vs 3 on /journal). The 4-agent
> pattern (separating ux-audit + code-review + silent-failure as
> distinct lenses + feature-mining as a separate lens) is the right
> shape going forward.
>
> Gates: typecheck 0 errors · lint 0 errors / 369 baseline warnings
> (+1 from new code · all pre-existing any) · vitest 184 files /
> 2797 tests · build OK · prod smoke 200 on 3 endpoints post-deploy.

> ## 2026-05-24 LATE-AFTERNOON · Wave S + T · feature-mining · 12 wire-ups · 2 ships
>
> Operator called out the gap from Wave P/Q/R: those were defensive
> UX sweeps (ux-audit · silent-failure-hunter · code-reviewer) but
> never did the OPPORTUNITY pass. Two parallel feature-mining agents
> (infinite-gratitude pattern) surveyed the 1,400+ skill library +
> the existing lib/brain/* + AutomationPolicy infrastructure ·
> surfaced 12 wire-up candidates · clarity-gate principle applied to
> mark each VERIFIED / PROJECTED / HYPOTHETICAL. Operator approved
> "all 12" · both waves shipped.
>
> **The unexpected finding:** the vast majority of "cool features"
> were already-built helpers not connected to the operator's eye.
> Zero new schema · zero new cron jobs · pure connect-paid-for-infra-
> to-the-operator's-eye work. This becomes Phase 5 of the per-page
> UX-sweep playbook · the defensive audits (Wave M/P/Q/R) caught
> bugs but missed the wire-up opportunities entirely.
>
> **Wave S · /journal · 7 wire-ups** · `a4307158`
> - **#7 · Learning-velocity ticker** (`measureLearningVelocity` →
>   one-line surface above the feed: "12 entries this week ·
>   3 new connections · 2 beliefs revised · brain 78/100")
> - **#5 · Weekly memoir block** (last 7d WISDOM/BELIEF promotions
>   surfaced as a small block above the feed · silent when fewer
>   than 2 items)
> - **#3 + #6 · Brain signals chip** (combined emotional trajectory +
>   drift composite via one read · trajectory tinted by
>   rising/falling/volatile/stable · drift color-banded 0-3/3-6/6+)
> - **#4 · Ghost counter-question** (reflect-composer · ghost-nick
>   prediction reshaped as a question · honors a year-old docstring
>   promise · violet inline banner · dismissable)
> - **#1 · Margin contradictions** (per-entry contradiction list in
>   brain-dump expanded body · pulls from contradiction-surfacer's
>   loadRecentContradictions(30d))
> - **#6 (refinement) · Drift pin on threads** (active threads with
>   14+d silence get "drifting · Nd" amber badge · soft warning
>   before cron-managed 30d auto-dormancy)
> - **#2 · Prediction-line on decision entries** ("predict outcome"
>   button on decision-type entries · one-line form writes to
>   existing Prediction model · predictions-grader cron resolves
>   when target date passes)
>
> Six new tRPC procedures on the journal router:
> `learningVelocity` · `ghostCounterQuestion` ·
> `contradictionsForEntry` · `brainSignals` · `weeklyMemoirItems` ·
> `savePrediction`. All wrapped in try/catch + log.warn +
> degrade-to-null · matches Wave M discipline.
>
> **Wave T · /settings · 5 elevators** · `dad4e9db`
> - **#1 · Proof-of-life badges** (per-flag last-fired tail joined
>   from AutomationPolicy by `autopilot:<key>` tag · last-result
>   color-coded · tooltip exposes policy id + fireCount · "never
>   fired · 14d" tells operator the binding's broken at a glance)
> - **#2 · Why-was-this-disabled audit trail** (toggle write writes
>   a BrainMemory row under new category AUTOPILOT_FLAG_CHANGE ·
>   payload includes prior-state duration + optional 1-line note ·
>   recentAutopilotFlagChanges read feeds the future drawer)
> - **#3 · Shadow mode for critical flags · UI rehearsal**
>   (3rd state on the 3 confirmDisable flags via localStorage ·
>   violet bg + "shadow" badge · workers don't honor SHADOW yet ·
>   UI rehearsal layer for the coming worker support · explicit
>   "UI-only" note in the procedure docstring)
> - **#4 · State-aware category dimming** (reads system.operatorState ·
>   when mood is depleted or scattered, sales + comms categories
>   drop to opacity-50 · brain + schedule stay at full · hover
>   restores full · toggles stay fully interactive)
> - **#5 · Blast-radius preview** (press-and-hold expansion surfaces
>   1-2 lines of "disabling stops X" from AutomationPolicy.
>   successMetric · confirm moment becomes learning moment · silent
>   when no policy is mapped)
>
> Three new tRPC procedures on the system router:
> `autopilotPolicyStatus` (covers #1 + #5) · `recordAutopilotFlagChange`
> (covers #2) · `recentAutopilotFlagChanges` (covers #2). One new
> BRAIN_CATEGORIES entry: `AUTOPILOT_FLAG_CHANGE`.
>
> **Playbook update:** the per-page sweep template now has 5 phases.
> Defensive audit (Phase 1-4) was Wave P/Q/R · feature-mining audit
> (Phase 5) is Wave S/T. The latter is the under-counted half · most
> codebases have huge troves of paid-for infrastructure that never
> surface. Apply both phases to every future page sweep
> (next candidates: /tasks · /chat · /brain · /knowledge · /system).
>
> **Flagged · NOT fixed (operator-action follow-ups)**
> - Worker support for SHADOW mode on the 3 critical flags
>   (auto_brain_cycle · auto_identity_refresh · adhd_operating_rhythm)
>   · this requires each cron to honor a `shadow=true` branch · UI
>   already rehearses the toggle.
> - Tag the rest of the AutomationPolicy rows with `autopilot:<key>` ·
>   only a subset is currently tagged · the proof-of-life badges show
>   nothing for un-tagged flags · low-effort but operator-decided
>   which flags map to which policies.
> - autonicks.com Cloudflare DNS flip still pending from Wave O.
>
> Gates: typecheck 0 errors · lint 0 errors / 368 baseline · vitest
> 184 files / 2797 tests · build OK · prod smoke 200 on 3 endpoints
> post-deploy on each wave.

> ## 2026-05-24 AFTERNOON · Wave R · /journal UX sweep · multi-agent audit · 1 ship
>
> Operator invoked `/infinite-gratitude` and `/clarity-gate` skills and
> asked for the same UX sweep treatment on `/journal` as Wave P+Q got on
> `/settings`. Discovered both skills had names that misled me:
> `infinite-gratitude` is actually a multi-agent research orchestration
> pattern (10 parallel agents) and `clarity-gate` is a RAG document
> verification system (will another LLM mistake assumptions for facts?).
> Adapted both correctly: dispatched 3 parallel review agents per
> infinite-gratitude pattern · borrowed clarity-gate's principle for
> the UI lens ("does any control imply state it can't deliver?").
>
> **Wave R · 6 surgical fixes synthesized from 22 audit findings** · `07639178`
> Three review agents ran in parallel (code-reviewer · silent-failure-
> hunter · ux-audit + frontend-design + mobile-design + clarity-gate
> principle). Pareto-filtered ~22 findings down to 6 with the highest
> operator-visible ROI:
> - **(P0) `thread-suggestions.tsx` accept/dismiss silent failures** ·
>   pre-fix both handlers had bare `catch {}` with the comment
>   "today: silent re-fetch." Operator tapped a suggestion → server
>   401/500 → UI looped → operator re-tapped forever. Now: log to
>   /system/errors + inline rose-300 banner that auto-clears.
> - **(P0) `thread-rail.tsx` whole-component vanish on error** ·
>   pre-fix `if (error) return null;` made the entire thread rail
>   disappear on any tRPC error · indistinguishable from "no threads
>   exist." Now: rose banner + retry button + error.message.
> - **(P0) `page.tsx` FilterChipRow · iOS HIG 44pt tap target** ·
>   pre-fix chips were 20-24px tall · operator's thumb on iPhone
>   couldn't reliably hit one. Added
>   `[@media(pointer:coarse)]:min-h-[44px]` (Tailwind v4 arbitrary
>   variant) · desktop unchanged · touch devices get HIG floor.
> - **(P0) `page.tsx` FilterChipRow · AnimatedCounter slop** ·
>   pre-fix every chip count rendered through `<AnimatedCounter>` ·
>   14 chips visible meant the whole row ticked from 0
>   simultaneously on every page load · gpt-built feel · semantically
>   wrong (counts didn't change). Plain span with tabular-nums.
> - **(P1) `page.tsx` byDate ordering on alpha sort** ·
>   pre-fix `byDate` grouped over the already-sorted list ·
>   `alpha-asc/desc/longest/shortest` modes produced TWO day-header
>   sections for the same date when entries weren't date-monotonic.
>   Now: day headers always sort by date · entries within inherit
>   the sortKey.
> - **(P1) `page.tsx` weak-spots `+N more` indicator** ·
>   pre-fix `meta.weakSpots.slice(0, 2)` silently hid the rest · a
>   brain with 7 weak spots looked identical to one with 2 (Nielsen
>   #1 violation). Added `+N more` chip with hidden spots in the
>   title attribute.
> - **(P1) `reflect-composer.tsx` submit log** · Wave-M class fix ·
>   pre-fix `catch{} toast.error("save failed")` with no log
>   breadcrumb. Now: structured log via sanitizeError + template +
>   filledCount in the payload so /system/quality can correlate.
>
> **Flagged · NOT fixed (deferred to Wave R.b if signal emerges)**
> - Reflect composer template chooser hidden behind 9px "switch"
>   link · 4 inline tabs would be the upgrade · bigger change ·
>   stable as-is.
> - localStorage 3x catch{} blocks in reflect-composer.tsx ·
>   logging would catch QuotaExceeded in Safari private mode ·
>   low frequency · noted.
> - thread-radar.tsx error/empty collapse · same class as the
>   rail fix · acceptable severity solo · could batch with a
>   future radar-related wave.
> - "extracting…" toast disclosure (clarity-gate violation) ·
>   needs a poll-or-listen status pill · bigger UX change.
>
> **The repeatable playbook locked in:** skill-check → invoke
> ux-audit + silent-failure-hunter + code-reviewer in parallel →
> read each finding's line numbers against ground truth → Pareto-
> filter to ≥80% confidence · ≥P1 severity · ≤8 fixes per wave →
> ship in one commit with all 4 gates green → reconcile docs.
> Same template applied to /settings (P+Q) and now /journal (R).
> Next page candidates: /tasks · /brain · /chat · /knowledge ·
> /system root.
>
> Gates: typecheck 0 · lint 0 errors / 368 baseline · vitest 184
> files / 2797 tests · build OK · prod smoke 200 on 3 endpoints
> post-deploy.

> ## 2026-05-24 MIDDAY · Wave O + P + Q · Vercel runbook v2 + /settings UX sweep · 4 ships
>
> Operator status check this morning identified two threads: (a) the
> autonicks.com Vercel cleanup that MEMORY.md flagged as a "ghost"
> turned out to be a live serving stale build with DNS still pointed
> at Vercel · runbook rewritten with the correct DNS-first sequence ·
> operator chose to delete all 4 Vercel projects upfront, which left
> autonicks.com returning `X-Vercel-Error: DEPLOYMENT_NOT_FOUND`
> (DNS flip still pending in operator's hands) · (b) /settings page
> UX sweep applying ux-audit + frontend-design + minimalist-ui +
> mobile-design skills.
>
> **Wave O · Vercel cleanup runbook v2 · DNS-first sequence** · `6542d5c5`
> Pre-flight via Vercel MCP + curl/DNS exposed the prior runbook's
> wrong-state assumption. New inventory: 4 Vercel projects identified
> (statenour-os holding autonicks.com · nickstire / easy-nickstire /
> elegant-yalow without custom domains). Rewrote `docs/RUNBOOK.md`
> with: 4-phase safe sequence (DNS flip → 48h wait → delete 3 dormant
> projects · then statenour-os) · Cloudflare DNS flip instructions
> (301 redirect vs park-domain options) · explicit safety-policy
> boundary statement (deletion + DNS are operator-only).
>
> **Wave P · /settings autopilot grouping + 3 UX fixes** · `0e5fb0ce`
> Applied Nielsen heuristics scan + frontend-design lens to the
> autopilot section · 3 violations found, all fixed:
> - Grouped the 13 flat toggles into 4 named categories: Brain ·
>   learning (4 · amber) · Sales · revenue (4 · emerald) · Schedule ·
>   focus (4 · violet) · Comms · marketing (1 · sky). Each group
>   shows a per-category count badge ("3/4 active"). Tints match
>   System Ops Hub vocabulary · md:grid-cols-2 on desktop · single-
>   col on mobile.
> - Eliminated the "everything ON" flash via `resolveInitialFlags()`
>   that reads localStorage SYNC during state init (Nielsen #1 fix).
> - Surfaced mutation failures inline with a rose-300 badge mirroring
>   PushNotificationToggle's translate-error pattern (Nielsen #9 fix).
> - Bonus: switched from GlassCard-with-cursor-pointer to semantic
>   `<button>` (correct ARIA · Apple HIG 44pt) · 7 distinct icons
>   replacing 3 duplicate `Zap` glyphs (Nielsen #6 · recognition not
>   recall).
>
> **Wave Q · extract SystemOpsHub + confirm-hold on critical toggles** · `fd02f4d0`
> Two surgical follow-ups to Wave P:
> - **Extracted SystemOpsHub** (230 lines · 7 category groups) from
>   inline in settings/page.tsx to a new
>   `components/settings/system-ops-hub.tsx` matching the existing
>   `components/settings/*` pattern. Pure relocation · zero visual or
>   behavioral change. settings/page.tsx: 935 → 787 LOC (-148).
> - **Press-and-hold confirm on 3 critical autopilot disables** ·
>   `auto_brain_cycle` · `auto_identity_refresh` ·
>   `adhd_operating_rhythm`. Uses the existing `ConfirmHold` primitive
>   (800ms ring · haptic warn on start · haptic success on commit).
>   Asymmetric friction by design: re-enabling stays a single tap (low
>   risk in turning automation back ON). Flow: tap critical-enabled
>   row → expansion banner with rose tint + ConfirmHold (danger
>   variant) + cancel button + 5s auto-cancel timeout (mobile-thumb
>   safety).
>
> **Flagged · NOT fixed**
> - autonicks.com Cloudflare DNS flip · still pending operator
>   action · domain now serves Vercel deleted-project 404. Runbook
>   covers the fix at `docs/RUNBOOK.md`.
> - `inline crons expansion` on autopilot flags (recognition-not-recall
>   improvement) · deferred · acceptable cognitive load with current
>   description text.
> - `real appVersion` in SystemInfo · already pulls from
>   `trpc.system.toolsHealth` · `?? "v10"` is just the loading
>   fallback · no actual drift.
> - Inline help expansion per flag · would need additional
>   per-flag content · deferred until operator surfaces a real
>   "I don't remember what X does" moment.
>
> Gates: typecheck 0 · lint 0 errors / 368 baseline · vitest 184
> files / 2797 tests · build OK · prod smoke 200 on 3 endpoints
> post-deploy on every wave.

> ## 2026-05-24 MORNING · Wave N · unstamped split + autonicks Vercel retire runbook · 1 ship
>
> Operator picked items 3 + 4 from this morning's status check:
> (3) the P2 `unstamped` counter granularity finding I'd deferred
> from Wave M, and (4) the Vercel-ghost autonicks.com cleanup that's
> sat in MEMORY.md as "needs operator action" since the Railway
> migration.
>
> **Wave N · 5 files changed** · `d4cc5652`
> - **`lib/services/state-calibration.ts`** · `unstamped` counter
>   split into 3 named diagnostic buckets:
>   - `unstamped` · `operatorStateSnapshot === null` · genuine
>     pre-Wave-H OR upstream writer regression
>   - `malformed` · snapshot exists but `mood` is not a string ·
>     schema drift on snapshot shape · indicates BUG in
>     `formatOperatorStateSnapshot`
>   - `unknownMood` · `mood` is a string but not in `ALL_MOODS` ·
>     new mood enum added upstream without extending the report ·
>     indicates DRIFT between `operator-state.ts` and
>     `state-calibration.ts`
>   Each counter implies a distinct root cause · prod diagnosis
>   is now zero-cognitive-load.
> - **`app/(mastery)/system/calibration/page.tsx`** · header
>   description surfaces non-zero malformed + unknownMood counters
>   inline (zero values hidden to keep the chip clean in the
>   common case · array-filter-join pattern).
> - **`tests/lib/services/state-calibration.test.ts`** · two new
>   vitest cases pinning the malformed and unknownMood paths ·
>   existing unstamped test extended to assert the other two
>   counters are 0 when only null-snapshot rows are present.
> - **`docs/RUNBOOK.md`** · appended an operator runbook section
>   "Retiring the autonicks.com Vercel ghost project · operator
>   action" covering: pre-flight checks (curl, DNS, callback URL
>   audit), Vercel-dashboard delete steps, post-deletion
>   verification. The agent cannot delete the Vercel project
>   itself (operator-account-only) · the runbook captures the
>   safe-deletion checklist so the operator doesn't re-derive it.
> - **`docs/chrome-extension-plan.md`** · fixed the only stale
>   `autonicks.com` reference in apps/statenour (a planning doc) ·
>   now reads "bdnick.info (Railway · custom domain · `autonicks.com`
>   was the pre-2026-05 Vercel domain · retired)."
>
> **Flagged · NOT fixed**
> - The actual Vercel project deletion · cannot be done by agent ·
>   sits in operator's hands. Runbook is at
>   `docs/RUNBOOK.md#retiring-the-autonickscom-vercel-ghost-project--operator-action`.
> - 2026-05-13 → 05-19 + 05-22 wave backfill · still pending ·
>   pure docs work · low priority.
>
> Gates: typecheck 0 · lint 0 errors / 368 baseline · vitest 184
> files / 2797 tests · build OK · prod smoke 200 on 3 endpoints
> post-deploy.

> ## 2026-05-23 LATE-NIGHT-3 · Wave M · post-audit silent-failure fixes · 1 ship
>
> Operator ran `check for errors` after the Wave L + UI sweep landed.
> Parallel code-reviewer + silent-failure-hunter audits found 1 P0 +
> 3 P1 + 1 P2 silent failures · all in the NEW code shipped today ·
> all invisible to typecheck/lint/vitest (which had been green for
> three consecutive pushes).
>
> **Wave M · 5 silent-failure fixes** · `66e7dcf1`
> - **P0 · `lib/trpc/routers/chat.ts` lensesForMessage** · two prisma
>   calls + a dynamic import had zero error handling · any DB blip,
>   schema drift, or import-resolution failure threw raw TRPCError to
>   the client. Combined with the P1 below, the lens-fire badges
>   silently vanished with no operator signal. Now: try/catch around
>   the procedure · `log.warn("lenses_for_message_failed", …)` on
>   failure · returns `{ lenses: [], error: "lens_lookup_failed" }`
>   so the client can branch correctly.
> - **P1 · `lib/ai/board/consult.ts` Wave L routing** · two distinct
>   silent failures in the same try block:
>   (1) bare `catch {}` swallowed `currentOperatorState()` failures
>   with no logging · Prisma outage would silently disable Wave L
>   routing for EVERY consultation. Now: `log.warn("board_state_read_failed", …)`.
>   (2) `if (snap.confidence > 0)` conflated "no signal yet" with
>   "computed low confidence" · the synthesizer trace +
>   `BoardConsultation.operatorState` never saw the snapshot even
>   when it was successfully computed. Now: always record the
>   snapshot for trace visibility · gate ONLY the routing /
>   drop-list on confidence > 0.
> - **P1 · `components/chat/lens-badge-row.tsx`** · React Query
>   didn't destructure `error` · so any failure from the P0 endpoint
>   produced the IDENTICAL visual experience as "Nick used no lenses"
>   · the exact failure mode the transparency feature exists to
>   eliminate. Now: faint rose pill with retry affordance when
>   `error` or `data.error === "lens_lookup_failed"`.
> - **P2 · `app/(mastery)/system/calibration/page.tsx`** · header
>   description showed "no data" when the query errored · identical
>   to the genuine empty-grid state. Operator scanning the chip alone
>   couldn't tell broken from warming-up. Now: "failed to load" when
>   `error` is set, distinct from the empty-grid path.
>
> **Flagged · NOT fixed**
> - `lib/services/state-calibration.ts:267-272` (P2) · `unstamped`
>   counter conflates 3 failure modes (genuine pre-Wave-H · malformed
>   snapshot · unknown mood). Diagnostic improvement, not a bug ·
>   would require schema/type changes to report. Deferred.
> - `lib/services/state-calibration.ts:181` DST ms-arithmetic ·
>   reviewer confirmed not a real bug (1-cell drift max, twice/year).
> - `state-pulse.tsx:270-274` `prefers-reduced-motion` :global
>   scoping interaction · reviewer confirmed correct.
> - `consult.ts:153` synthesizer `userPrompt` un-sliced · operator-
>   only surface, no untrusted input, not a security issue.
>
> Gates: typecheck 0 · lint 0 errors / 368 baseline · vitest 184
> files / 2795 tests · build OK · prod smoke 200 on 3 endpoints
> post-deploy.

> ## 2026-05-23 LATE-NIGHT-2 · Wave L + UI sweep · multi-advisor mood-gating + 4 visual upgrades · 3 ships
>
> Three ships closing the operator's "OKAY GO" directive on Wave L
> (Sam-Altman pick for the 5th operator-state opt-in) plus the
> follow-up "auto mode i am busy just complete it all" UI sweep.
> Each gated through typecheck + lint + vitest (184 files · 2795
> tests) + build · pre-push hook caught nothing · prod smoke 200
> on `/`, `/api/system/heartbeat`, `/auth/sign-in` post-deploy.
>
> **Wave L · multi-advisor mood-gated routing** · `1f3bb9e4`
> The 5th AI surface to opt into operator-state. ADR-0018 board
> consultation now reads `currentOperatorState()` pre-fan-out and
> applies `MOOD_DROP_RULES` to gate out advisors whose voice
> would land wrong for the current mood (e.g. depleted operator
> doesn't get Elon's first-principles intensity · scattered
> operator skips Buffett's wait-for-fat-pitch patience). Safety
> net: if gating would empty the board, keeps original members
> + adds a synthesizer gate-note. Mood-blind boards (no snapshot)
> degrade to pre-Wave-L behavior. 7 new tests in
> `tests/ai/board/mood-gating.test.ts` cover neutral/energized
> no-op · depleted/scattered drops · safety net engagement ·
> framework-id typo regression guard. `BoardConsultation` type
> extended with `operatorState` (compact snapshot · null when
> mood-blind) + `droppedAdvisorIds`.
>
> **UI #1 + #2 + #3 · lens badges + heatmap + state-pulse** · `d8b4e5b6`
> Three visual upgrades in one push:
> - **Lens-fire badges** under Nick replies · new
>   `lensesForMessage` tRPC query re-runs `pickFrameworks` on
>   the preceding user message (detector is pure → deterministic
>   re-execution). `LensBadgeRow` renders chips with
>   click-to-expand inline detail · returns null when no lenses
>   fire (zero DOM cost) · react-query cached forever per
>   messageId (input is immutable).
> - **Calibration heatmap + sparklines** on `/system/calibration`.
>   `cellTone` refactored to return inline-style `bgStyle` with
>   `rgb(R G B / opacity)` (Tailwind JIT can't pre-generate
>   runtime opacity strings). Emerald ≥60% · amber 35-59% ·
>   rose <35% · confidence dampener for total < 3 samples.
>   Row + col sparklines from new forward-filled daily trends
>   in `buildStateCalibration`.
> - **Operator-state pulse** at `/system/operator-state`. New
>   `StatePulse` SVG component · 4 concentric value rings +
>   center mood text · pulse period scales with momentum
>   (high momentum = fast pulse) · drift ring jitters when
>   drift > 0.4 · respects `prefers-reduced-motion`. Replaces
>   the static `Brain` icon circle.
>
> **UI #4 + #7 · command palette extension + calibration empty
> state** · `eb681a3c`
> - **Cmd+K palette** gains 6 new entries surfacing surfaces
>   that weren't reachable from the global palette:
>   `/system/operator-state` · `/system/calibration` ·
>   `/system/api-tokens` · `/system/judge-eval` ·
>   `/system/lens-stats` · `/brain/board`.
> - **/system/calibration cold-start state**. Pre-fix the grid
>   rendered as a sea of "—" cells when `totalRows === 0` · the
>   heatmap looked broken rather than warming up. New
>   empty-state callout: concentric Sparkles icon (matches
>   state-pulse vocabulary) · 3-step "how this fills"
>   walkthrough · link to `/system/operator-state` so operator
>   sees the live signal. Grid stays in DOM with `hidden` class
>   so layout doesn't reflow once the first chip-action lands.
>
> **UI #5 + #6 · already shipped pre-session** · zero new code
> UI #5 (suggestion-kind icons) discovered already implemented
> in `components/chat/nick-suggestions.tsx` via `KIND_META`
> const (11 kinds · per-kind icon + tone). UI #6 (swipe-to-
> archive on task rows) discovered already implemented in
> `components/actions/loop-row-item.tsx` (v10.0.529.19 · F12 ·
> right=complete · left=snooze). Tasks #59 + #60 marked
> complete-as-found · no work added.

> ## 2026-05-23 LATE-NIGHT · P-wave + Wave I/J · closing every routed item · 7 ships
>
> Seven ships closing the operator's "the routed ones go with the
> smartest options" directive plus a follow-up "keep going" wave.
> Each gated through 4-gate verification independently · 31
> migrations applied · 2787 tests · prod heartbeat 200 throughout.
>
> **P1 · voice_latency migration APPLIED to prod Neon** · `4544120b`
> Migration 20260512_v526_voice_latency moved from pending · 3 SQL
> statements ok · resolved as applied · 31 migrations applied total.
> Wave F's gated VoiceLatencyEvent composite index now also live
> (DO $$ table-existence check was a no-op pre-P1 · table exists now).
>
> **P2 · OSS lenses Phase 2 · consumer rewire as SHIM** · `4544120b`
> All 49 inline framework files deleted · lib/ai/strategic-frameworks/
> is now a 3-file shim that re-exports from @statenour/lenses ·
> aliases pickFrameworks→detectLenses + hasBusinessIntent→hasStrategicIntent
> · custom composeStrategicLensBlock preserves the Wave E
> featured-fallback path. Zero consumer code changed · chat path
> stays untouched. Source of truth now single.
>
> **P3 · /api/ai/page-insight first operator-state opt-in** · `4544120b`
> formatOperatorStateBlock(snap) injected after the lens block when
> confidence > 0 · best-effort · degrades to no-block on DB error.
> Pivoted from "morning brief" (pure template · no LLM call to
> influence). First consumer of ADR-0019 substrate.
>
> **P4 · Chrome extension MVP + supporting infra** · `ed3c5e7b`
> packages/chrome-extension/ · MV3 · vanilla JS · popup + options +
> service worker · 4 icon sizes generated from icon-nour.svg · Cmd+Shift+B
> from any tab. Backed by:
> - /api/brain/dump POST · token-authed · Zod-validated
> - /system/api-tokens page · issue/list/revoke
> - lib/auth/extension-token.ts · sha256 hashing · BrainMemory storage
> - 3 new tRPC procedures · 1 new BrainMemory category (API_TOKEN)
>
> **P5 · @statenour/lenses publish-ready** · `ed3c5e7b`
> CHANGELOG.md v0.1.0 · pnpm pack verified 131KB. Operator runs
> `cd packages/lenses && pnpm publish --access public` for the npm
> 2FA prompt (only manual step remaining).
>
> **Wave I · 3 more operator-state opt-ins**
> - /api/ai/plan-day · day plans now state-adapted (mood=depleted →
>   shorter plans · mood=scattered → fewer blocks)
> - /api/ai/assist · complementary to existing stateContext · two
>   layers of state now (environmental + internal)
> - lib/services/ai-coach-goal.ts · goal coaching pressure matches
>   capacity/momentum
>
> **Wave I.b · 19 new tests across 2 files**
> - tests/lib/services/state-calibration.test.ts · 6 cases · pure
>   aggregation math
> - tests/lib/auth/extension-token.test.ts · 13 cases · full
>   issue/validate/list/revoke round-trip
> - Test count 2768 → 2787
>
> **Wave J · Chrome ext F3 page-aware re-discovery**
> - /api/brain/by-url · two-pass lookup (exact URL match first ·
>   domain fallback) · token-authed · Zod-validated
> - Popup queries this on open · renders prior notes ABOVE composer
>   in a scrollable panel · hidden when no matches
> - Extension bumped to v0.2.0
>
> **ADR-0021 · docs/adr/0021-p-wave-and-extension.md**
> Records every P + I + J decision · 4 alternatives considered · 4
> open items.
>
> **Gates** · 183 vitest files / 2787 tests · 0 lint errors ·
> 0 typecheck errors · every push gated · prisma migrate status
> clean · 31 migrations applied · prod heartbeat 200.
>
> **Flagged · NOT fixed**
> - npm publish · only operator can run (2FA gate).
> - Chrome ext F2 (ask Nick via side panel) · deferred to next wave.
> - Shadow-judge queue tests · code is untested · backlog item.

> ## 2026-05-23 NIGHT · overnight power-mode · M1 (Closed-Loop Calibrated Brain) + Q2 shadow queue + OSS lenses workspace + Wave F schema · 4 ships
>
> Four substrate-fusion ships closing the operator's "complete waves
> F H Q2 OSS lenses" directive. Each gated through 4-gate verification
> independently · prod Neon migration applied with autocommit driver ·
> 30 migrations clean.
>
> **Q2 · prompt-v2 paired-comparison queue** · `77174b0a`
> Closes the V1→V2 cutover quality-signal gap. New PROMPT_SHADOW_JUDGE_QUEUE
> BrainMemory category · shadow path samples ~10% of turns + enqueues
> v1Prompt+v2Prompt+userMessage keyed by sha1(userMessage|tier|slot)
> · judge-eval-shadow cron drains queue items at end-of-tick · writes
> prompt.shadow.judge_score_delta SystemMetric centered around 0.
> Decouples judging cost from chat-path latency.
>
> **Wave H · M1 · Closed-Loop Calibrated Brain** · `77174b0a` (bundled)
> Fuses operator-state + suggestion-loop + judge-eval into one
> auditable feedback graph. suggestion-loop now stamps the compact
> 5-dim operator-state snapshot into BrainMemory.metadata on every
> action/outcome write. New buildStateCalibration() service joins on
> mood × suggestion kind · 4×19 grid + rollups. /system/calibration
> page renders the grid with editorial-minimalist visual vocabulary.
> system.stateCalibration tRPC procedure.
>
> **OSS lenses workspace** · `4ebcc193`
> New pnpm workspace `packages/lenses/` shipping `@statenour/lenses`
> v0.1.0 · MIT licensed · ESM-only · 49 frameworks + types + dispatch
> · zero project-local dependencies · `dist/` builds clean (52 source
> files × 4 outputs = 208 dist files). README + LICENSE + publishConfig.
> Statenour keeps its own copy at lib/ai/strategic-frameworks/ ·
> consumer rewire deferred to Phase 2.
>
> **Wave F · Tier-2 schema debt · APPLIED to prod Neon** · `4ab3185e`
> Migration 20260523_wave_f_schema_debt applied via apply-pending-
> migration.ts · prisma migrate status clean · 30 migrations applied.
> - Contradiction · +updatedAt + deletedAt + composite index (resolved,
>   category, created_at) + deletedAt index
> - TaskEvent · +denormalized goalId + partial index on (goalId,
>   created_at) WHERE goal_id IS NOT NULL · 49 existing rows backfilled
> - VoiceLatencyEvent · +(assistant_id, stage, created_at) composite ·
>   gated behind DO $$ table-existence check (table is in a parked
>   migration · gate makes Wave F apply-order-independent)
>
> **ADR-0020** · `docs/adr/0020-closed-loop-calibrated-brain.md`
> Records the M1 decision · supporting Q2 + Wave F + OSS context ·
> 4 alternatives considered · 3 open items routed to operator.
>
> **Gates** · 181 vitest files / 2768 tests · 0 lint errors ·
> 0 typecheck errors · next build green every push · prisma migrate
> status clean · prod heartbeat 200 throughout.
>
> **Flagged · NOT fixed**
> - Phase 2 of OSS extraction · statenour still imports its own copy
>   of the lens registry. ~30 LOC import rewire · 1h.
> - State-calibration grid will show mostly empty cells for ~weeks
>   until suggestion-loop rows accumulate · expected.
> - Wave F migration UPDATE used wrong table casing initially · corrected
>   for posterity but worth a note: future schema migrations should grep
>   schema.prisma for @@map values before writing UPDATE statements.

> ## 2026-05-23 EVE · LeCun-lens consolidation · operator-state model + judge-eval ground truth · 3 ships
>
> Three slices closing the LeCun-lens consolidation pass on the AI
> quality stack. Each slice is a structural addition · zero schema
> changes · zero deletion · pure substrate the rest of the codebase
> can opt into incrementally.
>
> **Slice 5.3 · explicit operator-state model** (`495e35c9`)
> Pure 5-dim model (focus · capacity · drift · momentum · mood) at
> `lib/services/operator-state.ts` · computes deterministically from
> 3 Prisma queries against TaskEvent + Task counts · degrades to
> zero-confidence defaults on DB error. 27 vitest cases cover each
> component function + integration smoke. Replaces autoregressive
> mood inference at the substrate level — Nick can now be opted in
> per-surface instead of guessing from chat text.
>
> **Slice 5.4 · /system/operator-state diagnostic surface** (`d2373d63`)
> `formatOperatorStateBlock(state)` formatter (the exact ~5-line
> system-prompt fragment any AI surface can include) + `system.operatorState`
> tRPC procedure + `/system/operator-state` page (mood chip, 4 numeric
> dimensions with AnimatedCounter, signal breakdown, exact prompt block
> shown for inspection). Chat path remains untouched per operator
> directive · substrate proves out first.
>
> **Slice 5.5 · ground-truth judge-eval calibration** (`4e0938dc`)
> `lib/services/judge-calibration.ts` joins PROMPT_COMPARISON_RUN rows
> against ChatMessage.feedbackScore via sourceMessageId · 4-cell
> confusion matrix · 4-band verdict (well-calibrated / moderate /
> miscalibrated / preliminary) · operator-side check on the V1→V2
> cutover plan. `system.judgeEvalCalibration` tRPC procedure + card
> on /system/judge-eval. 15 vitest cases cover empty / exclusions /
> each cell / mixed agreement / each verdict band.
>
> **Slice 5.6 · ADR-0019 + this entry**
> `docs/adr/0019-explicit-operator-state-model.md` records the
> decision · context (autoregressive failure mode) · 5-dim choice ·
> alternatives considered · open items.
>
> **Gates** · 181 vitest files / 2768 tests · 0 lint errors · 0
> typecheck errors · next build green · each slice pushed
> individually (5.3 → 5.4 → 5.5).
>
> **Flagged · NOT fixed**
> - Operator-state has NO consumer yet (substrate only). First-surface
>   pick deferred to a future ADR · candidates listed in ADR-0019.
> - Calibration sample size will read "preliminary" for weeks · this is
>   expected (operator gives feedback on a small fraction of turns).
>   No action needed · the metric needs to exist BEFORE samples accumulate.

> ## 2026-05-23 PM · subtask wave · migration + 4 UI slices · task #22 closed
>
> The parked `Task.parentTaskId` migration ran successfully against
> prod Neon at 13:35 ET (5/5 SQL statements ok via `apply-pending-
> migration.ts` · autocommit driver handled CREATE INDEX CONCURRENTLY
> outside the BEGIN/COMMIT transaction). `prisma migrate status`
> shows clean · 29 migrations applied. Subsequent slices implemented
> all 6 ADR-0017 amended semantic rules (Elon's-lens critique
> versions). Railway env vars rotated to the new neondb_owner
> password (the previous one leaked once in this chat session ·
> rotated immediately · old password dead).
>
> **`dff36255` · subtask schema + migration applied to prod Neon
> (task #22 step 3)** — schema.prisma Task model gains parentTaskId
> (String? · @map "parent_task_id") + self-relation "TaskChildren"
> (onDelete: SetNull · matches goalId pattern) + @@index. Task
> TypeScript interface in components/actions/shared.ts gains optional
> parentTaskId. `pnpm prisma generate` refreshed client. Migration
> SQL moved from migrations-pending/ to migrations/ + recorded via
> `prisma migrate resolve --applied`. The schema now matches the
> applied DB state · the v10.0.462 incident is intentionally avoided
> (schema-ahead-of-migration would have re-created it).
>
> **`73549556` · createTask accepts parentTaskId + inherits goalId
> from parent (task #22 step 4.1 · Rule 2)** — taskCreateSchema in
> validators/tasks.ts adds optional parentTaskId. createTask service
> precedence: explicit payload.goalId wins → parent.goalId wins over
> sibling-scan → sibling-scan fallback (existing heuristic preserved
> for goal-less parents). +4 contract tests covering the 4 branches.
>
> **`e139fca1` (sibling-bundled · my 4.2 changes were rolled into a
> nickstire batch commit by cross-session contamination · diff
> verified mine) · MissionScoreboard rollup re-weighted by EFFORT_RANK
> (task #22 step 4.2 · amended Rule 6)** — EFFORT_WEIGHT map
> (M5=1 · M15=2 · M30=3 · H1=4 · H2PLUS=5) replaces the old
> `done / all` formula. Missing-effort defaults to middle weight (3 ·
> safe migration · legacy tasks without estimates still count without
> dominating). +4 tests cover heavy/light asymmetry · 32 total
> derive-mission-matrix tests pass. Decision-quality grip: missions
> with hidden hard OPEN work now read lower · operator can't be
> fooled by an 50% reading.
>
> **`db962ace` · subtask visual indent + child-count chip on /tasks
> (task #22 step 4.3 · Rule 3 + 4)** — LoopRowItem gains
> indentLevel?: number + childCount?: number | null props.
> indentLevel > 0 adds ml-6 (24px · matches existing eyebrow rhythm).
> childCount > 0 renders "+N sub" chip on parent rows (same vocabulary
> as effort/fit/morning chips). LoopStream computes
> childCountByParent map in O(N) once per tasks change · passes per
> row. indentLevel capped at 1 per Rule 4 · raw-SQL grand-children
> degrade to indent=1 (graceful). Children render in their natural
> sort position (no structural re-ordering · sort/filter behavior
> unchanged from earlier waves).
>
> **`ae8305e2` · cascade-on-complete with confirm prompt (task #22
> step 4.4 · amended Rule 1 Option A)** — when operator completes a
> parent with open children, native window.confirm "Complete N
> subtasks too?" fires · yes triggers atomic
> prisma.task.updateMany cascade · no preserves parent-only behavior.
> checkTask service gains cascadeChildren?: boolean parameter ·
> CheckTaskResult returns childrenCascaded count. tRPC task.check
> Zod accepts the flag. LoopStream computes openChildCountByParent ·
> drives the prompt only when work is left (vs total childCount that
> drives the chip). /tasks page does optimistic local cascade for UI
> consistency · server is source of truth on next load. Cascade
> failure logged + degraded · doesn't fail the primary parent
> completion.
>
> **Flagged · NOT shipped (intentional · later slice candidates):**
> - "+ subtask" creation button on parent rows · operator can't
>   create a subtask via UI yet · API supports parentTaskId though
>   (createTask service · tRPC task.create) · workaround: capture +
>   manual parentTaskId via API/chat-fast-path · proper UI is
>   pending operator green-light
> - Collapsible chevron · children always visible · the amended
>   Rule 3 "collapsible" word remains for the polished UX
> - Inline-nested rendering · children appear in their natural
>   sort position rather than under their parent · the polished
>   "Todoist-style under-parent visual nesting" is a separate slice
>   (more invasive · changes sort order semantics)

> ## 2026-05-23 · multi-advisor board · strategic-intelligence amplifier · 2 ships + ADR
>
> Borrowed the multi-advisor pattern from the community skill ecosystem
> + built it native into statenour. This is the "next level" the
> operator framed — strategic decisions get N parallel advisor lenses
> with synthesis that PRESERVES divergence (where the lenses split is
> the highest-signal information · fusion destroys it).
>
> Distinct from the existing strategic-frameworks lens-injection
> (≤3 lenses fused into ONE Nick answer) by design · two patterns,
> two jobs · tactical/daily questions go to Nick (fused),
> major/multi-faceted strategic decisions go to the board (parallel).
>
> **`31b797ec` · multi-advisor board · foundation (task #23 · Slice A)** —
> `lib/ai/board/` · types + 5 pre-configured boards (strategic ·
> invest · product · operator · full) + the consult service. Fans
> out to N advisors via `Promise.all` over `aiChat(taskType:"reason")`,
> synthesizes via one more `aiChat` call. Reuses existing strategic-
> frameworks REGISTRY persona blocks (elon-musk · warren-buffett ·
> steve-jobs · inversion · etc.) — no duplicate persona maintenance.
> 20 contract tests covering happy path · divergence preservation ·
> graceful degradation (advisor throw / provider unavailable / parse
> fail · synthesizer parse fail) · coercion · prompt content. Cost
> per consultation = members.length + 1 aiChat calls (default 5-member
> board = 6 calls). Tracing through `makeTracedAiChat("board-consult")`
> shows every call in /system/agent-traces.
>
> **`06ce9933` · multi-advisor board · /brain/board surface + persistence
> (task #24 · Slice B)** — `lib/services/board-consult-record.ts`
> wraps Slice A with `brainMemory.remember` for persistence + flat-
> projected read helper (metadata Json opened inside the service ·
> TS2589 firewall · same pattern as `listRecentReflections`).
> `brain.consultBoard` mutation + `brain.recentBoardConsultations`
> query. `/brain/board/page.tsx` ships the operator surface · board
> selector chips · question textarea · synthesis card (top, gold
> border, recommendation + tension + consensus + divergence
> sections) · expandable advisor takes · recent consultations rail.
> Editorial-minimalist styling. `BOARD_CONSULTATION` registered in
> `lib/brain/categories.ts` so the registry guard doesn't warn on
> every write.
>
> **ADR-0018 (this slice)** · documents the pattern · distinguishes
> from related patterns (multi-agent parallel sub-agents ADR-0009 ·
> specialist sub-agents #13/#16 · CoALA reflection #12/#17). Includes
> 4 future-work items (decision-replay coupling · suggested-board
> routing · custom boards · board-vs-Nick eval scenario).
>
> **Flagged · NOT fixed:**
> - Task #26 (Elon's critique on ADR-0017) shipped immediately after
>   this wave · the subtask migration stays parked.

> ## 2026-05-23 · Todoist/Evernote hierarchy follow-ups on /tasks · 3 ships
>
> Three surgical follow-ups to the /tasks upgrade quartet that landed
> earlier today — each one a direct ask from the agent's `#7` open-
> questions list. All shipped with kaizen-grade blast radius (5-60 LOC
> per slice · no schema · no new components · all four gates green).
> A fourth ask (true subtasks via `Task.parentTaskId` self-FK) was
> filed as task #22 but is BLOCKED on operator's call across 6
> semantic questions before any Prisma migration can land.
>
> **`b957008e` · sticky kind-section headers (task #19)** — pure CSS ·
> the kind-section eyebrows the agent shipped in #7 now pin to the
> top of the scroll container via `sticky top-0 z-10
> bg-[var(--bg-base)]`. On a long stream the operator never loses
> sight of which kind-cluster they're reading. ~8 LOC.
>
> **`792a02e3` · status grouping axis (task #20)** — second grouping
> axis alongside the kind axis. `TaskSortKey` gains `"by-status"` ·
> `STATUS_RANK` (DOING=0 → CANCELLED=5) drives the primary sort with
> urgency desc as the secondary key inside each bucket. Status-
> section sticky eyebrows insert at each status boundary using the
> same editorial vocabulary as the kind eyebrows. SortDropdown
> surfaces "by status · doing first" in #2 position. Mutually
> exclusive with kind sections — one axis at a time. ~30 LOC.
>
> **`2a3514cd` · mission-name eyebrow ABOVE row title (task #21)** —
> Todoist "Project · task" pattern. Each row in LoopRowItem now
> carries the mission name as a `text-[10px] font-mono uppercase
> tracking-[0.18em] text-zinc-500` eyebrow above the title line.
> Skipped when mission is "Inbox" (un-categorized bucket · would
> noise capture rows). The bottom mission-fallback chip (which
> rendered when no goal was linked) is REMOVED — its job is now
> the top eyebrow's, and double-stamping would clutter goal-less
> rows. Goal chip below remains untouched. ~23 LOC.
>
> **Flagged · awaiting operator-applied migration:**
> - Task #22 — true subtasks via Prisma migration · all 6 semantic
>   decisions locked in `docs/adr/0017-task-subtasks-semantics.md`
>   (no cascade · selective inheritance · inline-nested UI · 1-level
>   depth · mixed-kind allowed · scoreboard counts descendants).
>   Migration SQL parked at `prisma/migrations-pending/20260523_
>   task_parent_task_id/migration.sql` — runs via
>   `scripts/apply-pending-migration.ts` when operator confirms prod
>   connectivity. Schema + UI code intentionally NOT shipped (the
>   v10.0.462 lesson · schema/DB-state must stay in sync · code
>   lands AFTER migration applies). Implementation checklist in
>   the ADR.

> ## 2026-05-23 · /tasks upgrade quartet · ComparisonMatrix consumer trio completed · 5 ships
>
> The original /tasks upgrade plan (5 slices ranked by leverage) shipped
> in a single autonomous wave. Five commits across 19 files. All four
> gates green (typecheck · lint · test · pre-push turbo build) on each
> push. The ComparisonMatrix primitive (task #8) now has its third
> consumer surface · the pattern proves out: pure derivation helper +
> dumb component + per-column scoring, reusable across very different
> domains (decision siblings · provider health · mission scoreboard).
>
> **`8f43c3f6` · +4 task-flow eval scenarios (task #18)** — extends
> the LLM-as-judge regression suite from 16 to 20 scenarios. Adds
> task-loop-completion-microaction (tone-matching for 5-word loop
> confirms) · task-overload-one-thing (reduction not sequencing ·
> distinct from task-ambiguous-priorities) · task-reschedule-with-
> reason (no moralizing on depleted reschedules) · task-mission-
> progress-eod (loop-vs-mission domain-model distinction). Contract
> test validates all 20 JSONs as Zod-strict on every CI run.
>
> **`b5f4b947` · /tasks visual hierarchy · agent ADD-ONLY pass (task
> #7)** — kind-section eyebrow headers in LoopStream (daily · habits ·
> promises · once · tasks · only when sortKey=urgency + kindFilter=all
> + non-pinned) + overdue PROMISE rows get a 2px red left stripe on top
> of existing tint. /journal audited and intentionally untouched — its
> day-grouped feed + ThreadRadar/Rail/Suggestions stack already
> provides Evernote-tier hierarchy. Sub-agent (a37168d9) reconnaissance
> caught the temptation to manufacture journal work and refused.
>
> **`ff8f46da` · schedule-keeper specialist · completes the trio (task
> #16)** — third specialist sub-agent under Nick (alongside
> financial-analyst · decision-coach) for calendar-shape questions:
> free blocks · day rhythm · reschedules. Persona is steady-not-chirpy
> with explicit NO MORALIZING on reschedules. Router refactored from
> pairwise to cardinality-based keyword pre-filter (`hitCount === 0` →
> general · `=== 1` → that specialist · `>= 2` → LLM tiebreak) so it
> scales to N specialists without O(2^N) pairwise branches. New
> SCHEDULE_SIGNALS regex anchored to "when can i" · "reschedule" ·
> "free/deep/focus/time block" · "push X to <weekday>". Still soft-
> launched (ENABLE_SPECIALIST_ROUTING gates the whole layer). New eval
> scenario specialist-routing-schedule.json proves the contract.
>
> **`6fc99da7` · task_loop reflection · extends CoALA cron to task-
> pattern lanes (task #17)** — two wins: (1) registers TASK_INSIGHT +
> TASK_PATTERN + ORPHAN_TASKS_NUDGE in BRAIN_CATEGORIES (closes the
> typo-protection gap · these were hand-typed strings in 4+ files for
> months · isKnownCategory now returns true). (2) Adds TASK_INSIGHT +
> TASK_PATTERN to the weekly reflection cron whitelist (auto-learn
> writes 3-5 task_insight/day · cross-cutting synthesis becomes useful
> at week scale). New contract test (10 tests) locks the whitelist so
> drift gets caught.
>
> **`189e6bc9` · MissionScoreboard · ComparisonMatrix surface #3 on
> /tasks (task #15)** — completes the consumer trio. Active missions
> × {progress · velocity (done today) · overdue · stale (days idle) ·
> deadline}. Pure derivation in `derive-mission-matrix.ts` (28 unit
> tests · mirrors derive-provider-matrix.ts pattern · zero React).
> Component self-fetches via `trpc.task.missions` + `trpc.task.list` ·
> self-hides when no active user missions with tasks · 60s poll +
> onDataChanged refresh debounced 500ms. Mounted in IntelPanel between
> TodaysCompound and CompoundChain — the "missions panorama" beat
> after today's signal before the multi-day compound view.
>
> **Flagged · NOT fixed:**
> - 358 ESLint `any` warnings still present (pre-existing · non-blocking).
> - vm_bundles cleanup (#10) still blocked behind a reboot — 20 claude.exe processes hold .vhdx file handles on AppData/Local/Roaming/Claude.
> - /tasks subtasks (true nesting via `Task.parentTaskId` self-FK) flagged by the agent on #7 — operator must define subtask semantics first. Separate Prisma-migration slice.

> ## 2026-05-22 · tRPC migration COMPLETE · 14 ships
>
> The day the REST→tRPC strangler-fig migration finished.
> `hooks/use-authed-fetch.ts` is **deleted** — zero importers
> remain. M-done achieved per the migration roadmap's own
> definition: "you cannot half-delete a function, so that
> milestone forced the migration to actually finish."
>
> **Phase B slices B.4 → B.14 · final 11 slices** · `bef2a860`
> (B.4 · actions/task domain) · `be2185bd` (B.5 · chat domain) ·
> `3c9ce883` (B.6a · ultron operator-domain) · `5627b8e4` (B.6b ·
> ultron task-domain) · `f3af544b` (B.6c · ultron system-domain) ·
> `68c3eb7e` (B.7 · brain domain) · `8e275dfe` (B.7a · system
> pages slice A) · `414c0e3a` (B.7b · system pages slice B) ·
> `6046ec50` (B.8 · misc pages) · `09b6230a` (B.9 · hooks ·
> partial) · `ac0d71d8` (B.10 · cross-domain residuals · chat +
> ultron + brain stragglers) · `fc218104` (B.11 · actions surface
> · added 9th router · ai) · `d7849454` (B.12 · scattered
> components · 13 files · ultron/goals/chat/brain/ai) · `7872709b`
> (B.13 · 7 straggler pages · + `app/voice/layout.tsx`) ·
> `2f172174` (B.14 · final hooks+lib slice · 16 authedFetch sites
> migrated · `hooks/use-authed-fetch.ts` DELETED · 10 new
> procedures · 7 new shared `lib/services/*` · 9 REST routes
> slimmed to call same functions · the migration CLOSES).
>
> **Supporting infra** · `9452aa84` (vanilla tRPC client for
> non-React call-sites · `createTRPCClient`) · `29e48302` (fix ·
> command-palette prerender · vanilla tRPC client at root-layout
> scope).
>
> **Out-of-band repairs** · `14ef500a` (feat · Nick response
> style · logical-hierarchy directive · scannable structure across
> reply turns) · `c3681b40` (fix · /financial page rendered "—"
> for every field).
>
> **Docs** · `9606359f` (Phase B progress update) · `b5ea7869`
> (Phase B progress reconcile) · `8e90711e` (tRPC migration
> roadmap · COMPLETE · M-done achieved · `hooks/use-authed-fetch.ts`
> deleted · importer grep returns 0 · only Phase C decommission
> of REST routes remains).
>
> **Gates** · per the migration roadmap doc · every slice gated
> typecheck + `eslint .` + full test suite + build-verified by
> pre-push `turbo build`. All 11 slices shipped green.

> ## 2026-05-21 · staleness deep-dive + reconcile — dead infra, dead code, fossil docs · 5 ships
>
> The operator's read — "a lot of old, stale, outdated data everywhere"
> — was correct. A 3-agent deep-dive audit (docs · dead code · stale
> comments) mapped it. Root finding: the CODE is disciplined (it
> self-documents its own removals), so code cruft is just "kept for
> now" files nobody garbage-collected — but the DOCS are the real rot,
> because they were append-only and never reconciled. Net of the wave:
> roughly −2,000 lines. typecheck + lint (0 errors) + the full
> 1954-test suite green.
>
> **`16fcb6a` · Nick's GitHub write/deploy capability removed** — 5 AI
> tools (githubWriteFile / CommitMultiple / SafeCommit / Deploy +
> checkDeployStatus) + 7 github.ts helpers, all wired to the retired
> statenour-os repo / codex branch / Vercel. They silently no-op'd
> (Nick "shipped", nothing reached prod); repointed at the live
> monorepo `main` they would push unreviewed code straight to
> production. Nick keeps every READ tool.
>
> **`a362b1d` · 9 dead files + dead logScore deleted** — −1,602 lines.
> projects-panel · home-strip · context-rail · mode-pill · capture-chip
> + 4 abandoned `components/3d/*` scenes. Every one grep-proven
> zero-import; the full 1954-test suite confirmed nothing depended on
> them.
>
> **`35bd055` · RECONCILIATION.md fossil fenced** — the buried v10.0.5x
> "READ THIS FIRST · single source of truth" header (which asserted the
> retired stack as current) is now a loud ⚠ HISTORICAL ARCHIVE fence.
>
> **`06bbbb3` · lying comments + dead CSS** — fixed the lib/logger
> comment that claimed client errors reach /system/logs (they do not);
> removed the `context-rail-drift` + `mode-pill-active` dead CSS.
>
> **`824e724` · doc infra-sweep · 10 files** — RUNBOOK · REPO-MAP ·
> AGENT-CONTRACT · README · AGENTS.md · ARCHITECTURE · DATA-MODEL ·
> tool-catalog · 3d-briefs · crons.ts swept from Vercel /
> codex → monorepo / `main` / Railway. AGENTS.md pre-push gate-count
> self-conflict resolved (verify:hard = 7 checks). Model count 78 → 80.
>
> **Deliberately LEFT (not stale-as-harm):** 2,313 `v10.0.x` version
> stamps + ~12 "extracted from X" archaeology comments — true history,
> bulk-editing them is churn with zero functional gain. `/plan`→`/goals`
> route refs also left — functional via a 301 redirect.

> ## 2026-05-21 · /tasks — quick-add P0, Tesla-minimal redesign, drift-class closeout · 6 ships
>
> The operator hit a dead quick-add ("can't add a task"). Root cause:
> taskCreateSchema required five fields the tRPC quick-add path never
> sends — a contract-drift bug the Phase-SS tRPC migration introduced
> and silent catch blocks hid. This wave fixed the P0, then closed the
> whole bug class: the over-stacked /tasks page was redesigned,
> swallowed errors made observable, the remaining tRPC mutations
> audited, and quick-add upgraded. typecheck + lint (0 errors) + tests
> green before each push · 20 vitest cases added across 3 files (2 new).
>
> **`f4703aa` · quick-add P0 — taskCreateSchema rejected thin payloads** —
> the quick-add bar POSTs ~7 fields through trpc.task.create; the
> schema required 5 more (nextPhysicalAction, frictionScore,
> energyRequired, context, finishCondition) with no default, so
> `.parse()` threw a ZodError → a generic "Failed to add task" toast.
> AI-adopt, omni-capture and chat long-press were dead too. The 5
> NOT-NULL columns now carry Zod defaults; createTask() falls
> nextPhysicalAction back to the title. 4 regression tests.
>
> **`4e746ff` · /tasks redesign — six intel widgets folded into one drawer** —
> daily brief · Nick's suggestions · operator pulse · today's compound ·
> compound chain · context band had each landed ABOVE the task list,
> one per wave. New `<IntelPanel>` disclosure folds all six BELOW
> NowPanel, collapsed by default, children mounting only when expanded
> (zero fetch when closed). Also re-surfaced /goals in the floating-orb
> nav — the KommandoShell teardown added it to NAV_ITEMS as a DEPTH
> item the orb (MOBILE_TABS only) never rendered.
>
> **`bf0d713` · /tasks failures now reach /system/logs** — lib/logger is
> console-only on the client, so every catch in tasks/page.tsx was
> browser-console-only and five handlers swallowed entirely.
> reportClientError() gained a `source` label; all nine operator-action
> catches (load · autoBackfill · genAi · addTask · completeLoop ·
> startTask · breakPromise · deleteTask · adoptAi) now report through
> the /api/errors → ErrorLog → /system/logs pipeline.
>
> **`0fa550c` · createMission drift fix + tRPC drift audit** — grepping
> all 8 routers for the permissive `.input(z.record/unknown/any)`
> signature returned exactly 2 hits: task.create (fixed) and
> task.createMission. createMission's missionCreateSchema had the
> identical bug — domain/priority/roiScore/neglectCost required with no
> default, but getInbox()'s auto-Inbox creation sends only
> {title,description,status}. Fixed with neutral defaults
> (PERSONAL/5/50/50). New tests/lib/validators/create-schemas.test.ts
> (6 cases) pins both schemas against their real thin payloads.
>
> **`f03649b` · quick-add done: prefix + promise ROI grading fix** —
> "done: cleaned the garage" creates then immediately completes a task,
> so the operator can log work finished earlier and still collect the
> streak/mastery credit; the colon is mandatory so "did I lock the
> door" stays an open task. Also: addTask hardcoded roiScore 80 for
> PROMISE and skipped scoreMutation for them — scoreTaskWithAI skips
> any task with roiScore !== 50, so promises were permanently
> un-graded. Every kind now starts at the 50 sentinel and gets graded.
> 10 parser tests.
>
> **`5917b4e` · IntelPanel signal badge** — the collapsed intel drawer
> gave no hint of folded content. IntelPanel gained generic
> signalCount/signalLabel props; the /tasks page feeds its overdue
> count → an amber "N overdue" pill on the collapsed toggle. No extra
> fetch — the page already derives `overdue`.
>
> **Flagged · NOT fixed**
> - **adoptAi roiScore** (tasks/page.tsx) — AI-adopted tasks hardcode
>   roiScore 90/50 and never call the score mutation, so they skip AI
>   ROI grading. Task #3's fix was scoped to the quick-add addTask path.
> - **load() per-fetch fallbacks** (tasks/page.tsx) — the
>   `.catch(() => [])` on each of the task / mission / goals fetches
>   silently degrades a failed fetch to an empty list; the operator
>   can't tell "no data" from "fetch failed". Deferred — touching
>   load()'s Promise.all is riskier; it's a deliberate partial-render
>   pattern.
> - **getInbox() description field** — sends a `description` key to
>   createMission, but missionBaseSchema has no such field (Mission has
>   no description column), so Zod strips it silently. Harmless but
>   dead / misleading code.
>
> **Update** · all three resolved same-session in `b8a5c42` — adoptAi
> now grades through the roiScore=50 sentinel, load() fetch failures
> report to /system/logs, and the dead `description` key is gone.

> ## 2026-05-21 · suggestion-improve — closing the suggestion-loop feedback loop · 3 ships
>
> Built the improve-agent counterpart for the suggestion-loop signal via
> a full brainstorm → design → implement arc. Nick's proactive suggestion
> chips now feed an analyzer that flags noisy kinds — the learning loop
> the C4 doc flagged as open is closed. typecheck + 144/144 test files
> (1934 tests) green before push.
>
> **`bc9eafd` · cover behavior-directive intensity gate** — first tests
> for behavior-directive.ts (the gate deciding whether Nick's prompt
> carries the ELEVATE directive): 13 cases over isStrictMode,
> resolveIntensity, getBehaviorDirective. Tail of the test-coverage loop.
>
> **`aa682bd` · suggestion-improve design doc** — docs/suggestion-improve-design.md ·
> output of a brainstorming session: understanding summary, assumptions
> A1-A5, decision log D1-D6, full design.
>
> **`247c7df` · suggestion-improve feature** — new lib/brain/suggestion-improve.ts
> (sibling of improve-agent.ts): reads suggestionLoopStats, flags any
> suggestion kind with dismissRate >= 0.5 over >= 5 signals as "noisy",
> persists one `suggestion_hypothesis` brain memory per noisy kind
> (operator-facing, surfaces on /brain/wisdom). New SUGGESTION_HYPOTHESIS
> category (RECALL-excluded). Wired as block 3 of the brain-feedback-loop
> cron. 11 vitest cases. Diagnose-only — no auto-tuning; operator decides.
>
> **Scope notes:** DPO export + LLM-synthesized aggregator fixes were
> explicitly deferred (design D1/D2). The /api/brain/improve-agent route
> was left out — it's read-only + improve-agent-specific; the cron is the
> canonical writer.

> ## 2026-05-21 · Nick agent hardening — test coverage + tooling + rerank telemetry · 6 ships
>
> Follow-up to the Nick agent wave below: hardened what shipped rather
> than adding surface. suggestion-loop.ts went from zero coverage to a
> 19-case vitest suite; a tooling crash blocking smoke-prod was fixed;
> and the brain-recall observability scope was finished by instrumenting
> the Cohere rerank stage. typecheck + 142/142 test files (1910 tests)
> green before each push.
>
> **`75d216f` · smoke-prod exits cleanly on Windows (undici teardown)** —
> scripts/smoke-prod.mjs ran its checks correctly but crashed on process
> teardown (libuv UV_HANDLE_CLOSING assertion), exiting non-zero even
> though every route passed. undici keeps keep-alive sockets + async
> handles open after the fetches resolve, and process.exit() races their
> cleanup. Fix: cancel each response body, then destroy undici's global
> dispatcher before exit.
>
> **`99bce19` + `35acaea` + `9103379` · suggestion-loop.ts full coverage** —
> the supervised-signal module had no tests. Now 19 cases in
> tests/brain/suggestion-loop.test.ts: getDismissedSuggestionIds (the VAD
> gate — id collection, Set de-dup, malformed-metadata skipping, windowed
> query), suggestionLoopStats (per-kind tallies, actionRate /
> positiveOutcomeRate, the divide-by-zero guard), and the write path
> (trackSuggestionAction + recordSuggestionOutcome — key format,
> confidence weights, validate-before-write). Closes the coverage gap
> flagged in the entry below.
>
> **`546d21a` · log cohere-rerank cost + counts on success** —
> cohere-rerank.ts only logged on failure; a healthy rerank — including
> Cohere's billed search_units — was invisible. Added one `[cohere-rerank]`
> success log. Completes the brain-recall observability scope.
>
> **Note:** an interim commit `28e1f13` added a first version of the
> write-path tests; `9103379` superseded it with the deduplicated set
> after a parallel turn appended a near-duplicate. Net state is one clean
> suite — nothing to action.

> ## 2026-05-21 · Nick agent — terseness + observability + signal gate · 2 ships
>
> Three Pipecat-inspired upgrades to the Nick agent — terseness, brain-
> recall observability, a suggestion signal gate — plus a tooling fix
> that unblocked the `prompt:size-check` gate. A C4 System Context doc
> for the Nick agent was added alongside (`docs/NICK-AGENT-CONTEXT.md`)
> so the next session reads a map instead of re-deriving it with a recon
> agent. typecheck + lint (0 errors) + 141/141 test files green before push.
>
> **`0e1e817` · Nick agent — terseness, brain observability, suggestion
> gate** — (1) the ELEVATE beat (`behavior-directive.ts`) and
> `BROADEN_AND_SUGGEST` (`operator-rules.ts`) flip from default-on to
> earned: a broadening line fires only on a real non-obvious angle, never
> on factual / status replies; both prompt builders (v1 + v2) aligned.
> (2) `contextual-recall.ts` wraps all six async recall stages in a
> `timed` helper and emits one structured `[brain-recall]` log per turn
> at every exit path — the pipeline was a black box. (3) `/api/nick/suggest`
> filters suggestions dismissed in the last 7d (`getDismissedSuggestionIds`)
> so a rejected chip stops re-firing on the 60s poll · VAD-style threshold.
>
> **`80ef38d` · fix measure-prompt-size crash under tsx (server-only)** —
> `scripts/measure-prompt-size.ts` crashed on import: the prompt-builder
> graph reaches modules that `import "server-only"`, which throws outside
> a React Server Component context. A bare `tsx` script has no
> `react-server` export condition, so `prompt:size-check` (and the whole
> `verify:hard` chain) died before measuring. `Module._load` now returns
> an empty module for `server-only` — the same no-op as its own
> `empty.js`. Tooling-only; the production RSC build is unaffected.
>
> **Flagged · NOT fixed (known gaps / judgment calls):**
> `getDismissedSuggestionIds` ships without a dedicated vitest unit — a
> real new-code-without-coverage gap, deferred · the `prompt:size-check`
> gate now *runs* but needs `DATABASE_URL` to complete (it measures the
> prompt against live Neon data), so `verify:hard` cannot reach a fully-
> green local state without Neon creds in the env — environmental, not a
> code defect.

> ## 2026-05-20 · Spline→R3F 3D pivot + de-Vercel sweep + /system hub redesign · 10 ships
>
> The 3D pivot day. Morning shipped a Spline scaffold (8 files in
> `components/3d/` with TBD scene URLs) · pivoted to React Three
> Fiber the same afternoon (Spline requires a human in its visual
> editor · R3F components are plain React + agent-buildable).
> Concurrent · de-Vercel sweep (retire `vercel.json` + dead
> Vercel-API subsystem + `autonicks.com` → `bdnick.info`) and the
> /system hub status-first redesign. This entry covers the
> non-bug-hunt arcs of the day · the two 05-20 entries below
> capture the bug-hunt waves.
>
> **3D layer pivot** · `ca467dce` (feat · Spline 3D integration
> scaffold Phase 1 · 8 files in `components/3d/` · `scene-registry`
> with 4 TBD scene URLs · `spline-scene` + `spline-canvas` +
> skeleton + `use-scene-binding` · all gracefully no-op until
> operator builds scenes in Spline editor) · `50fed272` (feat ·
> 3D layer · React Three Fiber pivot from Spline · drops
> `@splinetool/*` · keeps R3F stack already in deps ·
> `scene-canvas` + `canvas-inner` + 4 scenes · CommandCore
> icosahedron · KnowledgeGalaxy 56 instanced spheres ·
> FrameworkOrbit 52 orbiting spheres · AiPulse faceted breathing
> mesh) · `289f804c` (chore · de-stale FrameworkOrbit mount
> comment).
>
> **De-Vercel sweep** · `a2cf99bb` (retire `autonicks.com` →
> `bdnick.info` across statenour) · `30f6aa16` (remove dead
> Vercel-API subsystem + Vercel deps) · `f042e0ad` (retire
> `vercel.json` + de-Vercel the cron verifier) · `1ec5b18c`
> (de-Vercel the cron-diagnostics runtime report).
>
> **/system hub + /chat + /tasks redesign + a11y** · `3aa39202`
> (/system hub · status-first layout + grouped de-duped card
> grid) · `ddf5f99e` (/chat dead-code sweep + timestamp legibility
> fix) · `1f427600` (/tasks dead-code + filter-banner a11y +
> brand-token fixes).
>
> **Gates** · per-commit · pre-push `turbo build --affected` +
> vitest green throughout.

> ## 2026-05-20 · bug-hunt continuation · journal + chat pipeline + brain recall · 10 ships
>
> Picks up the wide-wave's flagged list, then two fresh code-review
> fan-outs (journal feature · chat pipeline) and a brain-recall audit.
> Every finding verified against real code before fixing — ~6 agent
> false-positives caught and retracted. typecheck + lint (0 errors) +
> green vitest through every ship; suite 1855 → 1891 (+36 tests).
>
> **Journal slice — 4 ships:**
>
> **`0c4ab3f` · journal-threads atomic writes** — `confirmCandidate`'s
> thread-create + candidate soft-delete now run in one `$transaction`
> (a crash mid-way had orphaned the thread); `joinThread`'s P2002
> check-then-act race is caught instead of throwing unhandled.
>
> **`c165515` · journal API routes map ServiceError → status** — all 6
> `/api/journal` routes returned 500 on an unauthenticated request, not
> 401: `requireSession` throws `ServiceError` but Next.js doesn't map a
> thrown error's `.status`. Each catch now maps it, matching the ~25
> other hand-written routes.
>
> **`61b1d0f` · convergence clusterHash stability** —
> `pruneCandidatesForExistingThreads` recomputed `clusterHash` from the
> pruned member set, minting a new BrainMemory key (and orphaning the
> prior row) each time a member was claimed by a thread. Hash now stays
> the raw cluster identity. Dead `BRAIN_CATEGORIES.DESC` removed.
>
> **`c22eb0e` · convergence test suite** — the convergence layer had
> zero coverage; +29 vitest units.
>
> **Chat pipeline — 4 ships:**
>
> **`008ab23` · tool-result verification no longer false-passes** —
> `environment-verifier` matched tool results by title with no time
> bound, so a stale same-title task verified a silently-failed
> `createTask` as success (feeds the fabrication detector); added a
> 5-min window + bulk verify now counts every task. `persist-user-turn`
> auto-complete ran `task.update(...).catch(()=>null)`, letting a failed
> update fall through to a false `Auto-completed` audit event.
>
> **`02d15b4` · fabrication hedge banner now persisted** — the L2
> hedge-banner rewrite reassigned `cleanedText` AFTER the assistant
> `ChatMessage` was already written, so the DB kept the un-hedged
> fabricated claim. The row is now patched (content + parts +
> searchableContent) after the rewrite.
>
> **`fed96b8` · new-conversation persist atomic** — `persist-user-turn`
> created the conversation row then the first message in two separate
> awaits; a crash between them orphaned an empty conversation. The
> new-conversation path is now one `$transaction`.
>
> **`77a568a` · claim detector abbreviation-safe split** —
> `splitSentences` broke a sentence on the period inside "i.e."/"e.g.",
> stranding a claim's verb and object in separate fragments (detected in
> neither). Negative lookbehinds added; +2 tests.
>
> **Mark-and-sweep + brain recall — 2 ships:**
>
> **`e9a42e6` · stale convergence-candidate sweep** —
> `sweepStaleCandidates` soft-deletes candidates whose cluster stops
> converging across scans (entries age out of the window) on a
> 3-nightly-scan TTL; previously they lingered in the radar forever.
> +2 tests.
>
> **`f1b6b2e` · Cohere rerank fetch abort signal** — the rerank `fetch`
> carried no `AbortSignal`; `withGuardian`'s timeout races the promise
> but doesn't abort the socket. Added `AbortSignal.timeout(7500)`.
>
> **Prior wave's flagged list — all resolved.** The wide-wave entry
> below flagged the timezone cluster, the `persist-user-turn` goal-lift
> bypass, `convertCaptureItem`'s missing transaction, and document-wide
> HEDGE_PATTERNS suppression — all four were fixed earlier this session
> (ET datetime helpers · `040a093` · `92a46fd` · `92af84f`).
>
> **Verified NOT bugs** (agents over-flagged · verify-don't-trust
> caught these): `chat-recall` "pairs mis-indexed" (`pairs` and
> `messages` are both `.map()`-derived — fully index-aligned) ·
> `ChatMessage` "missing `deletedAt` filter" (the model has no
> `deletedAt` column) · `journal-feed` situation typeFilter (consistent
> with the `reflection` entryType) · `rrf.ts` / `similarity.ts` ranking
> math verified clean.
>
> **Flagged · NOT fixed (low-severity / judgment calls):**
> `contextual-recall`'s token budget counts only memory content, not
> formatting + cross-source overhead — the block can run ~5-10% over an
> (explicitly approximate) budget · `cohere-rerank` would drop the
> middle slice when `topN < poolSize`, but that path is dormant (the
> sole caller passes the full pool length).

> ## 2026-05-20 · wide bug-hunt wave · 4-agent parallel audit → 4 ships
>
> Four `code-reviewer` agents audited ~1,300 files in parallel across 4
> slices (API routes · AI/chat stack · services+db · components+3D).
> ~30 findings → each verified against real code → clear/safe/high-value
> ones fixed, the rest flagged. ~17 bugs fixed in 13 files. typecheck +
> lint (0 errors) + 1855/1855 tests green through every ship.
>
> **Ship-by-ship roll-up:**
>
> **`a0bd932` · 3D scene memory leaks + per-frame allocations** — two
> `useMemo(() => () => dispose())` GPU-buffer cleanups that never ran
> (useMemo memoizes a value, never invokes a returned fn) → useEffect;
> `mastery-polyhedron` lineGeometry given a dispose path; `THREE.Object3D`
> / `THREE.Color` allocations hoisted out of `useFrame`; reduced-motion
> check moved off render into an effect (was a hydration mismatch);
> `use-voice-input` continuous-mode RAF loop given a cancel handle.
>
> **`79da25f` · 2 unauthenticated API routes + timing-safe cron compare**
> — `GET /api/mastery` (scores incl. evidence text) and
> `GET /api/cameras/[id]/snapshot` ran with zero auth (`apiHandler` with
> no `auth` option runs no guard); `prompt-cache-flush` compared
> CRON_SECRET with `===` (timing oracle) → exported `auth-guard`'s
> constant-time `safeEqual`.
>
> **`5497222` · goal-progress write races + truth-grounding regex leak**
> — `liftGoalOnTaskComplete` + `updateGoal` read-then-wrote
> `lifeGoal.currentValue` (lost-update race under concurrent task
> completes) → atomic `{ increment }`; `truth-grounding` extractEntities
> ran a module-level `/g` regex whose `lastIndex` leaked past an early
> `break`, silently disabling L4 fabrication-grounding on the next turn.
>
> **`20b196f` · exclude `.next-prod` build artifacts from vitest** —
> vitest.config excluded `.next/` but not `.next-prod/` (statenour's
> `NEXT_DIST_DIR` for `build:local`); a stale `.next-prod/standalone/`
> tree left vitest collecting ~173 bundled nickstire test files →
> permanently-red suite (24 failed files / 73 failed tests, masking real
> regressions). Now 140 real files, 1855/1855 green, 10.7s (was 29.7s).
>
> **Flagged · NOT fixed (real bugs · need a bigger/riskier change):**
>
> - timezone cluster — `startOfLocalDay`/`startOf` in `execution.ts` ·
>   `scoreboard.ts` · `business-intel.ts` · `strategic-triggers.ts`
>   compute day boundaries in server-UTC, not ET; "today"
>   scoreboard/revenue is off ~5h daily. Needs an ET-aware date helper.
> - `persist-user-turn` chat auto-complete bypasses
>   `liftGoalOnTaskComplete` — chat-completed tasks never lift goals.
> - `convertCaptureItem` has no transaction — partial failure orphans a
>   task/mission/lead.
> - `action-claim-detector` HEDGE_PATTERNS suppress fabrication
>   document-wide (a message that both fabricates AND hedges drops the
>   fab claim) — needs a sentence-aware, test-covered refactor.
> - lower-pri — bare `\bpinned\b` fab false-positive · truth-grounding
>   sequential DB loop · several swallowed `catch` blocks in AI handlers.
>
> **Verified NOT bugs** (agents over-flagged · "verify don't trust"
> caught these) — `brain-bus-durable` check-then-act (the P2002 catch +
> Postgres conflict-blocking make the dedupe correct) · `use-wisdom-
> suggest` `dismissed.size` effect dep (effect only acts on empty draft).

> ## 2026-05-19 · monorepo Tier-1+2 buildout + supervised-signal loop + fetch-timeout sweep · 36 ships
>
> Three overlapping arcs · (1) Monorepo Tier-1+2 buildout (Turbo
> affected · pre-push validation · shared packages · BuildKit
> cache · CI matrix) closing the 9-hour Wave 40 deploy thrash ·
> (2) supervised-signal loop end-to-end (NickSuggestions chip taps
> + dismiss-X → `brain_memory` rows → outcome rollup cron +
> operator stats endpoint) · (3) fetch-timeout sweep
> (`wave-181.91+92`) bounding every external fetch wall-clock ·
> plus the tRPC strangler-fig push from `/tasks` to `/knowledge`
> (Phases SS through AAA · J at 36/50+ surfaces by EOD).
>
> **Monorepo Tier-1+2 buildout** · `cec9dda1` (Turbo + pre-push +
> shared packages + BuildKit cache + CI matrix · cold 987ms →
> warm 103ms · 9.5x speedup) · `2c2fe056` (`next.config.ts` add
> `@nour/utils` to `transpilePackages`) · `834ccc73` / `ab504b25`
> / `6231e396` (Dockerfile BuildKit cache mount fixes · Railway
> rejects `id=` field) · `deeb363b` (Tier-3 · `@nour/utils` ships
> pre-built `dist/` · drop transpilePackages dep) · `e6776a39`
> (`pnpm smoke:prod` · post-deploy verification) · `07e2012c`
> (`pnpm audit:surfaces` · Elon delete-first companion script).
>
> **Supervised-signal loop · end-to-end** · `e9fe26b3`
> (`brain/suggestion-loop` · supervised-signal capture for Nick
> suggestions) · `0dda5695` (NickSuggestions chip taps →
> suggestion-loop API) · `696f854f` (`SUGGESTION_LOOP` to
> `BRAIN_CATEGORIES`) · `b41022a9` (dismiss-X on each Nick
> suggestion chip · captures `event=dismissed`) · `cc2e9378` (GET
> `/api/system/suggestion-loop-stats` · operator-visible signal
> capture) · `1dde046e` (`/api/cron/suggestion-outcome-rollup` ·
> closes the Ilya loop end-to-end) · `0466246d`
> (`suggestion-outcome-rollup` added to `EVENING_JOBS` fan-out) ·
> `848a302b` (NickSuggestions on /tasks · supervised-signal
> capture on second surface).
>
> **Fetch-timeout sweep** · `b730eeda` (wave-181.91 · 9
> high-traffic AI sites + shared helper) · `d65aa86a`
> (wave-181.92 · 23 lower-priority sites · cron-driven + admin
> integration paths · every statenour external fetch now has
> bounded wall-clock).
>
> **tRPC strangler-fig push · Phases OO-AAA · 7 surface migrations
> + Mastery Polyhedron** · `3d231b5d` (OO · /goals page snapshot ·
> J at 22/50+) · `c2b05958` (PP · /tasks reads · 6th router ·
> task) · `05495f23` (QQ · TaskEvent typed read · J at 24/50+) ·
> `85bc8589` (RR · /tasks 4 mutations migrated · J at 25/50+ ·
> 50% threshold) · `0d56980a` / `46908a3c` / `54da813c` /
> `9f542641` (SS.1-SS.4 · /tasks 2 create mutations · AI roiScore
> + AI task generation + bulk backfill · 100% on tRPC) ·
> `1826361a` (TT · /journal · 7th router) · `849f055d` (UU ·
> /brain/wisdom · 8th router) · `f46d2dfe` (VV ·
> /brain/link-review · brain router at 5) · `5f894cb0` (WW ·
> /scoreboard snapshot) · `9f3e5475` (XX · /body daily check-in) ·
> `ad5c19bb` (YY · /pins · brain router at 9) · `818f5746` (ZZ ·
> /knowledge reads · operator router at 9 · J at 36/50+ · 72%) ·
> `2d34555e` (Phase AAA · Mastery Polyhedron on /goals · 1st
> bespoke 3D identity moment).
>
> **Chat composer redesign** · `f8488ede` (v10.0.529.96 · Wave
> 40 · chat composer redesign · slim chrome + upper-middle empty
> state).

> ## 2026-05-18 · Nick Reasoning Engine "Charizard" + tRPC strangler-fig start + deeper coherence · 63 ships
>
> Biggest single day in the gap. Three overlapping arcs · (1) Nick
> reasoning engine upgrade (Charmeleon→Charizard · Phases H
> through H.8) including OperatorPulse + CompoundChain
> visualizations · (2) tRPC strangler-fig migration kickoff
> (Phases J through GG · 13+ domain routers + 7 surface
> migrations · J at ~26% by EOD) · (3) deeper coherence pass
> across mastery primitives + design tokens + /journal
> pattern-radar Phase D completion.
>
> **Nick Reasoning Engine · Phases E-H.8** · `a1dbd5ad` (Phase E ·
> OperatorPulse forward-looking intelligence across 4 mastery
> surfaces) · `ebdb6bc9` (Phase F · wisdom line · context-matched
> persona-weighted) · `70735965` (Phase G · CompoundChain ·
> see-your-work compound visualization) · `7f713f72` (Phase G.2
> bugfix) · `da7ed9aa` (Phase H · Charmeleon → Charizard) ·
> `42ada555` (Phase H.2 · Mega Charizard · 5-feature reasoning
> upgrade) · `43021b63` (H.3 · 4 critical critique items from
> H.2 self-audit) · `00ce2867` (H.4 · 7 H.2 critique backlog
> items shipped) · `60f2526e` (H.5 · real cost threading +
> telemetry UI + marker quality) · `a50f696d` (H.6 · 3
> high-severity bugs from find-bugs audit) · `86d42546` (H.7 ·
> MEDIUM/LOW audit items closed) · `4c82abf2` (H.8 · real
> sub-pipeline `callCount`).
>
> **tRPC strangler-fig · Phases J-GG · 4 domain routers + 17
> surface migrations** · `a37a4442` (Phase J · H-series surfaces ·
> type-safe end-to-end) · `1ada9abb` (Phase Z · 4th tRPC router ·
> chat · ChatHistorySearch migrated) · `14705ea7` (Y · 2 more
> /system/* migrations) · `49487f0e` (AA · /system/judge-eval
> polish · 5 findings) · `f0a14875` (BB · category codemod sweep
> · 133 files / 411 replacements · category migration CLOSED) ·
> `f0587679` (CC · audit V-BB chain · 4 real bugs caught + fixed) ·
> `81d039f4` (DD · MessageBranchSwitcher) · `f249e90e` (EE ·
> MessageInfoCard provenance + BB codemod regex broadened) ·
> `068dc89b` (FF · audit V-EE chain · 6 surgical fixes) ·
> `eb97edf9` (GG · LaneCorrectionChip) · `8a5c7b18` (HH ·
> EmailDraftCard send · first true `.mutation()`) · `9ae17d94`
> (JJ · MessageEditControls edit + history) · `26ea463c` (II ·
> NickMessage image upscale + vary) · `01ceb082` (KK ·
> BuilderSandbox deploys + rollback) · `aa9bf3da` (LL ·
> BrowserSandbox · 5th domain router) · `de26150b` (MM ·
> ActionClaimWarning) · `60c8a472` (NN · cron-diagnostics
> mutations · T.4 carve-out closed).
>
> **Cross-cutting skill-driven hardenings** · `79d35129` (Phase L ·
> modern-JS adoption · 5 patterns + 1 architectural bug fix) ·
> `7f22f8ba` (M · CrewAI-inspired · smart tier + personas +
> plan-first UI) · `830a5ed5` (N · `cc-skill-*` inspired · 6
> items + 2 real bug fixes) · `93412826` (O · TypeScript advanced
> types · 3 surgical safety hardenings) · `e563dd03` (P ·
> legacy-modernizer surgical hardening · tests + codemod +
> deprecation) · `6e957e84` (Q · strangler-fig migration tracker
> · 3 items · 4 docs + flag registry + tracker UI) · `8c57496f`
> (K · operator review pipeline · 5-piece pre-push + audit +
> lookup) · `435121b1` (R · M.2 persona wiring · scorer sees
> real keys) · `ac7a39e6` / `6a66ddf6` / `4cd39099` (S/T/U ·
> persona wiring + 3 /system/* tRPC migrations) · `4366fc26`
> (V · AGENT_V1→V2 judge-eval comparator · Phase 0 safety net
> shipped) · `b7ec78c7` (W · AGENT_V2 corpus-building workflow) ·
> `c8bc8f61` (X · AGENT_V2 auto-corpus cron · Phase 0 COMPLETE
> end-to-end).
>
> **/journal pattern-radar Phase D completion** · `ce3cc591`
> (deeper coherence pass · ADR-0014 + Reflection auto-join + 3
> hook conversions) · `0eb9c942` (mastery primitives +
> goals/scoreboard conversions) · `fa835588` / `176803f4`
> (cross-links #1-3 · 4 surfaces mesh) · `de81a314` (Phase D
> TRUE completion · all 4 journal sources wired to auto-join) ·
> `9e22f069` (manual scan trigger) · `92e43e26` (radar
> observability on `/api/health`) · `08d81ea5`
> (operator-initiated thread creation).
>
> **Design + canonical headers** · `b9d3f46e` (HomeStrip →
> HomeNarrator · editorial sentence as router) · `2f871cf1`
> (/voice redesign · brief leads + live-call follows) ·
> `acd9429c` (/brain hub · canonical header + 5 zones · was 22
> stacked atoms) · `a1481f73` (goals + scoreboard header drift
> fixes) · `292bd08b` (MasterySectionLabel · canonicalize
> tracking + tone) · `0ec16392` (design tokens · mastery
> primitives realigned to aesthetic-principles + ADR-0015).
>
> **Build + Railway fixes** · `3eb5cbe2` (fix · /tasks
> force-dynamic for `useSearchParams` · Phase B build-failure
> root cause) · `6b3083d8` (Suspense wrap `useSearchParams`
> pages) · `b45c0275` (all hook adoptions double-wrapped
> useAuthedFetch type · components silently no-op'd) · `5a71a838`
> (MasterySectionLabel h2 → p · global h2 override broke eyebrow
> sizing) · `d435b04b` (cache-bust Dockerfile to break Railway
> BuildKit corruption) · `b79d6239` (touch health route to force
> fresh Railway snapshot upload) · `aac62eb4` (wave-181.51 · SMS
> instrumentation · reply-rate + attribution + A/B + admin tile).

> ## 2026-05-17 · monorepo cutover + WAVE-200 substrate · 43 ships
>
> The cutover day. statenour-os left its standalone repo and
> Vercel deploy and landed in the monorepo (`apps/statenour/`)
> with a Railway twin (`statenour-web` + `apps/worker/`).
> Concurrent with the cutover · WAVE-200 substrate landed
> (Mastra agent · Inngest durable workflows · LiveKit operator
> voice · Customer 360 + predictive brain · multi-channel morning
> brief). Closing the day · orphan dead-code sweep.
>
> **Cutover (CP2-CP9)** · `7a8a2eb4` (CP3 import) · `e022ddb9`
> (CP4 worker) · `1754e84c` (CP5 Dockerfiles + `APP_BASE_URL`) ·
> `88e905eb` (CP6 worker → `/api/cron/*` forwarding) ·
> `4bf96cde` / `a628860c` / `4528019d` (CP7 force-dynamic +
> 300s `staticPageGenerationTimeout` for Railway) · `553bb952`
> (CP9 merge) · `ef2313bd` (cutover landed) · `4ce4ace7` (drop
> email/Resend from `/api/health`).
>
> **WAVE-200 substrate** · `def38ce9` (Phase 0 · Mastra +
> Braintrust scaffold + 3 ADRs) · `b27b58fb` (Phase 1 · Nick as
> Mastra agent + eval suite) · `2b29d3e0` (Phase 3 · Inngest
> durable workflows · mega-fanout) · `d99a69f3` (Phase 4 ·
> LiveKit operator voice · Python worker + PWA launcher) ·
> `19462256` (Phase 5 · morning brief multi-channel · push +
> audio) · `b899cb83` (Phase 6 · Customer 360 + predictive brain
> scaffold) · `aca0dbf0` (Phase 7 · Mastra memory +
> Inngest→Telegram + brief×prefs) · `f16c4dcc` (Phase 7+ ·
> memory wiring fix + play brief + smoke harness) · `10f28472`
> (11 audit fixes from code-reviewer + silent-failure-hunter +
> live Chrome smoke) · `894a1e4c` (Phase 1.5 · `/api/ai/chat`
> AGENT_V2 cutover gate · early-exit) · `02c7cc85` (Phase 1.3 ·
> `@mastra/pg` flag-gated scaffold) · `1d4d554e` (env spec
> covers all 9 substrate flags) · `d3f93b6b` (Inngest completion
> wave · 6 follow-ups) · `a9e3f7e2` (outreach segmentation ·
> end-to-end approval loop wired) · `8f9d8d33` (Phase 4
> follow-up · voice-bridge bearer token · ADR-0006) · `17b4507f`
> (nickstire · `recent_customer_ids` query activates statenour
> customer-prefs cron).
>
> **Orphan + dead-code sweep** · `6da0effd` (33 orphan API
> routes deleted · 0 callers) · `e0a75262` (13 orphan components
> deleted) · `e647606c` (6 orphan crons wired into mega fan-out)
> · `4400af39` (`token-age-watch` + `semantic-link` wired per
> registry intent) · `ce2fdfd9` (3 coherency holes from audit) ·
> `9d28b73e` (`.gitignore` was hiding /system/logs page + API
> route).
>
> **Auth + middleware hardening** · `da470bd8` (`/api/agent`
> bypasses global auth middleware · handles bridge-token +
> session auth) · `b440d0dd` (`/api/inngest` bypasses global
> auth · webhook validates HMAC itself) · `f17c3f6e` (mega-fanout
> concurrency 6→5 to fit Inngest free tier cap) · `54a4ff20`
> (`autonicks.com` dropped · Railway canonical host).
>
> **Schema + migration catch-up** · `a41b99a7` (catch-up DB
> migrations to match deployed Prisma client) · `1f2ea4e3`
> (`/api/health` functions count 5→6 · goal-pruner added).

> ## 2026-05-16 · Consolidation Sprint · Waves 46-55 · ~10 ships (pre-monorepo · partially conjectured)
>
> The 18-dimension god-mode audit + 10-wave consolidation pass.
> Took an "85% coherent / 15% drift" codebase and shipped 10
> surgical waves in one day · zero rollbacks · all 15 pre-push
> gates green · ~1,400 LOC removed · 4 silent-failure modes
> closed · 30 new tests · 1747 vitest passing at EOD.
>
> **Honesty footnote** · the commits themselves are NOT in this
> monorepo's git log — they shipped on the standalone
> `statenour-os.git` repo before the 2026-05-17 import (CP3 ·
> `7a8a2eb4`). The two surviving artifacts are
> `docs/CONSOLIDATION-PLAN-2026-05-16.md` (Waves 46-57 ranked
> plan) and `docs/cohort-2026-05-16-consolidation-eod.md` (the
> EOD sprint summary). The wave decomposition below is sourced
> from those · the wave 47 SHA is missing because the plan doc
> lists it as "(Phase A · already on branch)". **Treat the SHAs
> below as historical references from the pre-cutover repo · they
> will not resolve via `git show` in NOURCITY.**
>
> - **Wave 46** · `08f8f85` · `CONSOLIDATION-PLAN-2026-05-16.md`
>   published · the 12-wave roadmap synthesized from 18 parallel
>   code-explorer agents.
> - **Wave 47** · Elon delete-first sweep (Phase A) · 2 retired
>   autonomous rules + 3 dead Settings hub links pruned.
> - **Wave 48** · `7e5adf1` · 11 standalone crons folded into
>   mega-evening fan-out · cron double-billing killed.
> - **Wave 49** · `3913721` · security lockdown · 3 unauth GETs
>   gated · structured logger for mock-bypass warn · runner-secret
>   dev fallback removed.
> - **Wave 50** · `ddbb2e5` · 3 hook primitives shipped ·
>   `usePollingFetch` · `useAbortableFetch` · `useLocalStorageState`
>   (33+ files have a migration target · migrations deferred).
> - **Wave 51** · `88c43e6` · 5 mobile gap fixes · /mastery
>   radar · /financial chart · /content/history table · /social
>   checkboxes · /system database-models grid.
> - **Wave 52** · `e448f16` · 2 silent event-emit gaps closed ·
>   `updateTask` now emits `task.completed` to brain-bus ·
>   `/tasks/[id]/start` now emits `TaskEvent.started`.
> - **Wave 53** · `d21747f` · `tool_telemetry` BrainMemory
>   dual-write removed · ~225 LOC legacy JSON-blob writes gone.
> - **Wave 53b** · `1822a87` · 3 more dual-writes removed ·
>   `autonomous_event` + `provider_ping` + `telemetry_tool_verb`
>   in one batch (identical pattern).
> - **Wave 54** · `7522711` · 30 new tests covering 3
>   previously-untested brain primitives · `resolveInboxMissionId`
>   + `memory-manager` + `auto-learn`.
> - **Wave 55** · `78b1435` · Descript registry stub deleted ·
>   HuggingFace Whisper + Tuya + 3-source search quorum KEPT with
>   documented rationale (deferred future migrations, not bugs).
> - **Wave 56** · docs reconciliation starter (in-progress at EOD
>   · ULTRON-VISION + CONSOLIDATION-PLAN status headers
>   corrected).
> - **Wave 57** · config strictness (`noUncheckedIndexedAccess` +
>   `exactOptionalPropertyTypes`) · explicitly DEFERRED to its own
>   sub-plan · 100+ existing call sites need fixes first.
>
> **Companion doc shipped same day** ·
> `docs/NEXT-EVOLUTION-2026-05-16.md` · 6-agent god-mode audit
> across cost/capability · cognition · UX · data+ops · tech debt
> · strategic capability · the "what's NEXT" master roadmap.

> ## 2026-05-13 → 2026-05-15 · pre-monorepo standalone-repo waves · **GAP**
>
> **Gap · backfill pending** · these dates predate the monorepo
> cutover (CP2-CP9 landed 2026-05-17). statenour was still in
> its own `nourdean22/statenour-os.git` repo and pushed to
> Vercel. No commits for these dates exist in the current
> monorepo git log (`apps/statenour/` was created via
> `git archive HEAD` on 05-17 · losing the standalone repo's
> commit graph). The work itself landed —
> `docs/session-handoff-2026-05-12.md` covers the v10.0.485 →
> v10.0.507 arc shipped just before this gap window opens — but
> reconstruction of per-day waves between 05-13 and 05-15 would
> require pulling the archived standalone repo. Not attempted
> here · operator decision needed if this gap matters for audit
> trail.

> ## v10.0.528 → v10.0.529.6 · audit-driven hardening wave · 2026-05-12 · 8 ships · 1 cohort
>
> Single-day aggressive push closing every High-severity audit finding
> from the 2026-05-12 sweep (silent-failure · STRIDE/OWASP · API
> readiness · DB cost) PLUS the deferred decision-replay UI consumer
> from Arc B Feature 3. Quantitative result:
>
> - **CVEs · 43 → 13 vulns** (–30) · **highs · 15 → 0** (–15)
> - **Cron budget · 38/40 → 36/40** (4 slot headroom · was 2 · device subsystem retired)
> - **Routes sanitized · 0 → 26** via new `sanitizeError` helper
> - **High-risk migration applied** (8 missing indexes + 14 dead drops on prod Neon)
> - **4 tool surfaces fenced** for prompt-injection defense (`searchDocuments`, `searchWebVerified`, `findRelatedConversations`, `ingestDocumentFromUrl`)
> - **2 cost-heavy tools quota-gated** (`runPython` 100/day · `ingestDocumentFromUrl` 50/day)
> - **xlsx → exceljs** · last 2 high CVEs (zip-bomb · ReDoS) closed
> - **1675 tests green** through every ship
>
> **Ship-by-ship roll-up:**
>
> **v10.0.528 · Wave 6 · 4 parallel agents · tracer obs + a11y bump + eval 35→75 + decision-replay coach** — `app/api/system/agent-traces/[id]/timeline` + waterfall component + focus-trap drawer; mobile composer 40→44px, textarea 40/32→44/36, tickers 20→32px mobile, `role="region"` + `aria-live="off"`; 40 new eval questions in 4 categories (`brain_recall_precision`, `tool_use_correctness`, `voice_intent_classification`, `anti_pattern_detection`); daily `decision-replay` cron folded into mega-morning picks `MasteryDecision` ≥30d, matches Munger/Naval/Buffett/Greene wisdom (no new schema · reuses `DecisionReplay` model). Pre-existing TS fix on decision-replays/route.ts (`never[]` collapse → hoisted type aliases).
>
> **v10.0.529 · deferred silent-failure + security fixes + Ultron tile** — H3 conversation-recall embedding-decode skip counters · H4 morning-brief idempotency fails closed · H5 morning-brief durable-write reports `persisted: bool` · S-2 OAuth CSRF state cookie (CSPRNG, HttpOnly Secure SameSite=Lax, timing-safe verify) · S-4 `getClientIp` prefers `x-vercel-forwarded-for` + last-non-private-hop walk · `server-only` declared in package.json · new `DecisionReplayCard` mounted between ObservabilityRow and SinceLastVisitCard (silent when queue + history both empty).
>
> **v10.0.529.1 · v526 index migration APPLIED to prod Neon** — 8 new indexes via `CREATE INDEX CONCURRENTLY` (chat_messages_conv_role_created, brain_memories_source_created, agent_traces_label_started, entity_audits_type_action_created, chat_messages_parent_created, brain_bus_events_topic_status_available, audit_events_event_actor_created, plus M8 fixup for PascalCase `AuditEvent` table) · 14 dead drops via `DROP INDEX CONCURRENTLY` (vector_embeddings standalones + 12 tiny-table createdAt/updatedAt) · new reusable `scripts/apply-pending-migration.ts` (autocommit pg driver, bypasses Prisma's implicit transaction wrap) · `prisma migrate resolve --applied` recorded · `migrate status` clean (23 migrations).
>
> **v10.0.529.2 · security mediums + silent-failure M6** — T-2 SQL injection defense-in-depth (runtime allowlist on `/api/brain/search-hybrid` `source` enum) · T-3 proper HTML escape in OAuth `errorPage` (covers `&<>"'/` not just `<`) · S-3 OAuth `/start` session-gated · D-3 xlsx CVE deferred with documented rationale · M6 morning-brief 5-query `personal_slice_<label>_failed` logs.
>
> **v10.0.529.3 · rate limits + silent-failure mediums + CVE cleanup** — D-1 `checkAiRateLimit` on autocomplete + suggestions + transcribe + chat/documents · `checkRateLimit("general")` on lane-check/feedback · M1 regression-runner stream parse skip-ratio warn (>50% → SDK drift, not regression) · M5 multi-search per-source timeout vs other failure discrimination · M7 tavily/exa/perplexity body-decode-failure distinction · **Next 16.2.3 → 16.2.6** (closes 7 high CVEs · SSRF · DoS×2 · middleware bypass×3 · App Router bypass) · pnpm.overrides `axios>=1.15.2` (4 high CVEs) · `fast-uri>=3.1.2` (2 high CVEs).
>
> **v10.0.529.4 · sanitizeError helper + tool-quota guard** — new `lib/utils/sanitize-error.ts` scrubs postgres URLs, Bearer tokens, `sk-*` keys, absolute paths, IPv4 (caps 200 chars) · applied via `replace_all` to 12 high-traffic AI routes (chat, suggestions, documents, assist, tasks, plan-day, teach, voice-to-content, coach-goal, nick-noticed, suggest-goals, review) · new `lib/ai/tool-quota.ts` daily-quota check via `BrainMemory(category="tool_quota_daily")` (no new tables) · wired into `runPython` (100/day · matches E2B free tier) and `ingestDocumentFromUrl` (50/day · 10× operator headroom).
>
> **v10.0.529.5 · I-1 sweep + xlsx→exceljs + E-3 prompt-injection fences** — sanitizeError swept to 14 more routes via parallel agent (ultron×4 · system×3 · cron×3 · brain · social · tasks · operator-brief · total 26 routes) · `xlsx@0.18.5` → `exceljs@4.4.0` via parallel agent (6.8M weekly downloads · zero CVEs · TS types bundled · ParsedDocument contract preserved · CSV path + xlsx path both rewritten) — closes the last 2 high CVEs · new `lib/ai/tool-result-fencing.ts` wraps `searchDocuments` / `searchWebVerified` / `findRelatedConversations` outputs in `<tool_data tool="..." source="external_web|external_doc|cross_session">` fences · system prompt gains `TOOL_DATA_FENCING_RULE` (~170 tokens) teaching the model to treat fenced regions as data not instructions.
>
> **v10.0.529.6 · cron retirement + docs reconciliation** — device subsystem retired (3 crons: `device-command-reap` · `device-sync` · `device-health` · all mode `retired` · schedule `null`) freeing 2 slots (38→36 active · 4 slot headroom · was 2) · saves ~430 wasted invocations/day · routes preserved for future re-activation · this RECONCILIATION entry written.
>
> **Operator-pending (carries to v530):**
>
> - `prisma/migrations-pending/20260512_v526_voice_latency/` · belongs on nickstire after VAPI migration · parallel session decides drop vs land
> - `app/api/cron/status/route.ts` · past retire-by date · pre-push gate warns · explicit nod needed to delete the file
> - E-3 Phase 2 · classifier over tool outputs + dangerous-combo block-list (e.g. `searchDocuments → ingestDocumentFromUrl` in one turn needs HITL) · longer-form work, not blocking
> - 12 moderate transitive CVEs (no broadly-exploitable paths · sweep after next major dep upgrade wave)
> - Spline 3D plan at `~/.claude/plans/silly-tickling-journal.md` · operator must build scenes in editor before integration

> ## v10.0.442 → v10.0.484 · sprint reconciliation · 2026-05-07/08 · 43 versions · 2 cohorts
>
> Two-day push spanning forward work + bug-fix recovery. Full sprint
> summary lives at `docs/cohort-2026-05-08-eod-summary.md`.
>
> **Cohort A · forward work (v10.0.442-472, 31 versions, 2026-05-07):**
> Closed v1↔v2 prompt-builder drift (v10.0.444-447 · 5 audit findings) ·
> shipped v2 cutover plan with 5 criteria + 4 phases + 3 rollback levels
> (`docs/v2-prompt-cutover-plan.md`) · backfilled 10 ADRs covering provider
> chain · CoALA · prompt builder split · withGuardian · Anthropic cache ·
> pgvector · skill recall · glitch taxonomy · multi-agent fan-out · editorial
> aesthetic (`docs/adr/0001-…0010-…`) · ran schema-timestamp audit (8 mutable
> models flagged) · fixed text-secondary contrast (3.28:1 → AA) · added
> universal `prefers-reduced-motion` rule · converted 17 box-shadow keyframes
> to opacity-on-pseudo for compositor-only animation · gated brand-anchor
> cascade to `[data-anchor]` opt-in.
>
> **Cohort B · bug-fix wave (v10.0.473-484, 12 versions, 2026-05-07/08):**
> Schema migration for 8 `updatedAt` columns reverted (v10.0.473) when
> `pnpm prisma migrate status` revealed migration never applied to prod
> Neon · migration parked at `prisma/migrations-pending/`. Image-gen
> routed back to Venice flux-2-pro (v10.0.477-480) — defense-in-depth
> via internal delegation in `lib/ai/openai-image.ts` after module-cache
> stale imports kept resurrecting OpenAI billing-cap path. Mobile chat
> composer recovered (v10.0.478) by hiding 3 toolbar buttons under `sm:`
> breakpoint — textarea was 0px on iPhone. Layout regression fixed
> (v10.0.474) by reverting state-aura `position: relative` (was creating
> containing block for `position: fixed` descendants → 2545px layout).
> Ideation regex tuned (v10.0.475, 483) to block "come up with",
> "brainstorm", "help me cook up" from firing image-gen classifier.
> Creativity dial bumped (v10.0.481-482) on 6 intents + new
> `BROADEN_AND_SUGGEST` operator-rule (rule #9). ProactiveInsightCard
> banner removed (v10.0.484) per operator request.
>
> **Cohort C · docs reconciliation (v10.0.484-485, 2026-05-08 EOD):**
> 36 living docs stamped with reconciliation footer · cohort summary
> written · CHANGELOG.md updated · this RECONCILIATION.md entry added ·
> ARCHITECTURE/DATA-MODEL/REPO-MAP "last verified" markers bumped from
> 2026-04-30 → 2026-05-08 · glitch-taxonomy.md gains 5 new incidents ·
> user-level MEMORY.md updated with sprint summary + READ FIRST pointer
> at the cohort summary.
>
> **Lessons captured:**
> 1. `prisma migrate status` is the source of truth, not "I ran release:db".
> 2. `position: relative` containing-block trap — adding it to a parent breaks
>    `position: fixed` descendants throughout the subtree.
> 3. Next.js dev-server module cache makes top-level imports sticky · use
>    defense-in-depth (internal delegation) when the import target swaps.
> 4. Ideation regex must catch "come up with" + friends, not just direct
>    image-gen keywords.
> 5. Mobile composer chrome budget · every always-visible button competes
>    with the textarea on 375px screens.

> ## v10.0.148 → v10.0.166 · post-audit consolidation wave · 2026-05-03 same session · 19 commits
>
> Triggered by an external audit report flagging ~70% hallucinated
> content. The report's accurate parts (MAPE-K framing, hierarchical
> memory, forecast registry, governed automation) drove a four-slice
> consolidation plan that turned implicit governance into explicit
> data, plus a follow-on chat-quality wave triggered by a real
> hallucination diagnosed via the new envelope work.
>
> ### Slice 1-4 · governance spine
>
> | Ver | Commit | Slice | Result |
> |---|---|---|---|
> | v10.0.148 | `a278533` | #1 · AutomationPolicy registry | 75 policies seeded · `/system/policies` operator surface · pre-push gate `[10/10]` policy coverage |
> | v10.0.149 | `b88820e` | #2 · Explainability envelope | Helper module (no new table; metadata extension) + `/system/agent-traces/[traceId]` drill-down |
> | v10.0.150 | `9d1ac85` | #3+4 · Forecast taxonomy + Brier scoring | `Prediction.kind` + `brierScore` columns · calibration helper · diagnostic SignalZone candidate |
> | v10.0.151 | `ac6621a` | A · Wire envelope into chat + autonomous-engine | Envelopes now POPULATED end-to-end |
> | v10.0.152 | `bca6771` | C · Cron wrapper logs policy fires | `Policy.fireCount` becomes live data |
> | v10.0.153 | `0c2c375` | B · Approval queue UI | `/system/approvals` (W11 backlog ship) |
> | v10.0.157 | `1edaedc` | A · Side-effect gating in autonomous-engine | Rules with `approval="ask"` defer; `executeApprovedAction(id)` replays on approve |
>
> ### Slice 5 · production hotfix wave (Bay 5 / pgvector / format)
>
> | Ver | Commit | Result |
> |---|---|---|
> | v10.0.154 | `ad8c002` | pgvector recovery (7653 vectors restored from JSON text) + project-cap fix (`isInboxMission()` helper unifies 3 surfaces) + destructive-push pre-push guard |
> | v10.0.155 | `fe6f176` | Schema sentinel verify (14/14 green) + `embedding_vec` recovery + inbox-janitor cron folded into mega-evening |
> | v10.0.158 | `d8a6a01` | Prisma format CI fix (column alignment) |
> | v10.0.159 | `edab10c` | `prisma format` pre-push gate `[2/11]` · gates renumbered to /11 |
>
> ### Slice 6 · chat-quality wave (anti-fabrication)
>
> Triggered by user report: "Nick said yes to adding tasks but Bay 5
> still has 0 tasks." Diagnosis took 4 minutes via the new envelope —
> first time the v10.0.149 work paid off in production.
>
> | Ver | Commit | Layer | Result |
> |---|---|---|---|
> | v10.0.156 | `25e1338` | Tool-call envelope wiring | Chat envelopes now show what tools fired during streamText |
> | v10.0.160 | `f62ff3f` | Detect + warn (action-claim verifier) | 19 verb patterns · 7 hedge patterns · `chat_claim_warn` BrainMemory + red chip on bubble |
> | v10.0.160 | `f62ff3f` | Smart-reply entity grounding | Replaces "Top 3 for right now" canned trio with "Show Bay 5 Revive tasks" |
> | v10.0.161 | `f29b8b8` | UI consolidation | Citation + Quality bands collapsed to one row |
> | v10.0.162 | `9a8e226` | L1 + L2 | System-prompt TRUTH RULE + pre-persist hedge banner rewriter |
> | v10.0.163 | `ca3888c` | L3 + L4 | History neutralization + entity truth-grounding (DB facts injected pre-turn) |
> | v10.0.164 | `c21d8b2` | Core | AGENTS.md + RECONCILIATION.md refresh |
> | v10.0.165 | `24a4484` | AI | Prompt library scaffold + /system/prompts surface |
> | v10.0.166 | (pending) | AI | `addTasksToProject` bulk task tool (resolving fabrication hallucination) |
>
> Five-layer fabrication defense now live end-to-end:
>   L1 prompt rule → L2 banner rewrite → L3 history neutralization →
>   L4 truth grounding → L5 operator chip
>
> ### Test coverage progression
>
> - Pre-wave (post-v10.0.80): 673 tests · 66 files
> - Post-wave: 760+ tests · 71+ files
> - New suites: automation/policy + automation/envelope +
>   automation/approval-queue + brain/calibration + brain/autonomous-
>   engine-gating + cron/inbox-janitor + ai/chat/action-claim-detector
>   + ai/chat/fabrication-rewriter + ai/chat/sanitize-history-fabrication
>   + ai/suggestion-cache (entity grounding) + lib/services/mission-helpers
>
> ### Pre-push gates progression
>
> - Pre-wave: 9/9
> - Post-v10.0.148: 10/10 (added policy coverage)
> - Post-v10.0.159: 11/11 (added prisma format)
> - Plus the destructive-push guard (no `--accept-data-loss` in shipping
>   config) wired inside the existing flow
>
> ### What's next
>
> v10.0.165 prompt library scaffold (`lib/prompts/library.ts` +
> `/system/prompts` listing surface). See AGENTS.md section 5
> "Active backlog" at the repo root for the full priority order.

> ## v10.0.77 → v10.0.80 medium-priority backlog · 2026-05-01 same session · 4 commits
>
> The 8-task prioritized list from the visible-but-misleading audit
> follow-up shipped in 4 commits. Each commit closes 1-3 tasks; all
> independent, all 9/9 green, all CI green.
>
> | Ver | Commit | Tasks | Result |
> |---|---|---|---|
> | v10.0.77 | `5c6f2c5` | 5 + 7 | chat console.log → log.info (24 sites) + activeKeys wired |
> | v10.0.78 | `0b6724d` | 8 | brain-bus producer expansion · 3 new event families (goal.transition, reflection.created, brain_dump.finalized) |
> | v10.0.79 | `40253ea` | 1 + 2 | revenue + snapshot tool cluster collapses (-2 tools: getLiveRevenue, getShopBriefing) |
> | v10.0.80 | `85137c7` | 6 + 3 + 4 | /system/* sister-page standardization (3 clusters: cost / log / cron) — cross-link chips + canonical-vs-sister docstrings |
>
> **Tool catalog progression across the full v10 reconciliation:**
> - Pre v10.0.73: 118 tools
> - v10.0.73 (Cat 2): 115 (closeLoop, createLoop, sendToTelegram retired)
> - v10.0.74 (Cat 6 part 1): 114 (searchBrainDumps retired)
> - v10.0.79 (Tasks 1+2): **112** (getLiveRevenue, getShopBriefing retired)
>
> Net 6 tool retirements. Each removes a duplicate that was splitting
> Nick's tool selection telemetry.
>
> **Brain-bus producers progression:**
> - Pre v10.0.63: 1 producer (cron.failure)
> - v10.0.63: +5 (drift / commitment / task / score / autonomous)
> - v10.0.78: **+3** (goal.transition / reflection.created / brain_dump.finalized)
>
> Total **9 event families** with handlers + dedupe + idempotent persistence.
>
> **Logger migration cumulative:**
> - v10.0.69-71: 65 console.* migrated (10 brain modules + 16 cron routes + 8 AI routes)
> - v10.0.77: +24 (chat route info-level)
> - **Total: 89 sites migrated to structured `logger.withSurface()`**
>
> Chat route is now 100% structured logger (warn/error from v10.0.71 +
> info-level from v10.0.77). Every observability call attributable to
> a surface name with named events for `/system/errors` filtering.
>
> **/system/* sister-page standardization (Tasks 6 + 3 + 4):**
>
> Three duplicate-page clusters got "canonical vs sister" positioning
> instead of hard merge — keeps each page's distinct UX while documenting
> which to open when. Cross-link chips in PageHeader actions on every
> page point to the sister surfaces.
>
> | Cluster | Canonical | Sister(s) |
> |---------|-----------|-----------|
> | Cost dashboard | `/system/costs` (live ops) | `/system/ai-cost` (historical breakdowns) |
> | Log feed | `/system/logs` (broad retrospective) | `/system/events` (real-time HUD) |
> | Cron management | `/system/crons` (control deck) | `/system/cron-runs` (history index) + `/system/cron-diagnostics` (why-silent) |
>
> Lower-risk, faster move than a full merge — preserves all functionality
> while addressing "which page do I open?" UX cost. Each docstring also
> updated with explicit "when to use which" guide.
>
> **Hardcoded-zero lies fully cleared (Cat 1):**
> - v10.0.73: driftBudgetUsed wired (mode classifier RECOVERY branch)
> - v10.0.77: activeKeys wired (rate-limit ribbon)
>
> Both were `: 0, // TODO` patterns that the previous report flagged as
> the highest-danger Cat 1. Both closed.

> ## v10.0.73 → v10.0.74 visible-but-misleading audit · 2026-05-01 same session · 2 commits
>
> Different bug class from the v10.0.63-72 contract-violation campaign. That
> previous campaign fixed **silent contract violations** (deletions leaking,
> calls untraced, console.log spam). This shorter campaign tackles **visible
> features that look done but aren't wired right** — the post-rename rot.
>
> | Ver | Commit | Categories | Fixes |
> |---|---|---|---|
> | v10.0.73 | `6ce37a8` | Cat 1 + Cat 4 + Cat 2 | hardcoded-zero wire-up + dead-code removal + 3 dup tools retired |
> | v10.0.74 | `e4f41a3` | Cat 6 part 1 | search-cluster collapse: searchBrainDumps → searchReflections |
>
> **Concrete fixes:**
>
> 1. **Hardcoded-zero silent lie (Cat 1):** `components/ultron/ultron.tsx`
>    was passing `driftBudgetUsed: 0` to the mode classifier. Mode classifier
>    has a "≥70% → RECOVERY mode" branch that could never fire because the
>    input was a constant. Pulse endpoint already exposed the correct shape
>    via `/api/ultron/pulse`. Wired up via `useUltronFetch` (dedupes with
>    PulseStack on the same cache key + 60s TTL).
>
> 2. **Dead code path (Cat 4):** `lib/ai/system-prompt.ts` had `recentPlates`
>    as a `Promise.resolve([])` stub for an ALPR integration never built,
>    plus a downstream render block (`if (recentPlates.length > 0) ...`)
>    that read like Nick handled license plates. He doesn't. Stub + render
>    block both deleted. When ALPR ships, re-add as a 4th Promise.all entry.
>
> 3. **Duplicate tools from old renames (Cat 2):** Apr 18 OpenLoop→Task
>    rename and an earlier Telegram naming change left three pairs of
>    duplicate tools exposed to Nick. tool-families.ts literally labeled
>    `sendToTelegram` as "Alias for sendTelegram (legacy)". Retired:
>    `closeLoop` → `completeTask`, `createLoop` → `createTask`,
>    `sendToTelegram` → `sendTelegram`. Removed from `tools.ts` definitions,
>    `catalog.ts` listings, `tool-families.ts` family metadata, two header
>    comments + listTools self-describer strings. Zero call sites elsewhere.
>
> 4. **Search-cluster collapse (Cat 6 part 1):** `searchReflections` already
>    searched both Reflection rows AND BrainDump entries; `searchBrainDumps`
>    was a strict subset (BrainDump only). Extended `searchReflections` with
>    `startDate`/`endDate` date-range params + the `patterns` field for
>    parity, then retired `searchBrainDumps`.
>
> **Tool catalog:** 118 → 114 (4 retirements: closeLoop, createLoop,
> sendToTelegram, searchBrainDumps).
>
> **Deferred clusters** (need product/architecture decision before collapse):
>
> - **Daily-snapshot cluster (4 tools):** `getDashboardSummary` (legacy
>   business-intel path, also wired to `/api/analytics/dashboard`),
>   `getShopSnapshot` (bridge-only narrow view), `getShopBriefing`
>   (bridge-batch wider view), `dailyPulse` (full daily incl. personal layer).
>   Real overlap but each has a distinct angle + non-tool callers.
> - **Revenue cluster (3 tools):** `getRevenueStats`, `getLiveRevenue`,
>   `compareLiveRevenue`. Different time-window angles.
> - **System pages cluster (37 pages):** `/system/events` vs `/system/logs`
>   are the clearest pair (both "live unified feed"); cron pages
>   (`crons` / `cron-runs` / `cron-diagnostics`) are 3 → could be 1 with tabs.
>
> **Pattern that finds these post-rename rot bugs:**
> ```
> grep -rn ": 0, // TODO\|: null, // TODO" lib/ app/ components/   # hardcoded zeros
> grep -rn "Promise.resolve(\[\])" lib/                            # dead async stubs
> grep -in "alias\|legacy\|deprecated" lib/ai/tool*                # legacy tool entries
> ```

> ## v10.0.63 → v10.0.71 reconciliation campaign · 2026-05-01 single session · 9 commits
>
> **The headline:** ~140 audit findings closed end-to-end across 5 contracts in
> a single autonomous session. Soft-delete contract is now end-to-end across
> all 9 soft-delete-aware tables (BrainMemory, Task, Mission, Commitment,
> BrainDump, Reflection, MasteryDecision, LifeGoal, IdentitySnapshot). Logger
> migration covers brain modules + 16 cron routes + 8 AI routes. AgentTrace
> coverage is universal. Brain-bus producers cover 5 event families.
>
> | Ver | Commit | Move | Fix count |
> |---|---|---|---|
> | v10.0.63 | `18130a4` | A · brain-bus producer audit | 5 typed wrappers + 9 emit sites + 11 tests |
> | v10.0.64 | `ea098b1` | C · AgentTrace coverage wave 2 | 21 modules via `makeTracedAiChat` factory |
> | v10.0.65 | `5610f63` | B · brain wave 4 audit | 11 fixes (8 CRITICAL system-prompt feeders) |
> | v10.0.66 | `3ae77af` | D · brain wave 5 audit | 18 fixes (8 CRITICAL system-prompt feeders) |
> | v10.0.67 | `8d1abfd` | E · Task/Mission/Commitment soft-delete | ~50 fixes |
> | v10.0.68 | `68ee684` | F · BrainDump/Reflection/MasteryDecision/LifeGoal | 30 fixes |
> | v10.0.69 | `33ecf4f` | Phase 3+4 · AgentTrace cleanup + brain logger | 1 + 11 sites |
> | v10.0.70 | `ecc7eca` | Phase 2 Tier 1 + 4 · page redirects + cron logger | 2 + 28 sites |
> | v10.0.71 | `7a08d98` | Phase 2 Tier 2 · /api/ai/* logger | 26 warn/error sites |
>
> **Soft-delete totals:** 16 CRITICAL system-prompt feeder bypasses closed +
> ~111 HIGH read-then-write loop fixes = **127 soft-delete bypass closures**.
>
> **Logger migration totals:** 65 console.* sites migrated to
> `logger.withSurface(...)` across 26 modules + routes (10 brain + 16 crons + 8 AI).
>
> **Audited surface:** 63 pages · 327 API routes · 75 brain modules · 36
> active crons (4 budget headroom under 40-cap).
>
> **Page audit (v10.0.70):** 5 stalest pages verified clean (auth/sign-in,
> system/diagnostics, system/events, system/tools, brain/categories) — old
> last-modified dates reflect stable surfaces, not drift. 2 real bugs found
> and fixed: `/capture` and `/ops` redirect targets pointed at non-existent
> `/command` route (404 trap from pre-Ultron consolidation).

> ⚠ **HISTORICAL ARCHIVE — do NOT read as current.** Everything from
> here to the end of this file is the v9.1 → v10.0.7x reconciliation
> ledger, kept for history only. It PRE-DATES the monorepo migration
> and describes RETIRED infrastructure — the standalone `statenour-os`
> repo, the `codex/ollama-local` branch, and Vercel.
> Branch names, cron counts, model counts, pre-push gate counts and
> "active gate task" notes below are frozen at that era and are NOT
> current — do not trust a number from this section.
>
> **For the current state of the OS, read the TOP of this file.**
> statenour now ships from the `MAINnicks-tire-autoNEW` monorepo
> (`apps/statenour/`), branch `main`, deployed by Railway. The
> `v10.0.X` version scheme is retired. (archived 2026-05-21)

## v9.1 wave progress (after v9.0 Command Spine)

### Phase 1 · prompt-v2 coverage (v9.1.0 → v9.1.10)

| Version | Commit | What shipped |
|---|---|---|
| v9.1.0 | `877bedf` | `/system/command-center` operator dashboard |
| v9.1.1 | `6079eff` | `/system/prompt-comparison` + semver migration |
| v9.1.2 | `87ebdad` | CommandSpinePulse on Ultron home |
| v9.1.3 | `b00b4ec` | 3-mode `NICK_PRIME_PROMPT` flag (off / shadow / on) |
| v9.1.4 | `8d32ce8` | prompt-v2 WHY block — Active Missions + Active Goals |
| v9.1.5 | `38cee0d` | prompt-v2 Recent Thinking — brain dumps + reflections |
| v9.1.6 | `25db66c` | shadow comparison persistence + 7-day trend strip |
| v9.1.7 | `3b4f9b8` | prompt-v2 commitments + scheduled actions |
| v9.1.8 | `54b1a05` | prompt-v2 anchors — pinned context + hot rules |
| v9.1.9 | `105278b` | prompt-v2 live domain snapshot — business + mastery |
| v9.1.10 | `a5e0538` | prompt-v2 temporal context — time-aware guidance + targets |

### Phase 2 · code-review hardening (v9.1.11 → v9.1.27)

17 commits across two parallel deep-audit waves. Every commit is single-surface-area and ships with green tests + typecheck + 9 pre-push gates. **65+ real bugs fixed** ranging from prompt injection to fail-open webhooks to silent ghost-row leaks to autonomous engine double-spam.

#### Round 1 audit (4 agents in parallel) → v9.1.13-v9.1.16

| Version | Commit | Surface | Findings |
|---|---|---|---|
| v9.1.11 | `4a26deb` | docs | reconciliation update for v9.1.4-v9.1.10 |
| v9.1.12 | `be6fba1` | self-audit on v9.1.4-v9.1.10 | 3 HIGH (past-due action mislabel, stale weekly target, unauthed shadow-trend) |
| v9.1.13 | `7dbb268` | AI/prompt subsystem | 2 HIGH (prompt injection sanitizer, v1 weekly-key local/UTC bug) + 4 MED |
| v9.1.14 | `f3cb277` | auth + security | 3 HIGH (open nickstire webhook, broken Make webhook, 12 leaky GETs) + 4 MED + new sensitive-GET pre-push gate |
| v9.1.15 | `9a16750` | DB + Prisma | 2 CRITICAL (Cascade→Restrict on soft-delete chains, pgvector $queryRawUnsafe guard) + 4 IMPORTANT |
| v9.1.16 | `9a14e23` | cron + brain-bus | 4 HIGH (double-CronJobLog write, lying probe, 60s envelope leak risk, blind 55min/hour spike detector) + 2 MED |

#### Phase 2.5 (housekeeping batch) → v9.1.17-v9.1.21

| Version | Commit | Surface | Findings |
|---|---|---|---|
| v9.1.17 | `d639ab4` | GET-route lockdown | 26 routes locked + sensitive-GET gate ratcheted to HARD mode |
| v9.1.18 | `f91d4c6` | soft-delete sweep + entity-audit | 5 brain-layer reads + 4 task.update() audit gaps closed |
| v9.1.19 | `eb9d8d3` | AI rate limits | chat route + 13 other AI-calling routes get 10 req/min/IP cap |
| v9.1.20 | `cf2fb45` | docs | reconciliation update for v9.1.13-v9.1.19 |
| v9.1.21 | `80fec0d` | regression tests | 12 new tests for v9.1.13 + v9.1.19 helpers |

#### Round 2 audit (3 agents in parallel) → v9.1.22-v9.1.27

| Version | Commit | Surface | Findings |
|---|---|---|---|
| v9.1.22 | `5f7321b` | streaming + chat pipeline | 1 HIGH (onError handler) + 4 IMPORTANT (rate-limit bypass, telemetry race, auto-rename race, etc.) |
| v9.1.23 | `8d843f8` | services + brain CRITICALs | 5 CRITICAL (health route public leak, autonomous engine idempotency, soft-delete leaks, cache invalidation gap) |
| v9.1.24 | `98fba67` | services + brain IMPORTANTs | 4 IMPORTANT (reflection idempotency, deleteConvo silent-fail, journal sanitization, maybeSpawnNextPhase non-transactional) |
| v9.1.25 | `fc7186f` | brain pipeline deferred | 3 IMPORTANT (commitment dual-spam, importance-scorer garbage accumulation, wisdom dedup) |
| v9.1.26 | `13bb0c3` | services + dashboard deferred | 2 IMPORTANT (claimWorkItems TOCTOU spin, system/crons re-render perf) |
| v9.1.27 | `fe66bc9` | streamText fallback | provider auto-rotation on stream-error (cross-request, 60s sticky window) |

### Pre-push gate evolution

Started: 8 gates (v8.21).  
v9.1.14: added [9/9] sensitive GET-route auth coverage.  
v9.1.17: ratcheted [9/9] from soft (warn) to HARD (fail-close) once sweep finished.  
Current: every push runs typecheck + lint + tests + raw-sql + cron-budget + AI-catalog + env-secret + auth-coverage (mutating) + auth-coverage (sensitive GET).

### v10 wave (active) — Tracks B + D + E complete

| Version | Commit | Track | What shipped |
|---|---|---|---|
| v10.0-alpha plan | `e1b26d9` | Phase 0 | V10-PLAN.md (corrected from external doc · parallel tracks A-E) |
| v10.0-alpha B.3 | `ffcc3d7` | B.3 | 21 regression tests (cache, journal-sanitize, reflection-idempotency) |
| v10.0-alpha B.1 | `e4176d3` | B.1 | Frontend audit (52 pages) + 2 RED + 2 YELLOW fixes |
| v10.0.1 | `61cdeae` | B.2 | Durable brain-bus replay (BrainBusEvent table + polling cron + 14 tests) |
| v10.0.2 | `8130cab` | B.4 | SchemaChangeLedger + DB-MIGRATION-POLICY.md + /api/system/schema-history + 12 tests |
| v10.0.3 | `5fe8900` | B.5 | Pre-first-token same-turn fallback (streamWithFallback + 8 tests) |
| v10.0.4 | `b821917` | B.1 | YELLOW sweep — 6 deferred frontend findings closed |
| v10.0.5 | `59b8c89` | docs | RECONCILIATION update — Track B + B.1 frontend complete |
| v10.0.6 | `ac4be73` | E.1 + E.2 | /system/repos + /system/schema-history dashboards |
| v10.0.7 | `af36967` | E.4 | /system/deployment-truth (build SHA + schema drift + env + cron 24h) |
| v10.0.8 | `6054466` | E.5 | AgentTrace contract (mintTraceId / wrapTrace / recordTrace + 11 tests) |
| v10.0.9 | `f3ac1a9` | D | Doc stamping + stale-banner sweep (6 docs) + mintTraceId monotonic fix |
| v10.0.10 | `2209056` | E.5 | /system/agent-traces dashboard + chat-route AgentTrace wiring |
| v10.0.11 | `2754880` | E.3 | GitHub ecosystem briefings — Nick-readable digest module + /api/system/repo-briefing + /system/repos panel |
| v10.0.12 | `0f305b8` | tests | repo-briefing tests + RECONCILIATION sync |
| v10.0.13 | `96058e6` | nav | 4 v10 dashboard cards added to SystemHubGrid |
| v10.0.14 | `47ad555` | E.5 | AgentTrace adoption in 3 cron jobs |
| v10.0.15 | `8d1d68d` | audit | Round 3 fixes (drift chain, GH timeout, commit cap, wrapTrace attribution) |
| v10.0.16 | `5ca6fb2` | E.5 | AgentTrace sweep — 17 aiChat + 3 generateText/streamText routes; new tracedAiChat helper |
| v10.0.17 | `ead2378` | B.2.1 + H5 | brain-bus dispatch registry + bundle-analyzer (`pnpm analyze`) |
| v10.0.18 | `fc1063d` | H5 | structured logger expansion + Prisma slow-query telemetry + /system/slow-queries |
| v10.0.19 | `d700cd8` | B.5b + B.2 | mid-stream graceful degradation (partial-text persist) + /system/brain-bus live tail |
| v10.0.20 | `61e5154` | B.2 | brain-bus producer wiring — cron failures publish durable events with real BrainMemory handler |
| v10.0.21 | `c0d2dce` | logger | structured-logger sweep wave 1 (24 console.* sites · lib/services + lib/brain core) |
| v10.0.22 | `5f3b223` | client-hardening | authedFetch sweep — 13 bare fetch sites in lib/state, lib/hooks, lib/chat |
| v10.0.23 | `f01d930` | UI | /system/agent-traces polish — search box + errors-only + 12-bucket sparkline |
| v10.0.24 | `18a5181` | H5 | schema-coverage audit — pg_stat_user_tables × pg_indexes × slow-queries cross-ref + dashboard |
| v10.0.25 | `83dffa4` | docs | RECONCILIATION sync stamping v10.0.12→24 |
| v10.0.26 | `2c8a7e6` | audit | Round 4 self-audit — 5 fixes (tracedAiChat provider=none silent success, brain-bus updatedAt bump, slow-query dynamic import, schema-coverage permission-denied, chat onChunk shape) |
| v10.0.27 | `2aa9c82` | audit | Round 5 — CRITICAL durable-bus claim SQL bug fixed (broken since v10.0.1) + 4 follow-ups |
| v10.0.28 | `4aabde2` | v11 surface | /chat audit — 8 fixes incl onDelete server-client desync, queueMicrotask for edit race, traceId deep-link |
| v10.0.29 | `17f1df1` | v11 surface | /tasks audit — 9 fixes incl setLoading-frozen-skeleton, inboxRef useRef, load() concurrency guard, listTasks 1500-row cap |
| v10.0.30 | `2310ed1` | v11 surface | /journal audit — 6 fixes incl error banner, AbortController, stagger gate, deep-link cleanup |
| v10.0.31 | `f40fa34` | v11 surface | 5-page sweep — knowledge/brain/body/financial/plan |
| v10.0.32 | `a0abd67` | v11 surface | 6-page sweep — pins/intel/devices-detail/brain-{categories,galaxy,continuity} |
| v10.0.33 | `bc9fc49` | v11 surface | Final 7-page sweep — /, content-history, photo-improver, social, mastery, integrations, settings |
| v10.0.34 | `46c7826` | cron audit | 8 cron-job fixes — memory-consolidation N+1, data-cleanup audit trail, weekly-digest+daily-report TZ bugs, auto-linker bounds, brain-intelligence silent writes |
| v10.0.35 | `a944477` | brain audit | 7 brain-layer fixes — journal-ingest PII leak, conversation-memory PII leak, mergeMemories soft-delete, scoreMemories wisdom overwrite, commitment cross-rule race, importance-scorer determinism, session-distiller logger |
| v10.0.36 | `b2c5561` | docs | RECONCILIATION sync v10.0.25→35 |
| v10.0.37 | `cec8ba4` | API audit · CRITICAL | 14 unauth GETs fixed (privacy hole since v9.1.17) + Zod input validation on /api/financial + /api/body + sensitive-GET pre-push gate widened from 5 to 16 prefixes |
| v10.0.38 | `ab9473d` | brain wave 2 | 7 brain-layer fixes — pipeline-controller orphan-edge race, embedding-utils unbounded scans, customer PII in brain memory, contradiction-surfacer N+1, decision-quality-drift TZ, identity-snapshot synthetic-overwrite, deletedAt filters |
| v10.0.39 | `f969a0a` | cron wave 2 | 9 cron fixes — embed-backfill unbounded + silent catches, learn cron UTC TZ, journal-checkin slot detection, backlog-triage destructive archive, weekly-review missing persist, correlation-scan + blindspot-surface N+1 + race, provider-ping silent catch, cost-regression dedup spam |
| v10.0.40 | `7249fd8` | docs | RECONCILIATION sync v10.0.36→39 |
| v10.0.41 | `d3ffac1` | docs · session-resume | AGENT-CONTRACT.md startup checklist rewritten to point at RECONCILIATION first; RECONCILIATION header upgraded with critical-find headline + active-state pointer; Turborepo skill installed at ~/.claude/skills/turborepo for future AI sessions |
| v10.0.42 | `596951f` | cron audit wave 3 · CRITICAL | 7 cron fixes incl 3 CRITICAL: operating-rhythm dead `Promise.resolve(null as any)` placeholders → 5 daily Telegrams reported $0 / 0 stale leads / 0 callbacks regardless of actual shop state (live since v9.x); alert-telegram-bridge spam-loop (claim AFTER send → Telegram failure re-fired infinitely); auto-calibrate destructive `.catch(() => {})` on 3 belief-recalibration update sites. Plus prediction-streaks/decision-drift/pin-hygiene/stale-tasks bounded scans. |
| v10.0.43 | `89d570b` | docs · doc-truth | Reality column re-counted from disk: models 66 → 69 (the v10.0.1/2/8 additions BrainBusEvent + SchemaChangeLedger + AgentTrace were never reflected); API routes 313 → 325; (mastery) pages 50 → 59; tests 59 → 60. HEAD bumped to v10.0.42. 4 zombie "63 models" phrases corrected (DATA-MODEL.md, AGENT-CONTRACT.md, UPGRADE-PLAN.md ×2). config/repos.ts MAINnicks-tire-autoNEW host bug fixed (`vercel` → `railway`). Pre-push script labels normalized to uniform [1/9]…[9/9]. RECONCILIATION pre-push gate count corrected from 8/8 to 9/9 with proper breakdown. |
| v10.0.44 | `cf47d80` | API audit · CRITICAL × 6 | 22 unauth-route privacy holes closed. 6 CRITICAL GETs that survived the v10.0.37 sweep because they were under unscoped prefixes: /api/settings (full system config), /api/command/data (shop revenue + CEO context + drift), /api/sse/events (real-time SSE stream of device events + error log + new brain memories), /api/chat/export/[conversationId] (full conversation by ID), /api/chat/hot-questions (chat content patterns), /api/actions-brain (tasks + identity + commitments + decisions). Plus 9 HIGH (personal-logs, analytics/revenue, drift, ai/errors-recent, ai/venice-status, integrations, settings/autopilot GET, settings/ai-config GET, sync/backup + sync/social verified-already-gated false-positives), 1 MEDIUM (nour-os/query timing-safe compare), and 6 more siblings caught by the widened gate (settings/crons, chat/search, personal-logs/[id], integrations/meetings, ai/chat/suggestions/stats, ai/nick-noticed). Sensitive-GET gate prefix list expanded from 16 → 26 to fail-close any future bare-GET landing under these trees. |
| v10.0.45 | `e2f6e43` | cron audit wave 4 · CRITICAL × 4 + weekly-never-fires | 7 cron fixes. CRITICAL: device-health offline-alert was a dead `Promise.resolve(null as any)` (Pattern-1 — Nour was never notified about >24h-dark devices); device-health + device-sync N+1 (40+ serial round-trips per run, batched via updateMany + $transaction); pgvector-backfill missing assertSafeVectorLiteral guard on $executeRawUnsafe interpolation. HIGH: mega/route.ts UTC-Sunday check fired at 03:00 UTC Monday (10pm ET) → getUTCDay = 1 → weekly block (weekly-digest, voice-clone-train, memory-bloat-watch) has been silently skipped every week since the slot was introduced. MEDIUM: brain-cycle workout-skip detector missing `deletedAt: null`, ingest-gmail audit-event silent .catch(() => {}). Closes the cron-layer audit at 38 / 38 active+folded handlers across 4 waves; total cron findings 31 (8 CRITICAL, 13 HIGH, 10 MEDIUM). |
| v10.0.46 | `8f4a657` | brain audit wave 3 · CRITICAL × 4 | 18 brain-layer fixes. CRITICAL: operating-rhythm MIT picker inverted (`orderBy: autoPriority desc` returned LEAST urgent task as Nour's daily MIT — every single 8am peak-block Telegram has surfaced the wrong focus task); contextual-recall soft-delete bypass on the per-chat-turn memory-context query (deleted memories injected into Nick's system prompt EVERY reply); task-completion-detector server-side relative `fetch` (auto-DONE feature has been silently dead — the catch always swallowed Next.js URL-resolution errors); thinking-engine runSimulation TypeError crash on `record.id` access (Promise.resolve placeholder returned null forever). HIGH × 8: wisdom-distiller bounds + dedup, chat-recall N+1 → batched OR query, decay/skill-extractor/drift-detector/qualitative-identity/reflection-engine soft-delete bypass × 5, predictive-engine non-transactional creates, ghost-nick dismissal-marker bypass. MEDIUM × 5: deep-scan Date.now()-in-key (~7300 new rows/yr no dedupe), correlation-finder Math.random non-determinism (replaced with seeded mulberry32 PRNG keyed off data-fingerprint FNV-1a), operating-rhythm habits placeholder. Cumulative brain-layer total: 32 fixes across 3 waves; 53/73 files audited. |
| v10.0.47 | `3053c5b` | docs · sync | RECONCILIATION sync stamping v10.0.43→46. |
| v10.0.48 | `cddcd2f` | component audit · CRITICAL × 1 | 5 component-layer fixes. CRITICAL: pwa-install-prompt.tsx bare `sessionStorage` access crashed Safari Private Browsing on every page load (component is mounted globally in mastery layout). HIGH: session-expiry-banner interval re-mount race producing two concurrent polls; memory-graph-explorer `key={i}` on re-orderable EdgeRow lists bled hover/focus state across pivots; nick-message `key={i}` on quick-action buttons stale-closed mid-stream. MEDIUM: notification-center clearAll sequential await loop blocking modal for 5+ seconds. Cumulative audit coverage: 6 layers (cron, brain, API, v11 surface, doc-truth, component). |
| v10.0.49 | `c58116e` | open-webui-plugins ports | renderInlineChart Nick tool + components/chat/inline-chart.tsx (pure-React SVG · 4 chart types) + composeEmail Nick tool + components/chat/email-draft-card.tsx + /api/email/send route (owner-gated) + 16 parser tests in tests/chat/inline-renderers.test.ts. Both tools emit fenced markdown blocks intercepted by the nick-message <pre> override. composeEmail NEVER auto-sends — user clicks Send card. tool-catalog: 133 → 135. |
| v10.0.50 | `de178d0` | Wave A · autonomous-engine | 11 ghost rules wired to queryNick + retired 2 dead rules. CRITICAL behavioral fixes: daily_score_reminder no longer fires every evening regardless of state, drift_escalation no longer fires every 24h forever, friday_revenue_check no longer reports gap = full target, stale_leads_alert + auto_remind_pending_appointment + auto_followup_expired_quote actually surface real shop signals. Helper `fetchBridge<T>` wraps queryNick with null-on-failure semantics. |
| v10.0.51 | `0847003` | Wave A · business-intel | 4 ghost functions wired (getRevenueStats, getTopServices, getCustomerStats, getDashboardSummary). bridgeAvailable + bridgeHealth fields surface to consumers so dashboard cards can render "shop offline" banner instead of pretending zeros are real. /api/analytics/revenue + /api/analytics/dashboard now return real shop revenue. |
| v10.0.52 | `38a6981` | feature · build-your-own-x | New `/learn` mastery page + `searchBuildYourOwnX` Nick tool. Bundled README from codecrafters-io/build-your-own-x at `lib/data/build-your-own-x.md` (504 lines). Parser at lib/learn/build-your-own-x.ts with 10 contract tests (≥20 categories, ≥200 tutorials, language tag on >80%, etc.). tool-catalog: 135 → 136. |
| v10.0.53 | `4333bb5` | Wave A · service-layer cleanup | 4 dead files deleted (lib/services/jobs.ts + scoring/weekly-profit.ts + validators/jobs.ts + validators/customers.ts — zero consumers). customers.ts 250→85 lines, leads.ts 258→154 lines (dropped orphaned CRUD methods, kept reads/createLead with graceful empty + warn-once). createLead production path was Promise.resolve(null) then accessed `.id` → TypeError every capture-to-LEAD; now throws typed ServiceError(501) with admin redirect. -828 / +144 net lines. |
| v10.0.54 | `753571b` | Wave A · tools.ts ghost calls | 16 sites across 9 hot-path Nick tools cleared. Analytics tools (getHabitStreaks, analyzeWeek, suggestMIT, dailyPulse, endOfDay, weeklyReview, decisionPreFlight) wired to identity_snapshot + DAILY-task replacements. customerLifetime sources customer + quotes from existing customer_search bridge response shape. createQuickQuote + triageStaleLead were both null-access TypeError crashes; now surface structured redirects with admin URLs. +375 / -144 net lines. |
| v10.0.55 | `913ffd6` | Wave A FINAL · brain layer | 55 sites across 17 files cleared via shared shim module `lib/brain/legacy-shims.ts` (recentScoreSnapshots / recentDailyHabits / recentShopJobs / recentShopLeads / recentShopQuotes) + 8 contract tests. camera-intelligence rewritten to derive aggregations from `prisma.deviceEvent` directly (was returning all-zeros from non-existent cameraMetric/cameraAlert tables). thinking-engine L9 simulations read now resolves via BrainMemory category="simulation" (matching v10.0.46 writes). 16 brain modules unblocked. **Wave A complete: 203 ghost sites at v10.0.47 → 0 actionable.** |

**Track B reliability work: COMPLETE.** All 5 sub-tracks (B.1 frontend, B.2 brain-bus, B.3 tests, B.4 schema ledger, B.5 same-turn fallback) shipped — plus B.5b mid-stream graceful degradation in v10.0.19.

**Track E build-on-top dashboards: COMPLETE.** All 5 surfaces shipped (E.1 repos · E.2 schema-history · E.3 ecosystem briefing · E.4 deployment-truth · E.5 agent-traces). Plus 3 Horizon-5 dashboards (slow-queries, brain-bus tail, schema-coverage).

**Track D doc stamping: COMPLETE.** All 6 top-level docs carry v10 truth or HISTORICAL banners (README, ARCHITECTURE, DATA-MODEL, REPO-MAP, RUNBOOK, ROADMAP, MASTER-CONTEXT, V9-PLAN, UPGRADE-PLAN).

**Operational polish: COMPLETE.** Brain-bus producer wiring (cron.failure end-to-end), structured-logger sweep wave 1 (24 sites), authedFetch sweep (13 client-side sites), AgentTrace dashboard polish, schema-coverage audit. Bundle-analyzer script live (`pnpm analyze`).

**v11 user-surface reconciliation: COMPLETE (v10.0.28→33).** 19 user-facing pages audited (chat, tasks, journal, knowledge, brain[+/categories/galaxy/continuity], body, financial, plan, pins, intel, devices/[id], /, content/history, photo-improver, social, mastery, integrations, settings, devices). 49 real bugs fixed across 6 commits. 9 pages audited as clean. Patterns: AbortController on polling, res.ok before .json(), stable React keys, structured logger sweep into client code, error banners on previously-silent failures, dead-code removal.

**Cron-layer audit: COMPLETE (v10.0.34).** 8 fixes across 13 audited crons. Highest-leverage finds: memory-consolidation N+1 count queries (60s timeout on warm DB), data-cleanup mass-deletes had no audit trail (defeated v8 phase-2A), weekly-digest UTC midnight off-by-one date display, daily-report startOfDay UTC vs ET (dropped morning completions), auto-linker quadratic edge-write loop unbounded, brain-intelligence blindspot writes silently swallowed.

**Brain-layer logic audit: COMPLETE (v10.0.35).** 7 fixes including 1 CRITICAL PII leak (raw journal text persisted into BrainMemory), HIGH PII leak (peopleMentioned in auditEvent payload), HIGH soft-delete bypass in mergeMemories (resurrection of deleted memories), HIGH wisdom-row confidence overwrite see-saw, HIGH commitment cross-rule double-fire race.

**API route audit (v10.0.37): CRITICAL privacy hole closed.** Pre-v10.0.37 the sensitive-GET pre-push gate covered only 5 route prefixes; an audit caught **14 operator-private GET handlers** across 11 unscoped prefixes that had been silently unauthed since v9.1.17 — including /api/journal (raw thoughts), /api/devices/command (lock codes + camera arms), /api/goals (life goals + ?includeDeleted=1 bypass), /api/tasks, /api/missions, /api/commitments, /api/body, /api/habits, /api/mastery/mood-trend. All 14 now require auth: "owner" or requireSession(req). Pre-push gate widened from 5 → 16 prefixes so future bare GETs in those trees fail CI. Plus Zod input validation on /api/financial + /api/body POSTs (was leaking column names through Prisma errors on bad types) + /api/commitments active+overdue overlap fix.

**Brain-layer audit wave 2 (v10.0.38): COMPLETE.** 7 more fixes incl 2 CRITICAL: pipeline-controller orphan-edge race (two `Date.now()` calls produced different keys → graph edge pointed at non-existent memory id), embedding-utils.semanticSearch unbounded full-table scan on metadata hydration. Plus customer PII in brain memory, contradiction-surfacer N+1, decision-quality-drift TZ bug, identity-snapshot synthetic-overwrite gap, missing soft-delete filter.

**Cron audit wave 2 (v10.0.39): COMPLETE.** 9 more fixes incl 4 CRITICAL: embed-backfill 5 unbounded vectorEmbedding scans + 5 silent catches, learn-cron UTC vs ET startOfDay (off by 5h), journal-checkin slot detection used UTC hours wrong (1am ET fired as morning slot), backlog-triage destructive archive could silently fail per-row + spin forever on sticky DB issues. Plus weekly-review never persisted AI output (dead `Promise.resolve(null as any)` placeholder), correlation-scan + blindspot-surface N+1 race patterns, cost-regression dedup write failure spam Telegram.

**Wave A · Ghost-feeder migration: COMPLETE (v10.0.50→55).** Five focused commits closing the structural pattern that audit waves 1-3 had documented but not yet repaired: 203 dead `Promise.resolve(...)` placeholders across 16 modules — silent feature death since the customer/job/lead tables moved to nickstire (TiDB on Railway) and the DailyScore/HabitLog tables retired (Apr 19). Total: 86 ghost sites cleared (v10.0.50 autonomous-engine, v10.0.51 business-intel, v10.0.53 service layer + 4 dead files removed, v10.0.54 lib/ai/tools.ts × 16, v10.0.55 lib/brain × 55). Architectural deliverable: `lib/brain/legacy-shims.ts` provides single-source replacements (`recentScoreSnapshots` → identity_snapshot JSON parse, `recentDailyHabits` → DAILY-task streakCount synthesis, `recentShop*` → graceful empty + warn-once). 4 CRITICAL crashes fixed (createLead null.id, createQuickQuote null.quoteNumber, triageStaleLead null.fullName, plus runSimulation already fixed in v10.0.46). camera-intelligence module fully rewritten to derive aggregations from real `prisma.deviceEvent` (was returning all-zeros from non-existent tables). Total Wave A net diff: ~1,250 lines added (mostly shim + tests + reflowed brain code) / ~1,200 lines removed (dead modules + dead production paths). **Pre-Wave-A: 203 ghost sites. Post-Wave-A: 0 actionable.** When the next nickstire bridge query lands (e.g. `jobs_range`), one shim function update lights up every consumer simultaneously instead of N inline edits.

**Production v10 surfaces (12 dashboards beyond v8.x):**
- /system/command-center · v9.0 NICK Prime control room
- /system/prompt-comparison · v9.1 v1↔v2 shadow trend
- /system/repos · v10 E.1 cross-repo health + ecosystem briefing
- /system/schema-history · v10 B.4 migration audit
- /system/deployment-truth · v10 E.4 single-pane state
- /system/agent-traces · v10 E.5 AI call chains (with v10.0.23 polish)
- /system/slow-queries · v10 H5 top-N Prisma query shapes
- /system/brain-bus · v10 B.2 durable event tail
- /system/schema-coverage · v10 H5 row × index × slow-query cross-ref

### Active

- **Track A · NICK Prime cutover** (time-gated, passive): `NICK_PRIME_PROMPT=shadow` running. 24-48h smoke window in progress. After parity holds (zero `prompt.shadow.build_failures` + delta-pct within ±5%), flip to `=1` and ship v9.2 deletion of the v1 builder.
- **Track C · CommandCenterState universal adoption**: pending Track A flip.

### Next required action

Watch `/system/prompt-comparison` for shadow-trend data. Once 24-48h shows no build_failures and delta within ±5%, flip `NICK_PRIME_PROMPT=1` via Vercel CLI. Track C work then unblocks.

> Single source of truth for "what's actually true right now." Future
> agents — read this FIRST before trusting any older doc claim. All
> numbers in this file were re-counted directly from the repo at the
> commit hash above. When you add work, bump this file's "Last verified"
> stamp + the impacted row.

---

## 1 · Verified reality

| Metric | Value | How verified |
|---|---|---|
| HEAD commit | `913ffd6` (v10.0.55) | `git rev-parse --short HEAD` |
| Branch | `codex/ollama-local` (deploys directly to bdnick.info) | `git rev-parse --abbrev-ref HEAD` |
| Commits last 7d | 213 | `git log --since='7 days ago' --oneline \| wc -l` |
| Prisma models | **69** (was 66 pre-v10; +3 from v10.0.1/2/8: BrainBusEvent, SchemaChangeLedger, AgentTrace) | `grep -c '^model ' prisma/schema.prisma` |
| `@relation` declarations | 19 | `grep -c '@relation' prisma/schema.prisma` |
| Migrations applied | 2 | `prisma/migrations/` |
| API routes (`route.ts`) | **326** (+1 from v10.0.49 `/api/email/send`) | `find app/api -name 'route.ts' \| wc -l` |
| `(mastery)` pages | **60** (+1 from v10.0.52 `/learn`; was 50 pre-v10 surface sweep) | `find 'app/(mastery)' -name 'page.tsx' \| wc -l` |
| Test files | 63 (644/644 passing as of v10.0.55) | `find tests -name '*.test.ts' \| wc -l` + `pnpm test` |
| **Auth-coverage gate** | **Hard-fail mode** · 0 unauthed mutating routes (51 retrofitted v8.26) | `bash scripts/pre-push-check.sh` |
| `authedFetch` adoption | All client `fetch("/api/...")` migrated (253 call sites v8.28) | `grep` across `components/`, `app/(mastery)`, `hooks/` |
| **Active crons** | **34** | `verify-crons.ts` — 6 slots headroom under Vercel Pro 40-cap |
| Folded crons (run inside another cron) | 24 | `verify-crons.ts` |
| Retired crons (deletion scheduled) | 5 | `verify-crons.ts` |
| TypeScript errors | 0 | `pnpm typecheck` |
| ESLint errors | 0 | `pnpm lint` |
| ESLint warnings | 430 (tolerated; `--quiet` mode passes) | `pnpm lint` |
| Pre-push gate steps | **9/9** (+ master-only full production build) | `bash scripts/pre-push-check.sh` |

### Pre-push gate breakdown (v8.21 → v10.0.43 normalized labels)

```
  [1/9]  typecheck                     tsc --noEmit
  [2/9]  lint                          eslint --quiet (warnings allowed)
  [3/9]  tests                         vitest run (60 files · 610 passing)
  [4/9]  raw-sql column audit          scripts/audit-raw-sql-columns.ts
  [5/9]  cron manifest drift + budget  verify-crons.ts (≤38 active)
  [6/9]  AI tool-catalog contract      vitest run tests/ai/
  [7/9]  env-secret bypass guard       grep for `process.env.<SECRET> ?? ""`
  [8/9]  API route auth coverage       hard-fail (mutating · v8.26 sweep complete)
  [9/9]  sensitive GET-route auth      hard-fail (16 prefixes · v10.0.37 widened)
  [+]    full production build         statenour-master only
```

Auth-coverage hard mode has been default since v8.26 (mutating) and v9.1.17 (sensitive GET). Emergency overrides: `AUTH_GATE_SOFT=1` / `SENSITIVE_GET_GATE_SOFT=1`.

### CI

GitHub Actions workflow at `.github/workflows/ci.yml` mirrors the local pre-push gates, plus runs the production build on `statenour-master`. The mirror workflow `.github/workflows/mirror-to-master.yml` fast-forwards `statenour-master` to `codex/ollama-local` HEAD on green CI.

---

## 2 · Doc-to-reality drift (now corrected)

| Doc | Stale claim | Reality |
|---|---|---|
| `README.md` | "31 active crons" + "63 Prisma models" + "73 tests" | 34 active · 66 models · 41 test files |
| `docs/ARCHITECTURE.md` | "209 handlers" + "31 active · 5 folded · 1 retired" + "63 models" | 313 handlers · 34/24/5 · 66 models |
| `docs/DATA-MODEL.md` | "63 models" header | 66 models |
| `docs/project/UPGRADE-PLAN.md` | Reality snapshot dated 2026-04-21 | re-stamped 2026-04-29; v8.x mega-overhaul live |
| `docs/project/ROADMAP.md` | Last touched 2026-04-20 (v10.4 era) | trimmed to high-level future horizons; full v10/v11 detail archived |
| `docs/project/MASTER-CONTEXT.md` | Apr 12, predates everything substantive | left in place — historical only; UPGRADE-PLAN is now active source |
| `docs/UPGRADE-PLAN-V6.md` | v6 mega-overhaul plan | shipped per `v6_mega_overhaul.md` memory; left in place as historical |
| `package.json` build script | `prisma db push --accept-data-loss && next build` ran on every Vercel deploy | dropped from default `build`; preserved as `build:push-schema` for explicit invocation only |

---

## 3 · Active version trees

There are two parallel numbering schemes — they are NOT the same series:

- **Personal-OS surface version** (v10.x → v11.x): the user-facing feature plan from Apr 20-22. Last bump was v11.1 mega-wave on Apr 22.
- **Mega-overhaul wave version** (v6 → v7 → v8.x): the multi-wave engineering reset that ran Apr 28-29. v6 + v7 + v8 (with sub-versions through v8.24) are sequential waves on `codex/ollama-local`.

Both apply. Roadmap items can reference either tree — note which when adding new ones.

**Current wave:** v8.x mega-overhaul (Apr 29). 25 commits across v8.0 → v8.24. Latest: v8.24 (`08237d9`, 2026-04-29).

Memory file at `~/.claude/projects/C--/memory/v8_mega_overhaul.md` carries the full version table for v6 → v8.24.

---

## 4 · Documentation hierarchy (read in order)

1. **`docs/RECONCILIATION.md`** ← THIS FILE · ground truth for current state
2. `docs/AGENT-CONTRACT.md` — what any agent needs to know before editing
3. `docs/project/UPGRADE-PLAN.md` — **active execution source** (current wave + checkpoints)
4. `docs/project/ROADMAP.md` — high-level future horizons (slimmed; not a wave plan)
5. `docs/project/CHANGELOG.md` — shipped features by wave/version
6. `docs/ARCHITECTURE.md` — subsystem map + data flow
7. `docs/DATA-MODEL.md` — Prisma model catalog + retention
8. `docs/SECURITY.md` — auth, CSP, secrets, boundaries
9. `docs/RUNBOOK.md` — cron catalog + incident playbook
10. `docs/REPO-MAP.md` — repos under `nourdean22/*`
11. `docs/ULTRON-VISION.md` — product vision for `/`

Archived: `docs/archive/` for retired plans (v10.x ROADMAP detail, Mar 27 prompt files, etc.)

---

## 5 · Build-script change rationale

**Before** (every Vercel deploy):
```json
"build": "prisma generate && prisma db push --accept-data-loss && next build"
```

`prisma db push --accept-data-loss` blindly conforms the live Neon schema to whatever's in `prisma/schema.prisma`, **dropping any column or table not in the schema**. Two failure modes:

1. A schema typo / accidental field deletion → silent data loss in prod on next deploy.
2. The `--accept-data-loss` flag suppresses the safety prompt that exists specifically to catch this.

**After:**
```json
"build": "prisma generate && next build",
"build:push-schema": "prisma generate && prisma db push --accept-data-loss && next build",
```

Schema changes now flow through explicit `prisma migrate dev` → migration files → `prisma migrate deploy` (or, if needed, deliberate one-shot `pnpm build:push-schema` invocations). Vercel's default build no longer touches the schema.

---

## 6 · How to keep this honest

Every wave that lands a commit:
- Bump "Last verified" stamp at the top of this file.
- Re-run the verification commands below; update Section 1 rows that changed.
- Touch the impacted doc only with the new value (not stale prose).

Verification commands (paste-ready):

```bash
# Reality counts
git rev-parse --short HEAD
git rev-parse --abbrev-ref HEAD
git log --since='7 days ago' --oneline | wc -l
grep -c '^model ' prisma/schema.prisma
grep -c '@relation' prisma/schema.prisma
find app/api -name 'route.ts' | wc -l
find 'app/(mastery)' -name 'page.tsx' | wc -l
find tests -name '*.test.ts' | wc -l
pnpm exec tsx scripts/verify-crons.ts | tail -10

# Quality
pnpm typecheck
pnpm lint
pnpm test
bash scripts/pre-push-check.sh
```

---

*End of reconciliation. If something here is wrong, fix it in the same commit that introduced the drift — never let stale numbers float.*

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.
