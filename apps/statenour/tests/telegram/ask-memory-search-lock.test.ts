/**
 * Telegram /ask: the memorySearch READ survives NICK_MUTATION_LOCK; the
 * createTask WRITE does not (hostile review 2026-10-10).
 *
 * THE DEFECT: cmdAsk wrapped BOTH lane tools with wrapToolsWithEmptyHandling.
 * memorySearch has no TOOL_CATALOG row, and capability-registry counts an
 * uncatalogued tool as a write, so authorityGate refused every /ask memory
 * recall with "mutation_locked ... it changes state" whenever the lock was on
 * or the flag store could not be read. The freeze removed the operator's
 * read-only phone recall and told the model a read was a blocked write.
 *
 * The model is a scripted MockLanguageModelV3; embeddings, the task service,
 * the flag store and Telegram are mocked; fetch throws. Nothing leaves the
 * process.
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
  const inert = (method: string) => async () =>
    method.startsWith("findMany") ? [] : method.endsWith("Many") || method === "count" ? { count: 0 } : null;
  const prisma = new Proxy({}, { get: () => new Proxy({}, { get: (_m, method: string) => inert(method) }) });
  return {
    prisma,
    flags: { lockOn: false, lockThrows: false },
    model: null as unknown,
    prompts: [] as unknown[],
    semanticSearch: vi.fn(async (..._a: unknown[]) => [] as unknown[]),
    createTask: vi.fn(async (input: { title: string }) => ({ id: "task_1", title: input.title })),
    sendTelegram: vi.fn(async (..._a: unknown[]) => true),
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/feature-flags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/feature-flags")>();
  return {
    ...actual,
    getFlag: (key: string) => {
      if (key !== "NICK_MUTATION_LOCK") return actual.getFlag(key);
      if (h.flags.lockThrows) throw new Error("flag store down");
      return { isOn: h.flags.lockOn };
    },
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
  createTask: h.createTask,
}));
vi.mock("@/lib/services/missions", async (orig) => ({
  ...(await orig<typeof import("@/lib/services/missions")>()),
  resolveInboxMissionId: async () => "m_inbox",
}));

import { POST } from "@/app/api/telegram/webhook/route";

// The first /ask loads the whole nourTools barrel; keep it out of a test's budget.
beforeAll(async () => {
  await import("@/lib/ai/tools");
  await import("@/lib/services/chat/stream-error-handler");
}, 180_000);

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
  h.prompts.length = 0;
  h.flags.lockOn = false;
  h.flags.lockThrows = false;
  h.semanticSearch.mockResolvedValue([
    { sourceType: "brain_memory", sourceId: "m1", content: "Sam prefers Tuesdays", similarity: 0.9, hybridScore: 0.9, category: "fact" },
  ]);
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

function ask(text: string): NextRequest {
  return new NextRequest("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "test-webhook-secret" },
    body: JSON.stringify({ message: { text, chat: { id: 4242 }, from: { id: 4242 } } }),
  });
}

/** The value of the first tool-result for `toolName` the model was shown. */
function toolResultShown(toolName: string): Record<string, unknown> | undefined {
  for (const prompt of h.prompts as Array<Array<{ role: string; content: unknown }>>) {
    for (const msg of prompt) {
      if (msg.role !== "tool" || !Array.isArray(msg.content)) continue;
      for (const part of msg.content as Array<{ toolName?: string; output?: { value?: unknown } }>) {
        if (part.toolName === toolName) return part.output?.value as Record<string, unknown>;
      }
    }
  }
  return undefined;
}

describe("/ask under NICK_MUTATION_LOCK", () => {
  it("lock ON: memorySearch still reads and the model sees the memories", async () => {
    h.flags.lockOn = true;
    h.model = scripted([{ toolName: "memorySearch", input: { query: "Sam" } }, { text: "Tuesdays." }]);

    await POST(ask("/ask when does Sam like to come in?"));

    expect(h.semanticSearch).toHaveBeenCalledTimes(1);
    const shown = toolResultShown("memorySearch");
    expect(shown?.error).toBeUndefined();
    expect(shown?.ok).toBe(true);
    expect(shown?.count).toBe(1);
  });

  it("lock state UNREADABLE: memorySearch still reads", async () => {
    h.flags.lockThrows = true;
    h.model = scripted([{ toolName: "memorySearch", input: { query: "Sam" } }, { text: "Tuesdays." }]);

    await POST(ask("/ask when does Sam like to come in?"));

    expect(h.semanticSearch).toHaveBeenCalledTimes(1);
    expect(toolResultShown("memorySearch")?.ok).toBe(true);
  });

  it("CONTROL: lock ON still refuses the createTask WRITE in the same lane", async () => {
    h.flags.lockOn = true;
    h.model = scripted([{ toolName: "createTask", input: { title: "Call Sam" } }, { text: "Blocked." }]);

    await POST(ask("/ask add a task to call Sam"));

    expect(h.createTask).not.toHaveBeenCalled();
    expect(toolResultShown("createTask")?.error).toBe("mutation_locked");
  });

  it("CONTROL: lock OFF, createTask runs", async () => {
    h.model = scripted([{ toolName: "createTask", input: { title: "Call Sam" } }, { text: "Done." }]);

    await POST(ask("/ask add a task to call Sam"));

    expect(h.createTask).toHaveBeenCalledTimes(1);
  });
});
