import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";
import { fetchQuoteCents } from "@/lib/services/market-quote";

export const dynamic = "force-dynamic";

/**
 * POST /api/wealth/refresh-prices
 * Pulls the latest market price for every holding (Stooq, keyless) and updates
 * currentPriceCents. Symbols that can't be resolved are left untouched and
 * returned in `failed` so the UI can flag them — never silently zeroed.
 */
export const POST = apiHandler(
  async () => {
    const holdings = await prisma.investmentHolding.findMany({ orderBy: { symbol: "asc" } });

    // Fetch all quotes in parallel, then apply DB writes sequentially.
    const quotes = await Promise.all(holdings.map((h) => fetchQuoteCents(h.symbol)));

    let updated = 0;
    const failed: string[] = [];

    for (let i = 0; i < holdings.length; i++) {
      const h = holdings[i];
      const priceCents = quotes[i].priceCents;

      if (priceCents === null) {
        failed.push(h.symbol);
        continue;
      }
      if (priceCents !== h.currentPriceCents) {
        await prisma.investmentHolding.update({
          where: { id: h.id },
          data: { currentPriceCents: priceCents, lastUpdatedAt: new Date() },
        });
        updated++;
      }
    }

    return { updated, total: holdings.length, failed };
  },
  { auth: "owner" }
);
