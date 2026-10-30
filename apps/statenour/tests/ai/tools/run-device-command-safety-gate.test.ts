/**
 * runDeviceCommand physical-safety gate · 2026-10-30 · Ring/Tuya W0.
 *
 * Before this gate the chat tool's only guard was "device OFFLINE -> refuse"
 * (lib/ai/tools/system.ts). The room lock and the water heater read OFFLINE
 * only because the home agent died in April; reviving it would have let
 * "unlock my room" enqueue a real unlock with no per-command go from Nour.
 *
 * The eval set below is six ordinary phrasings resolved to tool args, run
 * against the REAL tool with Prisma mocked. The assertion is on the consumer
 * end: did a DeviceCommand row get created (that row is what an agent polls).
 * Positive controls: a TV turn_on and a camera snapshot still enqueue.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { db } = vi.hoisted(() => ({
  db: {
    smartDevice: { findUnique: vi.fn(), findMany: vi.fn() },
    deviceCommand: { create: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: db, resetQueryCount: vi.fn(), getQueryCount: vi.fn(() => 0) }));
vi.mock("@/lib/workers/external-worker", () => ({
  getExternalWorkerJob: vi.fn(),
  getExternalWorkerLaneSnapshots: vi.fn(),
  getExternalWorkerLanes: vi.fn(),
  queueExternalWorker: vi.fn(),
}));

import { systemTools } from "@/lib/ai/tools/system";

type Row = { id: string; name: string; platform: string; status: string; location: string | null; deviceType: string };

const LOCK: Row = { id: "d-lock", name: "Nour Roomlock", platform: "TUYA", status: "ONLINE", location: "home-bedroom", deviceType: "LOCK" };
const HEATER: Row = { id: "d-heat", name: "Water Heater", platform: "TUYA", status: "ONLINE", location: "home", deviceType: "HEATER" };
// The old agent's category map labelled Tuya category `rs` (water heater) IR_REMOTE.
const HEATER_MISLABELLED: Row = { ...HEATER, id: "d-heat2", deviceType: "IR_REMOTE" };
const GATEWAY: Row = { id: "d-gw", name: "E02F Device", platform: "TUYA", status: "ONLINE", location: "home", deviceType: "OTHER" };
const TV: Row = { id: "d-tv", name: "TV Basement", platform: "TUYA", status: "ONLINE", location: "home-basement", deviceType: "IR_REMOTE" };
const CAM: Row = { id: "d-cam", name: "Front", platform: "RING", status: "ONLINE", location: "home-front", deviceType: "CAMERA" };

type Exec = (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
const run = (args: Record<string, unknown>) =>
  (systemTools.runDeviceCommand as unknown as { execute: Exec }).execute(args);

function resolveTo(row: Row) {
  db.smartDevice.findUnique.mockResolvedValue(row);
  db.smartDevice.findMany.mockResolvedValue([row]);
}

beforeEach(() => {
  db.smartDevice.findUnique.mockReset();
  db.smartDevice.findMany.mockReset();
  db.deviceCommand.create.mockReset();
  db.deviceCommand.create.mockResolvedValue({ id: "cmd-1", status: "pending", createdAt: new Date() });
});

describe("runDeviceCommand physical-safety gate (eval: 6 phrasings)", () => {
  const refused: Array<[string, Row, Record<string, unknown>]> = [
    ["'unlock my room'", LOCK, { nameQuery: "room", command: "unlock" }],
    ["'lock the room door'", LOCK, { deviceId: LOCK.id, command: "lock" }],
    ["'turn the water heater off'", HEATER, { nameQuery: "water heater", command: "turn_off" }],
    ["'turn on the water heater' (row mislabelled IR_REMOTE)", HEATER_MISLABELLED, { nameQuery: "water heater", command: "turn_on" }],
    ["'UNLOCK ' sent to the lock's gateway (verb gate, case and space)", GATEWAY, { deviceId: GATEWAY.id, command: "UNLOCK " }],
    ["a raw vendor command to any device", TV, { deviceId: TV.id, command: "raw", params: { commands: [] } }],
  ];

  it.each(refused)("refuses %s and enqueues nothing", async (_label, row, args) => {
    resolveTo(row);
    const out = await run(args);
    expect(out.success).toBe(false);
    expect(out.reason).toBe("needs_nour_approval");
    expect(db.deviceCommand.create).not.toHaveBeenCalled();
  });

  it("refuses set_temp, arm and disarm on any device", async () => {
    for (const command of ["set_temp", "arm", "disarm"]) {
      resolveTo(TV);
      const out = await run({ deviceId: TV.id, command });
      expect(out.reason).toBe("needs_nour_approval");
    }
    expect(db.deviceCommand.create).not.toHaveBeenCalled();
  });

  it("positive control: 'turn the basement TV on' still enqueues", async () => {
    resolveTo(TV);
    const out = await run({ nameQuery: "tv", command: "turn_on" });
    expect(out.success).toBe(true);
    expect(db.deviceCommand.create).toHaveBeenCalledTimes(1);
  });

  it("positive control: a camera snapshot enqueues the normalized verb", async () => {
    resolveTo(CAM);
    const out = await run({ deviceId: CAM.id, command: " Snapshot" });
    expect(out.success).toBe(true);
    expect(db.deviceCommand.create.mock.calls[0][0].data.command).toBe("snapshot");
  });
});
