/**
 * CANARY · reinforce() must never write `metadata`.
 *
 * WHY THIS FILE EXISTS SEPARATELY. lib/brain/blind-spot-identity.ts rests
 * entirely on this property: a stable memory key preserves the operator's
 * `discoveryVerdict` ONLY because a re-sighting goes through reinforce(), which
 * writes seenCount / confidence / lastSeen / expiresAt / content and nothing
 * else. Adversarial review pointed out that blind-spot-identity.test.ts mocks
 * the whole memory-manager module and merely RESTATES that assumption in its
 * fake — add a metadata write to reinforce() tomorrow and that suite stays
 * green while every verdict in the system starts getting clobbered.
 *
 * This pins the REAL function against a mocked prisma instead.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findUniqueOrThrow: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      findUniqueOrThrow: mocks.findUniqueOrThrow,
      update: mocks.update,
    },
  },
}));
vi.mock("@/lib/brain/embeddings", () => ({ storeMemoryEmbedding: vi.fn() }));

import { brainMemory } from "@/lib/brain/memory-manager";

const stored = {
  id: "m1",
  category: "blind_spot",
  key: "blindspot_personal_abc",
  content: "[HIGH] old text",
  confidence: 0.5,
  seenCount: 1,
  metadata: { discoveryVerdict: "noise", discoveryVerdictSeverityRank: 2 },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUniqueOrThrow.mockResolvedValue({ ...stored });
  mocks.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...stored,
    ...data,
  }));
});

describe("reinforce() metadata invariant", () => {
  it("does NOT include `metadata` in its update payload — full-bump path", async () => {
    await brainMemory.reinforce("m1", "[HIGH] new text");
    const payload = mocks.update.mock.calls[0][0].data;
    expect(Object.keys(payload)).not.toContain("metadata");
  });

  it("does NOT include `metadata` on the no-bump path the gateway uses", async () => {
    // memory-manager.ts:424 — an equal-strength source that CHANGED the claim.
    // This is the path a nightly blind-spot re-detect actually takes.
    await brainMemory.reinforce("m1", "[HIGH] new text", { bumpConfidence: false });
    const payload = mocks.update.mock.calls[0][0].data;
    expect(Object.keys(payload)).not.toContain("metadata");
  });

  it("writes exactly the fields blind-spot-identity.ts assumes it writes", async () => {
    await brainMemory.reinforce("m1", "[HIGH] new text");
    const payload = mocks.update.mock.calls[0][0].data;
    for (const k of Object.keys(payload)) {
      expect(["seenCount", "confidence", "lastSeen", "expiresAt", "content"]).toContain(k);
    }
  });

  it("the no-bump path does NOT advance seenCount — so promotion is unreachable", async () => {
    // This is WHY persistBlindSpot has to clear expiresAt itself: reinforce()
    // only nulls the probationary expiry at seenCount >= 3 AND bumpConfidence,
    // and the gateway never gives it either.
    await brainMemory.reinforce("m1", "[HIGH] new text", { bumpConfidence: false });
    const payload = mocks.update.mock.calls[0][0].data;
    expect(payload.seenCount).toBe(stored.seenCount);
    expect(payload.expiresAt).toBeUndefined();
  });
});
