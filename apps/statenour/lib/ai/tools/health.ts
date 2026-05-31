/**
 * Health tools — body tracking reads.
 *
 * Includes: getBodyData.
 *
 * v10.0.529.106 · Wave 82 · extracted from monolithic lib/ai/tools.ts.
 * Aggregate barrel: lib/ai/tools.ts re-exports nourTools composed from
 * all 7 domain files. Catalog source of truth: lib/ai/tools/catalog.ts.
 */

import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { daysAgo, toDateString } from "@/lib/utils/datetime";

export const healthTools = {
  getBodyData: tool({
    description: "Get recent body tracking entries",
    inputSchema: z.object({ days: z.number().min(1).max(365).default(30) }),
    execute: async ({ days }) => {
      return prisma.bodyTracking.findMany({
        where: { date: { gte: toDateString(daysAgo(days)) } },
        orderBy: { date: "desc" },
      }).catch((): never[] => []);
    },
  }),

};
