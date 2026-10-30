/**
 * PATCH /api/devices/:id currentStateMerge · 2026-10-30 · Ring W1a (Codex P2 on PR 3413).
 *
 * `currentState` replaces the whole JSON value (the camera bridge sends its full
 * state each beat, so replace is right for it). The Ring poller only knows
 * connection, battery and firmware; replacing would erase fields another writer
 * owns, such as `snapshotUrl` that /api/cameras reads. `currentStateMerge` merges
 * into the stored state instead. Consumer-end: what reaches prisma.update.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { db } = vi.hoisted(() => ({
  db: { smartDevice: { findFirst: vi.fn(), update: vi.fn() } },
}));
vi.mock("@/lib/utils/http", () => ({ apiHandler: (h: unknown) => h }));
vi.mock("@/lib/prisma", () => ({ prisma: db, resetQueryCount: vi.fn(), getQueryCount: vi.fn(() => 0) }));

import { PATCH } from "@/app/api/devices/[id]/route";

type H = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<unknown>;
const patch = (body: unknown) =>
  (PATCH as unknown as H)(
    new Request("https://x/api/devices/ring-1", { method: "PATCH", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: "ring-1" }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  db.smartDevice.findFirst.mockResolvedValue({ id: "d1", currentState: { snapshotUrl: "https://img/1.jpg", connection: "offline" } });
  db.smartDevice.update.mockResolvedValue({ id: "d1", metadata: null });
});

describe("PATCH currentStateMerge", () => {
  it("merges into the stored state: other fields survive, its own fields win", async () => {
    await patch({ status: "ONLINE", currentStateMerge: { connection: "online", battery: "87" } });
    expect(db.smartDevice.update.mock.calls[0][0].data.currentState).toEqual({
      snapshotUrl: "https://img/1.jpg",
      connection: "online",
      battery: "87",
    });
  });

  it("merges onto an empty stored state", async () => {
    db.smartDevice.findFirst.mockResolvedValue({ id: "d1", currentState: null });
    await patch({ currentStateMerge: { connection: "online" } });
    expect(db.smartDevice.update.mock.calls[0][0].data.currentState).toEqual({ connection: "online" });
  });

  it("positive control: currentState still replaces (the camera bridge's contract)", async () => {
    await patch({ currentState: { frames: 10 } });
    expect(db.smartDevice.update.mock.calls[0][0].data.currentState).toEqual({ frames: 10 });
  });
});
