import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mission: {
    findMany: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mission: mocks.mission,
  },
}));

import { missionsTools } from "@/lib/ai/tools/missions";

describe("getMissions tool execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters out SYSTEM missions and projects systemKind", async () => {
    mocks.mission.findMany.mockResolvedValueOnce([
      { id: "m1", title: "Mission 1", domain: "HEALTH", priority: 10, status: "ACTIVE", systemKind: null },
      { id: "m2", title: "Mission 2", domain: "BUSINESS", priority: 20, status: "ACTIVE", systemKind: "GENERAL" },
    ]);

    const result = await (missionsTools.getMissions.execute as any)({});
    expect(result).toHaveLength(2);
    expect(mocks.mission.findMany).toHaveBeenCalledWith({
      where: {
        status: "ACTIVE",
        deletedAt: null,
        OR: [
          { systemKind: null },
          { systemKind: { not: "SYSTEM" } }
        ]
      },
      select: { id: true, title: true, domain: true, priority: true, status: true, systemKind: true },
      orderBy: { priority: "desc" },
    });
  });
});
