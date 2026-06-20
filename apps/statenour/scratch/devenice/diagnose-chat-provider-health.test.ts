import { describe, it, expect, vi, beforeEach } from "vitest";

// One-line note: Assertions checking that the diagnostics report omits Venice and 'quick' mode references go green only after F2 source changes in diagnose-chat.ts are applied.

// Mock prisma
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(async () => [1]),
    apiRequestLog: {
      findMany: vi.fn().mockResolvedValue([
        {
          createdAt: new Date(),
          statusCode: 500,
          durationMs: 450,
          error: "Simulated internal gateway error",
        },
      ]),
    },
    auditEvent: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

// Mock provider health
vi.mock("@/lib/ai/provider-health", () => ({
  getProviderHealth: vi.fn(async () => ({
    overallTone: "green",
    providers: [
      { name: "gemini", available: true, latencyMs: 150 },
      { name: "openai", available: true, latencyMs: 250 },
    ],
  })),
}));

describe("diagnose-chat provider health diagnostics", () => {
  it("generates a report with no Venice or quick mode references", async () => {
    const { runChatDiagnostic } = await import("@/lib/services/diagnose-chat");

    const result = await runChatDiagnostic();

    expect(result.ok).toBe(true);
    expect(result.report).toBeDefined();

    // The report must not refer to Venice (case insensitive)
    expect(result.report.toLowerCase()).not.toContain("venice");

    // The report must not recommend or mention "quick" mode
    expect(result.report.toLowerCase()).not.toContain("quick");

    // The report should contain database check
    expect(result.report).toContain("Database");

    // The report should contain details of the recent errors
    expect(result.report).toContain("500");
    expect(result.report).toContain("Simulated internal gateway error");
  });
});
