/**
 * v10.0.24 · Tests for schema coverage report builder.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

import { prisma } from "@/lib/prisma";
import { buildSchemaCoverageReport } from "@/lib/db/schema-coverage";

const $queryRaw = vi.mocked(prisma.$queryRaw);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("v10.0.24 · buildSchemaCoverageReport", () => {
  it("flags large tables with too few indexes", async () => {
    // pg_stat_user_tables call returns BrainMemory with 50k rows.
    $queryRaw
      .mockResolvedValueOnce([
        { schemaname: "public", relname: "BrainMemory", n_live_tup: 50_000 },
      ] as never)
      // pg_indexes call returns BrainMemory with only the PK index.
      .mockResolvedValueOnce([
        { tablename: "BrainMemory", indexname: "BrainMemory_pkey" },
      ] as never);

    const report = await buildSchemaCoverageReport();
    const brainMemory = report.models.find((m) => m.modelName === "BrainMemory");
    expect(brainMemory).toBeDefined();
    expect(brainMemory?.estimatedRows).toBe(50_000);
    expect(brainMemory?.indexCount).toBe(1);
    expect(brainMemory?.flagged).toBe(true);
    expect(brainMemory?.flagReason).toContain("seq-scan");
  });

  it("flags slow-query tables even at smaller row counts", async () => {
    $queryRaw
      .mockResolvedValueOnce([
        { schemaname: "public", relname: "Task", n_live_tup: 500 },
      ] as never)
      .mockResolvedValueOnce([
        { tablename: "Task", indexname: "Task_pkey" },
        { tablename: "Task", indexname: "Task_status_idx" },
      ] as never);

    const report = await buildSchemaCoverageReport({
      slowQueryShapes: ['SELECT * FROM "Task" WHERE status = $1'],
    });
    const task = report.models.find((m) => m.modelName === "Task");
    expect(task).toBeDefined();
    expect(task?.inRecentSlowQueries).toBe(true);
    expect(task?.flagged).toBe(true);
    expect(task?.flagReason).toContain("slow-queries");
  });

  it("does NOT flag well-indexed tables", async () => {
    $queryRaw
      .mockResolvedValueOnce([
        { schemaname: "public", relname: "ChatMessage", n_live_tup: 100_000 },
      ] as never)
      .mockResolvedValueOnce([
        { tablename: "ChatMessage", indexname: "ChatMessage_pkey" },
        { tablename: "ChatMessage", indexname: "idx_a" },
        { tablename: "ChatMessage", indexname: "idx_b" },
        { tablename: "ChatMessage", indexname: "idx_c" },
      ] as never);

    const report = await buildSchemaCoverageReport();
    const chat = report.models.find((m) => m.modelName === "ChatMessage");
    expect(chat?.flagged).toBe(false);
    expect(chat?.flagReason).toBeNull();
  });

  it("sorts flagged models first, then by row count desc", async () => {
    $queryRaw
      .mockResolvedValueOnce([
        { schemaname: "public", relname: "BrainMemory", n_live_tup: 30_000 },
        { schemaname: "public", relname: "ChatMessage", n_live_tup: 200_000 },
        { schemaname: "public", relname: "Task", n_live_tup: 80_000 },
      ] as never)
      .mockResolvedValueOnce([
        { tablename: "BrainMemory", indexname: "_pkey" },
        // Only PK on BrainMemory → flagged.
        { tablename: "ChatMessage", indexname: "_pkey" },
        { tablename: "ChatMessage", indexname: "idx_a" },
        { tablename: "ChatMessage", indexname: "idx_b" },
        // 3 indexes on ChatMessage → not flagged.
        { tablename: "Task", indexname: "_pkey" },
        // Only PK on Task → flagged.
      ] as never);

    const report = await buildSchemaCoverageReport();
    // Flagged ones first
    expect(report.models[0].flagged).toBe(true);
    expect(report.models[1].flagged).toBe(true);
    // Among flagged: bigger first
    expect(report.models[0].estimatedRows).toBeGreaterThan(
      report.models[1].estimatedRows,
    );
  });

  it("survives a Postgres query failure with empty maps", async () => {
    $queryRaw.mockRejectedValue(new Error("db down"));
    const report = await buildSchemaCoverageReport();
    expect(report.models.length).toBeGreaterThan(0);
    // All rows should be 0 + 0 indexes since the maps fell back empty.
    for (const m of report.models) {
      expect(m.estimatedRows).toBe(0);
      expect(m.indexCount).toBe(0);
    }
    // v10.0.26 — permission-denied flag must be set so the dashboard
    // can warn rather than silently showing zeros as "all healthy".
    expect(report.permissionDenied).toBe(true);
  });

  it("does NOT set permissionDenied when reads succeed (even if empty)", async () => {
    // Both queries succeed but return zero rows — fresh DB scenario.
    $queryRaw
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);
    const report = await buildSchemaCoverageReport();
    expect(report.permissionDenied).toBe(false);
  });
});
