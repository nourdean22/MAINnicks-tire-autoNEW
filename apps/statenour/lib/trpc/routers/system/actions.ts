import { z } from "zod";
import { operatorProcedure } from "../../trpc";
import { prisma } from "@/lib/prisma";
import { TRPCError } from "@trpc/server";
import { executeApprovedToolAsync } from "@/lib/tools/guardian";
import { expiredApprovalMessage, isApprovalRequestExpired } from "@/lib/automation/approval-freshness";

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

      if (input.editedPayload) {
        updateData.payload = input.editedPayload;
        // Import pendingExecutions dynamically or at top-level
        const { pendingExecutions } = await import("@/lib/tools/guardian");
        const pending = pendingExecutions.get(input.id);
        if (pending) {
          pending.args = [input.editedPayload];
        }
      }

      // Transition state to approved
      await prisma.approvalRequest.update({
        where: { id: input.id },
        data: updateData,
      });

      // Spawn background tool execution
      void executeApprovedToolAsync(input.id);

      return { success: true };
    }),

  rejectApprovalRequest: operatorProcedure
    .input(z.object({ id: z.string(), reason: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      await prisma.approvalRequest.update({
        where: { id: input.id },
        data: {
          status: "rejected",
          resultPayload: { error: input.reason ?? "Rejected by operator" },
          approvedAt: new Date(),
          approvedBy: ctx.session.email ?? "Operator",
        },
      });
      return { success: true };
    }),
};
