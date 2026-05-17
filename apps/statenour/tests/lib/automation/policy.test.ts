/**
 * AutomationPolicy service tests · v10.0.148
 *
 * The service mostly delegates to Prisma + the soft-delete helper, so
 * these tests focus on the validation surface (id<->surface coherence,
 * required fields, approval-class enum) and the `findMissingPolicies`
 * gap detector that the pre-push gate uses.
 *
 * Heavy DB-touching paths (upsertPolicy, setApprovalClass, etc.) are
 * smoke-tested via `vi.mock` of `@/lib/prisma` — full integration is
 * exercised by the seed script which actually hits Neon.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma BEFORE importing the service so the service binds to the
// mock instead of the real client. `vi.hoisted` is required because
// vi.mock factories run before module-level `const`s — without hoist
// the mockPrisma reference would be undefined at mock-resolution time.
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    automationPolicy: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));
vi.mock("@/lib/db/soft-delete", () => ({
  softDelete: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/logger", () => ({
  logger: {
    withSurface: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import {
  upsertPolicy,
  findMissingPolicies,
  setApprovalClass,
  setEnabled,
  logPolicyFire,
  type PolicyUpsertInput,
} from "@/lib/automation/policy";

const baseRow = {
  id: "cron.test",
  surface: "cron",
  name: "test",
  objective: "test obj",
  trigger: "cron · 0 0 * * *",
  inputs: null,
  approvalClass: "auto",
  rollback: null,
  successMetric: "test metric",
  owner: "nour",
  enabled: true,
  lastFiredAt: null,
  lastResult: null,
  fireCount: 0,
  notes: null,
  metadata: null,
  tags: [],
  createdAt: new Date("2026-05-03"),
  updatedAt: new Date("2026-05-03"),
};

const validInput: PolicyUpsertInput = {
  id: "cron.test",
  surface: "cron",
  name: "test",
  objective: "Test objective.",
  trigger: "cron · 0 0 * * *",
  successMetric: "Returns 200 in <30s",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("upsertPolicy · validation", () => {
  it("rejects ids missing the surface prefix", async () => {
    await expect(
      upsertPolicy({ ...validInput, id: "test-no-prefix" }),
    ).rejects.toThrow(/policy id must be/);
  });

  it("rejects ids whose prefix disagrees with the explicit surface", async () => {
    await expect(
      upsertPolicy({ ...validInput, id: "tool.test", surface: "cron" }),
    ).rejects.toThrow(/disagrees with/);
  });

  it("rejects unknown surfaces", async () => {
    await expect(
      upsertPolicy({
        ...validInput,
        id: "ufo.test",
        // @ts-expect-error · explicitly testing the runtime guard
        surface: "ufo",
      }),
    ).rejects.toThrow(/invalid surface/);
  });

  it("rejects unknown approvalClass values", async () => {
    await expect(
      upsertPolicy({
        ...validInput,
        // @ts-expect-error · runtime guard test
        approvalClass: "pending-please",
      }),
    ).rejects.toThrow(/invalid approvalClass/);
  });

  it("rejects empty objective", async () => {
    await expect(
      upsertPolicy({ ...validInput, objective: "  " }),
    ).rejects.toThrow(/objective is required/);
  });

  it("rejects empty trigger", async () => {
    await expect(
      upsertPolicy({ ...validInput, trigger: "" }),
    ).rejects.toThrow(/trigger is required/);
  });

  it("rejects empty successMetric", async () => {
    await expect(
      upsertPolicy({ ...validInput, successMetric: "" }),
    ).rejects.toThrow(/successMetric is required/);
  });

  it("accepts a valid input and writes through to prisma", async () => {
    mockPrisma.automationPolicy.upsert.mockResolvedValueOnce(baseRow);
    await upsertPolicy(validInput);
    expect(mockPrisma.automationPolicy.upsert).toHaveBeenCalledOnce();
    const call = mockPrisma.automationPolicy.upsert.mock.calls[0][0];
    expect(call.where.id).toBe("cron.test");
    expect(call.create.approvalClass).toBe("auto"); // default applied
  });
});

describe("findMissingPolicies", () => {
  it("returns empty array when all expected ids are present", async () => {
    mockPrisma.automationPolicy.findMany.mockResolvedValueOnce([
      { id: "cron.a" },
      { id: "cron.b" },
    ]);
    const missing = await findMissingPolicies(["cron.a", "cron.b"]);
    expect(missing).toEqual([]);
  });

  it("returns the ids absent from the registry", async () => {
    mockPrisma.automationPolicy.findMany.mockResolvedValueOnce([{ id: "cron.a" }]);
    const missing = await findMissingPolicies(["cron.a", "cron.b", "cron.c"]);
    expect(missing).toEqual(["cron.b", "cron.c"]);
  });

  it("short-circuits on empty input without hitting prisma", async () => {
    const missing = await findMissingPolicies([]);
    expect(missing).toEqual([]);
    expect(mockPrisma.automationPolicy.findMany).not.toHaveBeenCalled();
  });
});

describe("operator setters", () => {
  it("setApprovalClass rejects when the policy is not found", async () => {
    mockPrisma.automationPolicy.findFirst.mockResolvedValueOnce(null);
    await expect(setApprovalClass("cron.missing", "pending")).rejects.toThrow(
      /Policy not found/,
    );
  });

  it("setApprovalClass updates and returns the patched record", async () => {
    mockPrisma.automationPolicy.findFirst.mockResolvedValueOnce(baseRow);
    mockPrisma.automationPolicy.update.mockResolvedValueOnce({
      ...baseRow,
      approvalClass: "pending",
    });
    const r = await setApprovalClass("cron.test", "pending");
    expect(r.approvalClass).toBe("pending");
  });

  it("setEnabled flips enabled flag", async () => {
    mockPrisma.automationPolicy.findFirst.mockResolvedValueOnce(baseRow);
    mockPrisma.automationPolicy.update.mockResolvedValueOnce({ ...baseRow, enabled: false });
    const r = await setEnabled("cron.test", false);
    expect(r.enabled).toBe(false);
  });
});

describe("logPolicyFire", () => {
  it("increments fireCount via updateMany when policy exists", async () => {
    mockPrisma.automationPolicy.updateMany.mockResolvedValueOnce({ count: 1 });
    await logPolicyFire("cron.test", "success");
    expect(mockPrisma.automationPolicy.updateMany).toHaveBeenCalledOnce();
    const call = mockPrisma.automationPolicy.updateMany.mock.calls[0][0];
    expect(call.data.lastResult).toBe("success");
    expect(call.data.fireCount.increment).toBe(1);
  });

  it("does not throw when the policy id is missing from registry", async () => {
    mockPrisma.automationPolicy.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(logPolicyFire("cron.unseeded", "failure")).resolves.toBeUndefined();
  });

  it("swallows DB errors so a fire-log failure cannot break the firing surface", async () => {
    mockPrisma.automationPolicy.updateMany.mockRejectedValueOnce(new Error("DB down"));
    await expect(logPolicyFire("cron.test", "success")).resolves.toBeUndefined();
  });
});
