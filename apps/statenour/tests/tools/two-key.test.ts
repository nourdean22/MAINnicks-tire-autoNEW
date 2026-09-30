/**
 * tests/tools/two-key.test.ts · 2026-09-30 (Q-19, §10.1 S4)
 *
 * An irreversible customer-facing send needs two keys even in a CLEAN owner
 * turn. Before this, the sink policy was the only gate and it returns early
 * unless the turn is tainted, so a live Instagram autopost ran on the model's
 * reading of one owner message.
 *
 * Pinned:
 *   1. A live autopost in a clean owner turn (and outside any turn) is refused
 *      at the nourTools boundary and queued as an owner ApprovalRequest; the
 *      tool never runs.
 *   2. Positive controls: a dry run and an unrelated tool still run.
 *   3. The approved re-execution (guardianBypassStorage) runs the tool once.
 *   4. A retry does not queue a second approval; a DB failure still refuses.
 *   5. The argument check fails closed: a missing dryRun counts as live.
 *   6. The real nourTools.triggerInstagramAutopost is behind the gate: a live
 *      call in an owner turn sends nothing to the shop's IG control route.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  approvalRequest: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { wrapToolsWithEmptyHandling } from "@/lib/ai/tools";
import { withTurnContext } from "@/lib/agent/turn-context";
import { guardianBypassStorage } from "@/lib/tools/guardian";
import { TWO_KEY_REASON, isIrreversibleCustomerSend, twoKeyGate } from "@/lib/tools/two-key";

type Result = { error?: string; requestId?: string | null; reflection?: { guidance: string }; posted?: boolean };

function wrapOne(name: string, execute: (...a: unknown[]) => unknown) {
  return wrapToolsWithEmptyHandling({ [name]: { execute } } as never) as unknown as Record<
    string,
    { execute: (a: unknown, o: unknown) => Promise<Result> }
  >;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.approvalRequest.findMany.mockResolvedValue([]);
  prismaMock.approvalRequest.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "req_2k",
    ...data,
  }));
});

describe("which calls are irreversible customer-facing sends", () => {
  it("a live autopost is; a dry run is not; other tools are not", () => {
    expect(isIrreversibleCustomerSend("triggerInstagramAutopost", { dryRun: false })).toBe(true);
    expect(isIrreversibleCustomerSend("triggerInstagramAutopost", { dryRun: true })).toBe(false);
    expect(isIrreversibleCustomerSend("getInstagramAutopostStatus", {})).toBe(false);
    expect(isIrreversibleCustomerSend("createTask", { dryRun: false })).toBe(false);
  });

  it("fails closed: anything but an explicit dryRun === true is live", () => {
    expect(isIrreversibleCustomerSend("triggerInstagramAutopost", {})).toBe(true);
    expect(isIrreversibleCustomerSend("triggerInstagramAutopost", { dryRun: "true" })).toBe(true);
    expect(isIrreversibleCustomerSend("triggerInstagramAutopost", null)).toBe(true);
  });

  it("the SMS tools are not on the list: they already stage and wait for a Telegram tap", () => {
    expect(isIrreversibleCustomerSend("sendOpportunitySms", { opportunityId: "x", body: "hi" })).toBe(false);
    expect(isIrreversibleCustomerSend("stageCustomerAlert", { phone: "2165550100", message: "hi" })).toBe(false);
  });
});

describe("the nourTools boundary holds a live publish for the second key", () => {
  it("clean owner turn: the live autopost is refused, queued for the owner, and never runs", async () => {
    const run = vi.fn(async () => ({ posted: true }));
    const tools = wrapOne("triggerInstagramAutopost", run);
    const res = await withTurnContext({}, () => tools.triggerInstagramAutopost.execute({ dryRun: false }, {}));

    expect(run).not.toHaveBeenCalled();
    expect(res.error).toBe("approval_required");
    expect(res.requestId).toBe("req_2k");
    expect(res.reflection?.guidance).toMatch(/NOT performed/);
    const created = prismaMock.approvalRequest.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      toolId: "triggerInstagramAutopost",
      actionType: "require_owner",
      status: "pending_approval",
      riskClass: "high",
      requestedBy: "agent",
      reason: TWO_KEY_REASON,
    });
    expect(created.payload).toEqual({ dryRun: false });
    expect(created.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("outside any turn (a background caller) the live autopost is held too", async () => {
    const run = vi.fn(async () => ({ posted: true }));
    const res = await wrapOne("triggerInstagramAutopost", run).triggerInstagramAutopost.execute(
      { dryRun: false, forceArchetype: "promo" },
      {},
    );
    expect(run).not.toHaveBeenCalled();
    expect(res.error).toBe("approval_required");
    expect(prismaMock.approvalRequest.create.mock.calls[0][0].data.requestedBy).toBe("system");
  });

  it("positive control: a dry run runs with no approval", async () => {
    const run = vi.fn(async () => ({ posted: false }));
    const res = await withTurnContext({}, () =>
      wrapOne("triggerInstagramAutopost", run).triggerInstagramAutopost.execute({ dryRun: true }, {}),
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ posted: false });
    expect(prismaMock.approvalRequest.create).not.toHaveBeenCalled();
  });

  it("positive control: an unrelated side-effecting tool is untouched", async () => {
    const run = vi.fn(async () => ({ ok: true }));
    await withTurnContext({}, () => wrapOne("createTask", run).createTask.execute({ title: "x" }, {}));
    expect(run).toHaveBeenCalledTimes(1);
    expect(prismaMock.approvalRequest.create).not.toHaveBeenCalled();
  });

  it("the approved re-execution is the second key: under the guardian bypass the publish runs once", async () => {
    const run = vi.fn(async () => ({ posted: true }));
    const tools = wrapOne("triggerInstagramAutopost", run);
    const res = await guardianBypassStorage.run(true, () => tools.triggerInstagramAutopost.execute({ dryRun: false }, {}));
    expect(run).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ posted: true });
    expect(prismaMock.approvalRequest.create).not.toHaveBeenCalled();
  });
});

describe("the real catalog tool is wired through the gate", () => {
  it("nourTools.triggerInstagramAutopost live in an owner turn sends no request to the shop", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const prevKey = process.env.NOUR_OS_IG_CONTROL_KEY;
    process.env.NOUR_OS_IG_CONTROL_KEY = "ig-control-key";
    try {
      const { nourTools } = await import("@/lib/ai/tools");
      const exec = (nourTools as unknown as Record<string, { execute: (a: unknown, o: unknown) => Promise<Result> }>)
        .triggerInstagramAutopost.execute;
      const res = await withTurnContext({}, () => exec({ dryRun: false }, {}));
      expect(res.error).toBe("approval_required");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      if (prevKey === undefined) delete process.env.NOUR_OS_IG_CONTROL_KEY;
      else process.env.NOUR_OS_IG_CONTROL_KEY = prevKey;
    }
  });
});

describe("twoKeyGate bookkeeping", () => {
  it("a retry with the same payload reuses the open request instead of queueing a second one", async () => {
    prismaMock.approvalRequest.findMany.mockResolvedValue([
      { id: "req_other", payload: { dryRun: false, forceArchetype: "meme" } },
      { id: "req_open", payload: { forceArchetype: "promo", dryRun: false } },
    ]);
    const res = await withTurnContext({}, () =>
      twoKeyGate("triggerInstagramAutopost", { dryRun: false, forceArchetype: "promo" }),
    );
    expect(res?.requestId).toBe("req_open");
    expect(prismaMock.approvalRequest.create).not.toHaveBeenCalled();
    const where = prismaMock.approvalRequest.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ toolId: "triggerInstagramAutopost", status: "pending_approval", reason: TWO_KEY_REASON });
    expect(where.expiresAt.gt).toBeInstanceOf(Date);
  });

  it("a DB failure still refuses (the queue is best-effort, the refusal is not)", async () => {
    prismaMock.approvalRequest.findMany.mockRejectedValueOnce(new Error("db down"));
    const res = await withTurnContext({}, () => twoKeyGate("triggerInstagramAutopost", { dryRun: false }));
    expect(res?.error).toBe("approval_required");
    expect(res?.requestId).toBeNull();
  });
});
