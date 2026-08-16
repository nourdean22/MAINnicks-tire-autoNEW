/**
 * pgvectorSemanticSearch must not serve deleted memories.
 *
 * The path reads `vector_embeddings` with no join to `brain_memories` and takes
 * its text from the EMBEDDING row's own `content` column, so a deleted memory
 * stays fully readable through the index unless the metadata lookup drops it.
 * Before this was fixed, a hit with no live metadata survived on the
 * `confidence ?? 0.5` fallback — which is how soft-deleting a memory failed to
 * remove it from Nick's context. Measured on prod 2026-08-16: 74.5% of the
 * searchable brain_memory index pointed at deleted or missing rows.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const LIVE = "mem_live";
const DELETED = "mem_deleted";
const GONE = "mem_gone";

vi.mock("@/lib/db/pgvector", () => ({
  isPgvectorAvailable: vi.fn(async () => true),
  knnSearch: vi.fn(async () => [
    { sourceType: "brain_memory", sourceId: DELETED, content: "SECRET deleted content", distance: 0.01 },
    { sourceType: "brain_memory", sourceId: GONE, content: "orphaned content", distance: 0.02 },
    { sourceType: "brain_memory", sourceId: LIVE, content: "live content", distance: 0.05 },
    { sourceType: "chat_message", sourceId: "chat_1", content: "a chat reply", distance: 0.06 },
  ]),
  assertSafeVectorLiteral: vi.fn(),
  padToVectorDim: (v: number[]) => v,
  vectorLiteral: (v: number[]) => `[${v.join(",")}]`,
}));

// Only the LIVE id comes back — the mock stands in for `deletedAt: null`.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      findMany: vi.fn(async () => [
        { id: LIVE, confidence: 0.9, createdAt: new Date(), category: "insight", seenCount: 1 },
      ]),
    },
  },
}));

vi.mock("@/lib/ai/provider", () => ({
  getEmbedding: vi.fn(async () => new Array(1024).fill(0.01)),
}));

describe("semanticSearch · deleted memories", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it("does NOT return a soft-deleted memory even when it is the closest match", async () => {
    const { semanticSearch } = await import("@/lib/brain/embedding-utils");
    const hits = await semanticSearch("anything", 10, ["brain_memory"]);
    const ids = hits.map((h) => h.sourceId);

    expect(ids).not.toContain(DELETED);
    expect(hits.map((h) => h.content).join(" ")).not.toContain("SECRET deleted content");
  });

  it("does NOT return an orphan whose memory row is gone entirely", async () => {
    const { semanticSearch } = await import("@/lib/brain/embedding-utils");
    const hits = await semanticSearch("anything", 10, ["brain_memory"]);
    expect(hits.map((h) => h.sourceId)).not.toContain(GONE);
  });

  it("still returns the live memory", async () => {
    const { semanticSearch } = await import("@/lib/brain/embedding-utils");
    const hits = await semanticSearch("anything", 10, ["brain_memory"]);
    expect(hits.map((h) => h.sourceId)).toContain(LIVE);
  });

  it("leaves non-brain_memory source types alone — they have no metadata row by design", async () => {
    const { semanticSearch } = await import("@/lib/brain/embedding-utils");
    const hits = await semanticSearch("anything", 10, ["brain_memory", "chat_message"]);
    expect(hits.map((h) => h.sourceId)).toContain("chat_1");
  });
});
