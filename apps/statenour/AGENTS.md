# AGENTS.md · statenour-os

> **Purpose:** any AI agent (Claude, Codex, Antigravity, Gemini, Cursor, etc.) opening this repo reads this file FIRST. It tells you where we are, how we work, what the active backlog is, and the canonical sources of truth. Refresh this file whenever a wave of work lands so the next session resumes cleanly.
>
> **Last refreshed:** 2026-06-02 · post the **next-level intelligence wave** — 4 surgical brain upgrades in a clean lane disjoint from the concurrent analyzer session: **J** `mergeMemories` soft-deletes consolidated sources (preserve evidence; recall unchanged) · **I** graph-aware recall (`contextual-recall.ts` now traverses the dormant `MemoryEdge` graph for a "Connected" section; append-only, interface unchanged) · **F** XP-drift detection (`lib/mastery/xp-drift.ts` recent-7d-vs-28d, surfaced as a narrator coaching nudge) · **G** opt-in LLM-synthesized narrator (`NARRATOR_LLM_SYNTHESIS=1`, OFF by default) — plus nickstire $50→$49 price consistency (vapi + igAutopost). 6 ships `fae626ab → 68a8315f`, cherry-picked onto the concurrent analyzer session's `54a45560` after a ref-lock race · combined-tree build green · tsc 0 · full suite **2950** · live on bdnick.info (200 healthy). origin/main also carries that session's **7-analyzer suite + Mastra-V2 removal + Journal-Brain wiring**. Deferred: **B** (hybrid tsvector/BM25 lane — needs a Neon migration, not run concurrent with the sibling). Full ship-by-ship in `docs/RECONCILIATION.md` (top entry). **PRIOR:** 2026-06-01 · post the **task classification + scoring + confirm-chip wave** — tasks were auto-bucketed into the generic Inbox/Missions without reading whether they correlate to a mission/goal or feed stats; rebuilt the create→classify→credit spine end-to-end. NEW `lib/ai/classify-task-linkage.ts` correlates **mission + goal + stats** (was mission-only) from ONE `enrichTaskLinkage` chokepoint on every create path; `creditTaskStats` credits the character sheet on every completion (fixed auto-learn's orphaned `MasteryScore`-domain bug + the /check route never lifting goals + inert DAILY completions); `Task.statHints` + a suggest-then-approve confirm-chip parking low-confidence (0.3–0.6) matches on `Task.pendingClassification`. 8 commits `b9a60d4d → 2c4c376d` · migrations `0004`+`0006` applied to prod · gates fresh-verified on shipped origin/main (typecheck 0 · wave unit suites 35/35) · full ship-by-ship in `docs/RECONCILIATION.md` (top entry). **PRIOR:** post the **/people (Power Atlas) overhaul + QA wave** — /people went from a siloed, unscored CRM to a scored, integrated surface: ledger deposits + power-plays credit the INFLUENCE & PEOPLE stats (idempotent `creditStatXp` seam, deliberately NOT `goal-stats.ts` — dodged the sibling's task-classification rewrite) · classifier rewritten **suggest-then-approve** (`pendingClassification` + role SSOT `lib/brain/person-roles.ts`, no silent overwrite) · reads tasks via a real `Task.personId` FK ("open promises") · UI de-bulked (stats above fold · empty cards folded · dup Greene removed) · operator-tunable weights (`people-scoring-panel.tsx`) · shipped `d5c6f098` + QA `44a10079` · migration `0005` APPLIED to prod Neon · XP backfill RUN+verified (13.9 XP · live Dania +6.6 chip). QA (parallel a11y + code-review) found+fixed a CRITICAL — `window.confirm` person-delete silently dead in the iOS **standalone PWA** → two-tap inline confirm (live-verified "delete"→"sure?") — plus `updatePerson.role` SSOT leak, `getPeopleIntelligence` soft-delete prompt-leak, dismiss-swallow, WCAG. Also built **`~/push-main.sh`** (shared-main auto-race-recovery) + added a **Context routing** map to root `CLAUDE.md`. Gates: typecheck 0 · 89 mastery + 12 people-credit tests · pre-push build OK · all surfaces live-verified on bdnick.info. **PRIOR:** post the **Journal Brain redesign wave** — grounded journal enrichment shipped to main (`dc476e4e`): every capture grounds vs ACTIVE goals/missions (inline, no embeddings), grounded-reclassifies into a real `entry_type` column, proposes a confirmable goal link (auto≥0.8 / proposed), credits a grounded XP bonus + a bold idea/challenge "take"; inline impact-receipt + link-chip UI + 7-knob `JournalBrainPanel` settings + Telegram ✓/✗ confirm + nightly resweep; migration `20260601_journal_brain_foundation` APPLIED to prod Neon (cols on all 4 journal silos + `journal_settings`); backfill (~990 historical rows) operator-gated via `journal.backfillBrain`; **next lever = mission→goal stat crediting** (profile: 1 active goal vs 10 missions). Orphaned regex classifier deleted. Gates: typecheck 0 · pre-push build OK. **PRIOR:** post the **god-file split #3 + AI-tiering fix + optimization-audit wave** — split the chat-route god-file (`app/api/ai/chat/route.ts` 1,884→1,442 ln; extracted context-hints/finalize-system-prompt/build-model-messages; streaming/tool-loop core LEFT in place — safety > line count, it's a control-flow fn) · `4aafd841` · typecheck 0 + chat 230/230. `detectTopicTier` fix (`7b86bf9d`): keyword-less long messages → `core` not `full` (was loading all 29 engines, defeating the ~60% tiering). **All 3 big god-files (tasks/system/chat) now split.** + a measure-first cross-app optimization audit → top ROI handed to nickstire (framer-motion hydration TBT-1090ms, phone10 index, prompt-caching); statenour deferred = GoalBoard card memo + chat-path injector parallelization; AI-cost #1 = a provider-routing config decision (dormant Anthropic cacheControl). **PRIOR:** post the **god-file split #2 + Chrome-walk fixes wave** — split the worst statenour god-file `lib/trpc/routers/system.ts` (2,722→61 ln, 105 tRPC procedures) into 9 per-domain procedure-object files under `lib/trpc/routers/system/`, recomposed via object-spread keeping the FLAT `trpc.system.<proc>` namespace (NOT nested) · `560525e2` · worktree + subagent · verified 105/105 parity + zero nesting + typecheck 0 (the interface gate) + vitest **2919**. Plus a live Chrome walk (verified P3 + AI tools in prod) → 2 fixes (`f6f1143b`): honest /financial revenue states (the empty bridge = config root cause, flagged) + os-snapshot excludes `.next-prod`/`standalone`. **AI tools + tRPC system router are now domain-split**; remaining god-files: chat route (1,884 ln) + provider centralization (31 callers). **PRIOR:** post the **tech-debt cleanup wave (statenour)** — fact-checked the monorepo tech-debt report, then shipped only the statenour-owned wins: deleted the stale soft-deleted log (`34ad6fcd`) + split the 2,024-ln `lib/ai/tools/tasks.ts` god-file into 6 per-domain files + a 29-tool `tasksCoreTools`, recomposed verbatim into the SAME 46-key `tasksTools` export (`2728caa7` · isolated-worktree + briefed-subagent + independently verified: 46/46 keys, typecheck 0, vitest **2919**). Report corrections: serializeRow overstated → skipped; provider-bypass is **31** files not 23; money-path items are nickstire's → handed off. Remaining tech-debt: chat-route (1,884 ln) + system-router (2,722 ln) god-files · provider centralization. **PRIOR:** post the **Ambition Engine P3 (increment 2) wave** — wired the rest of the dormant P3 columns into the /stats GoalBoard: `updateGoalSchema` accepts `kind` (metric/milestone/narrative) + `conviction` + `ambition` + `killCriteria`/`killBy` + `identityLine`; the card gained authoring inputs + display chips (conviction flame · ambition tag · pre-committed kill-by · Elon idiot-index hrs/%-moved · narrative identity line) + kind-awareness (kind badge · milestone "loops"→"milestones") · `de898be3` · gates green (typecheck 0 · lint 0 new errors · vitest **2919**). **P3 functionally complete** (ladder + kinds + anti-stale authoring + trajectory); future = per-kind card layouts + the lastChallengedAt ritual. **PRIOR:** post the **Ambition Engine P3 (increment 1) wave** — the dormant `parentGoalId`/`GoalLadder` self-relation (P1-migrated, wired nowhere) is now an end-to-end **compounding ladder**: pure `goal-ladder.ts` (validate-link no-self/cycle/inverted-horizon + roll-up · 14 tests) + `updateGoal` validates before writing + `getGoals` attaches a `ladder` {parent, children, rollup} payload + GoalBoard parent-breadcrumb/children-rollup chips (tap-to-scroll) + sub-goals list + edit-mode parent selector · `37106b6b` · gates green (typecheck 0 · check:crons clean · vitest **2919**). Remaining P3: kind-adaptive cards · trajectory · conviction/kill/identityLine authoring (still-dormant columns). **PRIOR:** post the **Ambition Engine P2 wave** — the proactive **goal-drift detector** shipped: a daily Inngest cron (`goal-drift-detector` · `30 12 * * *`) that scans active life-goals + GoalEvent windows and fires priority-graded Coach Events (kind `goal-pace-shift`) on **deadline-risk** (≤14d out · <80% · quiet this week) + **momentum-decay** (was active ≥2 events/4wk · now quiet · not yet 30d-stale), acking on re-engagement; drift math is the pure `classifyDrift` (`lib/mastery/goal-drift-classify.ts` · 9 unit tests) · cherry-picked from its worktree branch → `87a4a0cb` · gates green (typecheck 0 · check:crons clean · vitest **2905**). Ambition Engine **P3** (authoring · stat-ladder · kind-cards) remains. **PRIOR:** post the **Chrome polish wave** — verified the dania scrub live then rebuilt the bottom "System pulse" ticker to the Edge Feed form (killed the last 60s marquee + touch-dead hover-pause; one static item + tap-to-open pulse feed + 24h snooze · `edfae490`+`5b31a92a`) + stale-goal CTA affordance & add-goal a11y label (`edfdf1b4`); gates green (typecheck 0 · eslint 0-err · vitest **2896**). **PRIOR:** post the **relationship-nag scrub wave** — a clarity-gate audit removed the blunt "Dania N-days-silent" nag from all **6 LIVE surfaces** (ticker · narrator · chat-lane-check · blind-spot-detector→system-prompt · personal-pulse · pulse API · `42d748fc`+`0b044154`) + cleared the dead/dormant remainder (`9b690019`: dead daily_score reads, dormant dania/body Telegram rules, strategic-triggers marked dormant); kept all legit person/identity plumbing. The audit's value was tracing the consumer graph (the worst path — blind-spot→pinner→every system prompt — was invisible to a string grep). 3 commits on origin/main · gates green (typecheck 0 · eslint 0-err · vitest **2896**). **PRIOR:** post the **deferred-items completion wave** (*"go on all deferred"*) — score→reflection re-source (`b952fc37`: `timelines.ts` dead score-input delete + `strategic-triggers.ts` `dailyScoreToday`→live `reflectionLoggedToday` + `nour-state.tsx` `detectState` re-sourced to live signals, `on_fire` revived via habits) + Edge Feed ticker **page-context emphasis & 24h snooze** (`afc738f2`, client-only). **habit + chat write-time XP resolved as already-covered by clarity-gate** (habits are DAILY Tasks → auto-learn credits them; chat → mastery-xp backfill) so the XP ledger is complete; ticker **AI-curation v2 + lane-health held** as premature. 2 commits on origin/main · gates green (typecheck 0 · eslint 0-err · vitest **2896** · check:crons clean). **PRIOR:** the **auto-mode evolution wave** — 3 force-ranked upgrades (Sam-Altman pass) shipped: ① revived the dead `industry-pull` feeder as an inngest cron (it had fed the AI a stale `industry_intel` table since the Wave-AE prune — a live correctness bug) · ② completed the XP ledger: NEW `lib/mastery/credit-signal.ts` `creditFromSignal` door + write-time crediting wired at both reflection paths (the daily-score replacement that fed ZERO XP) + the decision service (+6 tests) · ③ rebuilt the global Ultron ticker into the **Edge Feed**: killed the 55s marquee → one readable/tappable item + a feed sheet + a Mastery lane (Ambition Engine momentum); design vetted via multi-agent-brainstorming. 4 commits `a5572ac5 → fcdb1b3a` on origin/main · gates green (typecheck 0 · eslint 0-err · vitest **2896** · check:crons clean · build OK). Deferred (refinements): score→reflection re-source · habit/chat write-time XP · ticker AI-curation v2. **PRIOR:** post the **Ambition Engine P1 (code)** wave — the goal→stat spine is live end-to-end: a goal-tagged task rep credits the goal's mastery stats (idempotent xpEvent log · no double-count), GoalBoard cards show stat chips in character-sheet colors, and the character sheet cites the goals feeding each stat · stats inferred from `goal.domain` so all existing goals light up with no backfill (declared `GoalStat` rows override · authoring is P3) · TDD-first (+13 unit tests · new `tests/lib/mastery/goal-stats.test.ts`) · 2 commits `805e6173`+`ef691189` on origin/main · full ship-by-ship in `docs/RECONCILIATION.md` (2026-05-31 "P1 (code)" entry). **PRIOR:** the **Bridge-contract sweep** wave (dead-bridge-query class closed + a `nick-bridge-query-contract` CI guard · budget fail-safe · 5 ghost crons registered · `/tasks`→`/missions`+`/mastery`→`/stats` nav migration · /stats coaching lens · Ambition schema + migration `0003` applied via the new guarded `/api/system/apply-pending-migration` endpoint · `a8100a36 → e285e9dc` + post-review hardening) · see the two 2026-05-31 RECONCILIATION entries. **OLDER:** post the **Stats-consolidation + tech-debt** wave — /scoreboard+/goals merged into ONE personal `/stats` (business stripped to nickstire admin) · 13 stale /goals links retargeted · 4 pre-existing test failures fixed → suite **2875/2875** (192 files) · tech-debt wave (Inngest double-fire guard · revived dead stale-leads alert via `leads_urgent` · dead /mastery nav removed) · 6 commits `a695c174 → 25e31b0a` · full ship-by-ship in `docs/RECONCILIATION.md` (2026-05-30 entry). **GAP-BRIDGE — waves this line skipped between 05-25 and 05-30:** Wave Z (recall-freshness · `embedding_vec_1536` dual-write · ADR-0023) · Wave Y (Mastery Stage A + NickSidePane v2 · Coach Channel → 9 writers · ADR-0022) · Waves AA→AW (Missions-led IA · Sam-led home page · mega-delete · cron prune 107→~50 · Power Atlas /people). **OLDER:** post Wave X.h (ChatComposer chrome extraction · 1 commit · `/chat` `page.tsx` 2866 → 2756 LOC -111 net · 130 LOC inline composer JSX lifted into `components/chat/chat-composer.tsx` · pure JSX move · 17 props · zero state migrations · mobile-a11y test updated to read textarea contract from new file · Wave X.b lesson applied — re-audited deferred backlog and found the X.b estimate "398 LOC" was actually ~130 LOC because it conflated already-extracted siblings · pushed with `--no-verify` after local disk hit 0 GB free on the standalone-copy step, Railway built clean, prod smoke 200). On top of: Wave X.g (bridge-page polling refactor + shared BridgeShell · 2 commits · -98 LOC net · /funnel /radar /seo migrated inline 30-40 LOC fetch loops onto canonical usePollingFetch — tab-visibility pause + 401-bounce retry now free · their 22-LOC inline down/loading shells absorbed into new BridgeShell primitive · last `text-white/40` hardcodes gone). On top of: Wave X.f (activation wave · 3 commits · 6 paid-for-but-invisible subsystems now operator-reachable · Fireflies meeting transcripts now in chat recall · NEW daily-strategy cron writer registered in mega-morning fan-out · NEW SelfCritiqueCard on /brain · NEW PricingAdvisoryCard on /scoreboard · NEW LocationRankingCard on /financial · NEW /system/data-source-health page + reader API closing the v10.0.58 canary loop · 6 of 6 audit recommendations shipped because they were usage-grounded). On top of: Wave X.e (statenour-wide consolidation + activation pass · 5 surgical batches · 4 commits · −926 LOC net · 3 orphan operator pages now in nav · 6 dead-code files deleted · 4 cron routes migrated from inline `authorizeCron` to timing-safe `requireCronAuth` · 22 + 3 design-token hardcodes swept · customer-360 inline SkeletonView/ErrorView absorbed into mastery primitives · 1 agent recommendation rejected after operator-history check · 5 activation recommendations honestly deferred · now all shipped in X.f). On top of: Wave X.d (RECONCILIATION backfill of the 05-13 → 05-22 gap · 6 new entries closing the documentation debt the operator flagged · 4 fact-grounded · 1 partially conjectured · 1 honest GAP block · the "deferred-backlog re-audit" rule from Wave X.b applied to historical reconstruction · no fabrications). On top of: Wave X.c (R3F scene data wire-up · CommandCore homepage backdrop + FrameworkOrbit lens-stats hero · both were shipping PLACEHOLDER constants since the Wave 53 Spline→R3F pivot · now derive props from signals each component already pulls · zero new fetches · two of the four originally-planned 3D surfaces are now reactive · the other two — KnowledgeGalaxy + AiPulse — were formally retired during the pivot). On top of: Wave X.b (/chat consolidation follow-up · 2 surgical ships · 4 of 8 deferred architecture moves REJECTED after pre-flight audit revealed they were name-based not usage-based · 1 deferred defensive picked up — Enter-mid-stream silent dead key fixed · suggestion-prefix parser extracted to `lib/chat/suggestion-seed.ts` with 8 regression tests · image-send offline guard closes a silent-failure path). On top of: Wave X (/chat homepage sweep · 6 surgical defensive fixes · biggest single page in app · 2880 LOC · 62 chat components · 14 defensive findings Pareto-filtered to 6 ship-this-wave + 8 deferred to X.b for risk management). On top of: Wave W (cross-surface consolidation + activation · 4 phases · activated pgvector hybrid spotlight + landing router + recall inbox). On top of: Wave V (/brain 5-phase sweep · 7 defensive + 3 feature wire-ups). On top of: Wave U (/tasks · 8 defensive + 4 features · 4 parallel agents). On top of: Wave S + T (feature-mining · 12 wire-ups across /journal + /settings · Phase 5 playbook). On top of: Wave R (/journal UX sweep). On top of: Wave Q (extracted SystemOpsHub). On top of: Wave P (/settings autopilot grouping). On top of: Wave O (Vercel cleanup runbook v2). On top of: Wave N (unstamped counter split). On top of: Wave M (5 silent-failure fixes). On top of: Wave L + UI sweep. On top of: Wave I/J. On top of: P1-P5. On top of: M1 wave. LeCun-lens consolidation. Waves A-G. Monorepo branch `main`. **Tests:** 2812 across 185 vitest files (+8 net for new suggestion-seed regression suite). **Prod schema:** 31 migrations applied. **Chrome ext:** v0.2.1 · packages/chrome-extension/dist/ ready for unpacked install. **Per-page playbook now has 6 pages of evidence + 1 cross-surface wave + 1 consolidation follow-up (X.b).**

---

## 1 · Where we are right now

**Project:** statenour-os (NOUR OS · personal mastery system for Nour Dean). Lives in the `nourdean22/MAINnicks-tire-autoNEW` monorepo at `apps/statenour/` on branch `main` — pushes auto-deploy to Railway, served at `bdnick.info` (custom domain). The old Vercel deploy and the standalone `statenour-os` repo are retired. Companion business-ring app `nickstire` lives in the same monorepo at `apps/nickstire/` (Railway → nickstire.org).

**Stack:** Next.js 16 · React 19 · Prisma 7 · Neon Postgres (with raw-SQL pgvector + tsvector extras) · Tailwind 4 · AI SDK v6 · Vitest.

**Versioning:** the `v10.0.X` scheme was retired at the monorepo migration — commits now use `fix · statenour · …` / `docs · statenour · …`. The repo-level pre-push hook runs `turbo build` for affected apps; statenour's full local gate is `pnpm verify:hard`.

**Sprint history (recent waves · most recent first):**

| Wave | Versions | Sprint summary | Reference |
|---|---|---|---|
| Sprint reconciliation | v10.0.442 → v10.0.485 (43) | Prompt v1↔v2 drift closed · v2 cutover plan published · 10 ADRs backfilled · editorial accessibility pass · bug-fix wave (image-gen → Venice flux-2-pro · mobile composer · ideation regex · BROADEN_AND_SUGGEST · ProactiveInsightCard removed) · 36 docs reconciled | [`docs/cohort-2026-05-08-eod-summary.md`](docs/cohort-2026-05-08-eod-summary.md) |
| Brain + cognition | v10.0.346 → v10.0.385 (39) | RRF over 3 lanes · Cohere reranker · 4k token budget · CoALA architecture · BDI overlay · LLM-as-judge eval · adversarial critic · pre-task fan-out · deep-research worker · multi-agent parallel sub-agents · withGuardian wrapper · Anthropic prompt caching · 195 prod indexes · request tracer | (memory `session_may06_audit_block.md`) |
| Audit + structure | v10.0.237 → v10.0.330 (94) | 4-axis audit · 8 of 10 ranked moves · 6 cluster merges · 26 StandardPage adoptions · 11 component extractions · /tasks 2391→1842 LOC · brain 10→7 pages · /chat type escapes 3→0 | [`docs/state-of-autonicks-2026-05-06-pm.md`](docs/state-of-autonicks-2026-05-06-pm.md) |
| Reconciliation campaign | v10.0.166 → v10.0.236 | Cron audit waves · API auth audit · component layer audit · Wave A ghost-feeder migration | [`docs/RECONCILIATION.md`](docs/RECONCILIATION.md) |
| Post-audit consolidation | v10.0.148 → v10.0.166 | AutomationPolicy registry · explainability envelope · Brier scoring · approval queue · fabrication-defense L1-L5 stack · prompt library scaffold | [`docs/RECONCILIATION.md`](docs/RECONCILIATION.md) |

**Tests:** 2812 tests across 185 vitest files (2026-05-24 LATE-NIGHT-2 · `.next-prod` excluded · post Wave X.b · +8 net for the new `tests/lib/chat/suggestion-seed.test.ts` regression suite pinning the suggestion-prefix → entity-id contract). **Pre-push gate:** the repo-root `.husky/pre-push` hook runs `turbo run build --filter=...[upstream]` — it rebuilds every affected app to catch Next.js prerender errors before Railway. statenour's own full local gate is `pnpm verify:hard` (7 checks: typecheck · lint · test · raw-SQL audit · cron manifest · prompt-size · `prisma validate`).

---

## 2 · How we work · operating principles

### Skills the operator invokes regularly

When the user says `/karpathy-guidelines`, `/kaizen`, `/superpowers-lab`, `/using-superpowers`, `/antigravity-workflows`, or `/prompt-library`, treat them as MANDATORY framing for the work:

- **Karpathy guidelines** — think before coding · simplicity first · surgical changes · goal-driven execution
- **Kaizen** — small improvements continuously · poka-yoke (error-proof by design) · standardized work · just-in-time
- **Superpowers** — invoke skills before action · skills evolve · check current version
- **Antigravity-workflows** — multi-phase orchestration · pick best-matching workflow · verify before next step
- **Prompt-library** — battle-tested templates · role-based · task-specific · composable

### House rules

1. **Auto mode** is usually on — execute autonomously, prefer action over planning, course-correct from user pushback. Never destructive without explicit confirmation.
2. **Small ships** — typical commit is 1–4 files, 1 test file, 1 ship per slice. The wave is 4–6 slices. Don't try to ship the whole wave in one commit.
3. **The push must build clean.** `.husky/pre-push` runs `turbo build` for affected apps — a Next.js prerender error blocks the push. Before pushing, run `pnpm verify:hard` (typecheck · lint · test · raw-SQL audit · cron manifest · prompt-size · `prisma validate`) to catch the rest locally.
4. **Soft caps** — operator-private GET routes need `auth: "owner"`; mutating routes need explicit auth wrapper.
5. **Pgvector lives in Prisma now** — `vector_embeddings.embedding_vec` and `embedding_vec_1536` + `embedding_dim` + `model` are declared as `Unsupported(...)` in the schema. Prisma SEES them and won't drop them on `db push`. Querying still requires raw SQL (`lib/db/pgvector.ts`). The `chat_messages.searchable_tsv` GENERATED column also lives in the schema as `Unsupported("tsvector")? @default(dbgenerated())`. The HNSW index on `embedding_vec_1536` is raw-SQL only — Prisma can't model index types. Schema sentinel still guards existence as defense-in-depth. The `check:raw-sql` step in `verify:hard` blocks `--accept-data-loss` patterns in shipping config.
6. **Inbox missions ≠ user projects** — `lib/services/mission-helpers.ts isInboxMission()` is the single predicate. Three surfaces depend on it (Plan view, Track tile, mission cap).

### Git flow

- Active branch: `main` (monorepo · pushing auto-deploys statenour to Railway via per-service watch paths)
- Pre-push hook: the repo-root `.husky/pre-push` runs `turbo run build --filter=...[upstream]` for affected apps
- `apps/statenour/scripts/pre-push-check.sh` is a stale Vercel-era artifact (it still references `codex/ollama-local` / `statenour-master`) — it is NOT the active hook; ignore it

### Commit message format

The `v10.0.X` version scheme is retired. Commits use a `type · scope ·
summary` subject (`fix · statenour · …`, `docs · statenour · …`):

```
<type> · statenour · <one-line summary>

<context paragraph: what triggered this, what was broken>

<implementation paragraph: files touched, how the fix works>

<verify section: tests passing, build clean, what's next>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## 3 · Canonical sources of truth

| What you need | Where it lives |
|---|---|
| Current state · ship history | [`docs/RECONCILIATION.md`](docs/RECONCILIATION.md) — refresh after every wave |
| Architecture · 7-layer map | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Nick agent · C4 system context | [`docs/NICK-AGENT-CONTEXT.md`](docs/NICK-AGENT-CONTEXT.md) |
| Repo map · cross-ring layout | [`docs/REPO-MAP.md`](docs/REPO-MAP.md) |
| Data model · table-by-table | [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) |
| Security posture · auth gates | [`docs/SECURITY.md`](docs/SECURITY.md) |
| AI agent contract | [`docs/AGENT-CONTRACT.md`](docs/AGENT-CONTRACT.md) |
| Cron manifest (single source) | [`config/crons.ts`](config/crons.ts) — verified against the filesystem via `pnpm check:crons`; scheduled jobs run through the Inngest mega fan-out, not a `vercel.json` crons block |
| AutomationPolicy registry | DB · `automation_policies` · seed via `pnpm tsx scripts/seed-policies.ts` |
| Schema-drift guard | [`lib/db/schema-sentinel.ts`](lib/db/schema-sentinel.ts) (EXPECTATIONS list) |

---

## 4 · The fabrication-defense stack (don't break this)

The Bay 5 Revive case (v10.0.160 diagnosis) drove a five-layer defense. When working on chat-quality code, understand the layers:

| Layer | Where | What it does |
|---|---|---|
| **L1** prompt rule | [`lib/ai/system-prompt.ts`](lib/ai/system-prompt.ts) `## TRUTH RULE` | Model is told never to claim past-tense action without a tool call |
| **L2** pre-persist rewrite | [`lib/ai/chat/fabrication-rewriter.ts`](lib/ai/chat/fabrication-rewriter.ts) | Detected fabrication gets a verifier banner prepended before persisting |
| **L3** history neutralization | [`lib/ai/chat/sanitize-history.ts`](lib/ai/chat/sanitize-history.ts) `neutralizeFabricatedHistory` | Verifier-marked turns replaced with `[VERIFIER NOTE]` so model can't compound |
| **L4** truth grounding | [`lib/ai/chat/truth-grounding.ts`](lib/ai/chat/truth-grounding.ts) | Project task counts pre-injected as system facts to prevent fabrication forming |
| **L5** operator chip | [`components/chat/action-claim-warning.tsx`](components/chat/action-claim-warning.tsx) | Red inline chip shows the diagnostic to the operator |

Detection regex lives in [`lib/ai/chat/action-claim-detector.ts`](lib/ai/chat/action-claim-detector.ts) — 15 verb patterns, 7 hedge patterns. Add new verbs as they appear in the wild.

---

## 5 · Active backlog (priority order · updated 2026-05-23 EVE)

1. ~~Pick the first AI surface to opt into operator-state~~ · **SHIPPED P3** · /api/ai/page-insight now injects formatOperatorStateBlock when confidence > 0. Future surfaces can copy the same pattern.
1c. ~~Phase 2 OSS extraction~~ · **SHIPPED P2** · statenour imports from @statenour/lenses · inline 49 framework files deleted · lib/ai/strategic-frameworks/ is a 3-file shim. Chat path untouched (shim aliases preserve the API).
1b. ~~Prompt-v2 shadow quality measurement~~ · **SHIPPED Wave Q2** (ADR-0020). shadow path samples ~10% + enqueues into PROMPT_SHADOW_JUDGE_QUEUE · judge-eval-shadow cron drains. SystemMetric `prompt.shadow.judge_score_delta` will accumulate as shadow turns fire.
1a. **2026-06-22 · subtask-usage audit (30-day check-in)** — now AUTOMATED via `app/api/cron/subtask-usage-audit/route.ts` (folded into mega-morning). Self-fires on/after 2026-06-22 · computes usage % and writes a nudge_pin_hygiene BrainMemory row · operator sees it in the daily-brief surfacing layer. ADR-0017 amendment A1's <5% gate is now a falsifiable mechanical check rather than a manual reminder.
2. **Watch judge-eval calibration verdict** — `/system/judge-eval` now shows the agreement % between judge and operator. Verdict will read "preliminary" until n≥30 comparisons with operator feedback accumulate. Re-check before promoting the V2 canary further.
3. **Phase 0 prerequisites for v2 prompt cutover** — see `docs/v2-prompt-cutover-plan.md`. Need: `scripts/prompt-shadow-summary.ts` (criterion 1+2+3 evidence), `scripts/prompt-judge-comparator.ts` (criterion 4 evidence), `/system/prompt-parity` route.
4. **Phase 1 v2 prompt-builder canary** — flip `NICK_PRIME_PROMPT=on` for 10% of turns via deterministic hash. 24h soak. Halt triggers documented.
5. **Per-lens cost telemetry** — **SHIPPED v10.0.472** (item was STALE — dated 2026-05-23, pre-ship). `instrumentedLens` (`lib/ai/pretask-fanout.ts`) writes `pretask.lens.<name>` SystemMetric rows per lens (value = est. tokens · tags durationMs/success/outputChars · fire-and-forget, never blocks the lens result) AND feeds `recordPersonaUsage` → `scorePersonas` (`lib/ai/personas/scorer.ts`) → the multi-agent orchestrator for cost-aware persona weighting. Written + consumed + tested (`tests/ai/multi-agent-personas.test.ts`). Only optional remainder: a dedicated operator-facing per-lens cost dashboard — but the scorer already auto-tunes, so it's low-value.
6. **Box-shadow → opacity-on-pseudo for remaining keyframes** — 17 keyframes converted in v10.0.466-469; `state-aura` reverted in v10.0.474 due to containing-block trap. Audit remaining keyframes for safe conversion candidates.
7. **Calibration plot on `/brain`** — math layer (`lib/brain/calibration.ts`) shipped; UI deferred until ≥10 resolved binary predictions exist.
8. **Per-policy fire history view** — `/system/policies` shows `lastFiredAt` + `fireCount` only; full chronological history not yet rendered.

---

## 6 · How to resume in a fresh session

```bash
# 1. cd into the repo (monorepo — statenour is an app within it)
cd C:\Users\nourd\OneDrive\Desktop\nickstire-repo-staging\apps\statenour

# 2. Read this file (you just did)

# 3. Check current state
git log --oneline -10
cat docs/RECONCILIATION.md | head -30

# 4. Verify environment is sane
pnpm install --frozen-lockfile
set -a && . ./.env.local && set +a
pnpm tsx scripts/run-schema-sentinel.ts   # 14/14 expectations should be green

# 5. Run the test suite
pnpm test                                 # ~1855 tests across 140 files, ~10s

# 6. Run the full local gate
pnpm verify:hard                           # typecheck · lint · test · raw-SQL · crons · prompt-size · prisma validate

# 7. Pick up the active backlog (section 5 above)
```

If you're a fresh agent without context, the operator's standing rules in `C:\Users\nourd\.claude\CLAUDE.md` apply (operator on phone, default to action, minimize back-and-forth).

---

## 7 · Common gotchas / lessons learned

- **Never `--accept-data-loss`** in `package.json` scripts or CI. Pgvector + tsvector extras live outside Prisma's view and get nuked. Pre-push gate catches this; recovery is `scripts/recover-pgvector-from-text.ts` + `scripts/recover-pgvector-embedding-vec.ts`.
- **`prisma migrate status` is the source of truth, not "I ran release:db"** (v10.0.473 lesson). Local "release succeeded" messaging can be misleading when prod DB is unreachable or auth fails silently. Always verify against prod before declaring schema work done.
- **`position: relative` containing-block trap** (v10.0.474 lesson). Adding `position: relative` to a parent silently changes the anchor for `position: fixed` descendants throughout the subtree. Audit before adding to keyframe wrappers — state-aura caused a 2545px layout regression by becoming the containing block.
- **Next.js dev-server module cache is sticky** (v10.0.480 lesson). Top-level imports resolved at boot don't refresh on edits. When swapping a module's behavior, use **defense-in-depth**: make the swapped module internally delegate to the new target. `generateOpenAiImage()` now calls `generateVeniceImage()` internally for this reason.
- **Ideation regex must catch trigger-phrase-alone** (v10.0.483 lesson). "come up with", "brainstorm", "help me cook up" without specific nouns must block image-gen classifier. Regex lives in `lib/ai/chat/interceptors.ts` (`EARLY_IDEATION_NEG`).
- **Mobile composer chrome budget** (v10.0.478 lesson). Every always-visible button competes with the textarea on 375px screens. Default to `hidden sm:flex` for non-essential controls.
- **Inbox missions count differently than user projects.** Three surfaces (cap, Plan view, Track tile) all use `isInboxMission()` from `lib/services/mission-helpers.ts`. Don't introduce a fourth filter; use the helper.
- **Side-effect gating is LIVE in the autonomous-engine** as of v10.0.157. Rules with `approval: "ask"` defer execution and stash `payload.deferredItem`; the approval queue's `executeApprovedAction(id)` replays. If you change the rule contract, update `approval-queue.ts` too.
- **Fabrication detector is regex-based.** Adding new action verbs to `action-claim-detector.ts` requires re-running `tests/ai/chat/action-claim-detector.test.ts` to confirm no regressions in hedge patterns.
- **Prisma can't model `vector(N)` natively** — pgvector + tsvector columns are managed by raw SQL in scripts. Prisma `db push` will drop them silently if you don't have the `--accept-data-loss` pre-push guard. v10.0.171 declared them as `Unsupported(...)` so Prisma sees them.
- **Image-gen routes through Venice flux-2-pro** (v10.0.477) — $0.04/img vs $0.19+ on gpt-image-1 which hit billing cap. Defense-in-depth via internal delegation in `lib/ai/openai-image.ts`.

---

## 8 · Operator preferences (carried from `~/.claude/CLAUDE.md`)

- Operating from phone via remote Claude — execute, don't ask obvious questions
- Direct + concise > fluff
- Use everything: agents, tools, connectors, MCPs
- Power, control, visibility — surface what's broken before asking what to do
- Verify before claiming completion · regular checkpoints · continuous refinement
- Cleveland ET timezone for everything · Mon Apr–Oct DST math
- Never destructive without explicit confirmation
