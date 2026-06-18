import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance
 * Returns transactions, summaries, and breakdowns for the ledger.
 */
export const GET = apiHandler(
  async () => {
    const transactions = await prisma.financialTransaction.findMany({
      orderBy: { date: "desc" },
      take: 100,
    });

    let totalIncomeCents = 0;
    let totalExpensesCents = 0;
    const categoryBreakdown: Record<string, number> = {};

    for (const tx of transactions) {
      const amount = tx.amountCents;
      if (amount > 0) {
        totalIncomeCents += amount;
      } else {
        totalExpensesCents += Math.abs(amount);
      }

      const cat = tx.manualOverrideCategory || tx.category || "Uncategorized";
      categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + amount;
    }

    return {
      transactions,
      summary: {
        totalIncomeCents,
        totalExpensesCents,
        netCents: totalIncomeCents - totalExpensesCents,
      },
      categoryBreakdown,
    };
  },
  { auth: "owner" }
);

/**
 * PATCH /api/finance
 * Updates manual category override or notes for a transaction.
 */
export const PATCH = apiHandler(
  async (req) => {
    const body = await req.json();
    const { id, manualOverrideCategory, notes } = body;

    if (!id) {
      throw new ServiceError("Transaction ID is required", 400);
    }

    const tx = await prisma.financialTransaction.findUnique({
      where: { id },
    });

    if (!tx) {
      throw new ServiceError("Transaction not found", 404);
    }

    const updated = await prisma.financialTransaction.update({
      where: { id },
      data: {
        manualOverrideCategory: manualOverrideCategory !== undefined ? manualOverrideCategory : undefined,
        notes: notes !== undefined ? notes : undefined,
      },
    });

    return { ok: true, transaction: updated };
  },
  { auth: "owner" }
);
