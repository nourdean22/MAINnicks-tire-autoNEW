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
import { logError } from "@/lib/utils/error-log";

export const healthTools = {
  getBodyData: tool({
    description: "Get recent body tracking entries",
    inputSchema: z.object({ days: z.number().min(1).max(365).default(30) }),
    execute: async ({ days }) => {
      // truth-substrate audit P0 (#6): keep the tool resilient (return [] so the
      // chat turn survives) but never SILENTLY conceal a failed read — a swallowed
      // error otherwise reads to the model as "no body tracking entries", and
      // downstream (pipeline-controller) even treats that absence as an avoidance
      // signal. Log loudly so the failure is observable.
      return prisma.bodyTracking.findMany({
        where: { date: { gte: toDateString(daysAgo(days)) } },
        orderBy: { date: "desc" },
      }).catch((e): never[] => {
        logError("ai.tools.health.getBodyData", e, { days });
        return [];
      });
    },
  }),

};
