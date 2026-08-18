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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  brainMemory: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
  },
  storeMemoryEmbedding: vi.fn().mockResolvedValue(undefined),
  softDelete: vi.fn().mockResolvedValue({}),
  restore: vi.fn().mockResolvedValue({}),
  canonicalCategory: vi.fn((c: string) => c),
  isKnownCategory: vi.fn(() => true),
  // parkForReview() dynamically imports BRAIN_CATEGORIES for the staging
  // category — the mock must expose it or Phase-2 parking throws into its
  // own catch and the test silently passes on the wrong path.
  BRAIN_CATEGORIES: { RESEARCH_PACK: "research_pack" } as Record<string, string>,
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
  BRAIN_CATEGORIES: mocks.BRAIN_CATEGORIES,
}));
vi.mock("@/lib/brain/wisdom-quality-gate", () => ({
  gateWisdom: mocks.gateWisdom,
}));

import { BrainMemoryManager } from "@/lib/brain/memory-manager";

/**
 * The memory gateway (lib/brain/memory-manager.ts:131) fire-and-forgets a
 * shadow receipt (category "memory_gateway_shadow") through this SAME
 * brainMemory.create mock on every remember() — Phase-1 default-ON since
 * #1514, and the write is unawaited, so a prior test's receipt can land in a
 * later test's spy window after clearAllMocks. Assertions about REAL memory
 * writes must therefore filter receipts out rather than counting raw calls;
 * the kill-switch env (NICK_MEMORY_GATEWAY_PHASE1=0) would NOT help — it
 * gates only the noop verdict, not the shadow write.
 */
const realCreateCalls = () =>
  mocks.brainMemory.create.mock.calls.filter(
    ([arg]) => arg?.data?.category !== "memory_gateway_shadow",
  );

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

    const createArgs = realCreateCalls()[0][0];
    expect(createArgs.data.confidence).toBe(0.5);
    const exp = createArgs.data.expiresAt as Date;
    expect(exp.getTime()).toBeGreaterThanOrEqual(before + 24 * 3600_000 - 50);
    expect(exp.getTime()).toBeLessThanOrEqual(after + 24 * 3600_000 + 50);
  });

  it("gives one-shot record categories their TTL policy, not the 24h probation", async () => {
    // 2026-08-18 · reply_judgment keys (`judge_<messageId>`) are written
    // exactly once — the 24h-until-reinforced probation was erasing every
    // judgment within a day (witnessed: 22/200 recent replies still had
    // rows). Records take category-ttl (reply_judgment → 90d) at create.
    mocks.brainMemory.findUnique.mockResolvedValueOnce(null);
    mocks.brainMemory.create.mockResolvedValueOnce({ id: "m-judge" });

    const before = Date.now();
    await mm.remember("reply_judgment", "judge_msg1", "Score 7.4/10", "judge-eval");
    const after = Date.now();

    const exp = realCreateCalls()[0][0].data.expiresAt as Date;
    const ninetyDays = 90 * 24 * 3600_000;
    expect(exp.getTime()).toBeGreaterThanOrEqual(before + ninetyDays - 50);
    expect(exp.getTime()).toBeLessThanOrEqual(after + ninetyDays + 50);
  });

  it("rewrites a deprecated category to its canonical form before write", async () => {
    mocks.brainMemory.findUnique.mockResolvedValueOnce(null);
    mocks.brainMemory.create.mockResolvedValueOnce({ id: "m2" });

    await mm.remember("skills", "key", "content", "source");
    const args = realCreateCalls()[0][0];
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
    const args = realCreateCalls()[0][0];
    expect(args.data.category).toBe("wisdom_candidate");
    expect(args.data.metadata.gateReject).toBe("too_vague");
    expect(args.data.metadata.originalCategory).toBe("wisdom");
  });

  it("bypasses the wisdom gate for operator-trusted sources", async () => {
    mocks.brainMemory.findUnique.mockResolvedValueOnce(null);
    mocks.brainMemory.create.mockResolvedValueOnce({ id: "m4" });

    await mm.remember("wisdom", "k", "anything", "manual");
    expect(mocks.gateWisdom).not.toHaveBeenCalled();
    const args = realCreateCalls()[0][0];
    expect(args.data.category).toBe("wisdom");
  });

  it("reinforces an existing memory instead of duplicating", async () => {
    // 2026-08-16 · TWO fixes, both needed before this exercised anything.
    // (1) `content`/`source` added — without them the gateway's norm() threw
    //     on undefined and the test ran the FAIL-OPEN CATCH, not the verdict.
    // (2) category "insight" → "pattern". The gateway resolves categories via
    //     a dynamic `import("./categories")`, which bypasses this file's
    //     vi.mock and hits the REAL module — and "insight" is not a
    //     registered BRAIN_CATEGORY, so every verdict short-circuited to
    //     unknown_category before any content comparison ran.
    const existing = {
      id: "existing-id",
      category: "pattern",
      key: "k",
      content: "old content",
      source: "test",
      confidence: 0.6,
      seenCount: 1,
    };
    mocks.brainMemory.findUnique.mockResolvedValueOnce(existing);
    mocks.brainMemory.findUniqueOrThrow.mockResolvedValueOnce(existing);
    mocks.brainMemory.update.mockResolvedValueOnce({ id: "existing-id" });

    await mm.remember("pattern", "k", "new content", "test");
    // Shadow receipts are the ONLY creates allowed on the reinforce path.
    expect(realCreateCalls()).toHaveLength(0);
    expect(mocks.brainMemory.update).toHaveBeenCalledOnce();
  });
});

/**
 * Gateway Phase-2 enforcement (2026-08-16). These assert that remember()
 * ACTS on the verdict — the decision rules themselves are already pinned in
 * tests/brain/memory-commit-gateway.test.ts.
 */
describe("BrainMemoryManager · gateway Phase-2 enforcement", () => {
  let mm: BrainMemoryManager;
  const prevFlag = process.env.NICK_MEMORY_GATEWAY_PHASE2;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isKnownCategory.mockReturnValue(true);
    mocks.gateWisdom.mockReturnValue({ pass: true });
    mocks.canonicalCategory.mockImplementation((c: string) => c);
    mm = new BrainMemoryManager();
  });

  afterEach(() => {
    if (prevFlag === undefined) delete process.env.NICK_MEMORY_GATEWAY_PHASE2;
    else process.env.NICK_MEMORY_GATEWAY_PHASE2 = prevFlag;
  });

  /** Equal-strength source changed the claim → verdict "update". */
  const equalStrengthChange = () => {
    const existing = {
      id: "existing-id",
      category: "pattern",
      key: "k",
      content: "old claim",
      source: "insight-engine-a", // supported_inference
      confidence: 0.6,
      seenCount: 1,
    };
    mocks.brainMemory.findUnique.mockResolvedValueOnce(existing);
    mocks.brainMemory.findUniqueOrThrow.mockResolvedValueOnce(existing);
    mocks.brainMemory.update.mockResolvedValueOnce({ id: "existing-id" });
    // different source, SAME evidence class (both map to supported_inference)
    return mm.remember("pattern", "k", "changed claim", "insight-engine-b");
  };

  it("KILLED (=0): an equal-strength content change still bumps confidence (legacy)", async () => {
    // 2026-08-16 · Phase-2 flipped default-ON on operator instruction, so the
    // legacy path is now reached only via the explicit kill-switch. This test
    // is the rollback lever's regression guard.
    process.env.NICK_MEMORY_GATEWAY_PHASE2 = "0";
    await equalStrengthChange();
    const data = mocks.brainMemory.update.mock.calls[0][0].data;
    expect(data.confidence).toBe(0.7); // 0.6 + 0.1
    expect(data.seenCount).toBe(2);
    expect(data.content).toBe("changed claim");
  });

  it("DEFAULT (unset): an equal-strength content change takes the content WITHOUT the confidence bump", async () => {
    delete process.env.NICK_MEMORY_GATEWAY_PHASE2;
    await equalStrengthChange();
    const data = mocks.brainMemory.update.mock.calls[0][0].data;
    expect(data.confidence).toBe(0.6); // unchanged — a change is not corroboration
    expect(data.seenCount).toBe(1); // no progress toward the 3-sighting promotion
    expect(data.content).toBe("changed claim"); // but the new claim IS taken
  });

  it("DEFAULT: weaker evidence contradicting a stronger claim parks instead of overwriting", async () => {
    delete process.env.NICK_MEMORY_GATEWAY_PHASE2;
    const existing = {
      id: "existing-id",
      category: "pattern",
      key: "k",
      content: "operator's own claim",
      source: "manual", // operator_stated, strength 6
      confidence: 0.9,
      seenCount: 4,
    };
    mocks.brainMemory.findUnique.mockResolvedValueOnce(existing);
    mocks.brainMemory.upsert.mockResolvedValueOnce({ id: "parked" });

    const result = await mm.remember("pattern", "k", "a bot disagrees", "scraper");

    // The stronger claim is returned untouched — no overwrite, no bump.
    expect(result).toEqual(existing);
    expect(mocks.brainMemory.update).not.toHaveBeenCalled();
    // ...and the losing claim is parked in the EXISTING review queue.
    expect(mocks.brainMemory.upsert).toHaveBeenCalledOnce();
    const parked = mocks.brainMemory.upsert.mock.calls[0][0];
    expect(parked.create.category).toBe("research_pack");
    expect(parked.create.metadata.recordType).toBe("knowledge_candidate");
    expect(parked.create.metadata.gateDecision).toBe("review_required");
    expect(parked.create.metadata.reasonCode).toBe("weaker_evidence");
    // candidate-store refuses to promote "action"/"question" kinds.
    expect(parked.create.metadata.kind).toBe("observation");
    expect(parked.create.metadata.targetCategory).toBe("pattern");
    expect(parked.create.metadata.targetKey).toBe("k");
  });

  it("rewrites FULL review metadata when re-parking, so a previously rejected candidate is visible again", async () => {
    // The regression: the upsert's update arm only set content/deletedAt, so a
    // candidate the operator had REJECTED (metadata gateDecision "reject",
    // soft-deleted) was revived by deletedAt:null but kept the old verdict.
    // listPendingKnowledgeCandidates() filters on gateDecision ===
    // "review_required", so the re-parked claim stayed invisible while this
    // module logged memory_gateway_parked as though it were queued.
    delete process.env.NICK_MEMORY_GATEWAY_PHASE2;
    const existing = {
      id: "existing-id",
      category: "pattern",
      key: "k",
      content: "operator's own claim",
      source: "manual",
      confidence: 0.9,
      seenCount: 4,
    };
    mocks.brainMemory.findUnique.mockResolvedValueOnce(existing);
    mocks.brainMemory.upsert.mockResolvedValueOnce({ id: "parked" });

    await mm.remember("pattern", "k", "a bot disagrees", "scraper");

    const call = mocks.brainMemory.upsert.mock.calls[0][0];
    // BOTH arms must carry the same review state.
    for (const arm of [call.create.metadata, call.update.metadata]) {
      expect(arm.gateDecision).toBe("review_required");
      expect(arm.recordType).toBe("knowledge_candidate");
      expect(arm.kind).toBe("observation");
      expect(arm.targetCategory).toBe("pattern");
    }
    expect(call.update.deletedAt).toBeNull();
  });

  it("DEFAULT: an UNKNOWN category is deliberately NOT parked (volume guard)", async () => {
    delete process.env.NICK_MEMORY_GATEWAY_PHASE2;
    mocks.isKnownCategory.mockReturnValue(false);
    const existing = {
      id: "existing-id",
      category: "made_up",
      key: "k",
      content: "old",
      source: "test",
      confidence: 0.5,
      seenCount: 1,
    };
    mocks.brainMemory.findUnique.mockResolvedValueOnce(existing);
    mocks.brainMemory.findUniqueOrThrow.mockResolvedValueOnce(existing);
    mocks.brainMemory.update.mockResolvedValueOnce({ id: "existing-id" });

    await mm.remember("made_up", "k", "new", "test");
    // unknown_category is ~5x the weaker_evidence volume; parking it would
    // freeze whole categories of automation writes. Legacy path stands.
    expect(mocks.brainMemory.upsert).not.toHaveBeenCalled();
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
