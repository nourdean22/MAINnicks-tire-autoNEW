# ADR-0006 · pgvector on Neon · Postgres-native vectors over managed DB

**Status:** Accepted
**Date adopted:** v8.x baseline (codified across the brain layer push)
**Backfilled:** 2026-05-07 (v10.0.454)

## Context

Nick's brain layer needs vector retrieval across a growing corpus:

- ~991 wisdoms (curated principles, persona packs, Greene's laws,
  reflections) at v10.0.385 — projected to grow to 5K+ as more
  domain knowledge ingests.
- Embeddings drive the 3-lane CoALA recall (ADR-0002): semantic /
  episodic / procedural lanes, each running cosine queries on
  per-row embeddings.
- The skill semantic recall layer (ADR-0007) adds 1,423 skill
  embeddings on top, with their own retrieval path.
- Per-turn budget: ≤ ~80ms wall-clock for the recall fan-out
  (3 lanes × parallel) plus Cohere reranker (~100-200ms) plus
  generation. Vector retrieval can't become the bottleneck.

The conventional wisdom in 2024 was "use a managed vector DB"
(Pinecone, Weaviate, Chroma Cloud, Qdrant, Milvus). Each of those
solves real problems: distributed sharding, sub-10ms retrieval at
1B+ scale, hybrid search, etc. None of those problems applied at
our 1K-100K embedding scale.

## Decision

Use **`pgvector` extension on Neon Postgres** with HNSW indexing.
Embeddings live in the same database as the rest of NOUR OS data,
co-located with `BrainMemory` rows that own them.

Schema shape:
```prisma
model BrainMemory {
  id        String  @id @default(cuid())
  category  String
  content   String
  embedding Json?   // pgvector type behind the Json wrapper
  // ...
}
```

The `embedding` field stores 1536-dim vectors (OpenAI
text-embedding-3-small) as `vector(1536)` with an HNSW index for
sub-10ms cosine queries up to ~100K rows. The Prisma adapter for
Neon (`@prisma/adapter-neon`) handles the wire protocol; raw SQL
is used for the `<=>` cosine operator since Prisma doesn't have
first-class vector query support.

## Consequences

**Positive:**

- **Zero new vendor.** Neon is already the OS database (cron jobs,
  brain memories, chat history, audit logs, system metrics). Adding
  embeddings to existing rows is a `prisma migrate` away, not a
  separate provisioning + auth + billing dance.
- **Co-location.** Filtering brain memories by category + recency
  THEN running cosine on the survivors is a single SQL query. With
  a managed vector DB the filter happens in Postgres, the IDs ship
  to the vector service, the vectors come back, then a second
  Postgres query hydrates the rows. Two round trips become one.
- **Cost.** 1K-100K embeddings × 1536 dims × 4 bytes ≈ 100-600 MB.
  Well within Neon's storage budget. Pinecone's free tier is
  enough but the production tier ($70/mo+) would be additional cost
  we don't need.
- **Backups + branching.** Neon's branch-and-restore covers
  embeddings automatically. Managed vector DBs need their own
  backup story.
- **Operator-grade observability.** Vector retrieval shows up in
  the same `system_metric` rows as the rest of the OS. Outages,
  slow queries, missing indexes — all observable through the
  existing dashboard.

**Negative:**

- **Scale ceiling.** HNSW on pgvector is competitive up to ~1-10M
  rows. Beyond that, sharded vector DBs win on retrieval latency.
  Not a near-term concern (we're at <5K rows of useful embeddings).
- **No first-class Prisma support.** Vector ops require raw SQL
  via `$queryRaw`. Migrations need manual `CREATE EXTENSION
  vector` + `CREATE INDEX ... USING hnsw (...)` SQL.
- **Single-region latency.** Neon serves from a primary region;
  cross-continent reads pay the WAN penalty. A managed vector DB
  with edge replicas could serve global reads faster. Not relevant
  for a single-operator personal OS.

## Alternatives considered

- **Pinecone.** Rejected on cost + co-location. The two-round-trip
  pattern (Postgres filter → Pinecone vectors → Postgres hydrate)
  measured 60-100ms in early prototyping vs <30ms for a single
  pgvector query.
- **Chroma Cloud / Qdrant Cloud.** Same trade-off as Pinecone.
  Better dev ergonomics, same architectural overhead.
- **Self-hosted Qdrant on Fly.io.** Rejected on operational cost
  (a service to babysit + monitor + backup separately). pgvector
  inherits Neon's ops story for free.
- **Weaviate.** Rejected on schema complexity (entity-relation +
  hybrid search patterns we don't need at our scale).
- **Plain Postgres without pgvector** (cosine via `cube` or pure
  array math). Rejected on perf — without HNSW, similarity search
  is O(N) scan; pgvector with HNSW is O(log N) effective.

## References

- `prisma/schema.prisma` — `BrainMemory.embedding` field
- `lib/brain/embedding.ts` — embedding generation pipeline
- `lib/brain/recall.ts` — cosine retrieval via raw SQL
- `lib/ai/context-reranker.ts` — Cohere cross-encoder layer on top
- v8.x commits introducing pgvector
- v10.0.376-381 commits adding 195 production indexes (some on the
  vector tables for the filter-then-similarity pattern)
- ADR-0002 · CoALA + 3-lane recall (consumer of pgvector)
- ADR-0007 · Skill semantic recall (sibling consumer)

## Open items

- Quantify retrieval latency at the current corpus size via
  `EXPLAIN ANALYZE`. Confirmed sub-10ms in early prototyping but
  no formal benchmark since the v10.0.376-381 index wave landed.
- Decide the cutover point if the corpus grows past 10M rows — at
  what size do we shard out to a dedicated vector DB? Probably
  never at single-operator scale, but worth a written threshold
  ("if `BrainMemory.count > X`, re-evaluate").

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.
