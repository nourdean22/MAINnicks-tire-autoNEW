/**
 * Nick's node stamp and the harness card's action read (job 2026-11-06-harness-control-nick-node).
 * heartbeatNick never throws and says what it stamped; a failed action read is unread, never "none".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { heartbeatRunner, findMany, runnerFindMany } = vi.hoisted(() => ({
  heartbeatRunner: vi.fn(),
  findMany: vi.fn(),
  runnerFindMany: vi.fn(),
}));
vi.mock("@/lib/services/runner-state", () => ({ heartbeatRunner }));
vi.mock("@/lib/services/deploy-identity", () => ({ getDeployMeta: () => ({ sha: "10f7860c70aa" }) }));
vi.mock("@/lib/logger", () => ({ logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    runnerNode: { findMany: runnerFindMany },
    harnessAction: { findMany },
    localSyncLog: { findFirst: async () => null },
    brainMemory: { count: async () => 0 },
  },
}));

import { heartbeatNick, resultStatus } from "@/lib/services/harness-control";
import { NICK_NODE_KEY, readHarnessStatus } from "@/lib/services/harness-status";

const CONTROL = "control-key-for-tests-0123456789abcdef";

describe("heartbeatNick", () => {
  beforeEach(() => {
    heartbeatRunner.mockReset();
    vi.stubEnv("HARNESS_CONTROL_KEY", CONTROL);
    vi.stubEnv("DEVICE_AGENT_KEY", "device-key-for-tests-0123456789abcdef");
    vi.stubEnv("STATENOUR_SYNC_KEY", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("POSITIVE CONTROL: stamps harness:nick with the deploy commit and a ready control key", async () => {
    heartbeatRunner.mockResolvedValueOnce({});
    expect(await heartbeatNick()).toBe("stamped");
    expect(heartbeatRunner.mock.calls[0][0]).toMatchObject({
      nodeKey: NICK_NODE_KEY,
      label: "Nick",
      version: "10f7860c70aa",
      metadata: { harnessAgent: { controlKeyReady: true } },
    });
  });

  it("a control key reused from the snapshot key reads as not ready", async () => {
    vi.stubEnv("HARNESS_CONTROL_KEY", "device-key-for-tests-0123456789abcdef");
    heartbeatRunner.mockResolvedValueOnce({});
    await heartbeatNick();
    expect(heartbeatRunner.mock.calls[0][0]).toMatchObject({ metadata: { harnessAgent: { controlKeyReady: false } } });
  });

  it("a failed stamp resolves to its reason; it never throws", async () => {
    heartbeatRunner.mockRejectedValueOnce(new Error("db down"));
    await expect(heartbeatNick()).resolves.toMatch(/^failed: db down/);
  });
});

describe("result status", () => {
  it("exit 0 is DONE; an action's named findings code is FINDINGS; anything else, or an error, is FAILED", () => {
    expect(resultStatus("bootstrap-check", 0, null)).toBe("DONE");
    expect(resultStatus("bootstrap-check", 1, null)).toBe("FINDINGS");
    expect(resultStatus("bootstrap-check", 2, null)).toBe("FAILED");
    expect(resultStatus("pc-status", 1, null)).toBe("FAILED");
    expect(resultStatus("pc-status", 0, "timed out after 30 s")).toBe("FAILED");
    expect(resultStatus("pc-status", null, null)).toBe("FAILED");
    expect(resultStatus("unknown-name", 1, null)).toBe("FAILED");
  });
});

describe("readHarnessStatus · the action list and Nick's row", () => {
  beforeEach(() => {
    findMany.mockReset();
    runnerFindMany.mockReset();
  });

  it("POSITIVE CONTROL: Nick's row reads reporting with his version; actions come through", async () => {
    runnerFindMany.mockResolvedValueOnce([{ nodeKey: NICK_NODE_KEY, lastHeartbeatAt: new Date(), version: "abc1234def", metadata: {} }]);
    findMany.mockResolvedValueOnce([]);
    const s = await readHarnessStatus();
    expect(s.nick).toMatchObject({ state: "reporting", version: "abc1234def" });
    expect(s.actions).toEqual([]);
    expect(s.actionsReason).toBeNull();
    expect(s.pcs).toHaveLength(3);
  });

  it("a missing table reads 'not migrated', null actions, PC rows intact", async () => {
    runnerFindMany.mockResolvedValueOnce([]);
    findMany.mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "P2021" }));
    const s = await readHarnessStatus();
    expect(s.actions).toBeNull();
    expect(s.actionsReason).toBe("Harness control is not migrated yet");
    expect(s.pcs).toHaveLength(3);
  });

  it("any other failed read is 'could not be read', never an empty list", async () => {
    runnerFindMany.mockResolvedValueOnce([]);
    findMany.mockRejectedValueOnce(new Error("connection reset"));
    const s = await readHarnessStatus();
    expect(s.actions).toBeNull();
    expect(s.actionsReason).toBe("The action list could not be read");
  });
});
