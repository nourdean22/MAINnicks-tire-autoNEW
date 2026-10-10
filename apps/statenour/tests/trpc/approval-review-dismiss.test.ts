/**
 * Approvals that were approved and then did not end `executed` (audit
 * 2026-10-10, controller ruling).
 *
 * `needs_review` (the tool may have run; never auto re-run) and `failed` rows
 * had no surface: /system/actions listed `pending_approval` only, and the
 * Owner Panel's exception for them carried `href: null`. These pin the reader
 * (the same windows as lib/system/owner-panel-data.ts) and the dismiss
 * mutation's where-guard: only a needs_review/failed row, unchanged since it
 * was read, moves to the existing terminal status "rejected".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = vi.hoisted(() => ({
  prisma: {
    approvalRequest: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/tools/guardian", () => ({ executeApprovedToolAsync: vi.fn() }));
vi.mock("@/lib/feature-flags", () => ({ getFlag: () => ({ isOn: false }) }));

import { router } from "@/lib/trpc/trpc";
import { actionsProcedures } from "@/lib/trpc/routers/system/actions";
import { APPROVAL_REVIEW_WINDOW_MS, EXCEPTION_WINDOW_MS } from "@/lib/system/owner-panel";

const caller = router({ ...actionsProcedures }).createCaller({
  session: { id: "op", email: "op@statenour.local", role: "owner" },
} as never);

const updatedAt = new Date("2026-10-10T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  prisma.approvalRequest.updateMany.mockResolvedValue({ count: 1 });
});

describe("getApprovalsNeedingReview · the grouping read", () => {
  it("reads needs_review (7d) and failed (24h) only, the Owner Panel's windows", async () => {
    prisma.approvalRequest.findMany.mockResolvedValue([]);
    const before = Date.now();
    await caller.getApprovalsNeedingReview();
    const where = prisma.approvalRequest.findMany.mock.calls[0][0].where;
    expect(where.OR.map((c: { status: string }) => c.status)).toEqual(["needs_review", "failed"]);
    const reviewSince = where.OR[0].updatedAt.gte.getTime();
    const failedSince = where.OR[1].updatedAt.gte.getTime();
    expect(Math.abs(before - APPROVAL_REVIEW_WINDOW_MS - reviewSince)).toBeLessThan(5_000);
    expect(Math.abs(before - EXCEPTION_WINDOW_MS - failedSince)).toBeLessThan(5_000);
  });
});

describe("dismissApprovalReview · the where-guard", () => {
  for (const status of ["pending_approval", "approved", "executing", "executed", "rejected"]) {
    it(`refuses a ${status} row and writes nothing`, async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue({ status, resultPayload: null, updatedAt });
      await expect(caller.dismissApprovalReview({ id: "a1" })).rejects.toThrow(/needs_review or failed/);
      expect(prisma.approvalRequest.updateMany).not.toHaveBeenCalled();
      expect(prisma.approvalRequest.update).not.toHaveBeenCalled();
    });
  }

  it("refuses a missing row", async () => {
    prisma.approvalRequest.findUnique.mockResolvedValue(null);
    await expect(caller.dismissApprovalReview({ id: "nope" })).rejects.toThrow(/needs_review or failed/);
    expect(prisma.approvalRequest.updateMany).not.toHaveBeenCalled();
  });

  for (const status of ["needs_review", "failed"]) {
    it(`POSITIVE CONTROL: a ${status} row moves to rejected, guarded on the row it read`, async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue({
        status,
        resultPayload: { error: "did not finish" },
        updatedAt,
      });
      await expect(caller.dismissApprovalReview({ id: "a1" })).resolves.toEqual({ success: true });
      const arg = prisma.approvalRequest.updateMany.mock.calls[0][0];
      expect(arg.where).toEqual({ id: "a1", status: { in: ["needs_review", "failed"] }, updatedAt });
      expect(arg.data.status).toBe("rejected");
      // The original error survives; the review is recorded beside it.
      expect(arg.data.resultPayload.error).toBe("did not finish");
      expect(arg.data.resultPayload.reviewed.from).toBe(status);
      expect(arg.data.resultPayload.reviewed.by).toBe("op@statenour.local");
    });
  }

  it("a row that changed between read and write (e.g. the executor finished) is a conflict", async () => {
    prisma.approvalRequest.findUnique.mockResolvedValue({ status: "needs_review", resultPayload: null, updatedAt });
    prisma.approvalRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(caller.dismissApprovalReview({ id: "a1" })).rejects.toThrow(/changed/);
  });
});
