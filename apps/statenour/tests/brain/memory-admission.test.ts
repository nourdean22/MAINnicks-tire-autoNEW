/**
 * tests/brain/memory-admission.test.ts · 2026-09-08 (Brain plan, Wave 1)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const remember = vi.hoisted(() => vi.fn());
const update = vi.hoisted(() => vi.fn());
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: { remember } }));
vi.mock("@/lib/prisma", () => ({ prisma: { brainMemory: { update } } }));

import { buildAdmissionEnvelope, stampAdmission, admitMemory, contentHash } from "@/lib/brain/memory-admission";

beforeEach(() => {
  vi.clearAllMocks();
  remember.mockResolvedValue({ id: "mem_1" });
  update.mockResolvedValue({ id: "mem_1" });
});

describe("buildAdmissionEnvelope", () => {
  it("an explicit save is a semantic, operator-stated memory with a content hash", () => {
    const env = buildAdmissionEnvelope({ source: "user_save", memoryKind: "semantic", extractionMethod: "explicit_save", content: "I run on Tuesdays" });
    expect(env.evidenceClass).toBe("operator_stated");
    expect(env.memoryKind).toBe("semantic");
    expect(env.contentHash).toBe(contentHash("i run on   tuesdays"));
    expect(env.orphanDerived).toBeUndefined();
  });
  it("a derived memory is never stronger than a summary, whatever its source string says", () => {
    const env = buildAdmissionEnvelope({ source: "manual", memoryKind: "derived", derivedFrom: ["a", "b", "a"] });
    expect(env.evidenceClass).toBe("generated_summary");
    expect(env.derivedFrom).toEqual(["a", "b"]);
  });
  it("a derived memory with no lineage is flagged — it can never be invalidated", () => {
    expect(buildAdmissionEnvelope({ source: "weekly_digest", memoryKind: "derived" }).orphanDerived).toBe(true);
  });
  it("stampAdmission keeps existing metadata and adds the envelope", () => {
    const m = stampAdmission({ nearDuplicateOf: "x" }, { source: "pin:chat", memoryKind: "semantic", extractionMethod: "operator_pin" });
    expect(m.nearDuplicateOf).toBe("x");
    expect((m.admission as { evidenceClass: string }).evidenceClass).toBe("operator_stated");
  });
});

describe("admitMemory", () => {
  it("routes through remember() with the envelope and writes the validity interval", async () => {
    const from = new Date("2026-09-01T00:00:00Z");
    const r = await admitMemory({ category: "preference", key: "k", content: "c", source: "operator", memoryKind: "semantic", effectiveFrom: from });
    expect(r).toEqual({ id: "mem_1", evidenceClass: "operator_stated", memoryKind: "semantic" });
    expect(remember).toHaveBeenCalledWith("preference", "k", "c", "operator", expect.objectContaining({ admission: expect.objectContaining({ memoryKind: "semantic", evidenceClass: "operator_stated" }) }));
    expect(update).toHaveBeenCalledWith({ where: { id: "mem_1" }, data: { validFrom: from } });
  });
  it("no interval, no extra write", async () => {
    await admitMemory({ category: "c", key: "k", content: "x", source: "cron:x", memoryKind: "episodic" });
    expect(update).not.toHaveBeenCalled();
  });
});
