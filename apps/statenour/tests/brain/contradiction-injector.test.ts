/**
 * v10.0.526 · Arc B Feature 5 · Proactive Contradiction Surfacing.
 *
 * Locks in the four critical behaviors of findRelevantContradictions:
 *   1. MATCH       — high-similarity unresolved hit returns the row
 *   2. NO MATCH    — sub-threshold similarity returns null
 *   3. DISMISSED   — resolved/dismissed rows are filtered out
 *   4. IDEMPOTENT  — same convo + day + key returns null on second call
 *
 * The injector is on the chat hot path. False positives or duplicate
 * surfacing burn operator trust; sub-threshold misses are tolerable
 * (the row stays available via the /brain dashboard surface). Tests
 * keep the failure mode on the silent side.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/ai/provider", () => ({
  getEmbedding: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { getEmbedding } from "@/lib/ai/provider";
import { findRelevantContradictions } from "@/lib/brain/contradiction-injector";

const USER_MESSAGE = "I want to hire that second tech this month";
const NEW_EXCERPT = "Hiring the second technician is the right call";
const OLD_EXCERPT = "I'm not hiring anyone else this year. Cash is too tight.";

function makeUnresolvedRow(overrides: Record<string, unknown> = {}) {
  return {
    key: "abc123",
    content: JSON.stringify({
      new_memory_id: "mem-new",
      old_memory_id: "mem-old",
      similarity: 0.85,
      signal: "negation",
      new_excerpt: NEW_EXCERPT,
      old_excerpt: OLD_EXCERPT,
      days_apart: 32,
      surfaced_at: new Date().toISOString(),
      status: "unresolved",
      ...overrides,
    }),
    createdAt: new Date(Date.now() - 32 * 86400_000),
  };
}

const SAME_DIRECTION_EMBEDDING = [1, 0, 0, 0];
const ORTHOGONAL_EMBEDDING = [0, 1, 0, 0];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findRelevantContradictions", () => {
  it("MATCH · returns the contradiction when user message cosine-matches above 0.7", async () => {
    (prisma.brainMemory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeUnresolvedRow(),
    ]);
    (prisma.brainMemory.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.brainMemory.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "log" });
    // First call embeds the user message; second call embeds the
    // contradiction's combined excerpt. Both same direction → cosine 1.
    (getEmbedding as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(SAME_DIRECTION_EMBEDDING)
      .mockResolvedValueOnce(SAME_DIRECTION_EMBEDDING);

    const hit = await findRelevantContradictions({
      userMessage: USER_MESSAGE,
      conversationId: "conv-1",
    });

    expect(hit).not.toBeNull();
    expect(hit?.key).toBe("abc123");
    expect(hit?.newExcerpt).toBe(NEW_EXCERPT);
    expect(hit?.oldExcerpt).toBe(OLD_EXCERPT);
    expect(hit?.daysApart).toBe(32);
    expect(hit?.similarity).toBeGreaterThanOrEqual(0.7);
    // Dedup marker written so a follow-up call in the same convo
    // doesn't re-fire.
    expect(prisma.brainMemory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          category: "contradiction_injection_log",
        }),
      }),
    );
  });

  it("NO MATCH · returns null when cosine similarity is below 0.7 threshold", async () => {
    (prisma.brainMemory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeUnresolvedRow(),
    ]);
    (prisma.brainMemory.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    // Orthogonal embeddings → cosine 0 → far below threshold.
    (getEmbedding as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(SAME_DIRECTION_EMBEDDING)
      .mockResolvedValueOnce(ORTHOGONAL_EMBEDDING);

    const hit = await findRelevantContradictions({
      userMessage: "tell me about cars",
      conversationId: "conv-2",
    });

    expect(hit).toBeNull();
    expect(prisma.brainMemory.create).not.toHaveBeenCalled();
  });

  it("DISMISSED RESPECTED · skips contradictions whose status is not 'unresolved'", async () => {
    // Two rows: one dismissed (recent), one would-match. The dismissed
    // one must be filtered out BEFORE the embedding step (which the
    // implementation does to save the Venice round-trip on dead rows).
    const dismissedRow = makeUnresolvedRow({
      status: "dismissed",
      resolved_at: new Date(Date.now() - 5 * 86400_000).toISOString(),
    });
    (prisma.brainMemory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      dismissedRow,
    ]);
    (prisma.brainMemory.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    // getEmbedding should never be called for the user message because
    // all candidates were filtered out. The implementation embeds the
    // user message once after filtering, but only if candidates remain.
    (getEmbedding as ReturnType<typeof vi.fn>).mockResolvedValue(SAME_DIRECTION_EMBEDDING);

    const hit = await findRelevantContradictions({
      userMessage: USER_MESSAGE,
      conversationId: "conv-3",
    });

    expect(hit).toBeNull();
    expect(prisma.brainMemory.create).not.toHaveBeenCalled();
  });

  it("IDEMPOTENT · returns null when the same contradiction was already surfaced today in this conversation", async () => {
    (prisma.brainMemory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeUnresolvedRow(),
    ]);
    // findUnique returns a pre-existing dedup log row → already surfaced.
    (prisma.brainMemory.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "existing-log",
    });
    (getEmbedding as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(SAME_DIRECTION_EMBEDDING)
      .mockResolvedValueOnce(SAME_DIRECTION_EMBEDDING);

    const hit = await findRelevantContradictions({
      userMessage: USER_MESSAGE,
      conversationId: "conv-4",
    });

    expect(hit).toBeNull();
    // Critical: no NEW dedup row written because we're suppressing,
    // not re-marking.
    expect(prisma.brainMemory.create).not.toHaveBeenCalled();
  });

  // Unit-length so its cosine against SAME_DIRECTION_EMBEDDING ([1,0,0,0])
  // is exactly 0.65: below the 0.7 default, above a 0.6 override.
  const BELOW_DEFAULT_ABOVE_LOWERED_THRESHOLD_EMBEDDING = [0.65, 0.7599341943872264, 0, 0];

  it("similarityThreshold override (2026-09-17, NICK_CORRECTION_THRESHOLD_BOOST) · a ~0.65 hit misses the 0.7 default and is caught when the caller lowers the bar", async () => {
    (prisma.brainMemory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeUnresolvedRow(),
    ]);
    (prisma.brainMemory.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.brainMemory.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "log" });

    (getEmbedding as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(SAME_DIRECTION_EMBEDDING)
      .mockResolvedValueOnce(BELOW_DEFAULT_ABOVE_LOWERED_THRESHOLD_EMBEDDING);
    const missedAtDefault = await findRelevantContradictions({
      userMessage: USER_MESSAGE,
      conversationId: "conv-5",
    });
    expect(missedAtDefault).toBeNull();

    // Same ~0.65 pair; caller passes the exact override
    // NICK_CORRECTION_THRESHOLD_BOOST sends (brain-context.ts) — now it hits.
    (getEmbedding as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(SAME_DIRECTION_EMBEDDING)
      .mockResolvedValueOnce(BELOW_DEFAULT_ABOVE_LOWERED_THRESHOLD_EMBEDDING);
    const hitWithBoost = await findRelevantContradictions({
      userMessage: USER_MESSAGE,
      conversationId: "conv-6",
      similarityThreshold: 0.6,
    });
    expect(hitWithBoost).not.toBeNull();
    expect(hitWithBoost?.key).toBe("abc123");
    expect(hitWithBoost?.similarity).toBeCloseTo(0.65, 6);
  });

  it("similarityThreshold is ignored when non-finite (garbage tolerance — falls back to the 0.7 default)", async () => {
    (prisma.brainMemory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeUnresolvedRow(),
    ]);
    (prisma.brainMemory.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (getEmbedding as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(SAME_DIRECTION_EMBEDDING)
      .mockResolvedValueOnce(BELOW_DEFAULT_ABOVE_LOWERED_THRESHOLD_EMBEDDING);

    const hit = await findRelevantContradictions({
      userMessage: USER_MESSAGE,
      conversationId: "conv-7",
      similarityThreshold: NaN,
    });
    expect(hit).toBeNull();
  });
});
