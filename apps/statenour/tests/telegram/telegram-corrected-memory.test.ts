/**
 * Corrected memories never reach Telegram /memory or /ask (audit tail T1).
 *
 * THE DEFECT: the keyword fallback in /memory and the memorySearch lexical
 * fallback in /ask filtered deletedAt and the quarantine category, but not the
 * correction state. A memory a later correction superseded, or whose validity
 * window had closed, came back as if it were still believed.
 *
 * Fixtures: one current memory, one superseded by a correction, one whose
 * validUntil has passed. The model is scripted; Telegram and Prisma are fakes.
 * Nothing leaves the process.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { MockLanguageModelV3 } from "ai/test";

const h = vi.hoisted(() => {
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-webhook-secret");
  vi.stubEnv("TELEGRAM_OWNER_ID", "4242");
  vi.stubEnv("TELEGRAM_CHAT_ID", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("network disabled in this test");
    }),
  );
  const rows = [
    { id: "m_cur", content: "Sam prefers Tuesdays", category: "fact", confidence: 0.9, deletedAt: null, supersededById: null, validUntil: null },
    { id: "m_old", content: "Sam prefers Thursdays", category: "fact", confidence: 0.95, deletedAt: null, supersededById: "m_cur", validUntil: null },
    { id: "m_exp", content: "Sam prefers Fridays", category: "fact", confidence: 0.95, deletedAt: null, supersededById: null, validUntil: new Date("2020-01-01T00:00:00Z") },
  ];
  // Evaluates the Prisma operators the lexical lanes use, so the test sees what
  // the query actually returns. Unknown operators pass (a leak then fails loudly).
  const matchesWhere = (row: Record<string, unknown>, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([k, cond]) => {
      if (k === "OR") return (cond as Record<string, unknown>[]).some((w) => matchesWhere(row, w));
      if (k === "AND") return (cond as Record<string, unknown>[]).every((w) => matchesWhere(row, w));
      if (k === "content") {
        return String(row.content).toLowerCase().includes(String((cond as { contains: string }).contains).toLowerCase());
      }
      if (k === "category") return !((cond as { notIn: string[] }).notIn ?? []).includes(String(row.category));
      const v = row[k];
      if (cond === null) return v === null || v === undefined;
      if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
      if (typeof cond === "object" && cond !== null && "gt" in cond) {
        return v instanceof Date && v.getTime() > (cond as { gt: Date }).gt.getTime();
      }
      return true;
    });
  const inert = (method: string) => async () =>
    method.startsWith("findMany") ? [] : method.endsWith("Many") || method === "count" ? { count: 0 } : null;
  const prisma = new Proxy(
    {},
    {
      get: (_t, model: string) =>
        model === "brainMemory"
          ? { findMany: async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => matchesWhere(r, where)) }
          : new Proxy({}, { get: (_m, method: string) => inert(method) }),
    },
  );
  return {
    prisma,
    model: null as unknown,
    prompts: [] as unknown[],
    semanticSearch: vi.fn(async (..._a: unknown[]) => [] as unknown[]),
    sendTelegram: vi.fn(async (..._a: unknown[]) => true),
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/feature-flags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/feature-flags")>();
  return {
    ...actual,
    getFlag: (key: string) => (key === "NICK_MUTATION_LOCK" ? { isOn: false } : actual.getFlag(key)),
  };
});
vi.mock("@/lib/services/telegram", async (orig) => ({
  ...(await orig<typeof import("@/lib/services/telegram")>()),
  sendTelegram: h.sendTelegram,
  answerCallbackQuery: vi.fn(async () => true),
  editTelegramMessage: vi.fn(async () => true),
  sendTelegramWithButtons: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/brain/journal-brain", () => ({ confirmJournalLink: vi.fn() }));
vi.mock("@/lib/observability/langfuse", async (orig) => ({
  ...(await orig<typeof import("@/lib/observability/langfuse")>()),
  langfuseTelemetry: () => undefined,
}));
vi.mock("@/lib/ai/provider", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/provider")>()),
  getModel: () => h.model,
}));
vi.mock("@/lib/ai/agent-trace", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/agent-trace")>()),
  mintTraceId: () => "trace_test",
  recordTrace: vi.fn(async () => undefined),
}));
vi.mock("@/lib/brain/embedding-utils", async (orig) => ({
  ...(await orig<typeof import("@/lib/brain/embedding-utils")>()),
  semanticSearch: h.semanticSearch,
}));
vi.mock("@/lib/services/tasks", async (orig) => ({
  ...(await orig<typeof import("@/lib/services/tasks")>()),
  createTask: vi.fn(async () => ({ id: "task_1" })),
}));
vi.mock("@/lib/services/missions", async (orig) => ({
  ...(await orig<typeof import("@/lib/services/missions")>()),
  resolveInboxMissionId: async () => "m_inbox",
}));

import { POST } from "@/app/api/telegram/webhook/route";

beforeAll(async () => {
  await import("@/lib/ai/tools");
}, 180_000);

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
  h.prompts.length = 0;
  h.semanticSearch.mockResolvedValue([]);
});

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
type Step = { toolName: string; input: Record<string, unknown> } | { text: string };

function scripted(steps: Step[]) {
  let i = 0;
  return new MockLanguageModelV3({
    doGenerate: async (options: { prompt: unknown }) => {
      h.prompts.push(options.prompt);
      const step = steps[Math.min(i, steps.length - 1)];
      i += 1;
      if ("text" in step) {
        return { content: [{ type: "text", text: step.text }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] };
      }
      return {
        content: [{ type: "tool-call", toolCallId: `call_${i}`, toolName: step.toolName, input: JSON.stringify(step.input) }],
        finishReason: { unified: "tool-calls", raw: "tool_calls" },
        usage,
        warnings: [],
      };
    },
  } as ConstructorParameters<typeof MockLanguageModelV3>[0]);
}

function send(text: string): NextRequest {
  return new NextRequest("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "test-webhook-secret" },
    body: JSON.stringify({ message: { text, chat: { id: 4242 }, from: { id: 4242 } } }),
  });
}

/** Everything a /memory reply put in front of the operator. */
function sentToOperator(): string {
  return h.sendTelegram.mock.calls.map((c) => String(c[0])).join("\n");
}

describe("corrected memories never reach /memory or /ask", () => {
  it("/memory keyword lane: the current memory is shown; the superseded and expired ones are not", async () => {
    h.semanticSearch.mockResolvedValueOnce([]);

    await POST(send("/memory Sam"));

    const sent = sentToOperator();
    expect(sent).toContain("Tuesdays");
    expect(sent).not.toContain("Thursdays");
    expect(sent).not.toContain("Fridays");
  });

  it("/ask memorySearch lexical lane: the model is shown the current memory only", async () => {
    h.semanticSearch.mockResolvedValueOnce([]);
    h.model = scripted([{ toolName: "memorySearch", input: { query: "Sam" } }, { text: "Tuesdays." }]);

    await POST(send("/ask when does Sam like to come in?"));

    // Every prompt the model received, including the memorySearch tool result it was shown.
    const seen = JSON.stringify(h.prompts) + JSON.stringify(h.sendTelegram.mock.calls);
    expect(seen).toContain("Tuesdays");
    expect(seen).not.toContain("Thursdays");
    expect(seen).not.toContain("Fridays");
  });
});
