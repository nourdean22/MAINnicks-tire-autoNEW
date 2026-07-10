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

  it("filters out SYSTEM, GENERAL, Inbox, and Inbox - <domain> missions in-memory", async () => {
    mocks.mission.findMany.mockResolvedValueOnce([
      // Excluded: SYSTEM
      { id: "m1", title: "System Watcher", domain: "HEALTH", priority: 10, status: "ACTIVE", systemKind: "SYSTEM" },
      // Excluded: GENERAL (by isGeneralAnchor)
      { id: "m2", title: "General Business Anchor", domain: "BUSINESS", priority: 20, status: "ACTIVE", systemKind: "GENERAL" },
      // Excluded: Inbox (by title)
      { id: "m3", title: "Inbox", domain: "PERSONAL", priority: 30, status: "ACTIVE", systemKind: null },
      // Excluded: Inbox - business (by title)
      { id: "m4", title: "Inbox - business", domain: "BUSINESS", priority: 40, status: "ACTIVE", systemKind: null },
      // Included: normal user mission
      { id: "m5", title: "Tire Shop Expansion", domain: "BUSINESS", priority: 50, status: "ACTIVE", systemKind: null },
    ]);

    const result = await (missionsTools.getMissions.execute as any)({});
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("m5");
    expect(result[0].title).toBe("Tire Shop Expansion");

    expect(mocks.mission.findMany).toHaveBeenCalledWith({
      where: {
        status: "ACTIVE",
        deletedAt: null,
      },
      select: { id: true, title: true, domain: true, priority: true, status: true, systemKind: true },
      orderBy: { priority: "desc" },
    });
  });

  it("throws a clear unavailable error on database failure", async () => {
    mocks.mission.findMany.mockRejectedValueOnce(new Error("Connection timeout"));

    await expect(
      (missionsTools.getMissions.execute as any)({})
    ).rejects.toThrow("Missions database is unavailable: Connection timeout");
  });
});
