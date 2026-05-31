/**
 * Finance tools — financial snapshot reads.
 *
 * Includes: getFinancialSnapshot.
 *
 * v10.0.529.106 · Wave 82 · extracted from monolithic lib/ai/tools.ts.
 * Aggregate barrel: lib/ai/tools.ts re-exports nourTools composed from
 * all 7 domain files. Catalog source of truth: lib/ai/tools/catalog.ts.
 */

import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const financeTools = {
  getFinancialSnapshot: tool({
    description: "Get the latest financial snapshot",
    inputSchema: z.object({}),
    execute: async () => {
      return prisma.financialSnapshot.findFirst({ orderBy: { date: "desc" } }).catch((): null => null);
    },
  }),

};
