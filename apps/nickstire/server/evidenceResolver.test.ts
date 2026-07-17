/**
 * Evidence resolver — the trust boundary between genome proof handles and the
 * grounding gate. Raw strings must never satisfy the gate; only verified DB
 * rows and accepted public proof families pass.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { parseEvidenceHandle } from "./services/evidenceResolver";

afterEach(() => {
  vi.doUnmock("./services/reelBriefGen");
  vi.resetModules();
});

describe("parseEvidenceHandle", () => {
  it("parses typed DB handles", () => {
    expect(parseEvidenceHandle("review:123")).toEqual({ type: "review", id: "123" });
    expect(parseEvidenceHandle("declined_work: wo_9")).toEqual({ type: "declined_work", id: "wo_9" });
    expect(parseEvidenceHandle("work_order:abc")).toEqual({ type: "declined_work", id: "abc" });
  });

  it("recognizes accepted public proof families as labels", () => {
    const p = parseEvidenceHandle("NHTSA tire pressure guidance");
    expect(p.type).toBe("public_source");
    if (p.type === "public_source") expect(p.family).toBe("NHTSA");
  });

  it("rejects free text that names no family and no typed id — the #811 trust gap", () => {
    expect(parseEvidenceHandle("customer review: cold morning no-start (Euclid)").type).toBe("unrecognized");
    expect(parseEvidenceHandle("trust me, this happens a lot").type).toBe("unrecognized");
  });
});

describe("resolveEvidenceHandles", () => {
  it("verifies DB handles through resolveSourceProvenance and rejects unverified ones", async () => {
    const spy = vi
      .fn()
      .mockResolvedValueOnce({ evidence: 'Grounded 5-Star Review by Sam: "fixed my slow crank"', isVerified: true, sourceType: "review" })
      .mockResolvedValueOnce({ evidence: "", isVerified: false, sourceType: "review" });
    vi.doMock("./services/reelBriefGen", () => ({ resolveSourceProvenance: spy }));
    vi.resetModules();
    const { resolveEvidenceHandles } = await import("./services/evidenceResolver");

    const res = await resolveEvidenceHandles(["review:1", "review:99999", "not a real source"]);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(res.resolved).toHaveLength(1);
    expect(res.resolved[0].assertion).toContain("fixed my slow crank");
    expect(res.resolved[0].origin).toBe("db");
    expect(res.rejected).toEqual(["review:99999", "not a real source"]);
  });

  it("passes public-family labels without a DB roundtrip", async () => {
    const spy = vi.fn();
    vi.doMock("./services/reelBriefGen", () => ({ resolveSourceProvenance: spy }));
    vi.resetModules();
    const { resolveEvidenceHandles } = await import("./services/evidenceResolver");

    const res = await resolveEvidenceHandles(["Ohio E-Check requirements overview"]);
    expect(spy).not.toHaveBeenCalled();
    expect(res.resolved[0]?.origin).toBe("public_family");
    expect(res.rejected).toHaveLength(0);
  });
});
