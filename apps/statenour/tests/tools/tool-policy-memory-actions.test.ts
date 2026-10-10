/**
 * 05-M3 (2026-10-10 audit) · action-block memory writes need approval, and
 * memory search must not surface deleted or superseded rows.
 *
 * Nick's reply text can carry ```action blocks with `memory.remember` and
 * `memory.forget`. They reach checkApprovalGate -> evaluateToolAction under
 * those ids, which resolve through the dynamic `memory.*` capability in
 * tool-registry.ts. Its write regex matched neither verb, so both resolved
 * as approvalPolicy "none" and the policy returned "allow": the model could
 * write or soft-delete any memory with no owner in the loop.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, forgetMock } = vi.hoisted(() => ({
  prismaMock: {
    brainMemory: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async (): Promise<{ id: string } | null> => null),
    },
  },
  forgetMock: vi.fn(async () => undefined),
}));

vi.mock("@/lib/feature-flags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/feature-flags")>();
  return {
    ...actual,
    getFlag: vi.fn((key: string) => ({ key, isOn: false })),
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/brain/memory-manager", () => ({
  brainMemory: { forget: forgetMock, remember: vi.fn() },
}));
vi.mock("@/lib/brain/thinking-engine", () => ({ runSimulation: vi.fn() }));

import { evaluateToolAction } from "@/lib/tools/tool-policy";
import { handleMemoryForget, handleMemorySearch } from "@/lib/ai/agent-actions/memory-actions";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("tool policy · action-block memory verbs", () => {
  it("memory.forget is not allowed without an owner", () => {
    const d = evaluateToolAction({ toolId: "memory.forget", actionType: "execute" });
    expect(d.decision).not.toBe("allow");
    expect(d.decision).toBe("require_owner");
  });

  it("memory.remember is not allowed without an owner", () => {
    const d = evaluateToolAction({ toolId: "memory.remember", actionType: "execute" });
    expect(d.decision).not.toBe("allow");
    expect(d.decision).toBe("require_owner");
  });

  it("control: memory.search (a read) is still allowed", () => {
    const d = evaluateToolAction({ toolId: "memory.search", actionType: "execute" });
    expect(d.decision).toBe("allow");
  });
});

describe("memory.search · only live rows", () => {
  it("filters soft-deleted and superseded memories", async () => {
    await handleMemorySearch({ query: "tires" }, "memory.search");
    expect(prismaMock.brainMemory.findMany).toHaveBeenCalledTimes(1);
    const where = prismaMock.brainMemory.findMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    expect(where.supersededById).toBeNull();
    // the keyword match is still there
    expect(where.OR).toHaveLength(2);
  });
});

describe("memory.forget · refuses ids it cannot find live", () => {
  it("does not delete, and reports failure, when the id is unknown or already deleted", async () => {
    prismaMock.brainMemory.findFirst.mockResolvedValueOnce(null);
    const res = await handleMemoryForget({ id: "mem_missing" }, "memory.forget");
    expect(res.success).toBe(false);
    expect(forgetMock).not.toHaveBeenCalled();
    const where = prismaMock.brainMemory.findFirst.mock.calls[0][0].where;
    expect(where).toEqual({ id: "mem_missing", deletedAt: null });
  });

  it("positive control: a live id is forgotten", async () => {
    prismaMock.brainMemory.findFirst.mockResolvedValueOnce({ id: "mem_live" });
    const res = await handleMemoryForget({ id: "mem_live" }, "memory.forget");
    expect(res.success).toBe(true);
    expect(forgetMock).toHaveBeenCalledWith("mem_live");
  });
});
