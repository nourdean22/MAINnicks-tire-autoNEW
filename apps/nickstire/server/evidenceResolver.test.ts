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

  it("maps a family + topic label to a CURATED record with a canonical URL", () => {
    const p = parseEvidenceHandle("NHTSA tire pressure guidance");
    expect(p.type).toBe("public_source");
    if (p.type === "public_source") {
      expect(p.record.family).toBe("NHTSA");
      expect(p.record.canonicalUrl).toContain("nhtsa.gov");
    }
  });

  it("a family NAME alone is recognition, not evidence — rejected", () => {
    expect(parseEvidenceHandle("Consumer Reports recommends this").type).toBe("family_without_record");
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

  it("resolves registry-matched public labels to the curated record's title + URL, no DB roundtrip", async () => {
    const spy = vi.fn();
    vi.doMock("./services/reelBriefGen", () => ({ resolveSourceProvenance: spy }));
    vi.resetModules();
    const { resolveEvidenceHandles } = await import("./services/evidenceResolver");

    const res = await resolveEvidenceHandles([
      "Ohio E-Check inspection requirements overview",
      "Bridgestone education material", // family with no curated record → rejected
    ]);
    expect(spy).not.toHaveBeenCalled();
    expect(res.resolved).toHaveLength(1);
    expect(res.resolved[0].origin).toBe("public_family");
    expect(res.resolved[0].assertion).toContain("epa.ohio.gov");
    expect(res.rejected).toEqual(["Bridgestone education material"]);
  });
});
