/**
 * system.* digest queries (Wire 3) — read-only surfaces over the existing
 * truth/intelligence services so they're reachable from /system, not just chat
 * commands + raw API routes. No mutation, no new logic — thin wrappers.
 */

import { z } from "zod";
import { operatorProcedure } from "../../trpc";
import { buildSystemChangeDigest } from "@/lib/services/system-change-digest";
import { buildMemoryEvalReport } from "@/lib/evals/memory-eval-report";
import { buildActionReceiptFeed } from "@/lib/services/action-receipt-feed";

export const digestProcedures = {
  /** F2 · "what changed since last reconciliation" + honest deploy status. */
  changeDigest: operatorProcedure.query(async () => buildSystemChangeDigest()),
  /** Truth scoreboard — does the docs corpus teach current truth? */
  memoryEvals: operatorProcedure.query(async () => buildMemoryEvalReport()),
  /**
   * F4 · recent action receipts (what Nick/system actually did).
   * BDN-003: optional limit so the /brain continuity timeline can pull a
   * deeper window than the /system card's 20 without a second procedure.
   */
  receiptFeed: operatorProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100) }).optional())
    .query(async ({ input }) => buildActionReceiptFeed({ limit: input?.limit ?? 20 })),
  /** Active and snoozed agenda items (witnessed commitments, standing intentions, etc.) */
  agendaItems: operatorProcedure.query(async () => {
    const { prisma } = await import("@/lib/prisma");
    return prisma.agendaItem.findMany({
      where: {
        status: { in: ["ACTIVE", "SNOOZED"] }
      },
      orderBy: { createdAt: "desc" }
    });
  }),
};
