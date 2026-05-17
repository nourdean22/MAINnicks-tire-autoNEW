import { apiHandler } from "@/lib/utils/http";
import { brainMemory } from "@/lib/brain/memory-manager";
import { prisma } from "@/lib/prisma";

/** GET /api/brain/status — Brain health and memory stats */
export const GET = apiHandler(async () => {
  const [memoryStatus, recentPatterns, automationRules] = await Promise.all([
    brainMemory.getStatus(),
    prisma.patternDetection.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { patternName: true, date: true, evidence: true },
    }),
    prisma.automationRule.findMany({
      where: { enabled: true },
      select: { name: true, priority: true, lastFired: true, fireCount: true },
      orderBy: { priority: "asc" },
    }),
  ]);

  return {
    memories: memoryStatus,
    recentPatterns,
    automationRules: {
      active: automationRules.length,
      rules: automationRules,
    },
  };
}, { auth: "owner" }); // v9.1.17 · added by add-get-route-auth.ts