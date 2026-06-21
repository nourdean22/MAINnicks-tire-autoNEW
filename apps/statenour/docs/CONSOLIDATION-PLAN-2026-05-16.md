# Statenour Consolidation Plan · 2026-05-16

> **🗄 HISTORICAL (superseded 2026-06-09).** Dated 2026-05-16 snapshot. Any
> "pending" item referencing `vercel.json` or the `statenour-master` /
> `codex/ollama-local` branches is obsolete — Vercel and those branches are
> retired (see [`CURRENT-TRUTH.md`](CURRENT-TRUTH.md)). Kept for historical
> context; do not execute its pending steps.

> **Status**: IN PROGRESS · Waves 46-55 SHIPPED (8 commits · v10.0.529.106 across 1 day) · Waves 56-57 pending
> **Owner**: Nour
> **Source**: 18 parallel code-explorer agents covered pages · API/services · crons · schema · components · tech debt · hooks · lib/ai · lib/brain · lib/services+db · integrations · performance/LLM cost · security · tests · dependencies · docs · build/config · file complexity
> **Cumulative findings**: ~12k words across 18 reports · synthesized here

## Wave shipping log (most-recent first)

| Wave | Status | Commit | What landed |
|---|---|---|---|
| 56 (this) | IN PROGRESS | — | docs refresh · ULTRON-VISION stale header + consolidation plan status header |
| 55 | SHIPPED | 78b1435 | Descript registry stub deleted · HF + Tuya + search-quorum kept as-is with documented rationale |
| 54 | SHIPPED | 7522711 | 30 new tests · resolveInboxMissionId + memory-manager + auto-learn |
| 53b | SHIPPED | 1822a87 | 3 more Phase 3 cuts · autonomous_event + provider_ping + telemetry_tool_verb dual-writes removed |
| 53 | SHIPPED | d21747f | Phase 3 cut · tool_telemetry dual-write removed · ~225 LOC of legacy JSON-blob writes gone |
| 52 | SHIPPED | e448f16 | Close 2 silent event-emit gaps · updateTask now emits task.completed to brain-bus · /tasks/[id]/start now emits TaskEvent.started |
| 51 | SHIPPED | 88c43e6 | 5 mobile gap fixes · /mastery radar · /financial chart · /content/history table · /social checkboxes · /system database-models grid |
| 50 | SHIPPED | ddbb2e5 | 3 hook primitives · usePollingFetch · useAbortableFetch · useLocalStorageState |
| 49 | SHIPPED | 3913721 | Security lockdown · 3 unauth GETs gated · structured logger for mock-bypass warn · runner-secret dev fallback removed |
| 48 | SHIPPED | 7e5adf1 | Cron double-billing killed · 11 standalone schedules folded into mega-evening |
| 47 | SHIPPED | (Phase A) | Elon delete-first sweep · 2 retired autonomous rules + 3 dead Settings hub links |
| 46 | SHIPPED | 08f8f85 | This document published |

Cumulative impact across Waves 46-55:
- ~1,400 LOC removed (legacy dual-writes + retired rules + stubs)
- 4 silent failure modes closed (3 unauth GETs + 2 event-emit gaps)
- 11 crons consolidated (zero double-billing on mega-evening overlaps)
- 30 new tests covering 3 previously-untested brain primitives
- 3 hook primitives shipped (33+ files now have a migration target)
- 1 registry stub deleted (Descript)

What's left in the plan (waves 56-57):
- Wave 56 · docs refresh · ULTRON-VISION corrected here · still pending:
  cohort summary, MEMORY.md update, ARCHITECTURE.md cron-count refresh
- Wave 57 · config strictness · noUncheckedIndexedAccess +
  exactOptionalPropertyTypes in tsconfig.json (the biggest remaining
  type-safety upgrade · likely 100+ existing call sites need fixes
  first · a separate sub-plan).


## Why this exists

After 100+ versions of "code on top of code", statenour-os accumulated drift. This document maps the drift, ranks the cleanup by leverage, and defines 12 shippable waves (46-57) so the operator + future agents can act on a single canonical plan instead of re-auditing.

**System state today**: ~85% coherent · ~15% drift · operational + profitable + shipping. The audit is a cleanup roadmap, not an SOS.

---

## The 6 drift archetypes (the pattern under every finding)

1. **Extracted but not finished** — service/model built, dual-write paths never cut. 4 BrainMemory categories still dual-written (`telemetry_tool_verb` · `autonomous_event` · `provider_ping` · `tool_telemetry`). 5 incomplete extractions in lib/brain.
2. **Retired but kept as stub** — feature killed, code left in tree as a no-op. 2 autonomous rules return `[]` permanently. 3 legacy shop shims return empty arrays. `useChatPersonality` hook has 0 callers but 80 LOC.
3. **Folded into mega but standalone schedule kept** — 9 crons double-fire nightly burning duplicate LLM calls. `embed-backfill` runs 26×/day instead of 2.
4. **Primitive built but not enforced** — `ShimmerSkeleton` exists, 47 files use raw `animate-pulse` (80% bypass). `Badge` exists, 19 inline pills bypass.
5. **Auth gate inconsistent** — `apiHandler` is canonical, 76 routes still use legacy `requireSession` (no rate-limit · no normalized errors).
6. **Documentation lies** — 9 docs describe retired features as current. `ULTRON-VISION.md` Status header says "planning" when Ultron is fully shipped.

---

## The 18-dimension scorecard

| Dimension | Healthy | Drift | Worst single finding |
|---|---|---|---|
| Pages (56) | 43 active | 5 drift · 6 duplicate · 3 dead-link 404s | 3 Settings hub links 404 today (`/system/gaps` · `/anti-patterns` · `/decision-drift`) |
| API routes (426) | 286 use apiHandler | 76 legacy requireSession · 105 raw prisma · 233 no service layer | `/api/tasks/[id]/check` 354 LOC in route layer (should be `completeTask` service) |
| Cron jobs (36 sched · 86 handlers) | 27 active | 9 double-firing · 50 zombie · 0 policy-gated | `embed-backfill` runs 26×/day · `think` 8×/day × 5 LLM = potential 40 LLM calls/day |
| Schema (78 models · 27 enums) | 62 active | 11 dead · 9 orphan enums · 85+ BrainMemory categories | No `VALID_BRAIN_CATEGORIES` enforcement at write time → categories accreted to 138 once already |
| Components (228) | 36 UI primitives | 3 cards · 5 radii · 47 animate-pulse bypass · 19 inline pills | `button-group.tsx` has 0 callers · delete now |
| Tech debt | — | 68 silent `.catch(() => {})` · 207 `any` · 2 retired-but-loaded rules | `recordError` purpose-built to replace silent catches · 68 callers still ignore it |
| Hooks (47) | 31 active | 1 dead · 9 single-caller · **0 tested** · 33+ files inline polling | `useChatPersonality` (80 LOC · 0 callers) · `usePollingFetch` would collapse 33 files |
| lib/ai (170 files) | core solid | 10 dead modules · 10 duplicate impls · 5 guardian bypasses | `strategicLaw` full scan on EVERY Anthropic chat turn (`route.ts:968`) → breaks prompt cache |
| lib/brain (100 files · 14k LOC) | many actives | 28 bypass `brainMemory.remember()` · 5 dead rules · 5 duplicate pipelines | 3 parallel identity writers · 5 recall pipelines · 2 wisdom-promotion paths |
| lib/services + lib/db (51+28) | 12 services with audit | 14 ZERO-service domains · 38 inline `deletedAt: null` · cache invalidation inconsistent | `completeTask` doesn't exist as a service function |
| Integrations (~30) | 9 core active | 5 STALE · 3 duplicates · 5+ env vars undocumented | Make.com webhook returns `"Future: ..."` stubs · all 5 handlers do nothing |
| Performance + cost | guardian + caches exist | strategicLaw scan · 5 LLM/cron run · 7 React.memo total | Anthropic prompt cache likely BROKEN (dynamic prefix = 0 hits) |
| Security (15 findings) | webhooks correct · no eval | **3 CRITICAL unauth GETs** · 76 rate-limit gaps · CSP unsafe-eval | `/api/situation-log` GET exposes personal logs |
| Tests (133 files · 0 skipped) | CI typecheck+lint+vitest+build | E2E **never runs in CI** (spec comment lies) · provider.ts / memory-manager.ts / guardian.ts UNTESTED | `auto-learn.ts` has zero tests |
| Dependencies (~125) | most ACTIVE | 8 DEAD packages · 1 duplicate (hono) · `gpt-5` model in .env.example | `stripe` · `twilio` · `cheerio` · `react-markdown` etc · zero imports |
| Build + config (13 files) | strict TS · CI gates | `ignoreBuildErrors: true` · CSP `unsafe-eval` · missing `noUncheckedIndexedAccess` | `OPENAI_MODEL="gpt-5"` would fail if used |
| File complexity | most files <500 | 5 MEGA (>1500) · 4 HEAVY (1000-1500) | `tools.ts` 5537 LOC · `chat/page.tsx` 3849 LOC |
| Documentation (68 files) | 36 canonical | 9 STALE · 5 duplicates · 5 missing critical | `ULTRON-VISION.md` says "planning" · Ultron fully shipped |

---

## 7 cross-cutting truths

1. **Biggest dollar leak**: `strategicLaw` full scan + 9 cron overlaps + broken prompt cache = structural AI bill inflation
2. **Statenour has TWO of almost everything in AI/brain**: provider chains · prompt builders · model registries · domain routers · identity writers · contradiction detectors · recall pipelines · wisdom-promotion paths
3. **Service layer is half-built**: blueprint right · adoption mechanical (76 routes legacy · 14 domains zero-service · 68 silent catches · 38 inline soft-delete bypasses)
4. **lib/brain is the highest-leverage refactor area**: 14k LOC · 28 bypasses · 5 dead rules · 5 duplicate pipelines · also highest risk (touches every AI turn)
5. **DELETE pile is huge and zero-risk**: ~8-10k LOC deletable today across 8 dimensions
6. **3 unauthenticated GETs leak personal data** (`/api/situation-log` · `/api/ultron/reflect` · `/api/ultron/tomorrow-note`) — 30 min to fix
7. **Cache + observability layers exist but aren't fully wired**: 4 caches no coordination · `record-error` ignored by 68 callers · E2E spec lies about CI

---

## 12 RANKED WAVES (46-57)

### Wave 46 · WRITE THIS PLAN · risk none · reward operator clarity forever
This document. 30 min. **You are reading the output.**

### Wave 47 · ELON DELETE-FIRST SWEEP · risk LOW · reward ~8-10k LOC deletion
- Drop 9 orphan Prisma enums (CustomerRiskStatus · LtvBand · CustomerFollowUpStage · CustomerSegment · LeadSource · LeadType · LeadUrgency · LeadStatus · ServiceCategory)
- Drop 11 dead Prisma models (StateLog · AuditEvent · LocalSyncLog · SessionReport · MasteryScore · ~~EnvironmentalSignal~~ ✓ dropped 2026-06-21 · PersonProfile · SystemSnapshot · OperatorProfile · OperatorPreference · BrainDump) after data-audit
- `pnpm remove` 8 dead packages: stripe · twilio · cheerio · @react-pdf/renderer · @next/env · sharp · react-markdown · remark-gfm
- Delete `useChatPersonality` hook (0 callers · 80 LOC)
- Delete `components/ui/button-group.tsx` (0 callers) + `components/metric-card.tsx` (1 caller → use TrendCounter)
- Delete 2 retired `autonomous-engine` rules (`auto_remind_unreviewed_applicant` line 96 · `adderall_timing_insight` line 814)
- Delete `legacy-shims.ts` shop helpers (`recentShopJobs/Leads/Quotes` return `[]` permanently · replace 3 caller patterns with inline `[]`)
- Delete 5 dead `lib/ai/*` modules (`gemini-image.ts` · `openai-image.ts` · `shadow-mode.ts` · `nick-agent.ts` superseded · `voice-clone-trainer.ts`)
- Delete 54 `lib/ai/strategic-frameworks/**` files (only 2 test imports)
- Delete or archive 9 stale docs (UPGRADE-PLAN-V6 · V9-PLAN · ROADMAP-v10.4 · UPGRADE-PLAN · state-of-autonicks AM/PM · cohort summaries · DEVICE-RPC retired header · MASTER-CONTEXT)
- Fix 3 dead Settings hub links (`/system/gaps` → `/system/coverage?view=gaps` · `/anti-patterns` → `/system/quality?view=lessons` · `/decision-drift` → `/system/quality?view=decisions`)
- Remove `puppeteer` from `next.config.ts` `serverExternalPackages` (not in deps)
- Remove `.next-ci/types/**` from `tsconfig.json` `include` (no CI build variant)
- Remove duplicate `seed` script from package.json (`db:seed` is the canonical)
- Run `pnpm dedupe` (hono 4.12.14 + 4.12.18 → one)

### Wave 48 · KILL COST DOUBLE-BILLING · risk LOW · reward biggest dollar savings
- `app/api/ai/chat/route.ts:968` add `take: 20` to `strategicLaw.findMany` + rotate subset (stop bloating every Anthropic turn)
- Freeze static system-prompt prefix to enable Anthropic prompt cache (cached input billed at ~10% of uncached)
- Remove 9 standalone cron schedules that ALSO fire in `mega-*`: `reflect` · `predict` · `brain-intelligence` · `drift-check` · `daily-report` · `stale-tasks` · `journal-checkin` · `weekly-digest` · `weekly-review`
- Cap `think` cron from 8×/day → 3×/day
- Remove hourly standalone `embed-backfill` (mega covers it · 26 fires → 2)
- Cancel Make.com subscription (5 stub handlers do nothing) OR wire the handlers
- Confirm + drop Twilio billing if dead (env vars set · KNOWN DOWN)
- Add `AutomationPolicy` gates to mass-mutation crons: `backlog-triage` · `data-cleanup` · `auto-calibrate` · `inbox-janitor`
- Add per-row `EntityAudit` writes to `backlog-triage` updateMany (so the next "tasks vanished" mystery has paper trail)

### Wave 49 · SECURITY LOCKDOWN · risk LOW · reward closes 3 CRITICAL data leaks
- Add `await requireSession(req)` to `/api/situation-log` GET
- Add `await requireSession(req)` to `/api/ultron/reflect` GET
- Add `await requireSession(req)` to `/api/ultron/tomorrow-note` GET
- Route `AUTH_ALLOW_MOCK_IN_PROD` bypass log through structured `logger.error` (lands in ErrorLog → Telegram alert)
- Remove `DEV_RUNNER_SECRET = "statenour-local-runner"` hardcoded fallback in `lib/internal/runner-auth.ts:6` (throw if env unset · including non-prod)
- Verify `/api/brain/search-hybrid` POST passes `source` through `validateSource`
- Remove CSP `'unsafe-eval'` from `next.config.ts:89` (scope to nonce if Spline needs it)
- Add 5 missing vendors to CSP `connect-src` (api.cohere.com · api.perplexity.ai · openapi.tuyaus.com · api.fireflies.ai · Neon WebSocket)
- Add `rateLimit: "general"` to `/api/system/logs` GET and `/api/system/crons/run`

### Wave 50 · UI CONSOLIDATION · risk MEDIUM · reward visible coherence
- Pick ONE card primitive (merge `Panel` + `GlassCard` + `Card` → keep `GlassCard`)
- Standardize border-radius (pick one value · likely `rounded-xl`)
- Merge 3 insight panels on /brain into one `<InsightSurface feed={} />` (data feed prop)
- Migrate 47 raw `animate-pulse` → `ShimmerSkeleton` primitive
- Migrate 19 inline pills → `Badge` primitive
- Build `CycleChip` primitive · refactor `mode-pill` + `mode-persona-chip`
- Build `usePollingFetch(url, intervalMs)` hook · refactor 33+ files using inline polling pattern
- Build `useAbortableFetch` hook · refactor 8+ files
- Build `useLocalStorageState<T>(key, default)` · refactor 12+ sort-key inline patterns
- Fix 5 mobile gaps: /mastery radar labels · /financial chart · /content/history table · /social checkboxes · /system pages (no sm: breakpoints)

### Wave 51 · SERVICE LAYER UNIFICATION · risk MEDIUM-HIGH · reward architectural foundation
- Move `/api/tasks/[id]/check` 354 LOC into `lib/services/tasks.ts::completeTask`
- Migrate `/api/tasks/[id]/start` + `/break-promise` from legacy `requireSession` → `apiHandler` + service function
- Build canonical services for 5 biggest ZERO-service domains: journal · decisions · commitments · mastery · financial (each ~150 LOC)
- Add `VALID_BRAIN_CATEGORIES` enum + write-time enforcement in `brainMemory.remember()` (prevents the 85→138 regression)
- Replace 68 silent `.catch(() => {})` with `recordError` (docstring purpose-built for this)
- Export `invalidateMutationCaches` from a shared module (currently duplicated tasks.ts + missions.ts)
- Promote 38 inline `deletedAt: null` filters to `findManyActive()` helper calls
- Add cache invalidation to: goals · commitments · capture · execution · leads · personal mutations
- Add `entity-audit` to writes on: commitments · decisions · brainMemory · brainDump · reflection · identitySnapshot · personal · leads · customers · ultron

### Wave 52 · PHASE 3 EXTRACTION CUTS · risk LOW · reward ~2-3k LOC removed
- Cut BrainMemory dual-writes for `telemetry_tool_verb` (ToolVerbRatio live)
- Cut BrainMemory dual-writes for `autonomous_event` (AutonomousEvent live)
- Cut BrainMemory dual-writes for `provider_ping` (ProviderPing live)
- Cut BrainMemory dual-writes for `tool_telemetry` (ToolTelemetry live)
- Cut BrainMemory reads for `semantic_edge` (SemanticEdge live · Phase 2 reads never cut)
- Drop 31 retired Prisma compat shims in `types/prisma-compat.d.ts`
- Drop `cli/nour.ts` if not actively used (still labels things "Open Loops")
- Consolidate `clamp` (defined 7 places) · `slugify` (4) · `formatRelative` (3) · `median` (2) into `lib/utils/`
- Remove `etDateKey` + `matchWisdom` duplicates in services

### Wave 53 · SPLIT MEGA FILES · risk MEDIUM-HIGH · reward maintainability
Each is its own mini-wave.
- `tools.ts` 5537 LOC → `tools/brain.ts` · `tools/tasks.ts` · `tools/business.ts` · `tools/content.ts` · `tools/social.ts` (catalog exists at `lib/ai/tools/catalog.ts` · plan documented in catalog comments)
- `chat/page.tsx` 3849 LOC → finish `hooks/chat/*` extraction (14 hooks exist · page never deleted inline copies) + `<ChatComposer>` + `<ChatMessageList>` + `<ChatVoiceLayer>` components
- `system-prompt.ts` 1933 LOC → finish v2 migration (`prompt/sections/` per-section files · delete `buildSystemPromptUncached`)
- `business-knowledge.ts` 1844 LOC → split constants vs logic (`knowledge/brand-constants.ts` + `knowledge/detectors.ts`)
- `interceptors.ts` 1364 LOC → extract `handlers/image.ts` + `handlers/decision.ts` + `handlers/brain-dump.ts` (current `handleImage` alone is 414 LOC)

### Wave 54 · TEST COVERAGE FOR CRITICAL PATHS · risk LOW · reward future safety floor
- `lib/ai/provider.ts` `aiChat` fallback · garbage detection · `getEmbedding` chain (most critical untested file)
- `lib/brain/memory-manager.ts` `remember/recall/reinforce/contradict/forget` (currently mocked everywhere · never tested)
- `lib/tools/guardian.ts` classify · isRetryable · backoffDelay · retry loop
- `lib/services/auto-learn.ts` (zero tests today)
- `lib/services/missions.ts::resolveInboxMissionId` (Wave 43 critical · untested)
- `lib/services/chat/brain-context.ts` 7-parallel-import + 3s timeout
- `lib/skills/skill-recall.ts` cosine scoring + cache
- Wire Playwright E2E into `ci.yml` (currently never runs · spec comment claims it does)

### Wave 55 · INTEGRATION CLEANUP · risk LOW · reward smaller surface
- Pick ONE web search provider · delete the other two (Tavily + Exa modules + env vars)
- Consolidate transcription to OpenAI Whisper · drop HuggingFace branch in Telegram webhook
- Drop Descript registry stub (no implementation file)
- Drop Tuya env vars (zero source refs)
- Document or delete: Apollo · ClickUp · Fireflies (registry stubs · no chat tools)
- Update `.env.example`: add 8 missing vars (VAPI_API_KEY · VAPI_WEBHOOK_SECRET · TAVILY_API_KEY · EXA_API_KEY · OLLAMA_API_KEY · OLLAMA_MODEL · OLLAMA_BASE_URL · BUFFER_*) · fix `OPENAI_MODEL="gpt-5"` → real model
- Add `driverAdapters` preview feature to Prisma schema generator

### Wave 56 · DOCS REFRESH · risk LOW · reward agent context clarity
- Fix 9 STALE docs:
  - `ULTRON-VISION.md` Status header is a lie (Ultron shipped)
  - `DB-MIGRATION-POLICY.md` false premise on line 11
  - `DEVICE-RPC.md` no RETIRED header
  - `agent/DEVICE_DIAGNOSTIC.md` 2026-03-29 snapshot presented as live
  - `.remember/core-memories.md` wrong prod URL · outdated branch
  - `OBSERVABILITY.md` surface count wrong · cron counts wrong
  - `ENDPOINT-HYGIENE.md` retired-component commentary noise
  - `state-of-autonicks-2026-05-06.md` + PM file · no HISTORICAL label
- Move 5 historical docs to `docs/archive/`
- Merge 5 duplicate docs (state-of-autonicks AM+PM · cohort/handoff trio · AGENT-CONTRACT/AGENTS · UPGRADE-PLAN/V9-PLAN · security-audit pair)
- Write 5 missing critical docs:
  - `docs/architecture/how-to-add-a-tool.md`
  - `docs/architecture/cron-map.md` (what runs at 2am UTC)
  - `docs/architecture/model-reference.md` (78-model dictionary)
  - `docs/architecture/pre-push-gates.md`
  - `docs/architecture/provider-routing.md`

### Wave 57 · CONFIG STRICTNESS · risk MEDIUM · reward compile-time bug catching
- Add `noUncheckedIndexedAccess: true` to tsconfig (highest-value missing strict flag · prevents runtime undefined crashes)
- Add `exactOptionalPropertyTypes: true`
- Add `noUnusedLocals: true` + `noUnusedParameters: true`
- Remove `tests`, `scripts`, `prisma/seeds` from tsconfig `exclude` (let typecheck catch script bugs)
- Verify CI actually runs `typecheck` (the `ignoreBuildErrors: true` in next.config depends on it)
- Update `vercel.json` deployment branch ref (`statenour-master` → `codex/ollama-local`)
- Add coverage thresholds to `vitest.config.ts`
- Add `webServer` stanza to `playwright.config.ts` + wire E2E into `ci.yml`

---

## Shipping order recommendation

**Phase A** (this session · ~4 hours total):
- Wave 46 ✅ (you are reading this)
- Wave 47 (ELON delete-first) · ~2-3 hours · 8-10k LOC deletion
- Wave 48 (kill double-billing) · ~1-2 hours · dollar savings start tonight
- Wave 49 (security lockdown) · ~30 min · 3 unauth GETs locked

**Phase B** (next session · architectural):
- Wave 50 (UI consolidation) · ~1 day
- Wave 51 (service layer unification) · ~2 days · foundation for everything after
- Wave 52 (Phase 3 cuts) · ~1 day

**Phase C** (as you touch them · incremental):
- Wave 53 (split mega files) · per-file as you edit them
- Wave 54 (test coverage) · per-file as you touch critical paths
- Wave 55 (integration cleanup) · 1 afternoon
- Wave 56 (docs refresh) · 1 afternoon
- Wave 57 (config strictness) · incremental

---

## Source audit logs

All 18 agent reports are preserved in:
- `C:\Users\nourd\AppData\Local\Temp\claude\C--\76bd38f2-37c8-4a60-89f2-55143da04c09\tasks\*.output`

Each report cites file:line for every claim. See those for evidence behind any finding above.

---

## How to update this plan

When a wave ships, mark it ✅ at the top of the section. When a finding is resolved, strike through the bullet. When new drift is detected, add a new wave or bullet. This doc is the canonical source of truth for "what's worth consolidating in statenour-os".

Last updated: 2026-05-16 by the 18-agent god-mode audit.
