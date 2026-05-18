# ADR-0013 · /journal pattern-radar · convergence detection → named threads

> **Status**: Accepted · APPLIED to Neon prod 2026-05-18 · radar fully live
> **Date**: 2026-05-18 · brainstorming locked Q1–Q5 + Understanding Lock confirmed
> **Decision drivers**: operator diagnosed two pains · (a) metacognition
> card is inert, (b) chronological feed is flat with no synthesis ·
> wanted "Pattern Radar" paradigm: quiet by default, fires only on signal

---

## Context

The /journal page (712 LOC client + 238 LOC API) already merges 4
sources into a chronological day-grouped feed: BrainDump (chat /
Telegram / manual capture), Reflection (nightly cron), SituationLog
(War Room), DecisionReplay (reviewed decisions). It surfaces a
nightly metacognition card from `BrainMemory(category="metacognition")`.

Two diagnosed weaknesses:

1. **Metacognition is shown but inert** · the nightly self-assessment
   surfaces `weakSpots`, `stagnationAlert`, calibration scores · they
   sit there · they don't become tasks, goals, chat seeds, or
   anything actionable.

2. **Feed is chronologically flat** · every entry has equal weight
   · no theme detection · no longitudinal structure ("how my
   thinking on X evolved") · no flagging of patterns.

Net: thoughts go in, nothing comes back out as insight.

## Decision

Add a **Pattern Radar** layer on top of /journal that detects
**convergence** (multiple recent entries pointing at the same
emerging unified theme) and lets the operator name + pin the
cluster as a **living thread**.

### Pattern types in scope

| Pattern | Status | Why |
|---|---|---|
| **CONVERGENCE** | ACCEPTED | Operator-chosen · generative ("something is coalescing") not diagnostic |
| Contradiction | REJECTED | Operator explicitly out of scope Q3 |
| Stagnation | REJECTED | Operator explicitly out of scope Q3 |
| Avoidance | REJECTED | Operator explicitly out of scope Q3 |

### UX paradigm

`Pattern Radar` (Q2 lock):
- Quiet by default · zero push notifications
- Inline only on /journal page (Q5 lock)
- Alert appears at top of /journal when convergence fires
- Below: existing metacognition card stays · chronological feed stays
- Operator opens /journal on their own cadence · alerts surface there

### Action on fire (Q4 lock)

`Thread` · operator names the converging cluster · it becomes a
pinned `JournalThread` at top of /journal · future entries scored
above similarity threshold auto-join the thread.

NOT chat-seed, NOT goal promotion, NOT multi-action chooser.

### Detection algorithm

1. **Nightly cron** (Inngest · 10pm UTC · after morning brief at 10am)
   - Pull all journal entries from last 14 days across all 4 sources
   - Get embeddings from `VectorEmbedding(sourceType, sourceId)` ·
     compute + write missing ones via Ollama nomic-embed-text or
     Venice (existing fallback chain in `lib/ai/embed.ts`)
   - Cluster via cosine similarity (in-memory · small N: at most
     ~200 entries in a 14-day window)
   - For each cluster: average pairwise cosine ≥ `0.75` and member
     count ≥ `3` → candidate
   - Filter out: members already belonging to an existing active
     thread (don't re-detect what's named)
   - Persist candidates to `BrainMemory(category="journal_convergence_candidate", key=<cluster-hash>)`
   - Call Mastra agent to generate 3 short noun-phrase name suggestions
     per candidate · store in `metadata.nameSuggestions`

2. **Operator confirmation flow** (UI-driven)
   - /journal page reads candidates · renders `ThreadRadar` card
   - Each card shows: cluster preview (3 representative excerpts) +
     3 Nick-suggested names + free-text "name your own" + dismiss
   - Confirm → `POST /api/journal/threads` → creates
     `JournalThread` + `JournalThreadEntry` rows (`joinMode="seed"`)
     → deletes the BrainMemory candidate row

3. **Auto-join on new capture**
   - During capture (BrainDump.create · Reflection.write · etc.)
     a post-hook computes the new entry's cosine to each active
     thread's centroid
   - ≥ `0.80`: auto-join (`joinMode="auto"`)
   - `0.65` - `0.80`: write to `BrainMemory(category="journal_thread_suggestion")`
     → next page-visit surfaces "this belongs to thread X?"
   - < `0.65`: ignore

4. **Daily dormancy sweep** (Inngest cron)
   - Threads with no `lastJoinAt` activity in 30+ days → mark
     `status="dormant"` · not deleted, just hidden from primary
     thread rail · visible in collapsed "Dormant threads" section

### Schema (Prisma)

```prisma
model JournalThread {
  id           String                @id @default(cuid())
  name         String                // operator-named
  summary      String?               @db.Text  // 1-line synthesis of theme
  status       String                @default("active")  // active | dormant | archived
  coherence    Float?                // last computed avg cluster cosine
  detectedAt   DateTime              // when convergence first fired
  namedAt      DateTime              // when operator confirmed
  lastJoinAt   DateTime?             // most recent membership join
  centroid     String?               @db.Text  // JSON-encoded cached centroid (vector-DB audit fix)
  memberCount  Int                   @default(0)  // rolling-avg denominator for incremental centroid update
  createdAt    DateTime              @default(now())
  updatedAt    DateTime              @updatedAt
  deletedAt    DateTime?
  memberships  JournalThreadEntry[]

  @@index([status])
  @@index([lastJoinAt])
  @@index([deletedAt])
  @@map("journal_threads")
}

model JournalThreadEntry {
  id           String        @id @default(cuid())
  threadId     String
  entrySource  String        // brain_dump | reflection | situation_log | decision_replay
  entryId      String        // FK into source table (polymorphic by entrySource)
  similarity   Float         // cosine sim at time of join
  joinedAt     DateTime      @default(now())
  joinMode     String        // seed | auto | operator
  thread       JournalThread @relation(fields: [threadId], references: [id], onDelete: Cascade)

  @@unique([threadId, entrySource, entryId])
  @@index([threadId])
  @@index([entrySource, entryId])
  @@map("journal_thread_memberships")
}
```

Polymorphic `entrySource + entryId` is acceptable here because:
- The set of entry sources is small and bounded (4 today, no growth planned)
- The existing /api/journal already does the same polymorphic merge in its feed handler
- A proper FK per source would mean 4 join tables for no real benefit (YAGNI)

### Migration

Parked at `apps/statenour/prisma/migrations-pending/0002_journal_threads/`
per WAVE-200-PLAN non-negotiable #1. Operator applies via Neon SQL
editor when ready.

### Threshold defaults (Open Questions resolution)

| Question | Default | Rationale |
|---|---|---|
| Cluster cohesion threshold | `≥ 0.75` avg pairwise cosine | Conservative · lets through real themes, blocks noise |
| Minimum cluster size | `≥ 3` entries | <3 isn't a "convergence", it's coincidence |
| Detection window | 14 days | Long enough to catch slow themes, short enough to feel fresh |
| Cadence | Nightly cron 10pm UTC | After morning brief, before next-day visit |
| Auto-join similarity | ≥ 0.80 | Silent join must be high-confidence |
| Suggest threshold | 0.65 – 0.80 | Operator confirms ambiguous membership |
| Dormancy threshold | 30 days no joins | Matches goal pruner discipline (ADR-0010) |
| Name suggestion count | 3 | Enough variety without choice paralysis |

All thresholds tunable via env vars: `JOURNAL_CONVERGENCE_*`
(future tightening without redeploy).

### Performance · vector-database-engineer audit (added 2026-05-18)

A vector-DB lens audit during build caught one real gap: the original
`scoreEntryAgainstActiveThreads()` re-fetched every member's vector
from `VectorEmbedding` on every capture write (N members × M threads
round-trip per capture). Fix: cache the centroid on the thread row
(`centroid String? @db.Text` + `memberCount Int`), update incrementally
via `rollCentroid()` (`new = (old·n + vec)/(n+1)` · O(d) per join, no
full recompute). Score path now does ONE `findMany` over threads, no
member fan-out. Catch-then-fix preserved in the migration + schema.

Other audit results: chunking deferred (full-doc embedding is correct
for cross-entry theme detection); HNSW index already in place via
`scripts/add-hnsw-index.ts` (v10.0.90); dimension mismatch is silently
skipped (matches existing `clusterMemories` discipline); embedding
model choice (768-dim nomic via provider chain) is within the
384-1536 sweet spot for short-form text.

## Rejected alternatives

### Real-time push (Telegram / VAPID) on convergence fire
Operator explicitly chose "Inline only" in Q5 · push noise was the
exact failure mode the operator wanted to avoid. Future operator
override possible by adding a `JOURNAL_RADAR_PUSH=true` env flag.

### Morning brief inclusion
Same reason as above · operator wants to discover threads when they
choose to open /journal, not be reminded daily.

### Replace metacognition card with thread radar
Operator picked "keep both" implicitly · metacognition and threads
serve different needs (metacog = nightly self-assessment, threads =
emerging theme detection). Both rise above the feed.

### Goal promotion on fire (theme becomes LifeGoal)
Rejected in Q4 · conflates two surfaces · if a thread feels
goal-worthy, operator can manually promote later (out of scope today).

### Chat-seed flow on fire (open /chat pre-loaded with cluster)
Rejected in Q4 · operator preferred direct naming on /journal page
· conversational flow felt indirect.

### Polymorphic entries via 4 separate join tables
Cleaner FK but 4x the surface area · YAGNI for 4 bounded source types
· `entrySource + entryId` is the right size for the problem.

### Third-party clustering / scoring (OpenAI · Cohere Rerank)
Rejected on privacy + cost grounds · pgvector already shipped ·
in-memory cosine on ~200 entries is sub-100ms.

## Consequences

### Positive
- The journal becomes a self-organizing surface · emerging themes
  rise above the chronological substrate without operator effort
- Metacognition + thread radar coexist · different cognitive lenses
- Threads are addressable · future surfaces (chat, voice, mastery)
  can reference `thread:<id>` for context
- Pgvector + Mastra (already shipped) carry the load · zero new
  framework adoption
- Clean rollback · drop two tables · disable cron · page falls
  back to today's behavior

### Negative
- New schema migration (parked per discipline · operator applies)
- Auto-join hook adds ~50ms latency to capture writes (cosine over
  N active threads · typically <10 threads at any time)
- False positive risk · dismissed candidates re-fire if entries
  keep matching the cluster · mitigated by recording dismissed
  cluster-hashes for 30 days

### Neutral
- Existing feed unchanged · capture flows unchanged · deep-link
  `#bd-<id>` unchanged
- Metacognition card stays exactly as-is

## Operator action items

1. ~~Apply parked migration~~ — APPLIED 2026-05-18 via Neon SQL editor
2. ~~Verify Inngest dashboard shows two new functions~~ — Inngest PUT
   sync returned `modified:true` post-deploy · functions registered
3. Wait for first nightly cron run (22:00 UTC = 6pm ET) · visit
   /journal next day · if convergence fires, name first thread

## Decision log

| # | Decision | Why |
|---|---|---|
| 1 | UX = Pattern Radar (not briefing / dashboard / chat partner) | Q2 · quiet operator-instrument fits power+control aesthetic |
| 2 | Fire on CONVERGENCE only | Q3 · generative > diagnostic |
| 3 | Action = Thread (not goal / chat-seed) | Q4 · keeps journal self-contained |
| 4 | Channel = Inline only (no push / brief / chat raise) | Q5 · zero noise |
| 5 | Threshold 3+ / 14d / ≥0.75 | Conservative defaults · tunable via env |
| 6 | Polymorphic membership (entrySource + entryId) | YAGNI · 4 sources, bounded |
| 7 | Nightly cron + cached snapshot on page open | Inline-only doesn't need real-time |
| 8 | Mastra agent for 3 name suggestions | Reuse AGENT_V2 substrate |
| 9 | Pgvector for clustering | Already shipped · zero new infra |
| 10 | 30-day dormancy auto-archive | Matches goal pruner discipline |

## References

- `docs/adr/0010-goals-page-merge.md` · sibling Phase A.1 work
- `docs/adr/0012-mission-lifegoal-fk.md` · sibling Phase A.3 work
- `docs/WAVE-200-PLAN.md` non-negotiable #1 · parked migration discipline
- `apps/statenour/prisma/schema.prisma` · BrainDump / Reflection /
  SituationLog / DecisionReplay / VectorEmbedding (substrate)
- `apps/statenour/app/(mastery)/journal/page.tsx` · 712 LOC consumer
- `apps/statenour/lib/ai/embed.ts` · embedding provider chain
- `apps/statenour/src/inngest/functions/goal-pruner.ts` · dormancy pattern
- `apps/statenour/src/mastra/agents/nick.ts` · naming-suggestion agent
