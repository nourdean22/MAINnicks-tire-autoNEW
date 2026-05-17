/**
 * v10 Track B.4 · Tests for the schema change ledger contract.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    schemaChangeLedger: {
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  recordSchemaChange,
  markSchemaChangeApplied,
  markSchemaChangeFailed,
  markSchemaChangeRolledBack,
  listRecentSchemaChanges,
  getSchemaLedgerStats,
} from "@/lib/db/schema-ledger";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("v10 B.4 · recordSchemaChange", () => {
  it("creates a ledger row for a non-destructive change", async () => {
    vi.mocked(prisma.schemaChangeLedger.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.schemaChangeLedger.create).mockResolvedValue({
      id: "lg_1",
    } as never);

    const result = await recordSchemaChange({
      changeKey: "v10-add-foo",
      title: "Add foo column",
      reason: "needed for X",
      changeType: "add_column",
      method: "db_push",
      environment: "production",
    });

    expect(result.created).toBe(true);
    expect(result.id).toBe("lg_1");
    const callArgs = vi.mocked(prisma.schemaChangeLedger.create).mock.calls[0]?.[0];
    expect(callArgs?.data).toMatchObject({
      changeKey: "v10-add-foo",
      destructive: false,
      status: "planned",
    });
  });

  it("idempotent · returns existing row when changeKey already used", async () => {
    vi.mocked(prisma.schemaChangeLedger.findUnique).mockResolvedValue({
      id: "lg_existing",
    } as never);

    const result = await recordSchemaChange({
      changeKey: "v10-already-recorded",
      title: "test",
      reason: "test",
      changeType: "other",
      method: "db_push",
      environment: "local",
    });

    expect(result.created).toBe(false);
    expect(result.id).toBe("lg_existing");
    expect(prisma.schemaChangeLedger.create).not.toHaveBeenCalled();
  });

  it("destructive change without approvedBy throws", async () => {
    await expect(
      recordSchemaChange({
        changeKey: "v10-drop-x",
        title: "Drop column X",
        reason: "no longer needed",
        changeType: "drop_column",
        method: "db_push",
        environment: "production",
        destructive: true,
        rollbackPlan: "ALTER TABLE foo ADD COLUMN x ...",
      }),
    ).rejects.toThrow(/destructive changes require approvedBy/);
  });

  it("destructive change without rollbackPlan throws", async () => {
    await expect(
      recordSchemaChange({
        changeKey: "v10-drop-y",
        title: "Drop column Y",
        reason: "no longer needed",
        changeType: "drop_column",
        method: "db_push",
        environment: "production",
        destructive: true,
        approvedBy: "operator",
      }),
    ).rejects.toThrow(/destructive changes require rollbackPlan/);
  });

  it("destructive change with both approvedBy + rollbackPlan succeeds", async () => {
    vi.mocked(prisma.schemaChangeLedger.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.schemaChangeLedger.create).mockResolvedValue({
      id: "lg_destructive",
    } as never);

    const result = await recordSchemaChange({
      changeKey: "v10-drop-z",
      title: "Drop column Z",
      reason: "deprecated",
      changeType: "drop_column",
      method: "db_push",
      environment: "production",
      destructive: true,
      approvedBy: "operator",
      rollbackPlan: "ALTER TABLE foo ADD COLUMN z ...",
    });

    expect(result.created).toBe(true);
    const callArgs = vi.mocked(prisma.schemaChangeLedger.create).mock.calls[0]?.[0];
    expect(callArgs?.data?.destructive).toBe(true);
    expect(callArgs?.data?.rollbackPlan).toBeTruthy();
  });
});

describe("v10 B.4 · markSchemaChangeApplied", () => {
  it("transitions planned → applied with appliedAt timestamp", async () => {
    vi.mocked(prisma.schemaChangeLedger.updateMany).mockResolvedValue({
      count: 1,
    } as never);

    await markSchemaChangeApplied({ changeKey: "v10-x" });

    const args = vi.mocked(prisma.schemaChangeLedger.updateMany).mock.calls[0]?.[0];
    expect(args?.where).toMatchObject({ changeKey: "v10-x", status: "planned" });
    expect(args?.data?.status).toBe("applied");
    expect(args?.data?.appliedAt).toBeInstanceOf(Date);
  });

  it("throws when no planned row exists for the key", async () => {
    vi.mocked(prisma.schemaChangeLedger.updateMany).mockResolvedValue({
      count: 0,
    } as never);

    await expect(
      markSchemaChangeApplied({ changeKey: "v10-missing" }),
    ).rejects.toThrow(/no planned ledger row found/);
  });
});

describe("v10 B.4 · markSchemaChangeFailed + RolledBack", () => {
  it("markFailed transitions planned → failed with error in summary", async () => {
    vi.mocked(prisma.schemaChangeLedger.updateMany).mockResolvedValue({
      count: 1,
    } as never);

    await markSchemaChangeFailed("v10-x", "P1001 connection refused");

    const args = vi.mocked(prisma.schemaChangeLedger.updateMany).mock.calls[0]?.[0];
    expect(args?.data?.status).toBe("failed");
    expect((args?.data?.sqlSummary as string)).toContain("[FAILED]");
    expect((args?.data?.sqlSummary as string)).toContain("P1001");
  });

  it("markRolledBack transitions applied → rolled_back with timestamp", async () => {
    vi.mocked(prisma.schemaChangeLedger.updateMany).mockResolvedValue({
      count: 1,
    } as never);

    await markSchemaChangeRolledBack("v10-x", "operator");

    const args = vi.mocked(prisma.schemaChangeLedger.updateMany).mock.calls[0]?.[0];
    expect(args?.where).toMatchObject({ changeKey: "v10-x", status: "applied" });
    expect(args?.data?.status).toBe("rolled_back");
    expect((args?.data?.sqlSummary as string)).toContain("[ROLLED-BACK by operator");
  });
});

describe("v10 B.4 · listRecentSchemaChanges", () => {
  it("clamps limit to [1, 200]", async () => {
    vi.mocked(prisma.schemaChangeLedger.findMany).mockResolvedValue([] as never);

    await listRecentSchemaChanges({ limit: 9999 });
    const args1 = vi.mocked(prisma.schemaChangeLedger.findMany).mock.calls[0]?.[0];
    expect(args1?.take).toBe(200);

    await listRecentSchemaChanges({ limit: 0 });
    const args2 = vi.mocked(prisma.schemaChangeLedger.findMany).mock.calls[1]?.[0];
    expect(args2?.take).toBe(1);
  });

  it("environment filter is passed to where clause", async () => {
    vi.mocked(prisma.schemaChangeLedger.findMany).mockResolvedValue([] as never);

    await listRecentSchemaChanges({ environment: "production" });
    const args = vi.mocked(prisma.schemaChangeLedger.findMany).mock.calls[0]?.[0];
    expect(args?.where).toMatchObject({ environment: "production" });
  });
});

describe("v10 B.4 · getSchemaLedgerStats", () => {
  it("aggregates counts across windows", async () => {
    vi.mocked(prisma.schemaChangeLedger.count).mockResolvedValue(0 as never);

    const stats = await getSchemaLedgerStats();

    expect(stats).toEqual({
      totalChanges: 0,
      appliedLast24h: 0,
      appliedLast7d: 0,
      pendingPlanned: 0,
      failedLast24h: 0,
      destructiveLast30d: 0,
    });
    expect(prisma.schemaChangeLedger.count).toHaveBeenCalledTimes(6);
  });
});
