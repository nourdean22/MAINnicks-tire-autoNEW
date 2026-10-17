/**
 * Chat route WRITERS for two R3-03 consumers (audit 04-F13, 04-F15, 2026-10-10).
 *
 *   - persist parents the reply on the turn's own user row by clientMessageId
 *     (tests/services/chat/persist-assistant-parent.test.ts): the route must
 *     hand persist that id, taken from the request's last user message;
 *   - compression shifts its summary cache by historyOffset
 *     (tests/ai/conversation-compress-window.test.ts): the route must pass
 *     the gate's historyOffset through.
 *
 * Drives the real POST handler (harness from private-route-wiring.test.ts) and
 * records what persist and compression were handed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const model = {
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    upsert: vi.fn().mockResolvedValue({}),
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    delete: vi.fn().mockResolvedValue({}),
  };
  return {
    gate: { messages: [] as Array<Record<string, unknown>>, historyOffset: undefined as number | undefined },
    seen: {} as Record<string, unknown>,
    compress: vi.fn(),
    prisma: new Proxy({}, { get: () => model }),
  };
});

vi.mock("@/lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/logger")>();
  const make = (): unknown => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    withContext: () => make(),
    withTraceId: () => make(),
    withSurface: () => make(),
    time: () => ({ stop: () => 0 }),
  });
  return { ...actual, logger: make() };
});
vi.mock("@/lib/ai/provider", () => ({
  inferProviderName: vi.fn().mockReturnValue("ollama"),
  getActiveProviderInfo: vi.fn().mockReturnValue({ name: "ollama", modelId: "m" }),
  isRuntimeProvider: vi.fn().mockReturnValue(true),
  getModel: vi.fn().mockReturnValue({ modelId: "m", provider: "ollama" }),
  aiChat: vi.fn().mockResolvedValue({ content: "{}", model: "m", provider: "none" }),
  getEmbedding: vi.fn().mockResolvedValue([]),
  GEMINI_SAFETY_OFF: {},
}));
vi.mock("@/lib/ai/traced-aichat", () => ({
  tracedAiChat: vi.fn().mockResolvedValue({ content: "{}", model: "m", provider: "none" }),
  makeTracedAiChat: vi.fn().mockReturnValue(vi.fn().mockResolvedValue({ content: "{}", model: "m", provider: "none" })),
}));
vi.mock("@/lib/ai/runtime/intent-router", () => ({
  classifyIntent: vi.fn().mockResolvedValue({ intent: "general_chat", mode: "standard", model: "m", provider: "none", targets: ["general"] }),
}));
vi.mock("@/lib/ai/agents/router", () => ({ routeMessage: vi.fn().mockResolvedValue({ route: "general", confidence: 0, reason: "" }) }));
vi.mock("@/lib/auth-guard", () => ({ requireSession: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/rate-limit", () => ({ checkAiRateLimit: vi.fn(() => null) }));
vi.mock("@/lib/db/actor", () => ({ withActor: vi.fn((_a: string, fn: () => unknown) => fn()) }));
vi.mock("@/lib/ai/chat/gate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/chat/gate")>();
  return {
    ...actual,
    runGate: vi.fn(async () => ({
      kind: "pass",
      body: {},
      messages: h.gate.messages,
      conversationId: "conv-123",
      userContent: "what changed on the lease",
      personality: "master",
      historyOffset: h.gate.historyOffset,
      privateMode: false,
      ephemeral: false,
      posture: "auto",
      actionPermission: "draft",
    })),
  };
});
vi.mock("@/lib/ai/decision-plane/shadow", () => ({
  scheduleTurnDecisionShadow: vi.fn(async () => ({ queued: false, reason: "feature_disabled" })),
}));
vi.mock("@/lib/ai/budget", () => ({ assertWithinBudget: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/ai/stream-with-fallback", () => ({
  streamWithFallback: vi.fn(async () => ({
    result: { toUIMessageStreamResponse: () => new Response("ok"), consumeStream: () => Promise.resolve() },
    attempts: [{ provider: "ollama", errorClass: null, failedAt: null }],
  })),
  inferProviderName: vi.fn(),
}));
vi.mock("@/app/api/ai/chat/build-stream-config", () => ({
  buildStreamConfigFactory: vi.fn((input: { persistBase: unknown }) => {
    h.seen.persistBase = input.persistBase;
    return () => ({});
  }),
}));
vi.mock("@/lib/services/chat/response-shape", () => ({
  buildChatResponse: vi.fn(({ streamResponse }: { streamResponse: Response }) => streamResponse),
}));
vi.mock("@/app/api/ai/chat/context-hints", () => ({ buildContextHints: vi.fn().mockResolvedValue(""), resolveToolBiasKey: vi.fn() }));
vi.mock("@/app/api/ai/chat/finalize-system-prompt", () => ({
  finalizeSystemPrompt: vi.fn().mockResolvedValue({ systemPrompt: "p", greeneSummary: "", strategicLawCount: 0 }),
}));
vi.mock("@/app/api/ai/chat/augment-final-prompt", () => ({ augmentFinalPrompt: vi.fn().mockResolvedValue("final") }));
vi.mock("@/app/api/ai/chat/build-model-messages", () => ({ buildModelMessages: vi.fn().mockResolvedValue([]) }));
vi.mock("@/app/api/ai/chat/alternate-paths", () => ({ runAlternatePaths: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/ai/tool-embeddings", () => ({
  embedUserMessage: vi.fn().mockResolvedValue([]),
  warmToolEmbeddings: vi.fn().mockResolvedValue(undefined),
  isToolEmbeddingCacheWarm: vi.fn().mockReturnValue(true),
}));
vi.mock("@/lib/ai/conversation-compress", () => ({
  compressConversation: (...a: unknown[]) => h.compress(...a),
}));
vi.mock("@/lib/ai/system-prompt", () => ({
  buildSystemPrompt: vi.fn().mockResolvedValue("sys"),
  detectTopicTier: vi.fn().mockReturnValue("core"),
  computePromptVariant: vi.fn().mockResolvedValue({ slot: "default", formatKey: "", variant: "default" }),
}));
vi.mock("@/lib/ai/system-prompt-cache", () => ({ getCachedPrompt: vi.fn().mockReturnValue(null), setCachedPrompt: vi.fn() }));
vi.mock("@/lib/ai/chat/interceptors", () => ({ runInterceptors: vi.fn().mockResolvedValue({ kind: "unhandled" }) }));
vi.mock("@/lib/services/chat/persist-user-turn", () => ({ persistUserTurn: vi.fn().mockResolvedValue("conv-123") }));
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/services/chat/brain-context", () => ({
  buildBrainContext: vi.fn(async () => ({
    systemPromptAddendum: "",
    contextBlocksFired: {},
    deeperContextCount: 0,
    deeperContextTypes: [],
    recalledHits: [],
    detectedContradictions: [],
  })),
}));
vi.mock("@/app/api/ai/chat/prepare-tools", () => ({
  prepareTools: vi.fn(async () => ({ prunedTools: {}, maxOutputTokens: 100, capabilityPlan: {} })),
}));

import { POST } from "@/app/api/ai/chat/route";
import { buildModelMessages } from "@/app/api/ai/chat/build-model-messages";

vi.setConfig({ testTimeout: 60_000 });

async function turn(messages: Array<Record<string, unknown>>, historyOffset?: number) {
  h.gate = { messages, historyOffset };
  const res = await POST(new Request("http://localhost/api/ai/chat", { method: "POST" }));
  await res.text().catch(() => "");
}

beforeEach(() => {
  for (const k of Object.keys(h.seen)) delete h.seen[k];
  h.compress.mockReset().mockResolvedValue({ compressed: false, messages: [], summary: null, compressedCount: 0 });
});

const history = [
  { id: "c-1", role: "user", parts: [{ type: "text", text: "first" }] },
  { id: "a-1", role: "assistant", parts: [{ type: "text", text: "reply" }] },
  { id: "c-777", role: "user", parts: [{ type: "text", text: "what changed on the lease" }] },
];

describe("chat route - persist gets the turn's own clientMessageId (04-F13)", () => {
  it("persistBase carries the last user message's id", async () => {
    await turn(history);
    expect((h.seen.persistBase as Record<string, unknown>).userClientMessageId).toBe("c-777");
  });

  it("CONTROL - a last message with no usable id hands persist no id (persist falls back to the newest row)", async () => {
    await turn([{ role: "user", parts: [{ type: "text", text: "no id" }] }]);
    expect(h.seen.persistBase, "the harness reached persistBase").toBeDefined();
    expect((h.seen.persistBase as Record<string, unknown>).userClientMessageId).toBeUndefined();
  });
});

describe("chat route - compression gets the gate's historyOffset (04-F15)", () => {
  it("historyOffset 100 reaches compressConversation", async () => {
    await turn(history, 100);
    expect(h.compress).toHaveBeenCalledWith(expect.any(Array), "conv-123", 100);
  });

  it("CONTROL - no offset from the gate = no shift", async () => {
    await turn(history);
    expect(h.compress.mock.calls[0]?.[2] ?? 0).toBe(0);
  });
});

/**
 * Brain FU3b (2026-10-17). When compressConversation throws or hits the 4 s race, the route
 * substitutes its own fallbackCompression. It read `m.content`, which a v6 parts-only message
 * does not have, so every history line became the string '""' and the model got empty history.
 * buildModelMessages receives that fallback, so its `compression.messages` is the consumer end.
 */
describe("chat route - compression fallback keeps the history text (brain FU3b)", () => {
  type Line = { role: string; content: unknown };
  const handedCompression = (): { compressed: boolean; messages: Line[] } => {
    const call = vi.mocked(buildModelMessages).mock.calls[0]?.[0] as
      | { compression: { compressed: boolean; messages: Line[] } }
      | undefined;
    expect(call, "the harness reached buildModelMessages").toBeDefined();
    return call!.compression;
  };

  beforeEach(() => {
    vi.mocked(buildModelMessages).mockClear();
    h.compress.mockReset().mockRejectedValue(new Error("summary provider down"));
  });

  it("a parts-only history reaches the model as real text on every line", async () => {
    await turn(history);
    const c = handedCompression();
    expect(c.compressed).toBe(false);
    expect(c.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(c.messages.map((m) => m.content)).toEqual(["first", "reply", "what changed on the lease"]);
  });

  it("CONTROL - a legacy { role, content } history is carried through unchanged", async () => {
    await turn([
      { role: "user", content: "legacy question" },
      { role: "assistant", content: "legacy answer" },
      { role: "user", content: "legacy follow-up" },
    ]);
    expect(handedCompression().messages.map((m) => m.content)).toEqual([
      "legacy question",
      "legacy answer",
      "legacy follow-up",
    ]);
  });
});
