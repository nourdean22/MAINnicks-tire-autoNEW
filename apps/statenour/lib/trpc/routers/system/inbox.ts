import { z } from "zod";
import { operatorProcedure } from "../../trpc";
import { prisma } from "@/lib/prisma";
import { TRPCError } from "@trpc/server";
import { saveToBrain } from "@/lib/services/brain/save";

export const inboxProcedures = {
  getQuarantinedItems: operatorProcedure.query(async () => {
    return prisma.memoryInboxItem.findMany({
      where: {
        status: { in: ["quarantined", "conflicting"] },
      },
      orderBy: { createdAt: "desc" },
    });
  }),

  resolveInboxItem: operatorProcedure
    .input(
      z.object({
        id: z.string(),
        verdict: z.enum(["overwrite", "reject", "coexist"]),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const item = await prisma.memoryInboxItem.findUnique({
        where: { id: input.id },
      });

      if (!item) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Inbox item not found",
        });
      }

      if (item.status !== "quarantined" && item.status !== "conflicting") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Inbox item already processed",
        });
      }

      const reviewedBy = ctx.session.email ?? "Operator";
      const reviewedAt = new Date();

      if (input.verdict === "reject") {
        await prisma.memoryInboxItem.update({
          where: { id: input.id },
          data: {
            status: "discarded",
            reviewedBy,
            reviewedAt,
          },
        });
        return { success: true };
      }

      // Both 'overwrite' and 'coexist' commit the claims to BrainMemory.
      // Parse extractedClaims which is stored as Json.
      let claims: Array<{ text: string; confidence?: number }> = [];
      try {
        if (Array.isArray(item.extractedClaims)) {
          claims = item.extractedClaims as any;
        } else if (typeof item.extractedClaims === "string") {
          claims = [{ text: item.extractedClaims }];
        } else if (item.extractedClaims && typeof item.extractedClaims === "object") {
          const obj = item.extractedClaims as any;
          if (obj.text) {
            claims = [obj];
          }
        }
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to parse extracted claims from inbox item",
        });
      }

      if (claims.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No valid claims found in extractedClaims",
        });
      }

      // If verdict is overwrite, delete/soft-delete matching contradiction logs/conflicts.
      if (input.verdict === "overwrite") {
        let conflictIds: string[] = [];
        try {
          if (Array.isArray(item.contradictionLogs)) {
            conflictIds = item.contradictionLogs
              .map((c: any) => (typeof c === "string" ? c : c.id))
              .filter(Boolean);
          } else if (typeof item.contradictionLogs === "string") {
            conflictIds = [item.contradictionLogs];
          }
        } catch (err) {
          // Ignore parse errors on contradiction logs
        }

        if (conflictIds.length > 0) {
          await prisma.brainMemory.updateMany({
            where: {
              id: { in: conflictIds },
            },
            data: {
              deletedAt: new Date(),
              source: "overwritten_by_inbox_resolution",
            },
          });
        }
      }

      // Commit claims to BrainMemory using saveToBrain
      for (const claim of claims) {
        await saveToBrain({
          content: claim.text,
          confidence: claim.confidence ?? 0.85,
          source: item.sourceType ? `inbox:${item.sourceType}` : "inbox",
          category: "belief",
          metadata: {
            inboxItemId: item.id,
            sourceUrl: item.sourceUrl,
            privacyClass: item.privacyClass,
            verdict: input.verdict,
            reason: input.reason ?? "",
          },
        });
      }

      await prisma.memoryInboxItem.update({
        where: { id: input.id },
        data: {
          status: "committed",
          reviewedBy,
          reviewedAt,
        },
      });

      return { success: true };
    }),
};
