/**
 * The two-key gate (lib/tools/two-key.ts), exercised through its remaining per-call rule: a device
 * command that unlocks, disarms or sends raw codes needs the owner's second key. (The Instagram
 * autopost rules these tests used were removed with the tools, 2026-10-19; the mechanics are the same.)
 *
 *   1. Such a command in a clean owner turn (and outside any turn) is refused at the nourTools
 *      boundary and queued as an owner ApprovalRequest; the tool never runs.
 *   2. Positive controls: an everyday command and an unrelated tool still run.
 *   3. The approved re-execution (guardianBypassStorage) runs the tool once.
 *   4. A retry does not queue a second approval; a DB failure still refuses.
 *   5. The argument check fails closed: a non-string command counts as held.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  approvalRequest: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { wrapToolsWithEmptyHandling } from "@/lib/ai/tools";
import { withTurnContext } from "@/lib/agent/turn-context";
import { guardianBypassStorage } from "@/lib/tools/guardian";
import { DEVICE_TWO_KEY_REASON, isIrreversibleCustomerSend, twoKeyGate } from "@/lib/tools/two-key";

type Result = { error?: string; requestId?: string | null; reflection?: { guidance: string }; ok?: boolean };

function wrapOne(name: string, execute: (...a: unknown[]) => unknown) {
  return wrapToolsWithEmptyHandling({ [name]: { execute } } as never) as unknown as Record<
    string,
    { execute: (a: unknown, o: unknown) => Promise<Result> }
  >;
}

const UNLOCK = { deviceId: "dev_1", command: "unlock" };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.approvalRequest.findMany.mockResolvedValue([]);
  prismaMock.approvalRequest.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "req_2k",
    ...data,
  }));
});

describe("which calls need the second key", () => {
  it("unlock, disarm and raw are held; an everyday command and other tools are not", () => {
    for (const command of ["unlock", "disarm", "raw"]) expect(isIrreversibleCustomerSend("runDeviceCommand", { command })).toBe(true);
    expect(isIrreversibleCustomerSend("runDeviceCommand", { command: "lights_on" })).toBe(false);
    expect(isIrreversibleCustomerSend("createTask", { command: "unlock" })).toBe(false);
  });

  it("fails closed: a missing or non-string command is held", () => {
    expect(isIrreversibleCustomerSend("runDeviceCommand", {})).toBe(true);
    expect(isIrreversibleCustomerSend("runDeviceCommand", { command: 5 })).toBe(true);
    expect(isIrreversibleCustomerSend("runDeviceCommand", null)).toBe(true);
  });

  it("the SMS tools are not on the list: they already stage and wait for a Telegram tap", () => {
    expect(isIrreversibleCustomerSend("sendOpportunitySms", { opportunityId: "x", body: "hi" })).toBe(false);
    expect(isIrreversibleCustomerSend("stageCustomerAlert", { phone: "2165550100", message: "hi" })).toBe(false);
  });
});

describe("the nourTools boundary holds the call for the second key", () => {
  it("clean owner turn: the unlock is refused, queued for the owner, and never runs", async () => {
    const run = vi.fn(async () => ({ ok: true }));
    const res = await withTurnContext({}, () => wrapOne("runDeviceCommand", run).runDeviceCommand.execute(UNLOCK, {}));

    expect(run).not.toHaveBeenCalled();
    expect(res.error).toBe("approval_required");
    expect(res.requestId).toBe("req_2k");
    expect(res.reflection?.guidance).toMatch(/NOT sent/);
    const created = prismaMock.approvalRequest.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      toolId: "runDeviceCommand",
      actionType: "require_owner",
      status: "pending_approval",
      requestedBy: "agent",
      reason: DEVICE_TWO_KEY_REASON,
    });
    expect(created.payload).toEqual(UNLOCK);
    expect(created.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("outside any turn (a background caller) the unlock is held too", async () => {
    const run = vi.fn(async () => ({ ok: true }));
    const res = await wrapOne("runDeviceCommand", run).runDeviceCommand.execute(UNLOCK, {});
    expect(run).not.toHaveBeenCalled();
    expect(res.error).toBe("approval_required");
    expect(prismaMock.approvalRequest.create.mock.calls[0][0].data.requestedBy).toBe("system");
  });

  it("positive control: an everyday command runs with no approval", async () => {
    const run = vi.fn(async () => ({ ok: true }));
    const res = await withTurnContext({}, () =>
      wrapOne("runDeviceCommand", run).runDeviceCommand.execute({ deviceId: "dev_1", command: "lights_on" }, {}),
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ ok: true });
    expect(prismaMock.approvalRequest.create).not.toHaveBeenCalled();
  });

  it("positive control: an unrelated side-effecting tool is untouched", async () => {
    const run = vi.fn(async () => ({ ok: true }));
    await withTurnContext({}, () => wrapOne("createTask", run).createTask.execute({ title: "x" }, {}));
    expect(run).toHaveBeenCalledTimes(1);
    expect(prismaMock.approvalRequest.create).not.toHaveBeenCalled();
  });

  it("the approved re-execution is the second key: under the guardian bypass the command runs once", async () => {
    const run = vi.fn(async () => ({ ok: true }));
    const tools = wrapOne("runDeviceCommand", run);
    const res = await guardianBypassStorage.run(true, () => tools.runDeviceCommand.execute(UNLOCK, {}));
    expect(run).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ ok: true });
    expect(prismaMock.approvalRequest.create).not.toHaveBeenCalled();
  });
});

describe("twoKeyGate bookkeeping", () => {
  it("a retry with the same payload reuses the open request instead of queueing a second one", async () => {
    prismaMock.approvalRequest.findMany.mockResolvedValue([
      { id: "req_other", payload: { deviceId: "dev_2", command: "unlock" } },
      { id: "req_open", payload: { command: "unlock", deviceId: "dev_1" } },
    ]);
    const res = await withTurnContext({}, () => twoKeyGate("runDeviceCommand", UNLOCK));
    expect(res?.requestId).toBe("req_open");
    expect(prismaMock.approvalRequest.create).not.toHaveBeenCalled();
    const where = prismaMock.approvalRequest.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ toolId: "runDeviceCommand", status: "pending_approval", reason: DEVICE_TWO_KEY_REASON });
    expect(where.expiresAt.gt).toBeInstanceOf(Date);
  });

  it("a DB failure still refuses (the queue is best-effort, the refusal is not)", async () => {
    prismaMock.approvalRequest.findMany.mockRejectedValueOnce(new Error("db down"));
    const res = await withTurnContext({}, () => twoKeyGate("runDeviceCommand", UNLOCK));
    expect(res?.error).toBe("approval_required");
    expect(res?.requestId).toBeNull();
  });
});
