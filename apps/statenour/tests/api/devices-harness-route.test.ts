/**
 * POST /api/devices/harness: the only door a PC has into the harness card. Written red first.
 * lib/auth-guard cannot load under vitest (next-auth), so its device door is rebuilt from the same two
 * pure helpers it calls: the 401s below are the real key compare, and they prove the route asks for it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const heartbeatRunner = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("@/lib/services/runner-state", () => ({ heartbeatRunner }));
vi.mock("@/lib/prisma", () => ({ prisma: {}, resetQueryCount: () => {}, getQueryCount: () => 0 }));

import { POST } from "@/app/api/devices/harness/route";
import { requireDeviceAgentAuth } from "@/lib/auth-guard";
import { deviceDoorAccepts } from "@/lib/security/device-agent-auth";
import { presentedLedgerKey } from "@/lib/security/evidence-ledger-auth";
import { ServiceError } from "@/lib/utils/service-error";

const KEY = "device-key-for-tests-0123456789";
const clean = {
  pc: "nicksmax",
  sha: null,
  ramFreeMb: null,
  heavy: null,
  chrome: null,
  sessionsActive: null,
  worktrees: null,
  health: null,
  prs: null,
  merged: null,
  mainSha: null,
  graph: null,
  vaultGraph: null,
  sites: { bdnick: null, nickstire: null },
  unread: { prs: "gh not installed" },
};
const call = (body: unknown, key?: string) =>
  POST(
    new Request("http://local.test/api/devices/harness", {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { "x-sync-key": key } : {}) },
      body: JSON.stringify(body),
    }) as never,
    {} as never,
  );

describe("POST /api/devices/harness", () => {
  beforeEach(() => {
    heartbeatRunner.mockClear();
    vi.mocked(requireDeviceAgentAuth).mockImplementation((req: Request) => {
      const env = { DEVICE_AGENT_KEY: process.env.DEVICE_AGENT_KEY, STATENOUR_SYNC_KEY: process.env.STATENOUR_SYNC_KEY };
      if (!deviceDoorAccepts(presentedLedgerKey(req.headers), env)) throw new ServiceError("Unauthorized", 401);
    });
    vi.stubEnv("DEVICE_AGENT_KEY", KEY);
    vi.stubEnv("STATENOUR_SYNC_KEY", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("refuses a call with no key and stores nothing", async () => {
    const res = await call(clean);
    expect(res.status).toBe(401);
    expect(heartbeatRunner).not.toHaveBeenCalled();
  });

  it("refuses a wrong key and stores nothing", async () => {
    const res = await call(clean, "not-the-key");
    expect(res.status).toBe(401);
    expect(heartbeatRunner).not.toHaveBeenCalled();
  });

  it("stores a clean snapshot under the PC's own node, with the server's clock", async () => {
    const res = await call(clean, KEY);
    expect(res.status).toBe(200);
    expect(heartbeatRunner).toHaveBeenCalledTimes(1);
    expect(heartbeatRunner.mock.calls[0][0]).toMatchObject({
      nodeKey: "harness:nicksmax",
      label: "NicksMax",
      metadata: { harnessSnapshot: { pc: "nicksmax" } },
    });
  });

  it("refuses a body carrying a path, with the right key, and stores nothing", async () => {
    const res = await call({ ...clean, unread: { ram: "C:\\Users\\x failed" } }, KEY);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(heartbeatRunner).not.toHaveBeenCalled();
  });
});
