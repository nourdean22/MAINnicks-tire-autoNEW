import { describe, expect, it, vi, beforeEach } from "vitest";
import { auditTodaysLeadsHandler } from "@/lib/inngest/functions/audit-todays-leads";
import { prisma } from "@/lib/prisma";

const mockApprovalRequestFindFirst = vi.fn();
const mockApprovalRequestCreate = vi.fn();
const mockCallNickstire = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    approvalRequest: {
      findFirst: () => mockApprovalRequestFindFirst(),
      create: (args: any) => mockApprovalRequestCreate(args),
    },
  },
}));

vi.mock("@/lib/ai/agent-actions/shop-actions", () => ({
  callNickstire: (action: string, args: any) => mockCallNickstire(action, args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockApprovalRequestFindFirst.mockReset();
  mockApprovalRequestCreate.mockReset();
  mockCallNickstire.mockReset();
});

describe("audit-todays-leads safety", () => {
  it("creates zero approval requests when Nick's Tire bridge is unavailable", async () => {
    // Setup bridge failure response
    mockCallNickstire.mockResolvedValue(null);

    // Mock step runner
    const mockStep = {
      run: async (id: string, fn: () => any) => fn(),
      sleep: async (id: string, duration: string) => {},
    };

    const res = await auditTodaysLeadsHandler({ step: mockStep as any });

    expect(res).toEqual({
      leadsProcessed: 0,
      draftsCreated: 0,
      timeline: [],
    });

    expect(mockApprovalRequestCreate).not.toHaveBeenCalled();
  });
});
