/**
 * tests/services/diagnose-chat.test.ts · de-Venice control-plane lock.
 *
 * The "Diagnose with Nick" probe used to ping Venice directly. The
 * de-Venice sweep rewired it onto `getProviderHealth()` (the
 * multi-lane fleet snapshot) via `checkProviders()`. This test runs
 * the real `runChatDiagnostic()` against a mocked provider-health
 * snapshot + empty Prisma, and locks that:
 *   · the first health check is "AI providers" (the fleet probe), and
 *   · the assembled markdown report mentions neither "Venice" nor the
 *     old "quick mode" copy.
 *
 * A regression that reintroduces a Venice ping or the quick-mode
 * language fails here.
 */

import { describe, it, expect, vi } from "vitest";

// Fleet snapshot stub — two lanes up, all green. checkProviders reads
// snap.providers / snap.overallTone / snap.pillLabel.
vi.mock("@/lib/ai/provider-health", () => ({
  getProviderHealth: async () => ({
    overallTone: "green",
    providers: [
      { name: "ollama", available: true, modelId: "x" },
      { name: "gemini", available: true, modelId: "y" },
    ],
    pillLabel: "all green",
  }),
}));

// Prisma is only used for the request-log / audit-event reads — return
// empty arrays so the report has no error/slow sections to assemble.
// $queryRaw resolves so the DB latency check passes too.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
    apiRequestLog: { findMany: vi.fn().mockResolvedValue([]) },
    auditEvent: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { runChatDiagnostic } from "@/lib/services/diagnose-chat";

describe("runChatDiagnostic · de-Venice'd provider probe", () => {
  it("reports the fleet probe as the first check, named 'AI providers'", async () => {
    const result = await runChatDiagnostic();
    expect(result.checks[0].name).toBe("AI providers");
    expect(result.checks[0].ok).toBe(true);
  });

  it("produces a report with no Venice mention and no 'quick mode' copy", async () => {
    const result = await runChatDiagnostic();
    expect(result.report).not.toMatch(/venice/i);
    expect(result.report).not.toMatch(/quick mode/i);
  });

  it("surfaces the live lanes from the fleet snapshot in the report", async () => {
    const result = await runChatDiagnostic();
    // Sanity: the rewire actually plumbs getProviderHealth output
    // through — the up-lanes detail string lists ollama + gemini.
    expect(result.report).toMatch(/ollama/);
    expect(result.report).toMatch(/gemini/);
  });
});
