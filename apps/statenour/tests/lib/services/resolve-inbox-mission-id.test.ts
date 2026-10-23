/**
 * resolveInboxMissionId tests · v10.0.529.106 · Wave 54
 *
 * The canonical inbox-resolver in lib/services/missions.ts has 4
 * decision paths and a cache layer. Pre-Wave-43 four sites
 * hardcoded `missionId: "m-inbox"` as a string literal · the
 * helper unified them by trying:
 *   1. Cache hit (returns prior result without a query)
 *   2. m-inbox id (seeded canonical)
 *   3. Title-based fallback (any active "Inbox" mission)
 *   4. Create fresh with id=m-inbox + title=Inbox
 *   5. Race-on-create · catch P2002, re-read by id
 *
 * Critical infra · if this regresses, every Telegram /task, bridge
 * open_loop, journal-ingest, and chat-task tools silently break
 * with FK violations. The fan-out is wide so the test surface
 * needs all paths covered.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mission: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { mission: mocks.mission },
}));

// Other imports the missions service pulls — stubbed so the import
// graph resolves without spinning up the whole brain layer.
vi.mock("@/lib/demo-store", () => ({
  getDemoState: vi.fn(() => ({ missions: [], tasks: [] })),
  makeDemoId: vi.fn(() => "demo-id"),
}));
vi.mock("@/lib/runtime", () => ({ isDemoMode: false }));
vi.mock("@/lib/scoring/mission-ranking", () => ({ rankMissions: vi.fn() }));
vi.mock("@/lib/services/tasks", () => ({ syncTaskPriorities: vi.fn() }));
vi.mock("@/lib/db/soft-delete", () => ({
  softDelete: vi.fn(),
  softDeleteMany: vi.fn(),
  // v10.0.529.106 wave-74 · faithful stub for the activeOnly() helper.
  activeOnly: (where?: object) =>
    where ? { ...where, deletedAt: null } : { deletedAt: null },
}));
vi.mock("@/lib/db/entity-audit", () => ({
  logCreate: vi.fn(),
  logUpdate: vi.fn(),
  stripNoise: vi.fn((x) => x),
}));
vi.mock("@/lib/utils/cache", () => ({ invalidate: vi.fn() }));

describe("resolveInboxMissionId · never a deleted or closed inbox (job 2026-10-23, map F4)", () => {
  afterEach(() => {
    mocks.mission.findUnique.mockReset();
    mocks.mission.findFirst.mockReset();
    mocks.mission.create.mockReset();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("a soft-deleted m-inbox is never returned: a fresh Inbox is created under a new id", async () => {
    mocks.mission.findUnique.mockResolvedValue({ id: "m-inbox", deletedAt: new Date("2026-08-01"), status: "PAUSED" });
    mocks.mission.findFirst.mockResolvedValue(null);
    mocks.mission.create.mockImplementation(async ({ data }: { data: { id?: string } }) => {
      if (data.id === "m-inbox") throw Object.assign(new Error("unique"), { code: "P2002" });
      return { id: "m-inbox-fresh" };
    });
    const { resolveInboxMissionId } = await import("@/lib/services/missions");
    await expect(resolveInboxMissionId()).resolves.toBe("m-inbox-fresh");
  });

  it("a PAUSED (not deleted) m-inbox is not a live inbox either", async () => {
    mocks.mission.findUnique.mockResolvedValue({ id: "m-inbox", deletedAt: null, status: "PAUSED" });
    mocks.mission.findFirst.mockResolvedValue({ id: "m-inbox-by-title" });
    const { resolveInboxMissionId } = await import("@/lib/services/missions");
    await expect(resolveInboxMissionId()).resolves.toBe("m-inbox-by-title");
  });
});

// Lens review 2026-10-23 (F4 via the anchor fallback): prod holds 4 COMPLETE general anchors
// and 1 ACTIVE; a closed anchor is never a filing target, on the fast path or the retry.
describe("resolveGeneralAnchorId · only a live anchor is a target", () => {
  afterEach(() => {
    mocks.mission.findUnique.mockReset();
    mocks.mission.create.mockReset();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("a COMPLETE anchor yields null (the task stays in Inbox), and nothing is created over it", async () => {
    mocks.mission.findUnique.mockResolvedValue({ id: "m-general-health", deletedAt: null, status: "COMPLETE" });
    mocks.mission.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    const { resolveGeneralAnchorId } = await import("@/lib/services/missions");
    await expect(resolveGeneralAnchorId("health" as never)).resolves.toBeNull();
  });

  it("a soft-deleted anchor yields null", async () => {
    mocks.mission.findUnique.mockResolvedValue({ id: "m-general-health", deletedAt: new Date("2026-09-01"), status: "ACTIVE" });
    mocks.mission.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    const { resolveGeneralAnchorId } = await import("@/lib/services/missions");
    await expect(resolveGeneralAnchorId("health" as never)).resolves.toBeNull();
  });

  it("control: an ACTIVE anchor is returned", async () => {
    mocks.mission.findUnique.mockResolvedValue({ id: "m-general-health", deletedAt: null, status: "ACTIVE" });
    const { resolveGeneralAnchorId } = await import("@/lib/services/missions");
    await expect(resolveGeneralAnchorId("health" as never)).resolves.toBe("m-general-health");
  });
});

describe("resolveInboxMissionId", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Module-level cache `_cachedInboxId` lives inside missions.ts.
    // resetModules forces a fresh import (and a fresh cache) per
    // test · without this every test after the first would hit the
    // cache and skip all the prisma branches we're trying to test.
    vi.resetModules();
  });

  it("returns m-inbox when the canonical seeded row exists", async () => {
    mocks.mission.findUnique.mockResolvedValueOnce({
      id: "m-inbox",
      deletedAt: null, status: "ACTIVE",
    });
    const { resolveInboxMissionId } = await import("@/lib/services/missions");
    const id = await resolveInboxMissionId();
    expect(id).toBe("m-inbox");
    expect(mocks.mission.findUnique).toHaveBeenCalledTimes(1);
    expect(mocks.mission.findFirst).not.toHaveBeenCalled();
    expect(mocks.mission.create).not.toHaveBeenCalled();
  });

  it("ignores m-inbox when soft-deleted, falls through to title lookup", async () => {
    mocks.mission.findUnique.mockResolvedValueOnce({
      id: "m-inbox",
      deletedAt: new Date(),
    });
    mocks.mission.findFirst.mockResolvedValueOnce({ id: "m-other-inbox" });
    const { resolveInboxMissionId } = await import("@/lib/services/missions");
    const id = await resolveInboxMissionId();
    expect(id).toBe("m-other-inbox");
    expect(mocks.mission.findFirst).toHaveBeenCalledWith({
      where: { title: "Inbox", deletedAt: null, status: "ACTIVE" },
      select: { id: true },
    });
    expect(mocks.mission.create).not.toHaveBeenCalled();
  });

  it("creates a fresh m-inbox when nothing exists at all", async () => {
    mocks.mission.findUnique.mockResolvedValueOnce(null);
    mocks.mission.findFirst.mockResolvedValueOnce(null);
    mocks.mission.create.mockResolvedValueOnce({ id: "m-inbox" });
    const { resolveInboxMissionId } = await import("@/lib/services/missions");
    const id = await resolveInboxMissionId();
    expect(id).toBe("m-inbox");
    expect(mocks.mission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: "m-inbox",
          title: "Inbox",
          domain: "PERSONAL",
          status: "ACTIVE",
        }),
        select: { id: true },
      }),
    );
  });

  it("recovers from a P2002 race by re-reading the freshly-created row", async () => {
    mocks.mission.findUnique
      .mockResolvedValueOnce(null) // initial probe
      .mockResolvedValueOnce({ id: "m-inbox", deletedAt: null, status: "ACTIVE" }); // race retry
    mocks.mission.findFirst.mockResolvedValueOnce(null);
    mocks.mission.create.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );
    const { resolveInboxMissionId } = await import("@/lib/services/missions");
    const id = await resolveInboxMissionId();
    expect(id).toBe("m-inbox");
    expect(mocks.mission.findUnique).toHaveBeenCalledTimes(2);
  });

  it("throws ServiceError when create fails AND retry can't find the row", async () => {
    mocks.mission.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null); // retry also misses
    mocks.mission.findFirst.mockResolvedValueOnce(null);
    mocks.mission.create.mockRejectedValueOnce(new Error("DB unreachable"));
    const { resolveInboxMissionId } = await import("@/lib/services/missions");
    await expect(resolveInboxMissionId()).rejects.toThrow(
      "Failed to resolve Inbox mission",
    );
  });

  it("caches the resolved id so a second call skips prisma entirely", async () => {
    mocks.mission.findUnique.mockResolvedValueOnce({
      id: "m-inbox",
      deletedAt: null, status: "ACTIVE",
    });
    const { resolveInboxMissionId } = await import("@/lib/services/missions");
    await resolveInboxMissionId();
    await resolveInboxMissionId();
    await resolveInboxMissionId();
    // Three calls · only ONE findUnique because of the module-scope cache.
    expect(mocks.mission.findUnique).toHaveBeenCalledTimes(1);
  });

  it("tolerates findUnique throwing without breaking the resolver chain", async () => {
    mocks.mission.findUnique.mockRejectedValueOnce(new Error("transient DB hiccup"));
    mocks.mission.findFirst.mockResolvedValueOnce({ id: "m-fallback" });
    const { resolveInboxMissionId } = await import("@/lib/services/missions");
    const id = await resolveInboxMissionId();
    expect(id).toBe("m-fallback");
  });
});
