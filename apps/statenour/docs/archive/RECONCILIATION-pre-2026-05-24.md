# Reconciliation (archive · entries before 2026-05-24) · statenour-os — HISTORICAL · DO-NOT-EXECUTE

> **HISTORICAL archive** — split out of `docs/RECONCILIATION.md` by the truth-substrate audit (2026-07-21) to cap the live log's size. Entries are most-recent-first and all predate ~2026-05-24. Many reference **retired** deploy paths (`codex/ollama-local` · `statenour-master` · Vercel · the standalone `statenour-os` repo) — lineage only, never current. Current truth: [`../CURRENT-TRUTH.md`](../CURRENT-TRUTH.md).

---

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
