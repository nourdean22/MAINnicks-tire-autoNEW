/**
 * Q-20 · checkApprovalGate must be at least as strict as the policy it reads.
 *
 * tool-policy.ts returns six decisions. checkApprovalGate used to raise an
 * approval for three of them and throw for "deny", so the sixth,
 * "require_memory_review", fell through to { approved: true } and the action
 * ran with no review. On the nick-agent action path the flags that produce
 * that decision (containsExternalContent, memoryWriteRequested,
 * basedOnInferredMemory) are written by the model in the action params.
 *
 * Invariant: only "allow" executes; "deny" throws; every other decision
 * raises an approval request and does not execute.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolDecisionType } from "@/lib/tools/tool-policy";

const { policy, prismaMock } = vi.hoisted(() => ({
  policy: { decision: "allow" as string },
  prismaMock: {
    approvalRequest: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(async () => ({ id: "req_new" })),
    },
  },
}));

vi.mock("@/lib/tools/tool-policy", () => ({
  evaluateToolAction: () => ({ decision: policy.decision, riskClass: "medium", reason: "mocked" }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { checkApprovalGate } from "@/lib/ai/runtime/approval-gate";

/**
 * Every member of ToolDecisionType. tsc does not read tests/ (tsconfig
 * excludes it), so a new member is NOT a compile error here; the exhaustive
 * permissiveness test fails on an unknown decision code instead.
 */
const ALL: Record<ToolDecisionType, true> = {
  allow: true,
  require_approval: true,
  require_owner: true,
  require_screenshot_approval: true,
  require_memory_review: true,
  deny: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.approvalRequest.findFirst.mockResolvedValue(null);
  prismaMock.approvalRequest.findUnique.mockResolvedValue(null);
});

describe("checkApprovalGate · only an allow decision executes", () => {
  for (const decision of Object.keys(ALL) as ToolDecisionType[]) {
    it(`${decision}`, async () => {
      policy.decision = decision;
      const call = checkApprovalGate("memory.remember", { content: "x", containsExternalContent: true });

      if (decision === "deny") {
        await expect(call).rejects.toThrow(/Action denied/);
        expect(prismaMock.approvalRequest.create).not.toHaveBeenCalled();
        return;
      }
      const res = await call;
      if (decision === "allow") {
        expect(res).toEqual({ approved: true });
        expect(prismaMock.approvalRequest.create).not.toHaveBeenCalled();
        return;
      }
      expect(res.approved).toBe(false);
      expect(res.approvalId).toBe("req_new");
      expect(prismaMock.approvalRequest.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.approvalRequest.create.mock.calls[0][0].data.actionType).toBe(decision);
    });
  }
});
