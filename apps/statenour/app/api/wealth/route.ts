import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";

export const dynamic = "force-dynamic";

/**
 * GET /api/wealth
 * Returns portfolio holdings, totals, and gain/loss statistics.
 */
export const GET = apiHandler(
  async () => {
    const holdings = await prisma.investmentHolding.findMany({
      orderBy: { symbol: "asc" },
    });

    let totalValueCents = 0;
    let totalCostCents = 0;

    const enrichedHoldings = holdings.map((h) => {
      const sharesNum = Number(h.shares);
      const costBasisCents = h.costBasisCents;
      const currentPriceCents = h.currentPriceCents;

      const totalHoldingCost = Math.round(sharesNum * costBasisCents);
      const totalHoldingValue = Math.round(sharesNum * currentPriceCents);
      const gainLossCents = totalHoldingValue - totalHoldingCost;
      const gainLossPct = totalHoldingCost > 0 ? (gainLossCents / totalHoldingCost) * 100 : 0;

      totalValueCents += totalHoldingValue;
      totalCostCents += totalHoldingCost;

      return {
        ...h,
        totalHoldingCost,
        totalHoldingValue,
        gainLossCents,
        gainLossPct,
      };
    });

    const portfolioGainLossCents = totalValueCents - totalCostCents;
    const portfolioGainLossPct = totalCostCents > 0 ? (portfolioGainLossCents / totalCostCents) * 100 : 0;

    return {
      holdings: enrichedHoldings,
      summary: {
        totalCostCents,
        totalValueCents,
        portfolioGainLossCents,
        portfolioGainLossPct,
      },
    };
  },
  { auth: "owner" }
);

/**
 * POST /api/wealth
 * Upserts a new investment holding.
 */
export const POST = apiHandler(
  async (req) => {
    const body = await req.json();
    const { symbol, name, shares, costBasisCents, currentPriceCents } = body;

    if (!symbol || !name || shares === undefined || costBasisCents === undefined || currentPriceCents === undefined) {
      throw new ServiceError("Missing required fields", 400);
    }

    const uppercaseSymbol = symbol.toUpperCase();

    const holding = await prisma.investmentHolding.upsert({
      where: { symbol: uppercaseSymbol },
      update: {
        name,
        shares,
        costBasisCents: Number(costBasisCents),
        currentPriceCents: Number(currentPriceCents),
        lastUpdatedAt: new Date(),
      },
      create: {
        symbol: uppercaseSymbol,
        name,
        shares,
        costBasisCents: Number(costBasisCents),
        currentPriceCents: Number(currentPriceCents),
        lastUpdatedAt: new Date(),
      },
    });

    return { ok: true, holding };
  },
  { auth: "owner" }
);

/**
 * DELETE /api/wealth
 * Deletes a holding from the portfolio.
 */
export const DELETE = apiHandler(
  async (req) => {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      throw new ServiceError("Holding ID is required", 400);
    }

    await prisma.investmentHolding.delete({
      where: { id },
    });

    return { ok: true };
  },
  { auth: "owner" }
);
