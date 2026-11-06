/**
 * The bridge's harness_status read (nickstire /admin Harness card). Harness actions cross to nickstire as
 * names and states only: a PC's output and a requester's free-text reason stay on bdnick.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const readHarnessStatus = vi.hoisted(() => vi.fn());
vi.mock("@/lib/services/harness-status", () => ({ readHarnessStatus }));
vi.mock("@/lib/prisma", () => ({ prisma: {}, resetQueryCount: () => {}, getQueryCount: () => 0 }));

import { POST } from "@/app/api/nour-os/query/route";

const KEY = "bridge-key-for-tests-0123456789abcdef";
const call = () =>
  POST(
    new Request("http://local.test/api/nour-os/query", {
      method: "POST",
      headers: { "content-type": "application/json", "x-sync-key": KEY },
      body: JSON.stringify({ query: "harness_status" }),
    }) as never,
  );

describe("nour-os query · harness_status", () => {
  beforeEach(() => vi.stubEnv("STATENOUR_SYNC_KEY", KEY));
  afterEach(() => vi.unstubAllEnvs());

  it("POSITIVE CONTROL: Nick's node and the action states come through", async () => {
    readHarnessStatus.mockResolvedValueOnce({
      reporting: 0,
      pcs: [],
      nick: { state: "reporting", version: "abc1234" },
      actions: [{ id: "ha_1", pc: "nattynour", action: "pc-status", state: "DONE", exitCode: 0, reason: "why", output: "free RAM: 1 MB", error: "boom" }],
      actionsReason: null,
    });
    const body = JSON.stringify(await (await call()).json());
    expect(body).toContain('"state":"reporting"');
    expect(body).toContain('"action":"pc-status"');
    expect(body).toContain('"exitCode":0');
    expect(body).not.toContain("free RAM");
    expect(body).not.toContain('"reason":"why"');
    expect(body).not.toContain("boom");
  });

  it("an unread action list stays null with its reason, never an empty list", async () => {
    readHarnessStatus.mockResolvedValueOnce({ reporting: 0, pcs: [], actions: null, actionsReason: "Harness control is not migrated yet" });
    const json = await (await call()).json();
    const data = json.data ?? json;
    expect(data.actions).toBeNull();
    expect(data.actionsReason).toBe("Harness control is not migrated yet");
  });
});
