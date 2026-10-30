/**
 * The device door is the one the agent-facing device routes consult · 2026-10-30 · Ring/Tuya W0.
 *
 * deviceDoorAccepts (tests/security/device-agent-auth.test.ts) proves the key
 * decision. This proves the wiring through the REAL apiHandler: every route the
 * home agent calls returns 401 when requireDeviceAgentAuth refuses, and the
 * scope arm shows /api/sync/nour-os still answers only to the bridge door.
 * The global auth-guard mock lets every guard pass; each case overrides one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { requireDeviceAgentAuth, requireSyncAuth } from "@/lib/auth-guard";
import { ServiceError } from "@/lib/utils/service-error";

vi.mock("@/lib/prisma", () => {
  const empty = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockRejectedValue(new Error("nope")),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    create: vi.fn().mockResolvedValue({}),
    upsert: vi.fn().mockResolvedValue({ id: "x" }),
  });
  return {
    prisma: {
      smartDevice: empty(),
      deviceCommand: empty(),
      deviceEvent: empty(),
      localSyncLog: empty(),
      runnerNode: empty(),
      $transaction: vi.fn().mockResolvedValue([]),
    },
    resetQueryCount: vi.fn(),
    getQueryCount: vi.fn(() => 0),
  };
});

import * as devices from "@/app/api/devices/route";
import * as device from "@/app/api/devices/[id]/route";
import * as events from "@/app/api/devices/[id]/events/route";
import * as perDeviceCommand from "@/app/api/devices/[id]/command/route";
import * as queue from "@/app/api/devices/queue/route";
import * as commandById from "@/app/api/devices/command/[id]/route";
import * as nourOs from "@/app/api/sync/nour-os/route";

type Route = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<unknown>;
const refuse = () => {
  throw new ServiceError("Unauthorized", 401);
};
async function status(handler: unknown, method: string, url: string, body?: unknown): Promise<number> {
  const req = new NextRequest(url, { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
  const res = (await (handler as Route)(req, { params: Promise.resolve({ id: "d-1" }) })) as Response;
  return res.status;
}

const AGENT_ROUTES: Array<[string, unknown, string, string, unknown?]> = [
  ["GET /api/devices", devices.GET, "GET", "http://x/api/devices"],
  ["POST /api/devices", devices.POST, "POST", "http://x/api/devices", { devices: [] }],
  ["GET /api/devices/:id", device.GET, "GET", "http://x/api/devices/d-1"],
  ["PATCH /api/devices/:id", device.PATCH, "PATCH", "http://x/api/devices/d-1", { status: "ONLINE" }],
  ["GET /api/devices/:id/events", events.GET, "GET", "http://x/api/devices/d-1/events"],
  ["POST /api/devices/:id/events", events.POST, "POST", "http://x/api/devices/d-1/events", { event: "motion" }],
  ["GET /api/devices/:id/command", perDeviceCommand.GET, "GET", "http://x/api/devices/d-1/command"],
  ["PATCH /api/devices/:id/command", perDeviceCommand.PATCH, "PATCH", "http://x/api/devices/d-1/command", { commandId: "c" }],
  ["GET /api/devices/queue", queue.GET, "GET", "http://x/api/devices/queue"],
  ["PATCH /api/devices/command/:id", commandById.PATCH, "PATCH", "http://x/api/devices/command/d-1", { status: "acked" }],
];

beforeEach(() => {
  vi.mocked(requireDeviceAgentAuth).mockReset();
  vi.mocked(requireSyncAuth).mockReset();
});

describe("agent-facing device routes use the device door", () => {
  it.each(AGENT_ROUTES)("%s -> 401 when the device door refuses", async (_l, h, method, url, body) => {
    vi.mocked(requireDeviceAgentAuth).mockImplementation(refuse);
    expect(await status(h, method, url, body)).toBe(401);
  });

  it.each(AGENT_ROUTES)("%s -> not 401 when only the bridge door would refuse", async (_l, h, method, url, body) => {
    vi.mocked(requireSyncAuth).mockImplementation(refuse);
    expect(await status(h, method, url, body)).not.toBe(401);
  });
});

describe("scope: the device door opens nothing else", () => {
  it("POST /api/sync/nour-os still answers only to the bridge door", async () => {
    vi.mocked(requireSyncAuth).mockImplementation(refuse);
    expect(await status(nourOs.POST, "POST", "http://x/api/sync/nour-os", { module: "devices", data: { devices: [] } })).toBe(401);
  });
});
