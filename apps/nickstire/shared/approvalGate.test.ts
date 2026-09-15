import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { GATE_BLOCK, gateProblem, isApproved, type GateApproval, type GateCandidate } from "./approvalGate";
import { approvalProblem, type ReelApprovalRecord, type ReelPublishCandidate } from "./reelApproval";

const NOW = new Date("2026-09-15T12:00:00.000Z");
const cand: GateCandidate = { subjectId: "pr:42", bindings: { headSha: "abc", diffSha: "d1" } };
const ok: GateApproval = { subjectId: "pr:42", bindings: { headSha: "abc", diffSha: "d1" }, approvedBy: "nour", approvedAt: NOW, expiresAt: new Date(NOW.getTime() + 3600_000) };

describe("gateProblem", () => {
  it("default-deny: no approval blocks", () => {
    expect(gateProblem(cand, null, NOW)?.code).toBe(GATE_BLOCK.missing);
  });
  it("passes a fresh, attributed, byte-matching approval", () => {
    expect(gateProblem(cand, ok, NOW)).toBeNull();
    expect(isApproved(cand, ok, NOW)).toBe(true);
  });
  it("each bypass is a named block", () => {
    expect(gateProblem(cand, { ...ok, subjectId: "pr:41" }, NOW)?.code).toBe(GATE_BLOCK.wrongSubject);
    expect(gateProblem(cand, { ...ok, revokedAt: NOW }, NOW)?.code).toBe(GATE_BLOCK.revoked);
    expect(gateProblem(cand, { ...ok, expiresAt: new Date(NOW.getTime() - 1) }, NOW)?.code).toBe(GATE_BLOCK.expired);
    expect(gateProblem(cand, { ...ok, approvedBy: "  " }, NOW)?.code).toBe(GATE_BLOCK.anonymous);
    expect(gateProblem(cand, { ...ok, bindings: { headSha: "abd", diffSha: "d1" } }, NOW)).toMatchObject({ code: GATE_BLOCK.bindingChanged, binding: "headSha" });
    expect(gateProblem({ subjectId: "pr:42", bindings: { headSha: "abc" } }, ok, NOW)).toMatchObject({ code: GATE_BLOCK.bindingUnverifiable, binding: "diffSha" });
  });
  it("an explicit window governs and suppresses the TTL", () => {
    const later = new Date(NOW.getTime() + 24 * 3600_000);
    const windowed: GateApproval = { ...ok, expiresAt: new Date(NOW.getTime() - 1), windowStart: later, windowEnd: new Date(later.getTime() + 3600_000) };
    expect(gateProblem(cand, windowed, NOW)?.code).toBe(GATE_BLOCK.notYetDue);
    expect(gateProblem(cand, windowed, new Date(later.getTime() + 60_000))).toBeNull();
    expect(gateProblem(cand, windowed, new Date(later.getTime() + 2 * 3600_000))?.code).toBe(GATE_BLOCK.windowPassed);
  });
});

/**
 * PARITY with the live reel gate. The generic gate must agree with
 * shared/reelApproval.approvalProblem on every arm of the reel decision — a
 * generic door that is looser or stricter than the one already holding the
 * autonomous reel lane would be a second approval system, which this module
 * exists to avoid.
 */
describe("parity with reelApproval.approvalProblem", () => {
  const reelToGeneric = (c: ReelPublishCandidate, a: ReelApprovalRecord | null) => {
    const candidate: GateCandidate = {
      subjectId: `reel:${c.jobId}`,
      bindings: { caption: c.captionFingerprint, video: c.videoUrl, ...(c.assetSha256 ? { asset: c.assetSha256 } : {}) },
    };
    const approval: GateApproval | null = a && {
      subjectId: `reel:${a.reelJobId}`,
      bindings: { caption: a.captionFingerprint, video: a.videoUrl, ...(a.assetSha256 ? { asset: a.assetSha256 } : {}) },
      approvedBy: a.approvedBy,
      approvedAt: a.approvedAt,
      revokedAt: a.revokedAt,
      expiresAt: a.expiresAt,
      windowStart: a.publishWindowStart,
      windowEnd: a.publishWindowEnd,
    };
    return { candidate, approval };
  };

  const hex = fc.constantFrom("aaa", "bbb");
  const arb = fc.record({
    jobId: fc.constantFrom(1, 2),
    approvalJob: fc.constantFrom(1, 2),
    caption: hex,
    approvedCaption: hex,
    video: fc.constantFrom("u1", "u2"),
    approvedVideo: fc.constantFrom("u1", "u2"),
    assetCand: fc.option(hex, { nil: null }),
    assetAppr: fc.option(hex, { nil: null }),
    approvedBy: fc.constantFrom("nour", "", "  "),
    revoked: fc.boolean(),
    expiresOffsetH: fc.option(fc.integer({ min: -100, max: 100 }), { nil: null }),
    windowStartH: fc.option(fc.integer({ min: -100, max: 100 }), { nil: null }),
    windowEndH: fc.option(fc.integer({ min: -100, max: 100 }), { nil: null }),
    hasApproval: fc.boolean(),
  });

  it("blocked-or-not agrees on every generated case", () => {
    fc.assert(
      fc.property(arb, (x) => {
        const h = (n: number | null) => (n === null ? null : new Date(NOW.getTime() + n * 3600_000));
        const c: ReelPublishCandidate = { jobId: x.jobId, captionFingerprint: x.caption, videoUrl: x.video, assetSha256: x.assetCand };
        const a: ReelApprovalRecord | null = x.hasApproval
          ? {
              reelJobId: x.approvalJob, captionFingerprint: x.approvedCaption, videoUrl: x.approvedVideo, assetSha256: x.assetAppr,
              approvedBy: x.approvedBy, approvedAt: NOW, revokedAt: x.revoked ? NOW : null, expiresAt: h(x.expiresOffsetH),
              publishWindowStart: h(x.windowStartH), publishWindowEnd: h(x.windowEndH),
            }
          : null;
        const reel = approvalProblem(c, a, NOW);
        const { candidate, approval } = reelToGeneric(c, a);
        const generic = gateProblem(candidate, approval, NOW);
        expect(generic === null).toBe(reel === null);
      }),
      { numRuns: 600 },
    );
  });
});
