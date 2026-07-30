/**
 * tests/services/diagnose-chat.test.ts · de-Venice control-plane lock
 * + truth-source lock.
 *
 * Lock 1 (de-Venice sweep): the probe reads `getProviderHealth()` (the
 * multi-lane fleet snapshot) via `checkProviders()` — the first health
 * check is "AI providers" and the report mentions neither "Venice" nor
 * the old "quick mode" copy.
 *
 * Lock 2 (2026-07-29 truth sources): prod `api_request_logs` has ZERO
 * rows for `/api/ai/chat` EVER — the chat route exports a bare POST and
 * never passes through the `apiHandler` request logger — so the old
 * request-log reads always returned [] and the report always claimed
 * "none in the last hour at the server level". The sections now read:
 *   · Chat errors  → auditEvent eventType="ai_error" actor="chat"
 *   · Slow chat    → aiGeneration feature="chat" durationMs>=15s
 *   · Other errors → auditEvent ai_error, every non-chat actor
 * The prisma mock has NO apiRequestLog key ON PURPOSE — a regression
 * that reintroduces the vacuous source crashes here on the missing mock.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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

const { auditFindMany, generationFindMany } = vi.hoisted(() => ({
  auditFindMany: vi.fn(),
  generationFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
    auditEvent: { findMany: auditFindMany },
    aiGeneration: { findMany: generationFindMany },
  },
}));

import { runChatDiagnostic } from "@/lib/services/diagnose-chat";

beforeEach(() => {
  auditFindMany.mockReset().mockResolvedValue([]);
  generationFindMany.mockReset().mockResolvedValue([]);
});

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

describe("runChatDiagnostic · truth sources", () => {
  it("reads chat errors from the ai_error audit trail scoped to actor 'chat'", async () => {
    auditFindMany.mockImplementation(async (args: { where?: { actor?: unknown } }) =>
      args?.where?.actor === "chat"
        ? [{ createdAt: new Date("2026-07-29T12:00:00Z"), detail: "chat:stream: provider timeout" }]
        : [],
    );
    const result = await runChatDiagnostic();
    expect(result.recentErrors).toHaveLength(1);
    expect(result.recentErrors[0].detail).toBe("chat:stream: provider timeout");
    expect(result.report).toMatch(/## Chat errors \(1 in last hour\)/);
    expect(result.report).toMatch(/chat:stream: provider timeout/);
    expect(auditFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ eventType: "ai_error", actor: "chat" }),
      }),
    );
  });

  it("does NOT print the transient-blip all-clear when chat errors exist", async () => {
    auditFindMany.mockImplementation(async (args: { where?: { actor?: unknown } }) =>
      args?.where?.actor === "chat"
        ? [{ createdAt: new Date(), detail: "chat:request: boom" }]
        : [],
    );
    const result = await runChatDiagnostic();
    expect(result.report).not.toMatch(/transient network blip/i);
    expect(result.report).toMatch(/logged real errors/i);
  });

  it("prints the all-clear only when the trail is readable AND empty", async () => {
    const result = await runChatDiagnostic();
    expect(result.report).toMatch(/none in the last hour \(ai_error audit trail\)/);
    expect(result.report).toMatch(/transient network blip/i);
  });

  it("reports the trail as unavailable — never 'none' — when the audit read fails", async () => {
    auditFindMany.mockImplementation(async (args: { where?: { actor?: unknown } }) => {
      if (args?.where?.actor === "chat") throw new Error("neon down");
      return [];
    });
    const result = await runChatDiagnostic();
    expect(result.report).toMatch(/error trail unavailable/i);
    expect(result.report).not.toMatch(/none in the last hour/);
    expect(result.report).not.toMatch(/transient network blip/i);
  });

  it("sources slow requests from AiGeneration feature='chat' (>15s)", async () => {
    generationFindMany.mockResolvedValue([
      { createdAt: new Date("2026-07-29T12:00:00Z"), durationMs: 22_000, model: "deepseek-v4-pro" },
    ]);
    const result = await runChatDiagnostic();
    expect(result.slowRequests).toEqual([
      expect.objectContaining({ durationMs: 22_000, model: "deepseek-v4-pro" }),
    ]);
    expect(result.report).toMatch(/## Slow chat generations/);
    expect(result.report).toMatch(/deepseek-v4-pro/);
    expect(generationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ feature: "chat", durationMs: { gte: 15_000 } }),
      }),
    );
  });

  it("separates non-chat ai errors into their own fleet-context section", async () => {
    auditFindMany.mockImplementation(async (args: { where?: { actor?: unknown } }) =>
      args?.where?.actor === "chat"
        ? []
        : [{ createdAt: new Date(), actor: "cron", detail: "cron:job: nightly failed" }],
    );
    const result = await runChatDiagnostic();
    expect(result.aiErrorEvents).toHaveLength(1);
    expect(result.aiErrorEvents[0].actor).toBe("cron");
    expect(result.report).toMatch(/## Other AI errors \(1/);
    // A clean chat trail still prints its all-clear even when other actors error.
    expect(result.report).toMatch(/none in the last hour/);
  });
});
