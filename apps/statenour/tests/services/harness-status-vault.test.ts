/** readHarnessStatus' database half: each vault read stands alone, and the count skips deleted rows. Red first. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ runners: vi.fn(), log: vi.fn(), count: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    runnerNode: { findMany: db.runners },
    localSyncLog: { findFirst: db.log },
    brainMemory: { count: db.count },
  },
}));

import { readHarnessStatus } from "@/lib/services/harness-status";

const statusRow = (body: unknown) => ({ details: JSON.stringify(body) });

describe("readHarnessStatus vault row", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.runners.mockResolvedValue([]);
    db.log.mockResolvedValue(statusRow({ lastExportRunAt: "2026-11-05T12:00:00.000Z", lastExportCount: 1200 }));
    db.count.mockResolvedValue(3400);
  });

  it("counts live rows on the export's own population: not deleted, superseded rows stay in", async () => {
    await readHarnessStatus();
    expect(db.count).toHaveBeenCalledWith({ where: { deletedAt: null } });
  });

  it("reads the export time and the count from the status row", async () => {
    const { vault } = await readHarnessStatus();
    expect(vault).toMatchObject({ lastExportAt: "2026-11-05T12:00:00.000Z", exportedCount: 1200, liveCount: 3400, unread: {} });
  });

  it("a failed count leaves liveCount null with a reason, and the export fields survive", async () => {
    db.count.mockRejectedValue(new Error("db down"));
    const { vault } = await readHarnessStatus();
    expect(vault.liveCount).toBeNull();
    expect(vault.unread.liveCount).toMatch(/could not be read/i);
    expect(vault.lastExportAt).toBe("2026-11-05T12:00:00.000Z");
    expect(vault.exportedCount).toBe(1200);
  });

  it("a failed status read leaves the export fields null with reasons, and the count survives", async () => {
    db.log.mockRejectedValue(new Error("db down"));
    const { vault } = await readHarnessStatus();
    expect(vault.lastExportAt).toBeNull();
    expect(vault.exportedCount).toBeNull();
    expect(vault.unread.lastExportAt).toMatch(/could not be read/i);
    expect(vault.liveCount).toBe(3400);
  });

  it("no count on the row reads unknown with a reason, not zero", async () => {
    db.log.mockResolvedValue(statusRow({ lastExportRunAt: "2026-11-05T12:00:00.000Z" }));
    const { vault } = await readHarnessStatus();
    expect(vault.exportedCount).toBeNull();
    expect(vault.unread.exportedCount).toMatch(/does not record/i);
  });

  it("a failed runner read throws, so the card says it could not load", async () => {
    db.runners.mockRejectedValue(new Error("db down"));
    await expect(readHarnessStatus()).rejects.toThrow("db down");
  });
});
