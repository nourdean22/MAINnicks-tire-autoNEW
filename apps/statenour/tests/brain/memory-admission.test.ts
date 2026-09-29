/**
 * tests/brain/memory-admission.test.ts · Q-31 admission authority
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  remember: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  shadow: vi.fn(),
}));

vi.mock("@/lib/brain/memory-manager", () => ({
  brainMemory: { remember: mocks.remember },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
  },
}));
vi.mock("@/lib/brain/memory-contradiction-shadow", () => ({
  shadowAdmissionContradictions: mocks.shadow,
}));

import {
  admitMemory,
  buildAdmissionEnvelope,
  contentHash,
  stampAdmission,
} from "@/lib/brain/memory-admission";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUnique.mockResolvedValue(null);
  mocks.remember.mockResolvedValue({
    id: "mem_1",
    content: "c",
    source: "operator",
    metadata: null,
  });
  mocks.update.mockResolvedValue({ id: "mem_1" });
  mocks.shadow.mockResolvedValue({ scanned: 0, flagged: 0 });
});

describe("buildAdmissionEnvelope", () => {
  it("an explicit save is a semantic, operator-stated memory with a content hash", () => {
    const env = buildAdmissionEnvelope({
      source: "user_save",
      memoryKind: "semantic",
      extractionMethod: "explicit_save",
      content: "I run on Tuesdays",
    });
    expect(env.evidenceClass).toBe("operator_stated");
    expect(env.memoryKind).toBe("semantic");
    expect(env.contentHash).toBe(contentHash("i run on   tuesdays"));
    expect(env.orphanDerived).toBeUndefined();
  });

  it("a derived memory is never stronger than a summary, whatever its source string says", () => {
    const env = buildAdmissionEnvelope({
      source: "manual",
      memoryKind: "derived",
      derivedFrom: ["a", "b", "a"],
    });
    expect(env.evidenceClass).toBe("generated_summary");
    expect(env.derivedFrom).toEqual(["a", "b"]);
  });

  it("a derived memory with no lineage is flagged", () => {
    expect(
      buildAdmissionEnvelope({ source: "weekly_digest", memoryKind: "derived" }).orphanDerived,
    ).toBe(true);
  });

  it("stampAdmission keeps existing metadata and adds the envelope", () => {
    const m = stampAdmission(
      { nearDuplicateOf: "x" },
      {
        source: "pin:chat",
        memoryKind: "semantic",
        extractionMethod: "operator_pin",
      },
    );
    expect(m.nearDuplicateOf).toBe("x");
    expect((m.admission as { evidenceClass: string }).evidenceClass).toBe("operator_stated");
  });
});

describe("admitMemory", () => {
  it("stamps provenance and effective time only when the candidate becomes canonical", async () => {
    const from = new Date("2026-09-01T00:00:00Z");

    const r = await admitMemory({
      category: "preference",
      key: "k",
      content: "c",
      source: "operator",
      memoryKind: "semantic",
      effectiveFrom: from,
    });

    expect(r).toEqual({
      id: "mem_1",
      evidenceClass: "operator_stated",
      memoryKind: "semantic",
    });
    expect(mocks.remember).toHaveBeenCalledWith(
      "preference",
      "k",
      "c",
      "operator",
      expect.objectContaining({
        admission: expect.objectContaining({
          memoryKind: "semantic",
          evidenceClass: "operator_stated",
          effectiveFrom: from.toISOString(),
        }),
      }),
    );
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "mem_1" },
      data: expect.objectContaining({
        source: "operator",
        validFrom: from,
        metadata: expect.objectContaining({
          admission: expect.objectContaining({ contentHash: expect.any(String) }),
        }),
      }),
    });
  });

  it("does not mutate the winning row when a changed candidate was parked/rejected", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "mem_1",
      content: "Operator prefers appointments",
      source: "operator",
      metadata: { original: true },
    });
    mocks.remember.mockResolvedValue({
      id: "mem_1",
      content: "Operator prefers appointments",
      source: "operator",
      metadata: { original: true },
    });

    await admitMemory({
      category: "preference",
      key: "booking",
      content: "Operator never wants appointments",
      source: "conversation_analysis",
      memoryKind: "derived",
      extractionMethod: "llm_extract",
      effectiveFrom: new Date("2026-09-20T00:00:00Z"),
      confidence: 0.9,
    });

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.shadow).not.toHaveBeenCalled();
  });

  it("leaves same-content no-op/reinforcement provenance untouched", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "mem_1",
      content: "same fact",
      source: "operator",
      metadata: { admission: { evidenceClass: "operator_stated" } },
    });
    mocks.remember.mockResolvedValue({
      id: "mem_1",
      content: "same fact",
      source: "operator",
      metadata: { admission: { evidenceClass: "operator_stated" } },
    });

    await admitMemory({
      category: "preference",
      key: "k",
      content: "same fact",
      source: "conversation_analysis",
      memoryKind: "derived",
      extractionMethod: "llm_extract",
    });

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.shadow).not.toHaveBeenCalled();
  });

  it("materializes AGENT_INFERRED for an accepted model-derived write", async () => {
    mocks.remember.mockResolvedValue({
      id: "mem_2",
      content: "derived fact",
      source: "conversation_analysis",
      metadata: null,
    });

    await admitMemory({
      category: "insight",
      key: "k2",
      content: "derived fact",
      source: "conversation_analysis",
      memoryKind: "derived",
      extractionMethod: "llm_extract",
      evidenceRefs: ["chat-turn:fixture"],
    });

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "mem_2" },
      data: expect.objectContaining({
        trustTier: "AGENT_INFERRED",
        source: "conversation_analysis",
      }),
    });

    await vi.waitFor(() => {
      expect(mocks.shadow).toHaveBeenCalledWith({
        memoryId: "mem_2",
        category: "insight",
        content: "derived fact",
      });
    });
  });

  it("does not run contradiction shadow for accepted episodic rows", async () => {
    mocks.remember.mockResolvedValue({
      id: "mem_3",
      content: "event happened",
      source: "event_receipt",
      metadata: null,
    });

    await admitMemory({
      category: "timeline",
      key: "e1",
      content: "event happened",
      source: "event_receipt",
      memoryKind: "episodic",
      extractionMethod: "receipt",
    });

    await Promise.resolve();
    expect(mocks.shadow).not.toHaveBeenCalled();
  });
});
