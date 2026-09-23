/**
 * checkApprovalGate · an executed approval is a receipt, never a standing
 * approval (lib/tools/approval-match.ts documents the rule).
 *
 * Pre-fix, an `executed` row whose payload JSON.stringify-matched the new call
 * returned { approved: true } with no time bound, so nick-agent's
 * executeAction re-ran the action with no new approval, indefinitely.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/tools/tool-policy", () => ({
  evaluateToolAction: () => ({
    decision: "require_approval",
    riskClass: "medium",
    reason: "mocked approval gate",
  }),
}));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    approvalRequest: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(async () => ({ id: "req_new" })),
    },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { checkApprovalGate } from "@/lib/ai/runtime/approval-gate";
import { pendingExecutions } from "@/lib/tools/guardian";

const TOOL = "shop.sendSms";
const PAYLOAD = { to: "+15550100", body: "Your car is ready", meta: { a: 1, b: [1, 2] } };
const HOUR = 3600_000;
const future = () => new Date(Date.now() + 24 * HOUR);

function row(overrides: Record<string, unknown>) {
  return {
    id: "req_1",
    toolId: TOOL,
    status: "pending_approval",
    payload: PAYLOAD,
    resultPayload: null,
    expiresAt: future(),
    executedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  pendingExecutions.clear();
  prismaMock.approvalRequest.findFirst.mockResolvedValue(null);
  prismaMock.approvalRequest.findUnique.mockResolvedValue(null);
});

describe("checkApprovalGate · executed is a receipt, not a standing approval", () => {
  it("(a) identical payload after an executed approval requires a NEW approval", async () => {
    prismaMock.approvalRequest.findFirst.mockResolvedValueOnce(
      row({ status: "executed", executedAt: new Date(), resultPayload: { sid: "SM1" } }),
    );

    const res = await checkApprovalGate(TOOL, PAYLOAD);

    expect(res.approved).toBe(false);
    expect(res.approvalId).toBe("req_new");
    expect(res.replay).toBeUndefined();
    expect(prismaMock.approvalRequest.create).toHaveBeenCalledTimes(1);
  });

  it("(a') even the approvalId of an executed request never yields approved:true", async () => {
    prismaMock.approvalRequest.findUnique.mockResolvedValueOnce(
      row({ status: "executed", executedAt: new Date(Date.now() - 2 * HOUR), resultPayload: { sid: "SM1" } }),
    );

    const res = await checkApprovalGate(TOOL, PAYLOAD, undefined, undefined, { approvalId: "req_1" });

    // Outside the replay window → new intent → new approval.
    expect(res.approved).toBe(false);
    expect(res.replay).toBeUndefined();
    expect(res.approvalId).toBe("req_new");
  });

  it("(b) key-order-different but equal payloads match the same request", async () => {
    const reordered = { meta: { b: [1, 2], a: 1 }, body: "Your car is ready", to: "+15550100" };
    prismaMock.approvalRequest.findFirst.mockResolvedValueOnce(row({ status: "pending_approval" }));

    const res = await checkApprovalGate(TOOL, reordered);

    expect(res).toEqual({ approved: false, approvalId: "req_1" });
    expect(prismaMock.approvalRequest.create).not.toHaveBeenCalled();
  });

  it("(b') array order stays significant", async () => {
    const different = { ...PAYLOAD, meta: { a: 1, b: [2, 1] } };
    prismaMock.approvalRequest.findFirst.mockResolvedValueOnce(row({ status: "pending_approval" }));

    const res = await checkApprovalGate(TOOL, different);

    expect(res.approvalId).toBe("req_new");
  });

  it("(c) same-request replay (same approvalId) inside the window returns the stored result without executing", async () => {
    prismaMock.approvalRequest.findUnique.mockResolvedValueOnce(
      row({ status: "executed", executedAt: new Date(Date.now() - 5 * 60_000), resultPayload: { sid: "SM1" } }),
    );
    const fn = vi.fn();

    const res = await checkApprovalGate(TOOL, PAYLOAD, fn, [PAYLOAD], { approvalId: "req_1" });

    expect(res).toEqual({ approved: false, approvalId: "req_1", replay: { result: { sid: "SM1" } } });
    expect(fn).not.toHaveBeenCalled();
    expect(prismaMock.approvalRequest.create).not.toHaveBeenCalled();
    expect(pendingExecutions.has("req_1")).toBe(false);
  });

  it("(c') an approvalId naming a different payload or tool is not a replay", async () => {
    prismaMock.approvalRequest.findUnique.mockResolvedValueOnce(
      row({ status: "executed", executedAt: new Date(), payload: { to: "+15550199" }, resultPayload: { sid: "SM1" } }),
    );

    const res = await checkApprovalGate(TOOL, PAYLOAD, undefined, undefined, { approvalId: "req_1" });

    expect(res.replay).toBeUndefined();
    expect(res.approvalId).toBe("req_new");
  });
});

describe("checkApprovalGate · other statuses unchanged", () => {
  it("(d) pending_approval match returns the existing id and registers the closure", async () => {
    prismaMock.approvalRequest.findFirst.mockResolvedValueOnce(row({ status: "pending_approval" }));
    const fn = vi.fn();

    const res = await checkApprovalGate(TOOL, PAYLOAD, fn, [PAYLOAD]);

    expect(res).toEqual({ approved: false, approvalId: "req_1" });
    expect(pendingExecutions.get("req_1")).toEqual({ fn, args: [PAYLOAD] });
    expect(prismaMock.approvalRequest.create).not.toHaveBeenCalled();
  });

  it("(d) approved match returns the existing id (the executor runs it, not the caller)", async () => {
    prismaMock.approvalRequest.findFirst.mockResolvedValueOnce(row({ status: "approved" }));

    const res = await checkApprovalGate(TOOL, PAYLOAD);

    expect(res).toEqual({ approved: false, approvalId: "req_1" });
  });

  it("(d) rejected match throws", async () => {
    prismaMock.approvalRequest.findFirst.mockResolvedValueOnce(row({ status: "rejected" }));
    await expect(checkApprovalGate(TOOL, PAYLOAD)).rejects.toThrow("Action rejected by operator");
  });

  it("(d) failed match throws with the stored error", async () => {
    prismaMock.approvalRequest.findFirst.mockResolvedValueOnce(
      row({ status: "failed", resultPayload: { error: "twilio 500" } }),
    );
    await expect(checkApprovalGate(TOOL, PAYLOAD)).rejects.toThrow(/twilio 500/);
  });

  it("an expired pending/approved match is ignored and a fresh request is raised", async () => {
    prismaMock.approvalRequest.findFirst.mockResolvedValueOnce(
      row({ status: "approved", expiresAt: new Date(Date.now() - 1000) }),
    );

    const res = await checkApprovalGate(TOOL, PAYLOAD);

    expect(res).toEqual({ approved: false, approvalId: "req_new" });
    expect(prismaMock.approvalRequest.create).toHaveBeenCalledTimes(1);
  });

  it("bounds the payload-match lookup to the 24h dedupe window, like withGuardian", async () => {
    await checkApprovalGate(TOOL, PAYLOAD);
    const where = prismaMock.approvalRequest.findFirst.mock.calls[0][0].where;
    const boundMs = Date.now() - (where.createdAt.gte as Date).getTime();
    expect(boundMs).toBeGreaterThan(24 * HOUR - 10_000);
    expect(boundMs).toBeLessThan(24 * HOUR + 10_000);
  });

  it("no match → creates a pending request", async () => {
    const res = await checkApprovalGate(TOOL, PAYLOAD);
    expect(res).toEqual({ approved: false, approvalId: "req_new" });
  });
});
