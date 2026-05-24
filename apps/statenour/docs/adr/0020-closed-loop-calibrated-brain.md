# ADR-0020 · Closed-Loop Calibrated Brain (M1) + supporting waves

**Status:** ACCEPTED · 2026-05-23 EVE
**Companion code:** `lib/services/state-calibration.ts` · `lib/brain/suggestion-loop.ts` · `app/(mastery)/system/calibration/page.tsx` · `lib/ai/prompt/v2/shadow-metrics.ts` · `app/api/cron/judge-eval-shadow/route.ts` · `packages/lenses/` · `prisma/migrations/20260523_wave_f_schema_debt/`
**Tasks:** Q2 · Wave F · Wave H · OSS lenses · all closed

## Context

ADR-0019 (operator-state model) and Wave 5.3-5.6 (substrate +
diagnostic surfaces) built the world-model substrate. Three independent
signals existed but didn't talk to each other:

1. **OperatorState** · deterministic 5-dim snapshot (Wave 5.3)
2. **suggestion-loop** · BrainMemory rows for action + outcome (existing · written by NickSuggestions chip taps)
3. **judge-eval** · LLM-as-judge V1↔V2 reply quality (Phase V/W · Wave 5.5 calibration)

The gap: a question like *"does Nick's suggestion hit rate change with
operator mood?"* was unanswerable because the three substrates lived
on separate axes. This ADR records the M1 move that fuses them into
one auditable feedback graph.

It also records the supporting infra work that landed in the same
session: Wave F schema fixes (Contradiction soft-delete + TaskEvent
denormalized goalId + VoiceLatencyEvent composite index), the Q2
prompt-v2 paired-comparison queue (closes the shadow quality signal
gap from Wave C), and the @statenour/lenses workspace extraction
(Wardley evolved-component move).

## Decision

### M1 · Closed-Loop Calibrated Brain
- `suggestion-loop.ts trackSuggestionAction()` + `recordSuggestionOutcome()`
  now capture `currentOperatorState()` at write-time and stamp a compact
  5-dim snapshot into `BrainMemory.metadata.operatorStateSnapshot`.
- `lib/services/state-calibration.ts buildStateCalibration()` joins the
  stamped action rows on mood × suggestion kind · returns a 4×19 grid
  + per-mood / per-kind rollups + unstamped count for pre-Wave-H rows.
- `/system/calibration` page renders the grid with editorial-minimalist
  visual vocabulary · color-graded cells (≥60% emerald · ≥35% amber ·
  <35% rose · no-data gray) · `system.stateCalibration` tRPC procedure
  drives it.

### Q2 · Prompt-v2 shadow quality queue
- New `PROMPT_SHADOW_JUDGE_QUEUE` BrainMemory category.
- `enqueueShadowJudgePair()` writes v1+v2 prompts + userMessage keyed
  by sha1(userMessage|tier|slot) · 14d TTL · idempotent.
- `system-prompt.ts` shadow path samples ~10% of turns and enqueues.
- `judge-eval-shadow` cron drains queued rows after sampler-driven
  batch · shares the per-tick LLM-call budget · writes
  `prompt.shadow.judge_score_delta` SystemMetric centered around 0.

### OSS lenses workspace extraction
- New `packages/lenses/` pnpm workspace · `@statenour/lenses` v0.1.0 ·
  MIT licensed · ESM-only · 49 frameworks + types + dispatch.
- Statenour keeps its own copy at `lib/ai/strategic-frameworks/` ·
  consumer rewire deferred to a follow-up (Phase 2).
- `pnpm publish --access public` from `packages/lenses/` when ready.

### Wave F · schema debt (applied to prod Neon)
- Contradiction · +updatedAt @updatedAt · +deletedAt soft-delete ·
  +composite index (resolved, category, created_at) · +deletedAt index.
- TaskEvent · +denormalized goalId · +partial index on (goalId,
  created_at) where goal_id IS NOT NULL · 49 rows backfilled.
- VoiceLatencyEvent · +(assistant_id, stage, created_at) composite ·
  gated behind DO $$ table-existence check (the table itself lives in
  a separate parked migration · the gate makes Wave F apply-order-
  independent).

## Consequences

### Positive
- **State-conditioned supervised signal** · every new suggestion-loop
  row carries the operator's mood/focus/capacity/drift/momentum at
  fire time · the dataset compounds daily · feeds future DPO data prep.
- **Auditable feedback graph** · the operator can read the grid and
  see exactly which suggestion kinds land in which states. Pattern
  hunting is mechanical, not gut-based.
- **Prompt-v2 cutover has a quality signal** · the shadow-judge
  queue gives the V1→V2 migration its first real falsifiable check.
  Sampling at ~10% caps the cost (budgeted via the existing
  judge-eval-shadow per-tick LLM-call ceiling).
- **OSS lens registry is shippable** · `@statenour/lenses` v0.1.0
  builds clean (52 frameworks compiled · `dist/` includes types
  and source maps) · operator runs `pnpm publish` to ship.
- **Hot dashboard queries indexed** · contradiction-by-category
  goes from 200ms+ full scan to 5ms index range · per-goal task
  event timeline goes from O(N) cross-join to O(log N) single-table
  range scan.

### Negative
- **State-stamped rows take ~60ms longer to write** · `currentOperatorState()`
  fires 3 Prisma queries · stamped via fire-and-forget so the chip-tap
  UX isn't blocked, but the cumulative DB cost rises. Acceptable cost
  for the supervised signal it unlocks · revisit if it shows up in
  query latency telemetry.
- **OSS package is not yet wired into statenour** · two copies of the
  same 49 framework files now exist. Phase 2 (the consumer rewire) is
  ~30 LOC of import-path changes · deferred to bound the blast radius
  of this wave.
- **State calibration grid will show mostly empty cells for ~weeks** ·
  takes time for the suggestion-loop row count to fill the 4×19
  matrix. Expected · the metric needs to exist BEFORE data accumulates.

### Neutral
- **Wave F migration was applied imperatively** · the migration SQL
  initially referenced "tasks" lowercase (Prisma's @@map convention I
  assumed) but the actual table is "Task" PascalCase. The backfill ran
  via a follow-up Node script and the SQL was corrected for posterity.
  Future migrations should grep the schema for actual @@map values
  before writing UPDATE statements.

## Alternatives considered

1. **Inline judge call in shadow path** (Q2 alternative). Rejected ·
   doubles per-turn LLM cost. The queue+cron pattern decouples it.
2. **Separate cron for queue drain** (Q2 alternative). Rejected ·
   judge-eval-shadow already manages the LLM-call budget per tick ·
   queue draining shares the same ceiling cleanly.
3. **New table for operatorStateSnapshot** (Wave H alternative).
   Rejected · BrainMemory.metadata is already JSON · adding a column
   would mean a schema migration on the hottest write path. Nesting
   in metadata is invisible cost for write, queryable with `path: []`
   filter for read.
4. **Wire statenour to @statenour/lenses immediately** (OSS alternative).
   Rejected · ~30 LOC of import changes across many files · risk of
   silent regression mid-wave · Phase 2 is cleaner.

## Open items

- Phase 2 of OSS extraction · rewire statenour to import from
  `@statenour/lenses` · delete the inline copy at
  `lib/ai/strategic-frameworks/`. ~30 LOC · 1h.
- Pick the first AI surface to opt into operator-state (ADR-0019
  open item, unchanged). The state-calibration grid will inform
  this choice once data accumulates.
- Decide whether to publish @statenour/lenses to npm publicly. The
  scoping doc (`docs/open-source-frameworks-scoping.md`) lists the
  4 open questions. Operator call.
