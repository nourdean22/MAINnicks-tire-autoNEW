/**
 * Tuya local keys: not stored, not served · 2026-10-30 · Ring/Tuya W0.
 *
 * Consumer-end assertions: what reaches prisma on a write, and what a
 * bridge-key holder gets back on a read. The three doors the April agent's
 * payload could pass through: POST /api/sync/nour-os module=devices (create),
 * PATCH /api/devices/:id (bridge heartbeat), and the two bridge-key reads.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    smartDevice: { upsert: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    localSyncLog: { create: vi.fn() },
    $transaction: vi.fn(),
    runnerNode: { upsert: vi.fn() },
  },
}));

vi.mock("@/lib/utils/http", () => ({
  apiHandler: (h: unknown) => h,
  syncHandler: (h: unknown) => h,
}));
vi.mock("@/lib/prisma", () => ({ prisma: db, resetQueryCount: vi.fn(), getQueryCount: vi.fn(() => 0) }));
vi.mock("@/lib/integrations/gmail-sync", () => ({ processGmailItems: vi.fn() }));
vi.mock("@/lib/services/tasks", () => ({ createTask: vi.fn() }));
vi.mock("@/lib/services/missions", () => ({ resolveInboxMissionId: vi.fn() }));
vi.mock("@/lib/services/bridge-receipts", () => ({
  holdStandingSlot: vi.fn(),
  parseStandingTrigger: vi.fn(),
  readIdempotencyKey: vi.fn(),
  runOnceByKey: vi.fn(),
}));

import { POST as syncPost } from "@/app/api/sync/nour-os/route";
import { GET as listGet, POST as listPost } from "@/app/api/devices/route";
import { GET as oneGet, PATCH as onePatch } from "@/app/api/devices/[id]/route";

type H = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Record<string, unknown>>;
const call = (h: unknown, req: Request, params: Record<string, string> = {}) =>
  (h as H)(req, { params: Promise.resolve(params) });
const json = (url: string, method: string, body: unknown) =>
  new Request(url, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });

const LEAKY_ROW = {
  id: "d-lock",
  platformDeviceId: "eb1060",
  name: "Nour Roomlock",
  metadata: { category: "ms", local_key: "LANKEY", product_name: "Lock" },
};

beforeEach(() => {
  vi.clearAllMocks();
  db.smartDevice.upsert.mockResolvedValue({ id: "d-lock" });
  db.localSyncLog.create.mockResolvedValue({});
  db.runnerNode.upsert.mockResolvedValue({});
});

describe("local_key is not stored", () => {
  it("sync route devices create drops local_key from metadata", async () => {
    await call(syncPost, json("https://x/api/sync/nour-os", "POST", {
      module: "devices",
      data: { devices: [{ platformDeviceId: "eb1060", name: "Nour Roomlock", platform: "TUYA", metadata: LEAKY_ROW.metadata }] },
    }));
    const stored = db.smartDevice.upsert.mock.calls[0][0].create.metadata;
    expect(stored).toEqual({ category: "ms", product_name: "Lock" });
  });

  it("POST /api/devices (bulk upsert) drops it on create and update and in the response", async () => {
    db.$transaction.mockImplementation(async (ops: unknown[]) => ops.map(() => LEAKY_ROW));
    const out = await call(listPost, json("https://x/api/devices", "POST", {
      devices: [{ platformDeviceId: "eb1060", name: "Nour Roomlock", platform: "TUYA", metadata: LEAKY_ROW.metadata }],
    }));
    const args = db.smartDevice.upsert.mock.calls[0][0];
    expect(args.create.metadata).toEqual({ category: "ms", product_name: "Lock" });
    expect(args.update.metadata).toEqual({ category: "ms", product_name: "Lock" });
    expect(JSON.stringify(out)).not.toContain("LANKEY");
  });

  it("PATCH /api/devices/:id drops local_key from metadata", async () => {
    db.smartDevice.findFirst.mockResolvedValue({ id: "d-lock" });
    db.smartDevice.update.mockResolvedValue(LEAKY_ROW);
    await call(onePatch, json("https://x/api/devices/d-lock", "PATCH", { metadata: LEAKY_ROW.metadata }), { id: "d-lock" });
    expect(db.smartDevice.update.mock.calls[0][0].data.metadata).toEqual({ category: "ms", product_name: "Lock" });
  });
});

describe("local_key is not served (rows already stored before the fix)", () => {
  it("GET /api/devices strips it from every row", async () => {
    db.smartDevice.findMany.mockResolvedValue([LEAKY_ROW]);
    const out = await call(listGet, new Request("https://x/api/devices"));
    const devices = out.devices as Array<{ metadata: Record<string, unknown> }>;
    expect(devices[0].metadata).toEqual({ category: "ms", product_name: "Lock" });
    expect(JSON.stringify(out)).not.toContain("LANKEY");
  });

  it("GET /api/devices/:id strips it", async () => {
    db.smartDevice.findFirst.mockResolvedValue({ ...LEAKY_ROW, events: [], commands: [] });
    const out = await call(oneGet, new Request("https://x/api/devices/d-lock"), { id: "d-lock" });
    expect(JSON.stringify(out)).not.toContain("LANKEY");
  });

  it("PATCH response strips it", async () => {
    db.smartDevice.findFirst.mockResolvedValue({ id: "d-lock" });
    db.smartDevice.update.mockResolvedValue(LEAKY_ROW);
    const out = await call(onePatch, json("https://x/api/devices/d-lock", "PATCH", { status: "ONLINE" }), { id: "d-lock" });
    expect(JSON.stringify(out)).not.toContain("LANKEY");
  });

  it("positive control: the rest of the row is still returned", async () => {
    db.smartDevice.findMany.mockResolvedValue([LEAKY_ROW]);
    const out = await call(listGet, new Request("https://x/api/devices"));
    expect((out.devices as Array<{ name: string }>)[0].name).toBe("Nour Roomlock");
  });
});
