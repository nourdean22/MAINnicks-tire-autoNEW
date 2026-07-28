/**
 * BrainMemoryManager tests · v10.0.529.106 · Wave 54
 *
 * The remember/reinforce/decay lifecycle is the brain's core
 * primitive · hundreds of callers depend on it. This file pins
 * the lifecycle invariants so future changes can't silently:
 *   · skip the deprecated-category rewrite (would scatter rows
 *     across legacy names)
 *   · skip the wisdom-quality gate (would dilute the 3-slot
 *     wisdom budget in chat recall)
 *   · forget to promote on 3rd sighting (would expire rows that
 *     are actually being reinforced)
 *   · forget to decay stale rows (would let dead memories pile up)
 *
 * Scope kept narrow: remember (new + dedupe), reinforce (counter
 * bump + promotion), confirm/contradict/forget (audit semantics).
 * The recall path is queried via raw findMany already · trust the
 * generated client there.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  brainMemory: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  storeMemoryEmbedding: vi.fn().mockResolvedValue(undefined),
  softDelete: vi.fn().mockResolvedValue({}),
  restore: vi.fn().mockResolvedValue({}),
  canonicalCategory: vi.fn((c: string) => c),
  isKnownCategory: vi.fn(() => true),
  DEPRECATED_CATEGORY_MAP: { skills: "skill" } as Record<string, string>,
  gateWisdom: vi.fn(() => ({ pass: true })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { brainMemory: mocks.brainMemory },
}));
vi.mock("@/lib/brain/embedding-utils", () => ({
  storeMemoryEmbedding: mocks.storeMemoryEmbedding,
}));
vi.mock("@/lib/db/soft-delete", () => ({
  softDelete: mocks.softDelete,
  restore: mocks.restore,
}));
vi.mock("@/lib/brain/categories", () => ({
  canonicalCategory: mocks.canonicalCategory,
  isKnownCategory: mocks.isKnownCategory,
  DEPRECATED_CATEGORY_MAP: mocks.DEPRECATED_CATEGORY_MAP,
}));
vi.mock("@/lib/brain/wisdom-quality-gate", () => ({
  gateWisdom: mocks.gateWisdom,
}));

import { BrainMemoryManager } from "@/lib/brain/memory-manager";

describe("BrainMemoryManager.remember", () => {
  let mm: BrainMemoryManager;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isKnownCategory.mockReturnValue(true);
    mocks.gateWisdom.mockReturnValue({ pass: true });
    mm = new BrainMemoryManager();
  });

  it("creates a new memory at confidence 0.5 with a 24h expiry", async () => {
    mocks.brainMemory.findUnique.mockResolvedValueOnce(null);
    mocks.brainMemory.create.mockResolvedValueOnce({
      id: "m1",
      category: "insight",
      key: "k1",
      content: "x",
      confidence: 0.5,
    });

    const before = Date.now();
    await mm.remember("insight", "k1", "x", "test");
    const after = Date.now();

    const createArgs = mocks.brainMemory.create.mock.calls[0][0];
    expect(createArgs.data.confidence).toBe(0.5);
    const exp = createArgs.data.expiresAt as Date;
    expect(exp.getTime()).toBeGreaterThanOrEqual(before + 24 * 3600_000 - 50);
    expect(exp.getTime()).toBeLessThanOrEqual(after + 24 * 3600_000 + 50);
  });

  it("rewrites a deprecated category to its canonical form before write", async () => {
    mocks.brainMemory.findUnique.mockResolvedValueOnce(null);
    mocks.brainMemory.create.mockResolvedValueOnce({ id: "m2" });

    await mm.remember("skills", "key", "content", "source");
    const args = mocks.brainMemory.create.mock.calls[0][0];
    expect(args.data.category).toBe("skill");
  });

  it("redirects vague wisdom writes to wisdom_candidate when the gate rejects", async () => {
    mocks.gateWisdom.mockReturnValueOnce({
      pass: false,
      reason: "too_vague",
      detail: "meta phrasing detected",
    });
    mocks.brainMemory.findUnique.mockResolvedValueOnce(null);
    mocks.brainMemory.create.mockResolvedValueOnce({ id: "m3" });

    await mm.remember("wisdom", "k", "be excellent", "auto_extracted");
    const args = mocks.brainMemory.create.mock.calls[0][0];
    expect(args.data.category).toBe("wisdom_candidate");
    expect(args.data.metadata.gateReject).toBe("too_vague");
    expect(args.data.metadata.originalCategory).toBe("wisdom");
  });

  it("bypasses the wisdom gate for operator-trusted sources", async () => {
    mocks.brainMemory.findUnique.mockResolvedValueOnce(null);
    mocks.brainMemory.create.mockResolvedValueOnce({ id: "m4" });

    await mm.remember("wisdom", "k", "anything", "manual");
    expect(mocks.gateWisdom).not.toHaveBeenCalled();
    const args = mocks.brainMemory.create.mock.calls[0][0];
    expect(args.data.category).toBe("wisdom");
  });

  it("reinforces an existing memory instead of duplicating", async () => {
    mocks.brainMemory.findUnique.mockResolvedValueOnce({
      id: "existing-id",
      category: "insight",
      key: "k",
      confidence: 0.6,
      seenCount: 1,
    });
    mocks.brainMemory.findUniqueOrThrow.mockResolvedValueOnce({
      id: "existing-id",
      category: "insight",
      key: "k",
      confidence: 0.6,
      seenCount: 1,
    });
    mocks.brainMemory.update.mockResolvedValueOnce({ id: "existing-id" });

    await mm.remember("insight", "k", "new content", "test");
    expect(mocks.brainMemory.create).not.toHaveBeenCalled();
    expect(mocks.brainMemory.update).toHaveBeenCalledOnce();
  });
});

describe("BrainMemoryManager.reinforce", () => {
  let mm: BrainMemoryManager;
  beforeEach(() => {
    vi.clearAllMocks();
    mm = new BrainMemoryManager();
  });

  it("bumps confidence by 0.1 and seenCount by 1", async () => {
    mocks.brainMemory.findUniqueOrThrow.mockResolvedValueOnce({
      id: "m",
      category: "insight",
      key: "k",
      confidence: 0.5,
      seenCount: 1,
    });
    mocks.brainMemory.update.mockResolvedValueOnce({ id: "m" });

    await mm.reinforce("m");
    const args = mocks.brainMemory.update.mock.calls[0][0];
    expect(args.data.seenCount).toBe(2);
    expect(args.data.confidence).toBe(0.6);
    // 2nd sighting · not yet promoted to permanent.
    expect(args.data.expiresAt).toBeUndefined();
  });

  it("caps confidence at 1.0", async () => {
    mocks.brainMemory.findUniqueOrThrow.mockResolvedValueOnce({
      id: "m",
      category: "insight",
      key: "k",
      confidence: 0.97,
      seenCount: 5,
    });
    mocks.brainMemory.update.mockResolvedValueOnce({ id: "m" });

    await mm.reinforce("m");
    const args = mocks.brainMemory.update.mock.calls[0][0];
    expect(args.data.confidence).toBe(1.0);
  });

  it("promotes to permanent on the 3rd sighting (clears expiresAt)", async () => {
    mocks.brainMemory.findUniqueOrThrow.mockResolvedValueOnce({
      id: "m",
      category: "insight",
      key: "k",
      confidence: 0.7,
      seenCount: 2,
    });
    mocks.brainMemory.update.mockResolvedValueOnce({ id: "m" });

    await mm.reinforce("m");
    const args = mocks.brainMemory.update.mock.calls[0][0];
    expect(args.data.seenCount).toBe(3);
    expect(args.data.expiresAt).toBeNull();
  });

  it("updates content when newContent provided + re-embeds", async () => {
    mocks.brainMemory.findUniqueOrThrow.mockResolvedValueOnce({
      id: "m",
      category: "insight",
      key: "k",
      confidence: 0.5,
      seenCount: 1,
    });
    mocks.brainMemory.update.mockResolvedValueOnce({
      id: "m",
      category: "insight",
      key: "k",
    });

    await mm.reinforce("m", "fresher phrasing");
    const args = mocks.brainMemory.update.mock.calls[0][0];
    expect(args.data.content).toBe("fresher phrasing");
    expect(mocks.storeMemoryEmbedding).toHaveBeenCalledWith(
      "m",
      "[insight] k: fresher phrasing",
    );
  });
});

describe("BrainMemoryManager.confirm / forget / contradict", () => {
  let mm: BrainMemoryManager;
  beforeEach(() => {
    vi.clearAllMocks();
    mm = new BrainMemoryManager();
  });

  it("confirm() pins confidence at 1.0 + clears expiry + marks source manual", async () => {
    mocks.brainMemory.update.mockResolvedValueOnce({ id: "m" });
    await mm.confirm("m");
    const args = mocks.brainMemory.update.mock.calls[0][0];
    expect(args.data.confidence).toBe(1.0);
    expect(args.data.expiresAt).toBeNull();
    expect(args.data.source).toBe("manual");
  });

  it("forget() routes through softDelete, not hard delete", async () => {
    await mm.forget("m");
    expect(mocks.softDelete).toHaveBeenCalledWith("brainMemory", { id: "m" });
    expect(mocks.brainMemory.delete).not.toHaveBeenCalled();
  });

  it("purge() does hard-delete (the GDPR / stale-purger path)", async () => {
    mocks.brainMemory.delete.mockResolvedValueOnce({ id: "m" });
    await mm.purge("m");
    expect(mocks.brainMemory.delete).toHaveBeenCalledWith({ where: { id: "m" } });
  });

  it("contradict() decrements confidence by 0.2, MERGES metadata and appends the event", async () => {
    // Spine-3: contradict now reads existing metadata first — pre-fix it
    // REPLACED the whole object, discarding provenance and keeping only
    // the latest contradiction.
    mocks.brainMemory.findUniqueOrThrow.mockResolvedValueOnce({
      metadata: { provenance: "journal", contradictionEvents: [{ evidence: "old", at: "2026-01-01" }] },
    });
    mocks.brainMemory.update.mockResolvedValueOnce({ id: "m" });
    await mm.contradict("m", "ran the experiment, got the opposite result");
    const args = mocks.brainMemory.update.mock.calls[0][0];
    expect(args.data.confidence).toEqual({ decrement: 0.2 });
    expect(args.data.metadata.contradicted).toBe(true);
    expect(args.data.metadata.contradiction).toBe(
      "ran the experiment, got the opposite result",
    );
    // provenance survives; the event APPENDS instead of replacing
    expect(args.data.metadata.provenance).toBe("journal");
    expect(args.data.metadata.contradictionEvents).toHaveLength(2);
    expect(args.data.metadata.contradictionEvents[1].evidence).toContain("opposite result");
  });
});
