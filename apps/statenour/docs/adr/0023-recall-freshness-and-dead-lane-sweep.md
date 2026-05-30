# ADR-0023 · Recall-freshness fix + dead-lane sweep + retro→journal (Sam-synergy pass)

**Status:** ACCEPTED · 2026-05-29
**Companion code:**
- `lib/db/pgvector.ts` (new `padToVectorDim(vec, dim)` + `VECTOR_DIM_1536` constant)
- `lib/brain/embedding-utils.ts` (`writePgvectorColumn` now dual-writes `embedding_vec_1536`)
- `lib/brain/memory-recall.ts` (`CONTEXT_CATEGORIES` +5 lanes)
- `lib/services/journal-feed.ts` (5th feed source · `mission_retro`)
- `components/journal/types.ts` (`SourceKey` + `FeedEntry.source` + `SOURCE_ICON` gain `retro`)
- `app/(mastery)/journal/page.tsx` (retro filter chip + count)
- `tests/db/pgvector-pad.test.ts` (new · pins cosine-preservation invariant · 9 tests)
- `scripts/backfill-hnsw-1536.ts` (ran against prod · padded 1,599 rows)
**Commits:** `d535550c` · `c803f1c8` · `5ef9a5df` · `b48c6e8a` (all on `origin/main`)

## Context

A Sam-Altman-voiced synergy report + a 10-agent build plan proposed a
slate of statenour "features" (decision→goals link, reflections panel,
body-state reflectback, content-draft-writer, suggestion-outcome-loop,
goals↔missions). An operator challenge ("r u sure check again n deeper")
forced adversarial verification of every load-bearing claim against the
**actual code** rather than the plan doc.

That verification overturned the plan twice:

1. **The headline features were mostly already built.** Six of them
   shipped in earlier waves (see Consequences). A doc-level plan
   enumerates features it *imagines* are missing; it cannot see what
   already exists.
2. **The real gaps were silent failures the plan never named** — defects
   only visible by tracing write→read data paths:
   - **Recall-freshness gap.** The opinionated chat recall
     (`recallMemoriesForQuery`, `memory-recall.ts:173`) reads ONLY
     `embedding_vec_1536 IS NOT NULL` via its HNSW index, but the write
     path `writePgvectorColumn` set ONLY `embedding_vec`. The 1536 column
     was filled solely by a *weekly* backfill cron → every freshly-written
     memory was invisible to Nick's live recall for up to 7 days.
   - **Dead recall lanes.** Several high-signal categories are written +
     embedded but were never added to `CONTEXT_CATEGORIES`, so their own
     docstrings' recall intent went unmet (same class as the earlier
     `domain_knowledge` / `meeting_transcript` dead lanes).
   - **mission_retro never surfaced in /journal** — the operator's
     life-review surface never showed mission retrospectives.

The Sam report also contained a factual error (claimed `/reason` persists
nothing; `persistTrace`, `engine.ts:1158`, in fact writes `reasoning_trace`),
corrected here.

## Decision

### 1. Write-time `embedding_vec_1536` dual-write (the keystone)

`writePgvectorColumn` now writes both columns in one path: the proven
`embedding_vec` UPDATE is left byte-identical, and an **isolated** second
UPDATE pads the vector to 1536 dims and writes `embedding_vec_1536`. The
isolation (own try/catch) guarantees a missing column or dim mismatch can
never regress the already-committed `embedding_vec` write.

Padding is **cosine-preserving**: zero-padding both operands leaves the
dot product and both magnitudes unchanged, so `cos(pad(a), pad(b)) ==
cos(a, b)` exactly — the invariant that lets sub-1536 embeddings (the HF
multilingual path is 1024-dim) share a `vector(1536)` HNSW column with
native-1536 vectors. Extracted as `padToVectorDim` in `pgvector.ts` and
pinned by `tests/db/pgvector-pad.test.ts` (exact-cosine + ranking
preservation). This mirrors the existing convention in
`memory-recall.ts` `padToTargetDim` and `scripts/backfill-hnsw-1536.ts`.

A one-time prod backfill (`backfill-hnsw-1536.ts`) lit up the existing
backlog: 1,599 rows padded, KNN HNSW top-10 confirmed at 195ms. (~1,200
older rows carry a vector but a NULL `embedding_dim` and are skipped by
the script's `embedding_dim IS NOT NULL` guard — a low-value long tail,
deferred.)

### 2. Recall dead-lane sweep · +5 `CONTEXT_CATEGORIES`

Added `board_consultation`, `weekly_review`, `mission_retro`,
`relationships_weekly_synthesis`, `gmail_outgoing` — all written via
`remember()` (embedded inline) or by the category-agnostic embed-backfill
cron, all with explicit recall intent in their own `categories.ts`
docstrings, all absent from the whitelist. `reasoning_trace` was
**deliberately excluded**: it is embedded (so the whitelist alone is not a
no-op) but is terse high-volume telemetry that would dilute the top-8
recall slots. Personal-life lanes (`preference` / `feedback` / …) were
**rejected as redundant** — already priority-injected directly into the
system prompt (`system-prompt.ts:1140`, `:698`, `:1271`), so adding them
to relevance-gated recall would double-inject.

### 3. retro→journal · `mission_retro` as a 5th feed source

`journal-feed.ts` keeps the four capture tables orthogonal and merges
them in memory; `mission_retro` BrainMemory rows are added as a 5th
source following that exact pattern (no migration). `SourceKey`,
`FeedEntry.source`, and `SOURCE_ICON` (Milestone) gain `retro` so the
entry-row + filter chips are first-class, not a blank-icon fallthrough.

### 4. Verification-driven scope reduction

Six plan items were verified already-built and **not** rebuilt;
`decision→goals` was **rejected** (would need a hand-applied prod
migration; the semantic recall shipped here already links decisions↔goals
by meaning — revisit via `metadata` JSON only if /goals ever needs a
literal "decisions for this goal" list).

## Consequences

**Net wins:**
- Every new memory is recallable immediately instead of up to 7 days
  stale — a system-wide brain-freshness fix, not just a single move.
- 5 previously-dark recall lanes now surface (board advice, weekly
  commitments, mission retros, relationship synthesis, sent-mail
  commitments).
- Mission retrospectives appear in `/journal`.
- Net code added is small + additive; no schema migration.

**Verified already-built (NOT rebuilt — would have been wasted effort):**
- goals↔missions → `Mission.lifeGoalId` FK (`schema.prisma:256`, indexed)
- reflections panel → `/journal` feed (source:reflection) + `ReflectComposer`
- body-state reflectback → `proactive-pushes.ts:162` (evening push) +
  `morning-brief.ts:561` (wellbeing slice)
- content-draft-writer → full `/content/drafts` surface
- suggestion-outcome-loop → `lib/brain/outcome-tracker.ts` (closed loop)

**Deferred / rejected:**
- `decision→goals` FK migration — rejected (semantic recall covers it)
- personal-life recall lanes — rejected (already priority-injected)
- `embedding_dim`-NULL long tail (~1,200 rows recall-dark until re-embed)

**Operating principles applied:**
- *karpathy* — verify every load-bearing claim against real code, not the
  plan doc; the adversarial re-check caught both a self-authored error and
  the buried landmine.
- *kaizen* — smallest surgical edit; the `_1536` write is isolated so it
  cannot regress the proven `embedding_vec` path.
- *database-architect* — additive vector write, no migration; the prod
  backfill is non-destructive (NULL→value only) + self-verifying via
  before/after row counts.

**Meta-lesson:** the value of this pass was not building the headline
features — it was *catching the silent failures beneath them* and *not*
burning effort on six things that already existed. Feature lists hide
both.

## Verification

- `pnpm --dir apps/statenour run typecheck` clean across all ships
- Focused suite green: `tests/db/pgvector-pad.test.ts` 9/9 + 104
  journal/recall/pgvector/memory tests pass · no regression from the 5th
  journal source or the new recall lanes
- All 4 commits on `origin/main` (`d535550c` → `b48c6e8a`); pre-push
  turbo build passed on every push
- Prod backfill ran · 1,599 rows padded · KNN HNSW 195ms confirmed
