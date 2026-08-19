import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkItemStatus, TaskStatus } from "@prisma/client";

process.env.DIRECT_URL = "postgres://mock-direct-url";

// Define mock functions for dependencies
const mocks = {
  buildCronCommandDeck: vi.fn(),
  runManifestCron: vi.fn(),
  recordCoachEvent: vi.fn(),
  markOllamaQuotaExhausted: vi.fn(),
  decomposeTaskWithAi: vi.fn(),
  clientConnect: vi.fn(),
  clientQuery: vi.fn(),
  clientEnd: vi.fn(),
};

// Mock pg module
vi.mock("pg", () => {
  const Client = vi.fn().mockImplementation(() => ({
    connect: mocks.clientConnect,
    query: mocks.clientQuery,
    end: mocks.clientEnd,
  }));
  return {
    default: { Client },
    Client,
  };
});

// Mock service dependencies
vi.mock("@/lib/services/system-pages", () => ({
  buildCronCommandDeck: () => mocks.buildCronCommandDeck(),
}));

vi.mock("@/lib/services/cron-control", () => ({
  runManifestCron: (name: string) => mocks.runManifestCron(name),
}));

vi.mock("@/lib/services/coach-events", () => ({
  recordCoachEvent: (input: unknown) => mocks.recordCoachEvent(input),
}));

vi.mock("@/lib/services/ai-tasks", () => ({
  decomposeTaskWithAi: (taskId: string) => mocks.decomposeTaskWithAi(taskId),
}));

vi.mock("@/lib/ai/provider", () => ({
  markOllamaQuotaExhausted: () => mocks.markOllamaQuotaExhausted(),
  isOllamaQuotaExhausted: () => false,
  getProviderStatus: () => ({ providers: [] }),
}));

// Mock prisma client
vi.mock("@/lib/prisma", () => {
  return {
    prisma: {
      agentTrace: {
        findMany: vi.fn(),
        deleteMany: vi.fn(),
      },
      workItem: {
        findMany: vi.fn(),
        update: vi.fn(),
      },
      task: {
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      apiRequestLog: {
        deleteMany: vi.fn(),
      },
      errorLog: {
        deleteMany: vi.fn(),
      },
      stateLog: {
        deleteMany: vi.fn(),
      },
      toolVerbRatio: {
        deleteMany: vi.fn(),
      },
      systemMetric: {
        deleteMany: vi.fn(),
      },
      deviceEvent: {
        deleteMany: vi.fn(),
      },
      auditEvent: {
        deleteMany: vi.fn(),
        create: vi.fn(),
      },
      cronJobLog: {
        deleteMany: vi.fn(),
      },
      $queryRaw: vi.fn(),
      $queryRawUnsafe: vi.fn(),
    },
  };
});

import { runAutonomicOrchestrator } from "@/lib/services/autonomic-orchestrator";
import { prisma } from "@/lib/prisma";

let mockAgentTracesPhase2: any[] = [];
let mockAgentTracesPhase3: any[] = [];

describe("services/autonomic-orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Setup default mock returns to avoid crashes
    mocks.buildCronCommandDeck.mockResolvedValue({ rows: [] });
    mocks.clientConnect.mockResolvedValue(undefined);
    mocks.clientQuery.mockResolvedValue({ rows: [] });
    mocks.clientEnd.mockResolvedValue(undefined);
    
    mockAgentTracesPhase2 = [];
    mockAgentTracesPhase3 = [];
    vi.mocked(prisma.agentTrace.findMany).mockImplementation(async (args: any) => {
      const where = args?.where ?? {};
      if (where.provider) {
        return mockAgentTracesPhase3;
      }
      return mockAgentTracesPhase2;
    });

    vi.mocked(prisma.agentTrace.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.workItem.findMany).mockResolvedValue([]);
    vi.mocked(prisma.task.findMany).mockResolvedValue([]);
    vi.mocked(prisma.task.update).mockResolvedValue({} as any);
    vi.mocked(prisma.task.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.apiRequestLog.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.errorLog.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.stateLog.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.toolVerbRatio.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.systemMetric.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.deviceEvent.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.auditEvent.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.cronJobLog.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as any);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([]);
  });

  it("Phase 1: heals failing or never-run crons (limit 3)", async () => {
    mocks.buildCronCommandDeck.mockResolvedValue({
      rows: [
        { name: "failing-cron", enabled: true, mode: "active", lastStatus: "failed", success14d: 5, fail14d: 1, lastRunAt: "2026-06-13T10:00:00Z" },
        { name: "never-run-cron", enabled: true, mode: "active", lastStatus: null, success14d: 0, fail14d: 0, lastRunAt: null },
        { name: "ok-cron", enabled: true, mode: "active", lastStatus: "success", success14d: 10, fail14d: 0, lastRunAt: "2026-06-13T10:00:00Z" },
        { name: "disabled-cron", enabled: false, mode: "active", lastStatus: "failed", success14d: 0, fail14d: 1, lastRunAt: "2026-06-13T10:00:00Z" },
        { name: "retired-cron", enabled: true, mode: "retired", lastStatus: "failed", success14d: 0, fail14d: 1, lastRunAt: "2026-06-13T10:00:00Z" },
      ],
    });

    // 2026-08-19 · fixture matches the real CronTriggerResult contract,
    // which always carries `ok` — the healer now checks it (a 404 from
    // triggerCronByPath resolves as ok:false and must not count as a heal).
    mocks.runManifestCron.mockResolvedValue({ ok: true, status: 200, durationMs: 150 });

    const res = await runAutonomicOrchestrator();

    expect(res.healedCrons).toContain("failing-cron");
    expect(res.healedCrons).toContain("never-run-cron");
    expect(res.healedCrons).not.toContain("ok-cron");
    expect(res.healedCrons).not.toContain("disabled-cron");
    expect(res.healedCrons).not.toContain("retired-cron");
    expect(mocks.runManifestCron).toHaveBeenCalledTimes(2);
    expect(mocks.recordCoachEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        priority: "P0",
        title: "Cron Healer: Rescued failing-cron",
      })
    );
    expect(mocks.recordCoachEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        priority: "P1",
        title: "Cron Healer: Rescued never-run-cron",
      })
    );
  });

  it("Phase 1: a heal attempt that resolves ok:false (e.g. 404) is NOT a rescue", async () => {
    // Regression (2026-08-19): triggerCronByPath never throws — a manifest
    // entry with no route resolves { ok:false, status:404 }. The healer
    // used to push it into healedCrons unconditionally and file a
    // "Cron Healer: Rescued X" coach event, burning the whole
    // MAX_HEAL_PER_RUN budget on phantom heals before reaching a real cron.
    mocks.buildCronCommandDeck.mockResolvedValue({
      rows: [
        { name: "phantom-cron", enabled: true, mode: "active", lastStatus: null, success14d: 0, fail14d: 0, lastRunAt: null },
      ],
    });
    mocks.runManifestCron.mockResolvedValue({ ok: false, status: 404, durationMs: 20 });

    const res = await runAutonomicOrchestrator();

    expect(res.healedCrons).not.toContain("phantom-cron");
    expect(mocks.recordCoachEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Cron Healer: Rescued phantom-cron" })
    );
  });

  it("Phase 2: vacuums bloated tables and reindexes HNSW on high latency, and vacuums over-50MB tables", async () => {
    // Mock pg stats query returning one bloated table, one large table
    mocks.clientQuery.mockResolvedValueOnce({
      rows: [
        { table_name: "CronJobLog", dead_rows: 1500, live_rows: 100, total_bytes: 100000 },
        { table_name: "agent_traces", dead_rows: 10, live_rows: 1000, total_bytes: 60 * 1024 * 1024 }, // 60MB -> triggers vacuum
        { table_name: "OkTable", dead_rows: 10, live_rows: 1000, total_bytes: 20000 },
      ],
    });

    // Mock recent agent traces with average latency > 150ms
    mockAgentTracesPhase2 = [
      { durationMs: 200 },
      { durationMs: 160 },
    ];

    const res = await runAutonomicOrchestrator();

    expect(res.vacuumedTables).toContain("CronJobLog");
    expect(res.vacuumedTables).toContain("agent_traces");
    expect(res.vacuumedTables).not.toContain("OkTable");
    expect(mocks.clientQuery).toHaveBeenCalledWith('VACUUM ANALYZE "CronJobLog"');
    expect(mocks.clientQuery).toHaveBeenCalledWith('VACUUM ANALYZE "agent_traces"');
    expect(res.avgLatencyMs).toBe(180);
    expect(res.indexReindexed).toBe(true);
    expect(mocks.clientQuery).toHaveBeenCalledWith("REINDEX INDEX CONCURRENTLY vector_embeddings_hnsw_1536");
  });

  it("Phase 3: trips Ollama circuit breaker on too many timeouts/errors and rescues work items", async () => {
    // 3 timeout/error traces on Ollama
    mockAgentTracesPhase3 = [
      { provider: "ollama", errorClass: "timeout", errorMessage: "deadline exceeded" },
      { provider: "ollama", errorClass: "failed", errorMessage: "ECONNRESET" },
      { provider: "ollama", errorClass: "failed", errorMessage: "timeout" },
    ];

    // 1 stalled WorkItem (claimed >15 minutes ago)
    vi.mocked(prisma.workItem.findMany).mockResolvedValueOnce([
      { id: "wi_stalled_1", type: "leads_sync", status: WorkItemStatus.CLAIMED } as any,
    ]);

    const res = await runAutonomicOrchestrator();

    expect(res.ollamaQuotaTripped).toBe(true);
    expect(mocks.markOllamaQuotaExhausted).toHaveBeenCalled();
    expect(res.rescuedWorkItems).toContain("wi_stalled_1");
    expect(prisma.workItem.update).toHaveBeenCalledWith({
      where: { id: "wi_stalled_1" },
      data: expect.objectContaining({
        status: WorkItemStatus.FAILED,
        errorCode: "STALLED",
      }),
    });
    expect(mocks.recordCoachEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        priority: "P0",
        title: "WorkItem Stalled: leads_sync",
      })
    );
  });

  it("Phase 3: trips Ollama circuit breaker instantly on 402", async () => {
    mockAgentTracesPhase3 = [
      { provider: "ollama", errorClass: "QuotaExhausted", errorMessage: "402 Payment Required" },
    ];

    const res = await runAutonomicOrchestrator();

    expect(res.ollamaQuotaTripped).toBe(true);
    expect(mocks.markOllamaQuotaExhausted).toHaveBeenCalled();
  });

  it("Phase 4: prunes log tables and runs task janitor", async () => {
    // Mock row counts returning high volume -> triggers aggressive pruning
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
      { relname: "CronJobLog", n_live_tup: 30000 },
      { relname: "system_metrics", n_live_tup: 15000 },
    ]);

    vi.mocked(prisma.apiRequestLog.deleteMany).mockResolvedValueOnce({ count: 50 });
    vi.mocked(prisma.task.updateMany).mockResolvedValueOnce({ count: 12 });

    const res = await runAutonomicOrchestrator();

    expect(res.prunedLogsCount).toBeGreaterThan(0);
    expect(res.archivedTasksCount).toBe(12);
    expect(prisma.task.updateMany).toHaveBeenCalledWith({
      where: {
        status: TaskStatus.READY,
        updatedAt: { lt: expect.any(Date) },
      },
      data: { status: TaskStatus.ARCHIVED },
    });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actor: "cron:data-cleanup",
          eventType: "cron:data_cleanup_completed",
        }),
      })
    );
  });

  it("Phase 5: decomposes stalled Tasks", async () => {
    vi.mocked(prisma.task.findMany).mockResolvedValueOnce([
      { id: "task_stalled_1", title: "Write complex database architecture report", status: TaskStatus.DOING, effort: "H1", nextPhysicalAction: "Start outline", context: "DESK" } as any,
    ]);

    mocks.decomposeTaskWithAi.mockResolvedValueOnce({ ok: true, subtasksCount: 4 });

    const res = await runAutonomicOrchestrator();

    expect(res.decomposedTasksCount).toBe(1);
    expect(mocks.decomposeTaskWithAi).toHaveBeenCalledWith("task_stalled_1");
    expect(prisma.task.update).toHaveBeenCalledWith({
      where: { id: "task_stalled_1" },
      data: {
        status: TaskStatus.WAITING,
        updatedBy: "cron:autonomic-healer",
      },
    });
    expect(mocks.recordCoachEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        priority: "P1",
        title: 'Task Healed: Decomposed "Write complex database architecture report"',
      })
    );
  });
});
