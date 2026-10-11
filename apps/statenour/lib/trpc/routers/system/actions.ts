import { z } from "zod";
import { operatorProcedure } from "../../trpc";
import { prisma } from "@/lib/prisma";
import { TRPCError } from "@trpc/server";
import { executeApprovedToolAsync } from "@/lib/tools/guardian";
import { expiredApprovalMessage, isApprovalRequestExpired } from "@/lib/automation/approval-freshness";
import { APPROVAL_REVIEW_WINDOW_MS, EXCEPTION_WINDOW_MS } from "@/lib/system/owner-panel";
import { logError } from "@/lib/utils/error-log";

/** Approved requests that did not end `executed`; only these may be dismissed. */
const REVIEWABLE = ["needs_review", "failed"];

export const actionsProcedures = {
  getCurrentUser: operatorProcedure.query(async ({ ctx }) => {
    return {
      id: ctx.session.id,
      email: ctx.session.email,
      role: ctx.session.role,
    };
  }),

  getPendingApprovals: operatorProcedure.query(async () => {
    const rows = await prisma.approvalRequest.findMany({
      where: { status: "pending_approval" },
      orderBy: { createdAt: "asc" },
    });
    // 2026-09-07 (D12) · `expiresAt` was written by every requester and read
    // by nobody. Expired rows stay LISTED (the obligation is still real) but
    // are flagged so the UI can say "re-request or dismiss" instead of
    // offering an Approve that would execute against stale state.
    const now = new Date();
    return rows.map((r) => ({ ...r, expired: isApprovalRequestExpired(r, now) }));
  }),

  /**
   * 2026-10-10 · approved requests that did not end `executed`: `needs_review`
   * (the tool may have run; never auto re-run) and `failed`. Same windows as
   * the Owner Panel (lib/system/owner-panel-data.ts), so the rows it pages
   * about are the rows /system/actions lets you dismiss.
   */
  getApprovalsNeedingReview: operatorProcedure.query(async () => {
    const now = Date.now();
    const rows = await prisma.approvalRequest.findMany({
      where: {
        OR: [
          { status: "needs_review", updatedAt: { gte: new Date(now - APPROVAL_REVIEW_WINDOW_MS) } },
          { status: "failed", updatedAt: { gte: new Date(now - EXCEPTION_WINDOW_MS) } },
        ],
      },
      select: { id: true, toolId: true, status: true, resultPayload: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
    // resultPayload as unknown: the inferred Prisma Json type is too deep for the client (TS2589).
    return rows.map((r) => ({ ...r, resultPayload: r.resultPayload as unknown }));
  }),

  /**
   * Mark a needs_review / failed approval as reviewed. Moves it to the existing
   * terminal status "rejected" (no schema change; "executed" would claim it
   * ran) and keeps the original error beside a `reviewed` note. Never re-runs.
   * Compare-and-swap on the row read: if the executor finished in between, the
   * update matches nothing and the caller is told to reload.
   */
  dismissApprovalReview: operatorProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const row = await prisma.approvalRequest.findUnique({
        where: { id: input.id },
        select: { status: true, resultPayload: true, updatedAt: true },
      });
      if (!row || !REVIEWABLE.includes(row.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only a needs_review or failed approval can be dismissed" });
      }
      const prior =
        row.resultPayload && typeof row.resultPayload === "object" && !Array.isArray(row.resultPayload)
          ? (row.resultPayload as Record<string, unknown>)
          : {};
      const res = await prisma.approvalRequest.updateMany({
        where: { id: input.id, status: { in: REVIEWABLE }, updatedAt: row.updatedAt },
        data: {
          status: "rejected",
          resultPayload: {
            ...prior,
            reviewed: { from: row.status, by: ctx.session.email ?? "Operator", at: new Date().toISOString() },
          } as never,
        },
      });
      if (res.count === 0) {
        throw new TRPCError({ code: "CONFLICT", message: "This approval changed since it was read; reload and check it again" });
      }
      // Its ledger attempt: an EXECUTING one is not in flight any more (the
      // process stopped mid-dispatch), so it becomes UNKNOWN. UNKNOWN / FAILED
      // stay as they are: a review is not a verdict on whether it ran.
      try {
        await prisma.actionAttempt.updateMany({
          where: { operationKey: `approval:${input.id}`, state: "EXECUTING" },
          data: {
            state: "UNKNOWN",
            settledAt: new Date(),
            reason: `not in flight; dismissed by ${ctx.session.email ?? "Operator"} after review; outcome not reconciled`,
          },
        });
      } catch (err) {
        logError("trpc.system.actions", err, { stage: "dismiss-settle-attempt", id: input.id }, "warn");
      }
      return { success: true };
    }),

  approveApprovalRequest: operatorProcedure
    .input(z.object({ id: z.string(), editedPayload: z.any().optional() }))
    .mutation(async ({ input, ctx }) => {
      const request = await prisma.approvalRequest.findUnique({
        where: { id: input.id },
      });

      if (!request || request.status !== "pending_approval") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Request not found or not in pending state",
        });
      }

      // Expire authorization, not obligations: an approval is permission to
      // run THIS payload against the state it was raised in. Past `expiresAt`
      // the permission is void — refuse before any state transition so the
      // background executor is never spawned. Reject stays available.
      if (isApprovalRequestExpired(request)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: expiredApprovalMessage("request", request.expiresAt),
        });
      }

      // Owner gate · triggers: high/critical risk class, OR the policy
      // engine explicitly decided require_owner (stored as actionType —
      // fires for non-critical cases too, e.g. external mutations with an
      // owner_required capability policy). Pre-fix, only the critical
      // branch was enforced and a require_owner decision executed on any
      // operator approval.
      if (
        (request.riskClass === "critical" || request.riskClass === "high" || request.actionType === "require_owner") &&
        ctx.session.role !== "owner"
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Owner privilege is required to approve this action",
        });
      }

      const updateData: any = {
        status: "approved",
        approvedAt: new Date(),
        approvedBy: ctx.session.email ?? "Operator",
      };
      if (input.editedPayload) updateData.payload = input.editedPayload;

      // Claim before act: swap on the row read (status, its updatedAt version,
      // and a deadline still in the future). A second approve, or one on a row
      // the executor already took, matches nothing and must not re-arm it.
      const claim = await prisma.approvalRequest.updateMany({
        where: { id: input.id, status: "pending_approval", updatedAt: request.updatedAt, expiresAt: { gt: new Date() } },
        data: updateData,
      });
      if (claim.count !== 1) throw await approvalConflict(input.id);

      // Only the winner patches the in-memory args the executor will run.
      if (input.editedPayload) {
        const { pendingExecutions } = await import("@/lib/tools/guardian");
        const pending = pendingExecutions.get(input.id);
        if (pending) {
          pending.args = [input.editedPayload];
        }
      }

      // Spawn background tool execution
      void executeApprovedToolAsync(input.id);

      return { success: true };
    }),

  rejectApprovalRequest: operatorProcedure
    .input(z.object({ id: z.string(), reason: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const row = await prisma.approvalRequest.findUnique({
        where: { id: input.id },
        select: { status: true, updatedAt: true },
      });
      if (!row || row.status !== "pending_approval") throw await approvalConflict(input.id);
      // Swap on the row read: an approval that ran (or started) is never relabelled rejected.
      const res = await prisma.approvalRequest.updateMany({
        where: { id: input.id, status: "pending_approval", updatedAt: row.updatedAt },
        data: {
          status: "rejected",
          resultPayload: { error: input.reason ?? "Rejected by operator" },
          approvedAt: new Date(),
          approvedBy: ctx.session.email ?? "Operator",
        },
      });
      if (res.count !== 1) throw await approvalConflict(input.id);
      return { success: true };
    }),
};

/** The loser of a swap: report the row's real state, never a silent success. */
async function approvalConflict(id: string): Promise<TRPCError> {
  const now = await prisma.approvalRequest.findUnique({ where: { id }, select: { status: true } });
  return new TRPCError({
    code: "CONFLICT",
    message: `This approval is ${now?.status ?? "gone"} now; reload and check it again`,
  });
}
