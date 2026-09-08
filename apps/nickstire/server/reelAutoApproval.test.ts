/**
 * Auto-approval is a POLICY switch, and both positions are pinned: "auto" records
 * through the real writer only for missing/expired approvals; anything else does
 * nothing at all. The dangerous direction is the one that would approve a
 * revoked or vetoed reel — pinned explicitly.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => { vi.doUnmock("./services/autonomyControl"); vi.doUnmock("./services/reelApproval"); vi.resetModules(); });

function arm(reelPermission: "auto" | "approval_required", entries: Array<Record<string, unknown>>) {
  const record = vi.fn().mockResolvedValue({ approvalId: "a", expiresAt: new Date(), captionSha: "s", videoUrl: "u", publishWindowStart: null, publishWindowEnd: null, assetSha256: null });
  vi.doMock("./services/autonomyControl", () => ({ getActivePolicy: vi.fn().mockResolvedValue({ version: 10, formatPermissions: { reel: reelPermission } }) }));
  class ReelApprovalWriteError extends Error { constructor(public code: string, m: string) { super(m); } }
  vi.doMock("./services/reelApproval", () => ({ listReelPublishQueue: vi.fn().mockResolvedValue({ entries, approvalsTableReadable: true }), recordReelApproval: record, ReelApprovalWriteError }));
  vi.resetModules();
  return record;
}
const entry = (jobId: number, code: string | null, vetoReason: string | null = null) => ({
  jobId, captionSha: `sha${jobId}`, videoUrl: `https://x/${jobId}.mp4`, vetoReason,
  approvalProblem: code ? { code, reason: code } : null,
});

describe("autoApproveAssembledReels", () => {
  it("policy 'auto': records an approval for missing and expired, through the real writer, bound to the queue's sha + url", async () => {
    const record = arm("auto", [entry(1, "no_approval_recorded"), entry(2, "approval_expired"), entry(3, null)]);
    const { autoApproveAssembledReels } = await import("./services/reelAutoApproval");
    const out = await autoApproveAssembledReels();
    expect(out.policy).toBe("auto");
    expect(out.approved).toEqual([1, 2]);
    expect(record).toHaveBeenCalledTimes(2);
    expect(record.mock.calls[0][0]).toMatchObject({ jobId: 1, expectedCaptionSha: "sha1", expectedVideoUrl: "https://x/1.mp4" });
    expect(String(record.mock.calls[0][0].approvedBy)).toMatch(/auto-approval:policy v10/);
  });

  it("PLANTED CANARY: a revoked, drifted, or vetoed reel is NEVER auto-approved", async () => {
    const record = arm("auto", [entry(4, "approval_revoked"), entry(5, "caption_changed_since_approval"), entry(6, "no_approval_recorded", "condemned by audit")]);
    const { autoApproveAssembledReels } = await import("./services/reelAutoApproval");
    const out = await autoApproveAssembledReels();
    expect(record).not.toHaveBeenCalled();
    expect(out.approved).toEqual([]);
    expect(out.skipped.map((s) => s.why).sort()).toEqual(["approval_revoked", "caption_changed_since_approval", "vetoed"]);
  });

  it("policy 'approval_required': does nothing — the switch is the gate", async () => {
    const record = arm("approval_required", [entry(7, "no_approval_recorded")]);
    const { autoApproveAssembledReels } = await import("./services/reelAutoApproval");
    const out = await autoApproveAssembledReels();
    expect(out.policy).toBe("not_auto");
    expect(record).not.toHaveBeenCalled();
  });

  it("a writer refusal (e.g. content_vetoed at the tap) is recorded as a skip, not thrown", async () => {
    const record = arm("auto", [entry(8, "no_approval_recorded")]);
    const { ReelApprovalWriteError } = await import("./services/reelApproval");
    record.mockRejectedValueOnce(new (ReelApprovalWriteError as any)("content_vetoed", "vetoed"));
    const { autoApproveAssembledReels } = await import("./services/reelAutoApproval");
    const out = await autoApproveAssembledReels();
    expect(out.approved).toEqual([]);
    expect(out.skipped).toEqual([{ jobId: 8, why: "content_vetoed" }]);
  });
});
