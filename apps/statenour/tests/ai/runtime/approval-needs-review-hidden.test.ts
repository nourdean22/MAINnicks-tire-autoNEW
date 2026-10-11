/**
 * R3-16 item 1 (review R3 wave A, finding 1) - the needs_review refusal was
 * bypassed by any NEWER same-tool request with a different payload. The dedupe
 * lookup read only the newest same-tool row in the 24h window and then compared
 * payloads, so an older same-payload needs_review row was never seen and a
 * re-raise opened a fresh approval (a second SMS once approved).
 *
 * The store below honours the status filter, newest-first order and `take`, and
 * answers both findFirst and findMany, so the test does not care which one the
 * code uses: only what the operator would see.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tools/tool-policy", () => ({
  evaluateToolAction: () => ({ decision: "require_approval", riskClass: "medium", reason: "mocked approval gate" }),
}));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    approvalRequest: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "req_new" })),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { checkApprovalGate } from "@/lib/ai/runtime/approval-gate";
import { withGuardian, GuardianApprovalPendingError, pendingExecutions } from "@/lib/tools/guardian";

const TOOL = "shop.sendSms";
const A = { to: "+15550100", body: "Your car is ready" };
const B = { to: "+15550199", body: "Different customer" };
const t0 = Date.now();
const row = (o: Record<string, unknown>) => ({
  toolId: TOOL,
  resultPayload: null,
  expiresAt: new Date(t0 + 3600_000),
  executedAt: null,
  ...o,
});

type Args = { where: { toolId: string; status: { in: string[] } }; take?: number };
function store(rows: Array<Record<string, unknown>>) {
  // newest first, as orderBy createdAt desc returns them
  const sorted = [...rows].sort((x, y) => (y.createdAt as Date).getTime() - (x.createdAt as Date).getTime());
  const hits = (a: Args) => sorted.filter((r) => r.toolId === a.where.toolId && a.where.status.in.includes(r.status as string));
  prismaMock.approvalRequest.findFirst.mockImplementation(async (a: Args) => hits(a)[0] ?? null);
  prismaMock.approvalRequest.findMany.mockImplementation(async (a: Args) => hits(a).slice(0, a.take ?? Infinity));
}

const reviewA = row({ id: "req_A", status: "needs_review", payload: A, resultPayload: { error: "timeout after dispatch" }, createdAt: new Date(t0 - 60_000) });
const pendingB = row({ id: "req_B", status: "pending_approval", payload: B, createdAt: new Date(t0 - 1000) });

beforeEach(() => {
  vi.clearAllMocks();
  pendingExecutions.clear();
});

describe("checkApprovalGate - an older same-payload needs_review row still refuses", () => {
  it("a newer same-tool request with another payload does not hide it", async () => {
    store([reviewA, pendingB]);
    await expect(checkApprovalGate(TOOL, A)).rejects.toThrow(/may already have run/);
    expect(prismaMock.approvalRequest.create).not.toHaveBeenCalled();
  });

  it("CONTROL - payload B still dedupes to its own pending request", async () => {
    store([reviewA, pendingB]);
    await expect(checkApprovalGate(TOOL, B)).resolves.toEqual({ approved: false, approvalId: "req_B" });
    expect(prismaMock.approvalRequest.create).not.toHaveBeenCalled();
  });

  it("CONTROL - a payload with no row in the window opens a new approval", async () => {
    store([reviewA, pendingB]);
    await expect(checkApprovalGate(TOOL, { to: "+15550123", body: "third" })).resolves.toEqual({ approved: false, approvalId: "req_new" });
    expect(prismaMock.approvalRequest.create).toHaveBeenCalledTimes(1);
  });
});

describe("withGuardian - an older same-payload needs_review row still refuses", () => {
  it("a newer same-tool request with another payload does not hide it", async () => {
    store([reviewA, pendingB]);
    const guarded = withGuardian(TOOL, async () => "sent");
    await expect(guarded(A)).rejects.toThrow(/may already have run/);
    expect(prismaMock.approvalRequest.create).not.toHaveBeenCalled();
  });

  it("CONTROL - payload B still dedupes to its own pending request", async () => {
    store([reviewA, pendingB]);
    const guarded = withGuardian(TOOL, async () => "sent");
    await expect(guarded(B)).rejects.toMatchObject({ requestId: "req_B" });
    expect(prismaMock.approvalRequest.create).not.toHaveBeenCalled();
  });

  it("CONTROL - a payload with no row in the window opens a new approval", async () => {
    store([reviewA, pendingB]);
    const guarded = withGuardian(TOOL, async () => "sent");
    await expect(guarded({ to: "+15550123", body: "third" })).rejects.toThrow(GuardianApprovalPendingError);
    expect(prismaMock.approvalRequest.create).toHaveBeenCalledTimes(1);
  });
});
