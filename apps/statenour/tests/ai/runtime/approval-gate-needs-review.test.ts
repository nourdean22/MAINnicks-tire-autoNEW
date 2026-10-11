/**
 * P-S5a (audit round 3) - checkApprovalGate's dedupe lookup did not include
 * `needs_review` -- the status the executor writes when an approved action MAY
 * already have run (lib/tools/guardian.ts). A same-payload re-raise inside the
 * window skipped that row and opened a fresh approval, so one approval could
 * mean a second execution of something that already happened. withGuardian
 * already refuses this case; the gate now does the same.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tools/tool-policy", () => ({
  evaluateToolAction: () => ({ decision: "require_approval", riskClass: "medium", reason: "mocked approval gate" }),
}));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    approvalRequest: {
      findMany: vi.fn(),
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "req_new" })),
    },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { checkApprovalGate } from "@/lib/ai/runtime/approval-gate";

const TOOL = "shop.sendSms";
const PAYLOAD = { to: "+15550100", body: "Your car is ready" };
const row = (o: Record<string, unknown>) => ({
  id: "req_1",
  toolId: TOOL,
  status: "needs_review",
  payload: PAYLOAD,
  resultPayload: { error: "timeout after dispatch" },
  expiresAt: new Date(Date.now() + 3600_000),
  executedAt: null,
  createdAt: new Date(),
  ...o,
});

/** A findMany that honours the status filter, as the database does. */
function store(rows: Array<Record<string, unknown>>) {
  prismaMock.approvalRequest.findMany.mockImplementation(async (args: { where: { status: { in: string[] } } }) =>
    rows.filter((r) => args.where.status.in.includes(r.status as string)),
  );
}

beforeEach(() => vi.clearAllMocks());

describe("checkApprovalGate - needs_review blocks a same-payload re-raise", () => {
  it("an existing needs_review row with the same payload refuses; no new approval opens", async () => {
    store([row({})]);
    await expect(checkApprovalGate(TOOL, PAYLOAD)).rejects.toThrow(/may already have run/);
    expect(prismaMock.approvalRequest.create).not.toHaveBeenCalled();
  });

  it("the lookup asks for needs_review rows", async () => {
    store([]);
    await checkApprovalGate(TOOL, PAYLOAD);
    expect(prismaMock.approvalRequest.findMany.mock.calls[0][0].where.status.in).toContain("needs_review");
  });

  it("CONTROL - a different payload opens a new approval", async () => {
    store([row({ payload: { to: "+15550199", body: "other" } })]);
    const res = await checkApprovalGate(TOOL, PAYLOAD);
    expect(res).toEqual({ approved: false, approvalId: "req_new" });
    expect(prismaMock.approvalRequest.create).toHaveBeenCalledTimes(1);
  });
});
