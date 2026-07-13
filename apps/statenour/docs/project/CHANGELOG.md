# Changelog

All notable changes to **statenour-os** (Nour's personal command center),
which lives in the `nourdean22/MAINnicks-tire-autoNEW` monorepo at
`apps/statenour` and deploys from `main` → Railway → `bdnick.info`.

> Entries below are a point-in-time **historical** release log. Older entries
> reference the now-**retired** standalone repo / Vercel / `codex/ollama-local`
> setup — that is history, not current truth. See
> [`../CURRENT-TRUTH.md`](../CURRENT-TRUTH.md) for what's live.

The project sits alongside the business repo `nickstire` but is intentionally
separate: different stack (Next.js vs Express), different deploy target
(Vercel vs Railway), different security surface (personal vs business ops).

---

## 2026-07-12 — Chat repair wave, Ollama-Cloud routing, king persona, recall backfill

Large multi-PR session on `main`. Model names below are a **point-in-time**
record of what was configured this day — the source of truth is env +
`config/ai-providers.ts` + `lib/ai/provider.ts`, not this entry.

### Chat ↔ missions integration (PRs #718, #719)
Operator's "map my day into tasks" flow was duplicating, hanging, and
misfiling. Four connected defects, all root-caused against prod:
- **Duplicate task creates (×3-4) + a pile of unattached tasks.**
  `createTaskAndEnrich` had no idempotency: a mid-stream error dropped the
  tool-call parts (so the verifier flagged the turn "unverified") even though
  the DB write landed, the operator retried, and every retry re-created the
  batch — the retry copies (no valid mission) piling into the Inbox. Added a
  retry-collapse guard (same normalized title + due day, live, <10 min →
  return the existing task), then extended it to **semantic** dedup
  (`normalizeTaskTitle` strips time-ranges/parentheticals so reworded variants
  collapse). Fire-safe. +7 tests.
- **"Runs the tool but never replies."** Action turns forced
  `toolChoice:"required"`, which with `stepCountIs(3)` forced a tool on EVERY
  step, so the turn ended with only tool cards. Switched to **`prepareStep`**:
  force the tool on step 0 only, then `auto` so the model writes a closing
  reply (also fixes the verifier false-positive — tool calls now land in
  completed steps + real text). Same fix on the python-execute force.
- **Replies too short.** Raised the standard budget 1200 → 2000 (deep
  4000 → 4500) + query-shape budgets (plan 1600→2800, explain 700→1400);
  yes/no + casual stay tight.
- **Mission proliferation → scatter/misfile.** Prod had 7 overlapping missions
  (3 health, 2 personal, 2 business); the domain-first classifier scattered
  identical tasks across them. Consolidated to 3 canonical missions
  (`HEALTH` / `PERSONAL & HOME` / `GENERAL BUSINESS & NICKS TIRE`), re-filed by
  the operator's rules (work→business, wake-up/bedtime/wind-down→personal,
  workout→health), and collapsed near-dups (title-normalize → token-Jaccard →
  containment). Net: 25 unattached + 7-mission scatter + 3-4× dupes → 15
  clean, correctly-filed tasks (reversible; snapshot in BrainMemory).

### AI routing → Ollama Cloud (PRs #696, #697)
- **Perplexica synthesis** moved off the spend-capped Gemini onto **Ollama
  Cloud** (registered as an `openai`-type provider at `https://ollama.com/v1`).
  Env-driven via `PERPLEXICA_CHAT_PROVIDER` / `PERPLEXICA_CHAT_MODEL`.
- **`TASK_ROUTING_PREFERENCES`**: Ollama Cloud is now **first for every task**
  (was OpenRouter/Gemini). Two-lane model split — a heavier reasoning model on
  the user-facing chat lane, a fast model on the internal lanes — via
  `OLLAMA_MODEL` + new `OLLAMA_FAST_MODEL`. OpenRouter is the 2nd hop; Gemini a
  late fallback (its key is spend-capped).
- **King persona** — `identityBlock()` reframed as "Hand of the King";
  `OWNER AUTHORITY` strengthened (execute directives, no moralizing / policy
  hedging). **Security machinery unchanged** (fencing, injection surfacing,
  two-tap destructive confirm all preserved).

### Chat surface repairs (PRs #699, #705)
- **Voice mode** — migrated to the OpenAI **GA Realtime API**: session mint at
  `POST /v1/realtime/client_secrets` (nested `session` config, model
  `gpt-realtime`), WebRTC SDP at `/v1/realtime/calls`. The old beta
  `/v1/realtime/sessions` was removed by OpenAI (404 "Invalid URL").
- **Image chat** — `OLLAMA_VISION_MODEL` pointed at a live vision model; the
  prior default (`qwen3-vl:235b-instruct`) had been retired on Ollama Cloud
  (410), so every image turn silently no-op'd.
- **Mic** — the "Microphone unavailable" toast was a misdiagnosis: a hardcoded
  `audio/webm` MediaRecorder codec throws on iOS/WebKit. Added a codec picker
  (webm→mp4) + split `getUserMedia` from recorder construction so only real
  permission failures show that toast.
- **Memory Inspector** — normalized the recall hit shape (`memoryId/knnDistance`
  → `id/similarity`) so hits stop rendering as "NaN% Match".
- **Consolidation corruption** — the nightly memory-consolidation cron was
  category-blind and rewrote structured-JSON brain rows into prose (it had
  silently disabled the admin AI-config panel and spammed JSON-parse errors).
  Added `CONSOLIDATION_EXCLUDE_CATEGORIES` + a JSON-shape guard so structured
  categories are never merged/distilled into prose.
- **Tool calls** — `experimental_repairToolCall` remaps hallucinated dotted tool
  names (e.g. `memory.remember`) onto the real tool when one exists in the set.
- **createTask FK guard** (earlier in session, #693) — invalid model-supplied
  `missionId`/`goalId` no longer FK-throws; resolves to Inbox / null.

### Recall / embeddings (PR #705 + prod data)
- **Backfill** — recall reads only `vector_embeddings.embedding_vec_1536`;
  coverage was 47%. Padded the rows that had a 1024-dim vector, then
  **re-embedded 4,111 rows** stranded in an old OpenAI-1536 space with the
  current provider (Cohere) so the whole corpus shares one vector space.
  Coverage **47% → 100%** (10,084/10,084), 0 failures.
- **HNSW `ef_search` bug** — `withEfSearch` did `SET LOCAL hnsw.ef_search = $1`
  via `$executeRaw`; Postgres `SET` rejects bind params → 42601 on **every
  recall**, so the recall-quality tuning had never applied and an error logged
  each turn. Fixed with `$executeRawUnsafe` + interpolated (clamped) integer.

### Ops
- `GITHUB_TOKEN` set on `statenour-web` + `-worker` → the Files (Drive + GitHub)
  tool category flips degraded → ok.

---

## 2026-07-05 — Chat pipeline: audit-fix wave + owner-authority + 5 perf/quality improvements

Six PRs on `main` (#550–#555). Full narrative: [`../sessions/2026-07-05.md`](../sessions/2026-07-05.md).

### Audit fixes
- **#550** — one canonical `classifyModelId`; fixed the live bug where `provider-health` misattributed OpenRouter ids (`google/gemini-*`) to the native gemini lane (cost HUD blind to OpenRouter). 3 drifted classifiers → 1 + anti-drift test.
- **#551** — 5 reachable chat findings: errored stub rows show a red "interrupted · retry" card in chat-v2 (was a blank bubble); chat deep-reasoning caps base-`mega`→`deep` (no silent ~$0.20 run); tool-gather output `fenceContent()`-wrapped at the engine choke point; `runToolGather` bounded with `AbortSignal.timeout(8000)`; compressed-path empty-string turns now hit the hollow scrub (+2 tests).

### Owner authority
- **#552** — `OWNER AUTHORITY` directive added to the LIVE `identityBlock()` (`static.ts`): never refuse/moralize/disclaim to Nour; name a risk in one line, then do it. Placed at prompt idx-0 (trim-proof). **Persona unrestricted, security machinery untouched** — the directive itself preserves fencing/injection/SSRF/mutation-lock/two-tap; zero guardrail files changed.

### Improvements
- **#553** — `arsenalWebSearch` returns citations on all paths; 45s text-keyed `getEmbedding` memo (collapses duplicate Cohere calls/turn); deleted dead `thinking-guard.ts` (−179 LOC).
- **#554** — parallelized `buildContextHints` + `buildBrainContext` into the route's main `Promise.all` (recall overlaps the prompt build vs a ~6s serial tail). Output byte-identical; only timing changes.
- **#555** — Perplexica added as a free 5th source in the `searchWebVerified` quorum; joins the DEFAULT set only when `hasPerplexica()` so it never dilutes confidence (`successes/requested.length`) on deploys that don't run it.

Verify (fresh, merged `origin/main` @ `4b6c8d12`): `tsc` exit 0; 68/68 across the six backing suites. Behavioral wins (TTFT, live search, UI) are static-verified only — the live chat is auth + prod-Neon gated.

---

## 2026-06-21 — Deep-disconnect audit · 13 dead Prisma models + 22 legacy REST routes deleted

Three-commit cleanup wave on `main` (PR #267).

### Schema · 13 models + 1 enum dropped
Verified empty/absent via Neon production probe (`scripts/probe-unused-models.cjs`):
`OperatorCheckIn`, `CommandResolution` + `CommandResolutionType` enum, `DailyEmpireSnapshot`, `WorkResult`, `StagedRecoveryItem`, `EnvironmentalSignal`, `DailyStrategy`, `AgentRun` + `AgentMemoryHit` + `AgentFeedback`, `ContentNode`, `FinancialTransaction`, `InvestmentHolding`.
8 tables NOT FOUND in prod; 5 exist with 0 rows / 0 bytes — all safe to drop.
Also excised dangling relation fields from `DailyExecutionState`, `WorkItem`, `RecoveryActionLog`, `StrategicLaw`, `PromptVersion`.
`prisma validate` clean; model count 101 → 88.

### Routes · 22 legacy REST routes deleted (~1,210 LOC)
Superseded by typed tRPC procedures. 5 living routes verified and preserved:
`/api/missions/[id]/retro`, `/api/coach/events/[key]/ack`, `/api/system/calibration/reviews/[id]/resolve`, `/api/relationships/[personId]/contextual-laws`, `/api/brain/wisdom/[id]/related`.

### Code · dead contract + exports pruned
Fixed broken `ChatEmptyState` prop contract (`onPick` removed), removed 6 dead exports, deleted 5 unused hooks/components, promoted 13 undocumented env vars to `runtime` tier in `env.ts` + `.env.example`.

### Docs updated
`DATA-MODEL.md` (count 88, removed deleted models from diagrams), `RECONCILIATION.md` (new top entry), `CONSOLIDATION-PLAN-2026-05-16.md` (strikethrough), `STATENOUR-CONNECTIVITY-MATRIX.md` (marked `DailyEmpireSnapshot` row REMOVED).

Gates: tsc 0 · eslint 0 · stale-docs 0 critical/0 warn · `pnpm test` pass · pre-push turbo green.

---

## 2026-05-08 — v10.0.442 → v10.0.484 EOD reconciliation sprint · 43 versions

Two-day push covering forward work (v10.0.442-472, 31 versions) followed by a
bug-fix wave (v10.0.473-484, 12 versions) and a final docs reconciliation. Full
sprint summary in `docs/cohort-2026-05-08-eod-summary.md`.

### Forward work · v10.0.442-472 highlights
- **Prompt-builder v1↔v2 drift closure** (v10.0.444-447) — 5 audit findings closed:
  causation magnitudes removed (no more "-15%/hr" stats), LIVE SCOREBOARD dedup,
  temporal sections compressed, response-style rules unified.
- **v2 cutover plan published** (v10.0.459) — 5 cutover criteria, 4 phases, 3
  rollback levels. Doc: `docs/v2-prompt-cutover-plan.md`.
- **ADR backfill** (v10.0.450-458) — 10 ADRs (`docs/adr/0001-…0010-…`) capturing
  the *why* behind major decisions: provider chain, CoALA, prompt builder split,
  withGuardian, Anthropic cache, pgvector, skill recall, glitch taxonomy,
  multi-agent fan-out, editorial-minimalist aesthetic.
- **Schema timestamp audit** (v10.0.451) — 8 mutable models flagged for
  `updatedAt`. Implementation parked at v10.0.473 pending prod DB reach.
- **Editorial accessibility pass** (v10.0.452-455, 466-469) — text-secondary
  contrast fixed (3.28:1 → AA), universal `prefers-reduced-motion` rule, 17
  box-shadow keyframes converted to opacity-on-pseudo for compositor-only
  animation, brand-anchor cascade gated to `[data-anchor]` opt-in.
- **Mobile chat composer recovered** (v10.0.478) — textarea was 0px on iPhone
  due to toolbar buttons consuming all width. Fix: `hidden sm:flex` on audio +
  camera + ModePersonaChip → 162px textarea recovered.

### Bug-fix wave · v10.0.473-484 highlights
- **Schema migration rolled back** (v10.0.473) — `pnpm prisma migrate status`
  proved migration never reached prod Neon. 8 `updatedAt` columns reverted in
  schema. Migration parked at `prisma/migrations-pending/` with apply README.
- **Image gen routed back to Venice** (v10.0.477-480) — OpenAI billing cap hit;
  switched default model to `flux-2-pro` ($0.04/img vs $0.19+ on gpt-image-1).
  Defense-in-depth: `generateOpenAiImage()` now internally delegates to Venice
  so module-cache stale imports can't resurrect the cap.
- **Ideation regex tuned** (v10.0.475, 483) — `EARLY_IDEATION_NEG` blocks
  `come up with`, `brainstorm`, `help me cook up`, etc. from firing image-gen
  classifier. Prevents "let's brainstorm an idea for an Insta post" from
  generating an actual image.
- **Creativity dial** (v10.0.481-482) — `pickTemperature()` bumped 6 intents
  (creative 0.75→0.85, casual 0.50→0.60); task overrides bumped (creative
  0.9→1.05, summary 0.3→0.45). New `BROADEN_AND_SUGGEST` operator-rule (rule
  #9) — Nick now offers an alt-angle / cross-pollinate / adjacent-action /
  unexpected-framework after the direct answer.
- **Layout regression fixed** (v10.0.474) — state-aura keyframe `position:
  relative` was creating a containing block for fixed children, causing 2545px
  layout. Reverted to direct box-shadow on the keyframe (compositor cost
  acceptable for the small set of state-aura instances).
- **ProactiveInsightCard removed** (v10.0.484) — "NICK NOTICED · TAP TO WALK
  ME THROUGH" banner killed per operator request.

### Lessons captured (in `cohort-2026-05-08-eod-summary.md`)
1. Schema migration verification — `prisma migrate status` is the source of
   truth, not "I ran release:db".
2. `position: relative` containing-block trap — adding it to a parent breaks
   `position: fixed` descendants.
3. Next.js dev-server module cache — top-level imports resolved at boot are
   sticky; defense-in-depth (internal delegation) survives module-graph rot.
4. Ideation framing without specific nouns — regex must catch "come up with"
   and friends, not just direct-image keywords.
5. Mobile composer chrome budget — every always-visible button competes with
   the textarea on 375px-wide screens.

### Stats
  · 43 versions over 2 days · ~70 files touched
  · 8 ADRs added · 1 cutover plan · 1 cohort summary · 36 docs stamped
  · 2 schema audit reports + 1 security audit (0 findings)
  · 17 keyframes converted to opacity-on-pseudo
  · 1 prod regression caught + reverted within 30 min (state-aura)

---

## 2026-04-29 — v8.4 QA pass + 4 more batches · vision-route / heartbeat cleanup / brain-bus / pgvector

### QA pass on v8.0-v8.3 — 4 real bugs caught
1. Galaxy view leaked soft-deleted memories (missing `deletedAt: null`
   on the knowledge-graph endpoint).
2. Schema-drift sentinel had wrong table names — Mission and Task
   have no `@@map`, so the actual tables are PascalCase. Sentinel
   would false-positive on every check. Fixed.
3. Index-name expectations were brittle — added `matchByDefinition`
   mode that substring-matches against pg_indexes.indexdef.
4. Two cleanups (unused Readable import, awkward type cast).

### BATCH 19 — /api/ai/chat/vision endpoint
Single-shot vision route. Client passes question + 1-4 image URLs;
server routes through `aiChatWithVision()` (v8.3 helper). Distinct
from caption-photo (content-focused) and from chat (text-streaming).

### BATCH 20 — Heartbeat redundancy cleanup
Discovered chat already uses `lib/streaming/heartbeat.ts` with SSE
COMMENT frames (the correct shape for the AI SDK UIMessage parser).
My v8.3 `data:`-frame helper would have BROKEN the parser if anyone
adopted it. Removed it + its tests.

### BATCH 21 — Phase 2B brain-bus skeleton
`lib/db/brain-bus.ts` — Postgres LISTEN/NOTIFY async event channel.
`publish()` uses prisma's existing pool (no new dep). `subscribe()`
dynamic-imports `pg` so the skeleton compiles without it; throws a
clear install-hint error when subscribers actually need the optional
dep. 9 unit tests.

### BATCH 22 — pgvector skeleton
`lib/db/pgvector.ts` — runtime detection + native KNN helpers.
`isPgvectorAvailable()` cached 5min; `enablePgvector()` admin
one-shot; `knnSearch()` returns null when extension/column absent
so callers gracefully fall back to JSON cosine. Schema migration
for the actual `vector` column lands in a separate batch. 14 tests.

### Stats
  · 7 files changed (+830 / -260 LOC)
  · 40 test files (was 39) · +23 new tests · 460 total
  · All 6 pre-push gates green

---

## 2026-04-29 — v8.3 Mega Bundle · 6 more batches · alerts/sandbox/galaxy/SSE/alive/vision

Third aggressive sweep of the day. Six more independent features.

### BATCH 13 — Active alerts surface on /brain
`<ActiveAlertsCard>` + `/api/brain/active-alerts` aggregate the v8.2
alert categories (correlation_alert, decision_quality_drift). Silent
on empty; tinted blocks per category when firing.

### BATCH 14 — Builder Sandbox 3 new clipboard actions
typecheck · gate · logs — combined with rollback + clone, the sandbox
is now a 5-button operator surface.

### BATCH 15 — `/brain/galaxy` semantic-graph view
Consumes the v7 knowledge-graph endpoint that had no UI for weeks.
Vanilla SVG + 60-iteration Fruchterman-Reingold (no graph library).
Click a node → opens its audit trail at /system/history. Min-similarity
slider. Verified live.

### BATCH 16 — SSE heartbeat helper
`lib/ai/stream-heartbeat.ts` wraps a model's stream with a 2s
heartbeat so clients never see >2s of silence. Helper + parser.
8 tests. Adoption in the chat route is queued.

### BATCH 17 — Alive-UI sweep
- PredictionStreaksCard: AnimatedCounter + Sparkline + flame pulse.
- GlobalActivityStream: breathing emerald "live · 60s" dot.

### BATCH 18 — Vision-input helper
`lib/ai/vision-input.ts`: `aiChatWithVision()` + `describeImage()`.
3-provider fallback (Ollama qwen3-vl → OpenAI gpt-4o → Anthropic
Haiku 4.5). 7 unit tests with fully-mocked fetch.

### Stats
  · 11 files changed (+1,800 LOC)
  · 39 test files (was 37) · +15 new tests
  · All 6 pre-push gates green

---

## 2026-04-29 — v8.2 Mega Bundle · 6 more batches · F2/F3/F5/D5/streak-UI/drift-surface

Continuing the audit-list assault from v8.1. Six more independent
features, each with cron / API / UI / tests as appropriate.

### BATCH 7 — F2 correlation alarm clock
`lib/brain/correlation-alarm.ts` runs `findCorrelations()`, snapshots
each pass to BrainMemory, emits a `correlation_alert` row when a NEW
|r|>0.7 correlation appears that wasn't strong on the prior pass.
Idempotent dedup via the existing `@@unique([category, key])` so
flapping correlations don't re-fire alerts. Cron every 6h.

### BATCH 8 — F3 decision-quality drift detector
`lib/brain/decision-quality-drift.ts` decodes `MasteryDecision.grade`
into a 0-4 GPA (handles A+/A/A-/B/etc. and numeric scores), computes
this-week vs prior-4-week rolling average, alerts on ≥15% drop.
Cron Sundays 11:00 UTC. 10 unit tests pin the math.

### BATCH 9 — F5 blind-spot auto-pinner
`lib/brain/blind-spot-pinner.ts` promotes critical/high blind-spots
to `pinned_user` BrainMemory rows so they sit at the top of every
Nick system prompt + the HQ pinned panel. Soft-deletes auto-pins
whose underlying spot dropped off the high/critical list (still
restorable from /brain/pinned). Cron every 4h.

### BATCH 10 — D5 freshness audit
- `BrainMaturityHeader` and `SkillLibraryPanel` now show
  `<FreshnessChip>` with source + reload.
- 4 structural-only files marked with `// FRESHNESS_EXEMPT` comments
  (glass-card, error-boundary, ai-settings-panel, ghost-nick-strip).
- New `scripts/audit-freshness-chips.ts` enforces the rule across
  all 16 GlassCard sites; pre-push hook can adopt it later.

### BATCH 11 — Prediction-streak UI card
`<PredictionStreaksCard>` consumes the v8.1 `/api/brain/prediction-
streaks` API and surfaces:
  · top active streak (positive reinforcement)
  · fresh streak-breaks from the last 24h (alert)
  · per-category accuracy mini-grid
Wired onto `/brain` between maturity header and nudges.

### BATCH 12 — Schema-drift surface in /system/health
`<SchemaDriftCard>` consumes the v8.1 `/api/system/schema-drift`
API. Three states: ✓ clean (silent green), DB unreachable (amber
banner), N findings (red, expandable list with severity tints +
table refs + reasons). Drops in above the metric tile row.

### Stats
  · 12 files changed (+1,400 LOC)
  · 37 test files (was 36) · +0 net new tests in this bundle
    (B7-9 + B12 are integration-tested via cron + API; B10 has the
    audit script; B11 is presentational)
  · All 6 pre-push gates green
  · 3 new crons (correlation-alarm · decision-quality-drift ·
    blindspot-pinner) — vercel.json synced

---

## 2026-04-29 — v8.1 Mega Bundle · 6 batches · audit-list sweep

Aggressive multi-batch push covering Phase 2A loop closure + Phase 2C
schema-drift sentinel + B1 chat-perf gating + voice-clone cron +
F1 continuity surface + F4 prediction-streaks. Six independent
features in one bundle, each with own test coverage.

### BATCH 1 — Universal History page + drawer
New `/system/history` route consumes the v8.0 EntityHistoryDrawer.
Three modes: per-entity (?type=&id=), actor-firehose (?actor=), and
quick-pick (empty). Permalink-friendly so any alert/email/Telegram
can deep-link to "what changed about this row." Verified in preview.

### BATCH 2 — Phase 2C schema-drift sentinel
New `lib/db/schema-sentinel.ts` declares EXPECTATIONS for v7.6→v8.0
schema invariants and runs them against `information_schema`. Catches
4 classes:
  · column_exists (missing → high)
  · index_exists (missing → medium)
  · partial_unique (missing/predicate-drift → high)
  · regular_unique_absent (resurrected by `db push` → high)

`GET /api/system/schema-drift` exposes the report (30s cache).
6 unit tests pin the contract. Designed to catch the v7.9.1
IdentitySnapshot.date class of bug at startup, not 500-spam later.

### BATCH 3 — Per-engine tier gating (B1 from v11.1)
`lib/ai/system-prompt.ts` Promise.all now wraps each query in
`gated(tier, allowedTiers, query, empty)`. Casual `core` turns
("hi", "thanks") skip ~12 DB queries the conversation doesn't need
(40-60% reduction per audit estimate).

Plus `withPromptTelemetry` (AsyncLocalStorage) records engine
runs/skips per request — surfaceable from /system/prompt for
visual verification. 7 tier-classifier tests.

### BATCH 4 — Voice-clone weekly cron + REPO-MAP refresh
Voice-clone trainer was built in v7 but never scheduled. Now wired:
`/api/cron/voice-clone-train` Mondays 10am Cleveland (15:00 UTC),
mines last week's Fireflies transcripts for hit-phrases / sentence
length / cadence markers, persists to BrainMemory category=
voice_clone_profile.

Registered in config/crons.ts (44 active crons total).
REPO-MAP.md refreshed with v7.6→v8.0 schema-hardening surfaces +
helper modules + new `/system/history` etc.

### BATCH 5 — F1 cross-session memory continuity surface
New `<GlobalActivityStream>` component wired into /brain/continuity.
Shows the last 30 entity-audit events across the WHOLE personal-OS,
auto-refreshing every 60s, action-tinted, each row links to the
per-entity diff at /system/history. Composes the v8.0 entity-audit
firehose into the brain-layer continuity dashboard.

`GET /api/audit/entity?firehose=1` (no actor) returns the global
activity stream — the new `getGlobalActivity()` helper in entity-
audit.ts powers it. Verified in preview.

### BATCH 6 — F4 prediction-streak tracker
New `lib/brain/prediction-streaks.ts` computes per-category
prediction-accuracy streaks from the `predictions` table:
  · currentStreak  — consecutive HITs at the latest tail
  · longestStreak  — best run in the 90-day window
  · hitRate        — graded ratio
  · brokenJustNow  — most-recent MISS following a HIT (alert)
  · freshBreaks    — breaks that happened in the last 24h
  · topActive      — current best alive streak

`GET /api/brain/prediction-streaks?windowDays=` exposes the report.
8 unit tests pin the streak math. UI integration on `/brain` is
queued separately.

### Stats
  · 16 files changed (+2,300 / -120 LOC across batches)
  · 36 test files (was 33) · 421 tests passing (+42)
  · All 6 pre-push gates green

---

## 2026-04-29 — v8.0.1 Tier 1 polish + AI route hardening

Tight follow-up bundle on top of v8.0 Phase 2A.

### Vercel email-alert spam, killed at the source
Extended the v7.9 plan-project hotfix pattern to 6 more AI routes
(track-story · suggest-goals · review · assist · teach · coach-goal)
plus a refactored plan-project. The old `schema.parse(await req.json())`
path turned every malformed client payload into a 500 + email alert.

New shared helper `lib/utils/http-parse.ts`:
- `safeParseBody(schema, req, routeName)` — bad input → 400 with field
  issues + `console.warn` (not error) so Vercel's monitor stays quiet.
- `aiRouteError(err, routeName, fallback)` — Zod-shape downstream
  errors → 502 + retry hint. Real server crashes → 500 + log.

Extracted into a sibling module so vitest can import without dragging
auth-guard's next-auth ESM resolution issue. Re-exported from `http.ts`
for back-compat. 12 unit tests pinning the contract.

### Phase 2A entity-audit — coverage expansion
Added `logCreate` / `logUpdate` calls to 4 more user-facing paths:
- `/api/commitments` POST (single update + create)
- `/api/decisions` POST (grade + create)
- `/api/brain/pinned` POST (re-pin update vs new pin)
- `/api/ai/chat/edit/[messageId]` PATCH (content edit, before/after)

Phase 2A coverage goes 6 → 10 wired sites.

### Phase 2A History UI — EntityHistoryDrawer
New `components/system/entity-history-drawer.tsx`. Drop into any entity
detail page to expose the audit trail visually:
- Day-grouped timeline, action-tinted badges
- Field-level diff table (red strikethrough → green)
- Actor formatter (`user` → "you", `cron:X` → "cron · X")
- Lazy-loads via the existing `GET /api/audit/entity` endpoint

Awaiting integration into Mission/Task/Goal pages (separate UI task).

### CHANGELOG backfill
Indexed every v6/v7/v7.6-v7.9 + v8.0 + v8.0.1 entry that was previously
only captured in memory + DATA-MODEL. Future agents reading the repo
can see what shipped without crawling the memory store.

---

## 2026-04-29 — v8.0 Phase 2A · Universal Entity-Audit Trail

First Phase 2 ship after closing Phase 1.

- New `entity_audits` table — generic provenance log composed on
  v7.8 actor + v7.9 soft-delete. Records every meaningful mutation
  (created · updated · soft_deleted · restored · purged) with the
  field-level diff (only changed keys, not full row).
- New helper module `lib/db/entity-audit.ts` — `recordAudit` +
  `logCreate / logUpdate / logSoftDelete / logRestore / logPurge` +
  `diffData` + `stripNoise` + `getEntityHistory` + `getActorActivity`.
  Names use `log*` prefix to avoid colliding with v7.8's `auditCreate`.
- Initial wiring: soft-delete helpers (auto-emit), tasks service
  (create + update), missions service (create + update), goals
  POST + PATCH.
- New API: `GET /api/audit/entity?type=&id=&limit=&actor=&action=&since=`
  for per-entity history; `?firehose=1&actor=nick` for actor activity.
- Migration `20260429240000_entity_audit` with `IF NOT EXISTS` +
  4 indexes + idempotency-key partial unique.
- 25 unit tests, full suite 379/379.

Distinct from per-entity event logs (TaskEvent · GoalEvent): those
are domain-semantic for the brain pattern miner; entity-audit is
field-level diffs for "what happened" queries.

---

## 2026-04-29 — v7.9.1 IdentitySnapshot soft-delete fix + missed reads

QA pass after v7.9 caught two real gaps:

- **`IdentitySnapshot.date @unique` blocked "redo today"** — soft-deleting
  today's snapshot left the row holding the unique slot, so the cron
  re-emit hit P2002. Dropped the unique, replaced with `@@index([date])`.
  Daily-uniqueness now enforced in app code via `findFirst({date,
  deletedAt:null}) → create-or-update` in `trackIdentityEvolution`.
- **3 read paths still pulled soft-deleted rows**:
  - `lib/brain/thinking-engine.ts` (2 sites — last/current snapshot)
  - `lib/brain/memory-consolidation.ts` (5 health-check counts)
  - `app/api/actions-brain/route.ts` (8 reads feeding the AI)
  Worst leak was actions-brain (injects task/memory/commitment context
  into the LLM prompt — soft-deleted rows would leak into responses).

Migration `20260429230000_identity_snapshot_drop_date_unique` drops
the constraint with `IF EXISTS` (safe across Vercel cold starts).

Plus same-day hotfix: `/api/ai/plan-project` `schema.parse()` →
`safeParse` so Zod input rejects don't fire Vercel email alerts.

---

## 2026-04-29 — v7.6 → v7.9 · Phase 1 Schema-Audit Hardening

Four foundational sweeps in one session, ranked from the schema audit.

### v7.6 — ChatMessage Batch A · 16-checkpoint sweep
After the audit flagged ChatMessage as carrying only 7 fields when
modern AI chat apps need 15-25, ChatMessage Batch A landed:

- **16 new chat_messages columns**: clientMessageId · parts (UIMessage
  tree) · streamingState · parentMessageId + branchId · editedAt +
  editHistory · errorDetails · provider · routerReason · latencyMs +
  firstTokenLatencyMs · costCents · promptTokens + completionTokens ·
  feedbackScore · searchableContent + tsvector GIN index ·
  attachmentsHash.
- **7 new chat_conversations columns**: pinnedSummary · topicTags ·
  archivedAt + starredAt + mutedAt · lastActiveAt · messageCount.
- **Helper module** `lib/ai/chat/message-fields.ts` — pure functions
  for extracting parts / attachments / hash / searchable content +
  client-id resolution. 27 unit tests.
- **Backfill cron** `/api/cron/chat-message-backfill` for legacy rows.
- **New endpoints**: `/api/ai/chat/feedback` · `/edit/[messageId]` ·
  `/branches/[parentMessageId]` · `/conversation/[id]` ·
  `/system/conversation-costs`.
- **New components**: MessageStatusBadge · MessageInfoCard ·
  MessageBranchSwitcher · MessageEditControls · ConversationPulse.

### v7.7 — Universal idempotency keys (6 tables)
`autonomous_actions · scheduled_actions · task_events · goal_events ·
reflections · decision_replays` get nullable `idempotency_key` +
UNIQUE PARTIAL INDEX (`WHERE idempotency_key IS NOT NULL`).

Helper `lib/db/idempotency.ts` — `mintIdempotencyKey` + `bucketed` +
`idempotentCreate` + `idempotencyRecipe` per table. 15 tests.

Wired into autonomous-engine rule fires + task-events emit + goal-events
emit. Cron retries on Vercel cold-starts no longer double-fire.

### v7.8 — Universal createdBy/updatedBy + AsyncLocalStorage actor
6 tables (Mission · Task · life_goals · brain_memories ·
mastery_decisions · commitments) tagged with `createdBy` + `updatedBy`
in a small predictable vocabulary: `user · nick · system · cron:<name>
· bridge:<system>`.

Helper `lib/db/actor.ts` — `withActor` / `currentActor` / `auditCreate`
/ `auditUpdate` / `resolveActor` / fast-path constructors. Async
context propagation so deeply nested writes can read the actor without
threading. 21 tests.

`apiHandler` + `cronHandler` + chat POST auto-tag. Avoids 200-file refactor.

### v7.9 — Universal soft-delete (9 tables)
`missions · tasks · life_goals · brain_memories · mastery_decisions ·
commitments · brain_dumps · reflections · identity_snapshots` get
nullable `deletedAt` + b-tree index. Helper `lib/db/soft-delete.ts` —
`softDelete` / `restore` / `findManyActive` / `softDeleteFor` / etc. 24 tests.

Wired into all user-facing deletes: goals · tasks · missions (cascades
to child tasks) · pinned · anti-patterns · memory-decay · `forget()`.
All AI-prompt injection paths filter `deletedAt: null`.

### Pre-push hook hardened (4 → 6 steps)
After CI caught dark-code crons that pre-push didn't:
- [5/6] cron manifest drift (`tsx scripts/verify-crons.ts`)
- [6/6] AI tool-catalog contract (`vitest run tests/ai/`)

Plus 9 dark-code cron routes registered in `config/crons.ts` (no
behavior change — just closing the manifest gap so the drift detector
goes green).

---

## 2026-04-28 — v6 Mega-Overhaul · 56 features across 8 batches

8-batch session covering content-engine power-ups, business-mode
feature surface, and personal-OS upgrades.

- Foundation + visibility: cold-memory bias rule, brand-context preview,
  aspect-ratio inference, model badge, `/system/prompt` diagnostics.
- Operations: 7-axis content critic, image upscale (2x/4x), z-image-turbo
  fast mode, /system/costs operator dashboard, rate-limit HUD pill,
  per-model latency p50/p95/p99.
- Content engine: multi-output detector (`/all` `/ab` `/reformat`
  `/twopass` `/carousel`), photo-as-input via qwen3-vl, A/B variations,
  cross-platform reformat, two-pass content, image variations toolbar,
  multi-image batch, content history search, domain-routed models, live
  image notifications.
- Distribution: Meta Graph publisher (IG/FB), Buffer scheduler, `/social` UI.
- Learning loops: Meta Insights v21.0 wrapper, ALG customer story
  sourcing, 14-source automotive industry RSS monitor, `/intel` UI.
- Personal-OS: `/api/ai/plan-day` + `/plan` UI, `/pins`, knowledge-refresh
  fan-out, Fireflies cron, journal classifier.
- Storefront photo improver: vision-pass via qwen3-vl + recraft-v4 rebrand.
- LIVE BRAIN RECALL into content-mode system prompt — pulls 5 industry
  items + 3 customer stories + 5 top performers from brain memory.

CI hotfix for Next 16 + googleapis@171.4.0 binary-detection bug.

## 2026-04-28 — v7 Mega-Overhaul · 9 batches continuing v6

Same-day continuation:
- Router upgrade (score + multi-signal + embedding fallback)
- Content-intent v2 (3-layer detector, 90+ Nick's-Tire keywords)
- Auto-fire 6-gate + AutoFirePlanToast (GO/EDIT/CANCEL)
- Ambiguity detector + content-feedback loop + outcome calibration
- Hallucination guard + semantic dedup + Playwright e2e
- 14-source competitor pulse + customer cohorts + weather hook
- Recurring-service predictor + Uber link + win-back templates
- Energy router + friction tracker + sleep context
- Cost regression + memory bloat watch + image rot scan + provider ping
- Autocomplete + image tournament + voice-to-content + context shrinker
- Voice-clone trainer (Fireflies-mined) + knowledge-graph endpoint
- Multi-language (es/ar/pl) + camera vision analyzer + federation skeleton

Plus 4 chat-glitch fixes from chat-export `cmoj0r72t`:
- priorAssistant skips image-gen turns
- Venice 400 errors name the offending field
- Missing-image-attachment friendly hint
- `?cid=` deep-link support

**CRITICAL CORRECTION**: 14 misplaced business modules removed (commit
`46eced2`). Per `feedback_business_separation`, those features belong
on nickstire — `lib/customer/*` · `lib/federation/*` · `lib/ai/lead-
scorer.ts` · `lib/ai/recurring-service-predictor.ts` etc. Net -2,300 lines.

Decision rule: **does this feature touch a real customer / invoice /
phone number? YES → nickstire. NO → statenour-os.**

---

## 2026-04-22 — v11.1 Devastating-Lead Continuation Wave

Continuation of v11.0 under explicit Nour-reinforced principles
(docs/BUSINESS-LANDSCAPE.md, `.claude/projects/memory/business_vision.md`,
UPGRADE-PLAN.md §"v11.1 MEGA WAVE"). Ship cadence: atomic commits,
regular pushes, universability — any agent can pick up mid-wave.

### Bugs killed (prod)
- `/system` crash (`health.loops` on retired OpenLoop) — optional-
  chained + type trimmed
- Chat "Maximum update depth" residual loop — stale-error clear + 500ms
  retry cadence floor in `useSilentRetry`
- Nightly `consolidate` cron 500ing (unique constraint on wisdom
  promotion) — `.create` → `.upsert` + per-stage safe wrapper
- 29 zombie commitments + hardcoded "0 score" in Nick context — stale
  DailyScore inject ripped + commitment extractor tightened
- Stale builder-mode UX ("where did the coder go") — persona picker
  restored in ⋯ menu + sandbox wired

### Chat fluidity (Tier 1–3)
- `use-stick-to-bottom` integrated (replaces manual scroll fight)
- Kinetic send↔stop button (single morphing element)
- Input stays live during stream; stream-end haptic tick
- ↓ new-reply chip when scrolled up mid-stream
- Streamdown replaces react-markdown (block-memoized, only changed
  block re-renders per token)
- Stagger 300→144ms with cubic-bezier; `.nick-prose--streaming`
  optimizeSpeed; pre-allocated message height; shimmer cursor

### Codebase cleanup
- **250 retired `prisma.*` calls ripped across 34 models** (codemod
  with paren balancing). -837 net LOC. `RETIRED_MODELS` shim deleted
  — hard failures instead of silent empties for any regression.
- `vercel.json` disables `statenour-master` preview builds
- Per-engine tier gating in `system-prompt.ts` (SmartDevice /
  AutomationRule / Market intel only on matching topic tiers —
  ~4 fewer DB hits per casual chat turn)

### Auth + diagnostics hardening
- `hooks/use-authed-fetch.ts` — 401 retry (300ms grace for cookie-
  arrival race) + `describeFetchError` surfaces status + body preview
- 10 panels converted (brain-maturity, skill-library, beliefs,
  contradictions, qualitative, nudges, tool-telemetry, pinned,
  suggestion-telemetry, identity)
- **Client error telemetry**: window.onerror + unhandledrejection →
  `/api/errors` → ErrorLog → visible at /system/errors. Dedupe by
  fingerprint (30s), rate-cap (10/min).
- **ErrorBoundary** class component auto-posts to same pipeline;
  mastery layout wrapped so one broken panel doesn't white-screen
  the shell.

### New HQ power surfaces
- **`<CarsTodayCard>`** — business-landscape rank #1. 42px animated
  count of today's cars through the bay (invoices + walk-ins + drop-
  offs with gold-highlighted drop-off) + delta-vs-7d + 24-bar hourly
  heat (current hour pulses) + FreshnessChip. Graceful "connecting
  to shop" state until nickstire ships `cars_today` action.
- **`<ConversionTrackerCard>`** — estimate→invoice critical gate
  (rank #4). Big % + delta-vs-prior + top-5 aging leaderboard with
  per-row Call/SMS/Lost actions.
- **`<FreshnessChip>`** — "Nns ago · source" primitive, 5 tones
  (live/fresh/recent/stale/very-stale), self-ticks every 30s, optional
  reload. Drop-in for any data card.

### Builder Sandbox power actions
- **Rollback deploy** — new `/api/system/deploys/rollback` promotes
  prev READY deploy via Vercel API. 501 when VERCEL_TOKEN missing
  (graceful toast, no noise).
- **Clone commit** — copies `git fetch && git checkout <sha>` to
  clipboard.
- **Open in VS Code / Copy path** — per-file row hover actions.
  `vscode://file/…` URI scheme + clipboard fallback for mobile.

### Chat page
- Safe X-Persona auto-sync (B5). Server still infers persona per
  turn via `X-Persona` header; now written to a ref and drained
  exactly once per turn completion (isStreaming true→false transition,
  diff against current value). Previously-reverted loop is impossible
  by construction.
- Calibration onboarding (D4). One-time inline explainer above any
  bet/calibration primary card ("What's a bet? Nick predicts…").
  Dismiss persists to localStorage.

### Cron fleet
- Full fleet audit: **1499 runs across 30 jobs in 7d — 29 clean,
  1 failing** (the `consolidate` job that's fixed but hasn't run
  since the fix shipped). `scripts/cron-fleet-audit.ts` +
  `docs/cron-health-2026-04-22.md`.

### Cross-ring business bridge
- **`docs/NICKSTIRE-QUERY-CONTRACT.md`** — explicit contract between
  statenour and nickstire. 10 existing actions documented, 4 new
  actions required (cars_today, estimates_conversion, estimates_
  aging, drop_off_ratio), 7 more predictively wired.
- **`/api/nickstire/query`** — browser-safe owner-authed proxy to
  the cross-domain bridge.
- **`predictive-prefetch.ts`** + **`pipeline-controller.ts`** — load-
  bearing business data now routes through queryNick. Empty-stub bug
  (Nick saying "0 leads" when shop had leads) blocked forever.

### Docs (versioned with code, overrides memory if drift)
- **`docs/BUSINESS-LANDSCAPE.md`** (NEW) — definitive business DNA
  reference. Operating pillars (LINE OF CARS · APPOINTMENTLESS ·
  HAPPY WAIT · DROP-OFF+UBER-OUT), metrics hierarchy, correct funnel
  (not lead→booking), CX covenant, philosophy layer, tool inventory.
- **`UPGRADE-PLAN.md`** — v11.1 MEGA WAVE section appended (9 batches,
  verification + rollback per task).
- **`.claude/projects/memory/business_vision.md`** + `feedback_
  business_dna.md` — 2026-04-22 reinforcement appended.

---

## 2026-04-22 — v11.0 Observability + Power + Meta-Intelligence Wave

Two-day sprint across 20+ commits. Foundation first (cleanup, CI,
types, docs), then observability (10 /system/* surfaces + pulse
aggregator), then meta-intelligence (Nick quality, anti-patterns,
decision drift, Ghost Nour), then compound loops.

### 14 /system/* surfaces went from 0 → live
- `/system/crons` — kill switches, manual run, sparklines, 8-category filter
- `/system/errors` — fingerprint groups + recent feed + "→ task" button
- `/system/ai-cost` — today/7d/30d × feature × model × burn rate
- `/system/actions` — autonomous-action audit with SVG success-rate rings
- `/system/quality` — Nick output-critic 4-axis trend + per-intent leaderboard
- `/system/anti-patterns` — explicit "I tried X, failed, reason Y" library
- `/system/decision-drift` — MasteryDecision grade trend + review rate + overdue
- `/system/ghost-nour` — Jaccard similarity over 500-decision history, 0¢ per query
- `/system/devices` — fleet deck + agent liveness banner
- `/system/power` — provider pin, cost cap, strict mode, pause-all-crons, quiet
- `/system/logs` — unified live tail across 5 log models
- `/system/gaps` — automated "nothing missing" detector
- `/system/pulse` (API only) — FloatingHome orb feed
- `/system/health` — preserved

### Foundation (v11 W1-W10)
- −242K lines cleanup · dead components, empty dirs, Ollama residue, stale prompts all archived
- CI workflow · typecheck + lint + test + schema-drift guard + cron-manifest guard
- Mirror workflow · codex/ollama-local → statenour-master auto-FF on green CI
- `scripts/sync-master.sh` · emergency manual catch-up
- Pre-push hook · tiered (typecheck+lint+test on codex, full build on master)
- Schema-drift bug fixed · `prisma format` was silently failing every CI run
- Lockfile ambiguity fixed · deleted package-lock.json; pnpm canonical
- `config/crons.ts` · 38 entries, 31 scheduled, drift-guarded in CI
- `cronHandler` auto-logs every run to CronJobLog
- `config/retention.ts` · 20-model retention policy, enforced weekly
- `lib/env.ts` · 3-tier spec (required/runtime/platform) + boot-time check
- 6 fresh docs · README + ARCHITECTURE + DATA-MODEL + RUNBOOK + SECURITY + AGENT-CONTRACT
- Prisma schema · Task.goal ↔ LifeGoal @relation added (ORM-level)
- tsconfig strict: true · 99 errors → 0 across 30+ files

### Compound loops (v11 W12)
- `checkAntiPattern` Nick tool · automatic anti-pattern check before side-effecting actions
- Nick-quality 7d mean surfaced on FloatingHome orb (🧠 badge)
- `/api/system/pulse` extended with nickQualityAvg7d + nickQualityReplies7d
- `BrainMemory` category sweeps in data-cleanup cron (5 volatile categories)

### Observability + control deck details
- `/api/system/pulse` · single-query rollup powering orb + widgets
- `lib/hooks/use-system-pulse` · shared 30s poll, de-duped across components
- FloatingHome orb · tints live by system tone (gold/amber/red), critical-count pip
- `/system/power` · BrainMemory(power_panel) backing store for settings
- `checkAiBudget` · enforces daily cap + strict mode on every chat call

### Tests + safety
- 13 → 15 test files (contract + snapshot tests for tool catalog)
- 113 → 114 tools in catalog
- 79 tests total, all passing
- Git history secret-pattern scan → 0 matches across all refs

### Shipped SHAs (v11.0)
- 1177323 · foundation
- 8f15929 · cron manifest
- 0fe3766 · /system/crons
- 5fa4e2e · /system/errors + retention
- 29dede9 · /system/ai-cost + /system/actions + orb
- 7fe1993 · docs wave
- aade9e3 · /system/power
- f6217c4 · tool catalog + Nick quality + anti-patterns
- df4ca01 · /system/devices + ⌘K + vim-nav
- 6553bca · CI hardening
- 5786e0a · prisma format drift fix
- a0b0955 · strict-null migration + Task.goal relation
- 5f4ed61 · /system/decision-drift + /system/ghost-nour
- 48ac7d4 · lockfile fix (force pnpm on Vercel)
- ed9b905 · plan checkpoint
- b3f26d2 · budget enforcement wire-up
- 02c004e · nick-message types + /system/logs + checkAntiPattern
- 050bc74 · /system/gaps

---

## 2026-04-20 — v10.4 Bridge Layer + Signal Unification + Audit Follow-ups

Major day. Three separate user callouts, 14 commits, 2 structural
collapses, 16 unit tests, all live on bdnick.info.

### Structural: HQ 7-card stack → 1 Situation card
- `lib/ultron/situation-synthesizer.ts` — pure logic that takes
  blind-spots, narrator voices, bets, aging beliefs, pin hygiene,
  ruminations, momentum, reflections, and ghost predictions; ranks
  by `severity × source × freshness`; cross-source dedupes via
  domain + token overlap; returns a single ranked payload with
  primary / secondaries / autoResolved / monitors / counts /
  noiseReduced.
- `/api/ultron/situation` — meta-aggregator route. Parallel
  `Promise.all` across all sources. Cached 120s.
- `<SituationCard>` — the ONE card. Severity ring (critical=red
  pulse, high=amber, medium=gold, low=zinc, win=emerald), primary
  headline + body + action, 5 ambient monitors at the bottom
  (watch, bets, re-rule, pins, reflections), expand drawer for
  secondaries + auto-resolved FYIs, `−N noise` counter.
- SignalZone now renders ONLY `<SituationCard />`. NarratorStrip
  + GhostNickStrip + BetDesk + BrainCarousel + MemoryCalibration
  + Rumination + TomorrowNote + ReflectNudge unmounted from HQ.
- `/api/cron/auto-calibrate` (2:30am ET) replaces the manual
  "CALIBRATE MEMORY · START" ritual. Three-branch rule triage:
  auto-verify on high-confidence + no-contradiction + aged 30d+,
  queue-for-review on contradicted, auto-retire on very-stale
  low-confidence, identity excluded. Writes `belief_refresh_report`
  BrainMemory rows; situation card reads them as auto-resolved.

### Structural: /tasks 5 tabs → 4 tabs + daily brief inline
- LEARN and REVIEW both rendered identical `<KommandoLearn />`. Pure
  duplication. Collapsed to 4 tabs (NOW / PLAN / TRACK / LEARN).
- Legacy `REVIEW` localStorage value silently migrates to `LEARN`.
- `<DailyBriefSection>` lives at the top of LEARN mode. Time-of-day
  aware: morning/midday/afternoon/evening/late with distinct icon +
  copy + accent. Pulls priority/wins/emerging from pulse-digest +
  overnight maintenance from belief_refresh_report + pin_hygiene.

### Goal ↔ Project bridge (/tasks)
- Three layers (LifeGoal / Mission / Task) now cross-reference in UI.
- Goal cards grew a "↳ projects:" inline row with clickable chips
  showing open/total counts. Click → jump + auto-expand project.
- Goals with no linked project show "↳ no project yet · [PLAN IT]"
  → seeds the project-create input with goal title + scrolls.
- Project cards grew a "↑ goal:" purple chip with real titles.
  Orphan projects show amber border + "↑ no goal linked" +
  `<LinkGoalPicker>` popover for one-click assignment (batch-
  patches every task under the project missing a goalId).
- Header: "2 active · N unlinked" or "all linked to goals".
- Bridge computed once per render via `useMemo` walking tasks
  (O(n)) — zero new schema, derives from Task.goalId + Task.missionId.
- `NEEDS ATTENTION` callout deleted (was pure duplication).

### Chat intelligence additions
- Mode pill shows what mode ACTUALLY ran via `X-Nick-Mode` +
  `X-Nick-Mode-Source` response headers. Silent when prediction
  matches reality; appends "ran·S" or "ran·D" when override was
  used or classifier changed between draft and send.
- Chat export in NickHeaderV2 overflow menu: "Export as Markdown"
  + "Export as JSON" on the current conversation. Previously only
  surfaced via Cmd+F history search.
- Lane-correction chip ships feedback: tap/dismiss logs to
  SystemMetric tagged by action/domain/severity so the regex
  classifier can tune later.
- Stream-stall reframe: when `stallStatus === "warn"|"stalled"`,
  NickStreaming shifts from "thinking…" to "thinking deeper · N
  tools pending". Anxiety → engagement info.
- Tool result cards grew a "▸ raw output" expand revealing the
  full JSON payload (truncated at 8K), closed by default.

### New AI tool: setTaskPriority (Tier 1.8)
- Natural-language retag. Nour says "this is critical" and Nick
  calls `setTaskPriority({ titleQuery: "...", priority: 15 })`.
- Writes manualPriorityOverride + autoPriority + logs reason to
  autoPriorityExplanation. Fuzzy title fallback when id unknown.
- Returns human-readable band (critical/high/normal/someday).
- Added to chat-mode CORE_TOOLS so standard mode surfaces it.

### Observability + persistence
- SuggestionMetric rows persist to SystemMetric on every
  `/api/ai/chat/suggestions` request. `readHistoricalSuggestion-
  Metrics(24)` aggregates the last 24h across lambda cold starts.
  Stats endpoint returns both live + history24 shapes.
- Lane-check feedback endpoint (`POST /api/ai/chat/lane-check/
  feedback`) persists tap/dismiss to SystemMetric.
- `scripts/dry-run-auto-calibrate.ts` replays the nightly cron's
  triage logic without writes. Verified live — 0 current candidates,
  clean execution.
- `scripts/measure-prompt-size.ts` (prior) + `scripts/smoke-pins.ts`
  (prior) + this script = 3 live verification scripts under
  `npm run prompt:size-check | pins:smoke | calibrate:dry`.

### Prefetch rate-limit fix
- `hooks/use-prefetch-client-id.ts` generates a per-tab sessionStorage
  UUID. `useChatPrefetch` + `useIdleWarmup` send it as
  `X-Prefetch-Client-Id`. Prefetch route keys rate-limit + dedupe
  by client-id first, falls back to ip+ua. Two Nours on the same
  IP no longer cancel each other's warmups.

### Tests (new — BATCH E)
- `tests/lib/situation-synthesizer.test.ts` — 16 unit tests, 0
  failures. Covers ranking, dedup, synthesis, monitor thresholds,
  noiseReduced math.

### Dead code swept
- Deleted: bet-desk, brain-carousel, rumination-card, tomorrow-note
  (component — the BrainMemory category stays), reflect-nudge,
  narrator-strip (+ empty narrator dir), nick-noticed.

### Infrastructure fixes
- Pinned `@@index([category, updatedAt])` on `brain_memories`
  applied to Neon via `scripts/add-pinned-index.ts` (prisma db
  push blocked by legacy-table drift; raw SQL via $executeRawUnsafe).
- Ghost Nick folded into situation as a ghost-source candidate;
  full accuracy scoreboard still lives on `/brain`.

### Build fix (CRITICAL — unblocked 11 stuck deploys)
- `lib/ai/chat-mode-detect.ts` split from `chat-mode.ts`. The
  lazy `require("./tool-embeddings")` inside `pruneTools()` was
  pulling googleapis → child_process into the client bundle
  whenever a client component imported `detectChatMode` from
  `chat-mode.ts`. Split the detector into a zero-deps file;
  client uses detect-only, server uses full file.

### Commits (14)
```
cb0849f  feat(ai): setTaskPriority tool
2deecd7  feat(chat): stall reframe + expandable tool cards
5085ab2  feat(audit): prefetch client-id + lane feedback + dry-run
c3e74df  test(brain): 16 unit tests + suggestion metric persistence
aa33106  chore(cleanup): retire 7 dead components + fold Ghost Nick
73ec442  feat(chat+tasks): mode-ran header + link-goal picker + export + ancestry
7171d11  feat(tasks): 5→4 tabs, fold REVIEW into LEARN with daily brief
2bde50a  feat(tasks): Goal ↔ Project bridge
2587d4b  fix(build): split chat-mode client detector from server pruner [CRITICAL]
169f6e3  feat(chat): lane-correction chip + endpoint hygiene doc
af27150  feat(hq): unified Situation layer — one card replaces the 7-card stack
df4c63f  fix(audit): wire dead writes + retire redundant NickNoticed + apply pinned index
(earlier today's v10.3 items)
```

---

## 2026-04-20 — v10.3 Quality Audit + Tier 1 Power Moves

Continuation of the v10.2 wave. Ran the entire Tier 9 quality audit
before adding new features, then shipped Tier 1.2/1.5/1.6/1.10/1.12
+ a starter pack of Tier 10 alive-UI animations. Seven atomic commits
across the day, all pushed in-order as checkpoints.

### Quality audit (Tier 9)

**9.1 Prompt size regression script** (`aec879a`)
- `scripts/measure-prompt-size.ts` builds the live system prompt,
  prints a top-10 section breakdown, and exits non-zero if total
  chars > 40K (20% Venice headroom).
- `npm run prompt:size-check` one-liner.

**9.6 BrainMemory compound index**
- Added `@@index([category, updatedAt])` so pinned_user queries
  (GET panel, system-prompt injection, stale-pin detection) hit an
  index instead of a seq scan. Additive — apply via `prisma db push`.

**9.8 Long-press pin role guard + verification readback**
- MessageActionSheet onPin now early-returns for user messages
  (ephemeral session pin only, no pollution of system prompt).
- Too-short content (<8 chars) skips permanent write.
- 800ms post-POST readback via GET /api/brain/pinned — missing row
  triggers haptic.error + console.warn so silent failures surface.

**9.11 Dark-mode sweep** — new components (mode-pill, smart-replies,
  pinned-context-panel, connection-status, suggestion-telemetry,
  hq-status-chips) verified free of hardcoded text-white/bg-white/
  text-black. Everything uses var(--*) tokens.

**9.12 Dead code** — `usePinnedMessages` verified KEPT as
  intentional session-pin feature, distinct from permanent
  BrainMemory pin system. Not dead code.

**9.3 Suggestion cache hit-rate telemetry** (`da1627a`)
- Module METRICS counter in suggestion route: cacheHits, veniceOk,
  veniceFail, heuristic, errorFallback, latency samples (cap 200).
- `/api/ai/chat/suggestions/stats` returns hitRate + p50/p95.
- `<SuggestionTelemetryPanel>` on /brain polls every 15s, shows a
  color-coded hit-rate bar + source split + interpretation footer.

**9.10 Venice retry observability**
- `veniceSuggestionsOnce` + retry wrapper: 4s first attempt, 6s
  retry after 150ms gap (salvages ~30% of cold-start failures).
- Every response carries `{ source, cached, attempts, latencyMs }`
  so clients can render fallback indicators.

**9.2 Pinned-context E2E smoke** — `scripts/smoke-pins.ts` writes
  a sentinel pin, reads it via the exact panel query, calls
  buildSystemPrompt() and greps for the sentinel, deletes, then
  verifies cache-invalidated prompt no longer has it. Self-cleaning.
  `npm run pins:smoke`.

**9.4 Pin-write verification** — shipped inline in 9.8's onPin.

**9.5 Error-code shape audit** (`06140b4`)
- Every `/api/brain/pinned` error branch returns `{error, code}`
  with stable codes: `PINS_FETCH_FAILED`, `PIN_WRITE_FAILED`,
  `PIN_PATCH_FAILED`, `PIN_DELETE_FAILED`. GET 500 no longer masks
  failure as empty data.

**9.9 Prefetch server rate-limit**
- In-lambda limiter keyed by ip+user-agent hash (1.5s window).
- Draft dedupe — identical draft within 2.5s returns
  `reason:"duplicate_draft"`.
- GC entries > 10× window to cap memory.

**9.7 Mobile tap targets** — pins panel action buttons get
  `p-2 md:p-1.5 touch-manipulation` for 32px thumb targets on
  mobile without bloating desktop.

### Tier 1 power moves

**1.10 Pin hygiene weekly cron** (`f2be101`)
- `/api/cron/pin-hygiene` runs Sunday 6AM ET. Classifies pins into
  stale / very_stale / over_cap / oversized, upserts a summary
  `nudge_pin_hygiene` BrainMemory row the NudgePanel can render.
- Self-cleans when everything is healthy.
- Added to vercel.json.

**1.5 Idle warmup on non-chat surfaces**
- `hooks/use-idle-warmup.ts` fires `/api/ai/chat/prefetch` on mount
  via `requestIdleCallback`, refires every 45s (matches prompt
  cache TTL).
- Wired into `/brain` and HQ Ultron root. /brain→/chat or /→/chat
  lands on a hot lambda.

**1.12 HQ status chips**
- `components/ultron/top-strip/hq-status-chips.tsx` — pin count
  chip (deep-links to `/brain#pinned-context`) + suggestion cache
  hit rate chip. Colors shift: gold→amber→red by pin staleness;
  suggestion chip goes amber when heuristic-heavy.
- Mobile hides suggestion chip to save space.

**1.2 Ranked + budget-aware pin injection**
- system-prompt.ts fetches up to 15 pinned_user rows, scores by
  `label_weight × recency × reinforce × source_weight`.
- Pins with Nour-set labels get 2x weight; reinforced pins scale
  by log(seenCount) up to 3x; `pin:manual` > `pin:chat` > default.
- Greedy fills `PIN_CHAR_BUDGET` (1200) OR top-5 cap. Block copy
  tells Nick when pins were trimmed for budget.

**1.6 Chat export** (pending)
- `/api/chat/export/[conversationId]?format=md|json&include=all`
- Markdown output includes tool calls as blockquotes, reasoning
  folded in `` ```reasoning `` blocks.
- Content-Disposition attachment triggers browser download with
  auto-generated filename `nick-chat-<id>-<date>.<ext>`.
- Download button added to each result in chat-history-search.

### Tier 10 starter pack — Alive-UI

**10.1 Mode pill breathes when Nick is active**
- New `active` prop. When true (during streaming), pill has a
  2.2s gold breathing animation.

**10.2 Pin ring respiration**
- Stale pins (>14d) get a slow 4s amber breath.
- Very-stale pins (>30d) get a more urgent 3s red breath.
- Pairs with ring-color class already in place — urgency that
  reads without reading.

**10.3 Smart-reply chips stagger-fade in**
- 240ms ease-out from translateY(4px) with 60ms delay per chip
  (0/60/120/180ms). Feels like Nick is *thinking of them*.

**10.15 Pin reinforce pulse**
- One-shot green ring pulse (900ms) on the reinforced pin. Short-
  lived `reinforcedId` state tracks which pin to animate.

**10.13 Typewriter caret class**
- `.type-caret` + `type-caret-blink` keyframe ready for the
  empty-state greeting letter-reveal effect. (JS letter driver
  will follow in a later commit.)

### Infrastructure refactor
- `lib/ai/suggestion-cache.ts` — extracted cache/metrics/hash/
  heuristic helpers from the route file. Next.js route validation
  forbids non-HTTP-method exports; the shared module fixes the
  TS2344 type-gen error and is now consumed by the POST route, the
  stats GET route, and the chat route's onFinish warmer.

### Commits
```
f2be101  feat(hq): pin hygiene cron + idle warmup + ranked pins + status chips
06140b4  fix(audit): error-code shape + prefetch rate limit + mobile taps
da1627a  feat(audit): suggestion telemetry + venice retry + pinned E2E smoke
aec879a  feat(audit): prompt size script + BrainMemory index + pin role guards
```

---

## 2026-04-20 — v10.2 Chat Intelligence Layer (Intelligence + Control)

After the v10.1 speed plumbing shipped, this release adds the
INTELLIGENCE + CONTROL layer on top. Seven atomic commits — each one
leaves the chat in a working state, so rollback is cheap.

### Added

**Mode pill + manual override** (commit 5ded0f1)
- `components/chat/mode-pill.tsx` — gold pill left of the send button.
  Shows the mode Nick WILL pick if Nour sends the current draft right
  now (live auto detection via `detectChatMode`). Tap to cycle:
  auto → standard → deep → auto.
- Override color goes bold gold + `·OVR` marker so Nour can tell at
  a glance whether he's locked in a mode or letting the classifier
  pick. Route already honored `body.modeOverride` — this just exposes
  the dial without leaving the input.
- Hidden during flow mode (journal dump) since flow has its own
  pipeline that ignores chat-mode classification.

**Smart reply suggestions** (commit de331a4)
- `app/api/ai/chat/suggestions/route.ts` — direct-fetch Venice call
  with 4s timeout + 180 token cap. Prompts for 3 ≤48-char follow-ups,
  returns JSON. Heuristic fallback (keyword-matched on assistant text)
  if Venice is slow/offline, so the chip row never hangs.
- Module-level cache keyed by user+assistant hash, 60s TTL, cap 40
  entries. Re-renders for the same exchange are free.
- `components/chat/smart-replies.tsx` — inline row below the last
  assistant bubble with Sparkles icon + 3 gold chips. Skeletons for
  1.5s max, then fails silent if no suggestions. Hides the moment
  Nour starts typing. Auto-hidden during flow, streaming, short
  replies (<40 chars — probably an ack).

**Pin to permanent memory** (commit b6ae344)
- 📌 button added to Nick's message footer. Tap it and the text
  becomes a BrainMemory row at confidence 1.0 with `expiresAt=null`,
  under category `pinned_user`.
- `app/api/brain/pinned/route.ts` — GET list, POST pin, DELETE unpin.
  POST is idempotent — same content reinforces the existing row
  instead of creating parallel duplicates. Fire-and-forget embedding
  so pins are semantically searchable alongside the rest of the brain.
- Separate from the existing "Save to brain" 🧠 action (`nick_advice`
  at 0.8 confidence). Pin is Nour-controlled permanent context at 1.0.
- Haptic success/error feedback.

**Time-of-day + mission + stale-pin openers** (commit 5bd0cbf)
- `/api/ai/chat-openers` enriched with three new signal sources:
  - Top active Mission (highest priority + ROI) → MIT surrogate.
    Opener copy rotates by phase of day: morning frames the MIT,
    afternoon checks what's slipping, evening closes the loop.
  - Stale pin review — if a `pinned_user` memory hasn't been
    touched in 14+ days, offer "still relevant? unpin?" as a
    cleanup nudge.
  - Phase-aware task framing — when 3+ high-ROI tasks open
    (`roiScore ≥ 70`), morning/afternoon/evening get distinct
    prompts (pick the MIT / what's slipping / reflect + set up
    tomorrow).
- All additions run inside the existing `Promise.all` so latency
  stays flat. Openers still cap at 3 (Tesla principle — fewer but
  sharper).

**Pinned context injected into system prompt** (commit ac9765a)
- `lib/ai/system-prompt.ts` — parallel fetch of the top 5
  `pinned_user` rows by most-recently updated. Injected ABOVE the
  rolling hot-rules memory window, below the permanent principles.
- Each pin truncated to 260 chars. `metadata.label` surfaces as a
  parenthetical when set.
- Block copy tells Nick these are user-controlled and to ask rather
  than assume if one feels stale.
- Closes the loop: chat msg → tap 📌 → `/api/brain/pinned` →
  BrainMemory row → next turn → systemPrompt loads it → Venice
  reads it every request.

**sendOrQueue complete wiring** (commit ab83ecc)
- Every text-based send site on the chat page now respects
  `navigator.onLine`: `handleRewordAndSend`, voice input sender,
  `?q=` auto-send on deep-link open, flow Start prompt, undo-send
  timer, `<NickMessage>` quick-action chips, edit-and-resend
  (Enter + Save), SmartReplies chip taps.
- Still raw `sendMessage`: offline drain handler (would infinite-loop
  through itself), `sendOrQueue` helper itself, image-attachment
  parts path (can't serialize a blob to localStorage — image upload
  needs to be online anyway).

### Commits (6 atomic commits + this CHANGELOG)
```
ab83ecc  feat(chat): route all send sites through sendOrQueue
ac9765a  feat(chat): pinned context slots injected into system prompt
5bd0cbf  feat(chat): time-of-day + mission + stale-pin starter openers
b6ae344  feat(chat): pin any assistant message as permanent context
de331a4  feat(chat): smart reply suggestions under latest assistant message
5ded0f1  feat(chat): mode indicator pill + manual override
```

### Files created
- `components/chat/mode-pill.tsx`
- `components/chat/smart-replies.tsx`
- `app/api/ai/chat/suggestions/route.ts`
- `app/api/brain/pinned/route.ts`

### Files modified
- `app/(mastery)/chat/page.tsx` — ModePill + SmartReplies + Pin
  action + sendOrQueue rewire
- `components/chat/nick-message.tsx` — Pin button added
- `app/api/ai/chat-openers/route.ts` — 3 new signal sources
- `lib/ai/system-prompt.ts` — pinned_user block injection

---

## 2026-04-15 — v10.1 Chat Intelligence + Permanent Principles

### Added

**Permanent working principles (3-layer redundancy)**
- `~/.claude/projects/C--/memory/feedback_work_style_v2.md` — file memory
  capturing Nour's 7 permanent rules (no agents, interesting+clever,
  power+control, thorough, never assume, wire everywhere, continuous
  reinforcement).
- `lib/ai/system-prompt.ts` — hardcoded "Nour's Permanent Working
  Principles" block in Nick's chat-layer prompt, marked HIGHEST
  PRIORITY, placed before Core Identity.
- `scripts/seed-working-principles.ts` — idempotent seed that writes
  7 BrainMemory rows at confidence 1.0 in category `feedback`. Ran
  against prod DB.

**Chat performance — 5-10x faster first token**
- `lib/ai/predictive-prefetch.ts` — keyword-based intent detection
  fires relevant DB queries in parallel with Venice so tool data is
  already injected into the prompt. No round-trip tool call needed
  for common queries (revenue, tasks, commitments, scores, blind
  spots, forecast). 7 intents covered, schema-verified against
  live Prisma.
- `lib/ai/conversation-compress.ts` — rolling summary for long chats.
  Past 12 messages, the older half gets Venice-summarized into a
  dense context block and cached per conversation in BrainMemory.
  Cuts token cost 60-70% on long conversations.
- `app/api/ai/chat/route.ts` refactored — `Promise.all` parallelizes
  prompt build + cross-session detect + contextual recall +
  predictive prefetch + conversation compression. Total wall-clock
  becomes max(each) instead of sum(each).
- Mode-based `maxOutputTokens`: quick=180, standard=500, deep=uncapped.
  Stops Nick from giving 400-word philosophical answers to "what's
  my revenue today".

**Optimistic UI prefetch**
- `app/api/ai/chat/prefetch/route.ts` — speculative warmup endpoint.
  Warms the system prompt cache + pre-runs intent prefetch + detects
  likely mode. Never calls Venice.
- `hooks/use-chat-prefetch.ts` — fires the endpoint while Nour is
  typing (300ms debounce, 8-char min, 2s rate-limit). By the time
  he hits send, lambda is warm + queries are cached.

**Progressive tool rendering**
- `components/chat/tool-result-card.tsx` — 14 new READ tools added
  to TOOL_CONFIG (searchMemories, searchReflections, rankNextActions,
  getBlindSpots, getRevenueAging, getDailyScores, dailyPulse,
  getCustomerLTV, findCustomer, getForecast, syncKnowledge,
  ingestThought, and more). Each has a human-readable running label
  and a subtitle extractor.
- Pending state visual upgrade: `Loader2` spinner instead of static
  icon, `chat-tool-shimmer` CSS keyframe sweeping gradient across
  the card while running. `output-error` state handled with red
  styling. Done state fades in.
- `app/globals.css` — new `chat-tool-shimmer-sweep` keyframe + class.

**Chat history search (Cmd+F)**
- `app/api/chat/search/route.ts` — full-text search across all chat
  messages via Postgres ILIKE. Groups by conversation, returns
  snippets with 200-char context window + match highlighting hints.
- `components/chat/chat-history-search.tsx` — gold-framed overlay
  with debounced auto-search, highlighted match spans, user/assistant
  icons, click-to-jump, keyboard shortcuts (Esc close, Enter search).
- Cmd+F handler in chat page — respects input focus (Shift+Cmd+F
  to override), plays nice with existing Cmd+K / Cmd+/ / Esc shortcuts.

**Offline queue + smart reconnection**
- `hooks/use-offline-queue.ts` — persistent localStorage queue.
  Auto-drains on connectivity return with exponential backoff
  (1.5s → 3s → 6s). Caps at 50. Status states: online / offline /
  queued / retrying / drained.
- `components/chat/connection-status.tsx` — colored status pill at
  bottom of chat. Hidden when online. Clickable to retry when queued.
- `app/(mastery)/chat/page.tsx` — new `sendOrQueue()` helper wraps
  `useChat`'s sendMessage with offline check. Used by form submit +
  suggestion chips.

**Roadmap**
- `ROADMAP.md` — 8-tier living roadmap for continued upgrades.
  Tier 1-8 covering intelligence upgrades, new surfaces, deep
  quality, external leverage, missing-controls audit, infrastructure,
  outside-the-box ideas. Each item has files, effort estimate,
  and "why" so future sessions can pick up cold.

### Changed
- Nick's system prompt now includes a new "Nour's Permanent Working
  Principles" section at HIGHEST PRIORITY level, placed immediately
  before Core Identity.
- `app/api/ai/chat/route.ts` — all three context-gathering pipelines
  (prompt, cross-session + recall + predictive prefetch, conversation
  compression) run in parallel now instead of sequentially.
- Long conversations (12+ messages) now auto-compress older messages
  into a summary block before being sent to Venice.

### Commits (9 atomic commits, all pushed)
```
923e169  feat(chat): offline queue + smart reconnection
4555c55  feat(chat): history search + jump-to-context (Cmd+F)
7354314  feat(chat): progressive tool result cards (14 new READ tools + shimmer)
8c3f51c  perf(chat): optimistic UI prefetch — warm lambda while typing
1fb2e96  perf(chat): parallel prefetch + predictive routing + compression + maxTokens
847972b  feat(principles): PERMANENT — Nour's working principles baked everywhere
(prior, same session)
d078268  docs: CHANGELOG for v10 knowledge-automation release
3700109  feat(knowledge): full automation — upload shortcut + Google OAuth + ingest crons
927be38  feat(knowledge): automated sync cron + syncKnowledge AI tool
```

### Known follow-ups (see ROADMAP.md for full list)
- Chat mode indicator pill (Tier 1.1)
- Smart reply suggestions (Tier 1.2)
- Pinned-context slots (Tier 1.4)
- Identity drift detection (Tier 2.1)
- Prediction calibration (Tier 2.2)
- Admin control panel `/admin/brain-controls` (Tier 3.1)
- Automated testing on critical paths (Tier 7.1)
- ~24 specific missing-control items in Tier 6

---

## 2026-04-15 — v10 Knowledge Automation

### Added

**Ingest & automation**
- `/api/cron/knowledge-sync` — 6-hour cron that runs backfill + rebalance +
  wisdom ingest end-to-end. Previously only runnable via local `tsx` scripts.
- `syncKnowledge` AI tool — Nick can trigger the full sync pipeline on
  demand ("sync my knowledge", "catch up the brain").
- **Google OAuth pipeline** for headless Gmail / Calendar / Drive:
  - `/api/oauth/google-data/start` — one-click consent URL
  - `/api/oauth/google-data/callback` — token exchange + storage in the
    `Integration` table
  - `lib/services/google-oauth.ts` — refresh-token-based access
    management with in-memory 55-min TTL cache
  - `lib/services/gmail-api.ts`, `calendar-api.ts`, `drive-api.ts` —
    thin read clients
  - `/api/cron/ingest-gmail` — twice daily (8am + 8pm), pulls outgoing +
    important inbound messages, filters noise, stores as `gmail_outgoing`
    / `gmail_thread` BrainMemory
  - `/api/cron/ingest-calendar` — daily 8:15am, past 7 + next 14 days
  - `/api/cron/ingest-drive` — Sun + Wed 2:30am, top 25 recent Docs/PDFs

**Ingest UI**
- `/command` page gets an **Upload Knowledge** GlassCard — file picker
  opens on mobile/desktop, accepts .md/.txt, auto-categorizes YAML
  frontmatter into identity/feedback/brand_rules/etc. Covers the
  `~/.claude/memory/*.md` laptop-only files that can't reach Vercel.
- `/api/knowledge/ingest-files` endpoint behind the button.

**Chat performance**
- `lib/ai/chat-mode.ts` — classifies every request as `quick` (0 tools,
  lean prompt) / `standard` (keyword-pruned tool subset) / `deep` (all 159
  tools). Cuts first-token latency from 10-30s → 2-5s for conversational
  messages. No loss of capability for data-heavy queries.
- `lib/ai/system-prompt-cache.ts` — 45-second in-memory cache for
  `buildSystemPrompt()` keyed by provider + 15-min time bucket. Warm
  lambdas skip the 35-engine rebuild.
- Memory section in the system prompt trimmed: 30→20 memories, 200→140
  chars each, priority to identity/feedback/brand_rules (hard rules
  never cut). DB fetch reduced from 100 rows to 60 @ confidence≥0.5.

**Task & journal layer**
- `/tasks` rows show friendly source badges (CHAT/JOURNAL/NICK) that
  link back to the spawning BrainDump. Clicking the badge opens
  `/journal#bd-<id>` with a gold-ring flash animation.
- `OpenLoop.sourceBrainDumpId` — nullable schema field linking tasks
  back to their source journal entries. Populated going forward via
  journal-ingest + backfilled for 202 of 234 existing tasks via
  `scripts/cleanup-openloop-descriptions.ts`.
- `/journal` gets a text search box (title + body + summary + tags).
- Deep-link scroll-to-entry via `#bd-<id>` hash.

**Commitments UI**
- Multi-select checkboxes on every commitment card.
- Sticky bulk-action bar (Mark kept / Mark broken / Expire) when any
  are selected.
- Search box for filtering by description.
- One-click "Expire >30d" button for pile cleanup.
- Backed by new `POST /api/commitments` actions `bulk_update` +
  `expire_stale`.

**HQ widgets**
- `MoodTrendCard` on `/command` — 14-day sparkline of the overall
  daily score with today's mood + average + delta vs prior week.
  Hides until 3+ days logged (no flat-line shame).
- `IngestKnowledgeButton` on `/command` — file upload for local
  knowledge.

**Nick system prompt**
- Knowledge corpus section — lists 18+ memory categories and maps
  query intent to the right category so Nick searches `identity` for
  "what do you know about me", `nick_advice` for "what did you say",
  `brand_rules` for voice/tone questions, etc.

**Navigation**
- Journal page added to the FloatingHome orb menu (6 items total).

**Shared tooling**
- `scripts/_lib/safety.ts` — `loadEnv()` + `confirmDatabase()` +
  `callVenice()` helpers for future scripts. Known-issue banner in
  `lib/ai/provider.ts` warning that `aiChat()` fails from standalone
  tsx scripts due to a Vercel AI SDK bug with Venice's
  `reasoning_content` field.

**Knowledge backfill scripts** (already committed during earlier work)
- `scripts/backfill-knowledge.ts` — classifies raw BrainDumps, promotes
  substantial chat messages, creates OpenLoops + Commitments +
  BrainMemories.
- `scripts/rebalance-task-priority.ts` — heuristic re-scorer for
  backfilled task priorities.
- `scripts/ingest-nick-wisdom.ts` — indexes assistant chat messages as
  `nick_advice` memories.
- `scripts/ingest-local-knowledge.ts` — walks `~/.claude/memory/*.md`,
  `.remember/*.md`, and repo-root .md files.
- `scripts/ingest-gmail.ts`, `ingest-calendar.ts`, `ingest-drive.ts` —
  MCP-agnostic JSON-file-based ingests (supplemented by the OAuth
  cron versions in this release).
- `scripts/knowledge-inventory.ts` — read-only DB state report.
- `scripts/cleanup-openloop-descriptions.ts` — one-shot cleanup for
  legacy backfill descriptions.

### Changed
- System prompt memory pull reduced from 100 → 60 rows @ confidence≥0.5.
- `MAX_TOTAL` memories in system prompt: 30 → 20. `CONTENT_LIMIT`:
  200 → 140 chars.
- Task subtitle rendering: suppress "unlinked — why are you doing
  this?" for tasks that have a source (journal/chat/NICK). Previously
  every backfilled task showed the unlinked prompt as noise.
- `prettifySource()` + `cleanupSubtitle()` helpers turn raw source
  strings into short display labels.
- `reflect` cron confirmed to already handle Sunday weekly mode —
  no change needed.

### Fixed
- `ShimmerSkeleton` "chart" variant — `Math.random()` bar heights
  caused SSR/CSR hydration mismatch. Replaced with static 7-value
  array.
- `AiInsight` component — nested `<button>` inside `<button>`
  (invalid HTML) + `load()` called during render. Fixed to
  `<div role="button">` + `useEffect`-driven load.
- Task-lanes UI forced all NickTasks into the CRITICAL lane
  regardless of actual priority. Now buckets by `priority` field.
- `criticalCount` prop in DriftShield only counts NickTasks with
  `priority === "critical"` (previously counted all of them).

### Deprecated / Archived
- 7 stale `archive/*` local branches pruned.

### Schema
- `OpenLoop.sourceBrainDumpId String? @map("source_brain_dump_id")`
  + `@@index([sourceBrainDumpId])` — additive, nullable, zero data
  loss, applied via `prisma db push`.

### Integrations
- `Integration` row `google_oauth` — stores Google OAuth refresh
  token in `config.refreshToken`. Created by the OAuth callback
  route after one-time consent.

### Cron schedule (via `vercel.json`)
```
knowledge-sync      0 */6 * * *         — every 6h
ingest-gmail        0 8,20 * * *        — 8am + 8pm
ingest-calendar     15 8 * * *          — daily 8:15am
ingest-drive        30 2 * * 0,3        — Sun + Wed 2:30am
```

---

## Data milestones

- **BrainDumps:** 38 (raw) → 135 (classified)
- **OpenLoops:** 72 → 306 (234 backfilled, correctly prioritized)
- **BrainMemory:** 1603 → 2170 across 18+ categories
  - insight 1648 · nick_advice 246 · concern 70 · win 50
  - reference 16 · project_context 16 · feedback 8 · identity 10
  - brand_rules 1 · business_context 2 · project_doc 6
- **Commitments:** 50 → 127
- **Embeddings:** 89% → 100% coverage (2194 vectors)
- **Schema:** additive only — zero destructive migrations

---

## Deployment

Single push to `codex/ollama-local` → Vercel auto-deploy. No other
branches touched. Follows the `feedback_single_deploy` memory.

---

## Known follow-ups

- **Gmail/Calendar/Drive consent step** — one-time click at
  `/api/oauth/google-data/start` required to activate the ingest
  crons. User must first add `gmail.readonly` / `calendar.readonly`
  / `drive.readonly` scopes to the OAuth consent screen in Google
  Cloud Console.
- `ingest-local-knowledge.ts` script path — only runs from Nour's
  laptop. The upload button on `/command` is the cross-device
  substitute.
- `/cron/learn` fails with the same Venice SDK issue the backfill
  scripts hit. Not blocking.
