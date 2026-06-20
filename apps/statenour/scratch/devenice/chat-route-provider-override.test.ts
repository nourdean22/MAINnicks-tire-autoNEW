import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// One-line note: Assertions validating providerOverride rejection of 'venice' and python override precedence go green only after F1 is applied.

// Mock getModel to spy on options
const getModelMock = vi.fn((taskType, opts) => ({
  modelId: "mocked-model-id",
  provider: opts?.forceProviderFirst || "gemini",
}));

vi.mock("@/lib/ai/provider", () => ({
  getModel: (taskType: any, opts: any) => getModelMock(taskType, opts),
  getActiveProviderInfo: vi.fn(() => ({ provider: "gemini", modelId: "gemini-3.5-flash" })),
}));

// Mock runGate
vi.mock("@/lib/ai/chat/gate", () => ({
  runGate: vi.fn(async (req: Request) => {
    const body = await req.json();
    return {
      kind: "pass",
      body,
      messages: body.messages || [],
      conversationId: "test-convo-id",
      providerOverride: body.providerOverride,
      userContent: body.messages?.[body.messages.length - 1]?.content || "",
    };
  }),
}));

// Mock other dependencies of the route to prevent database/external calls
vi.mock("@/lib/auth-guard", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkAiRateLimit: vi.fn(() => null) }));
vi.mock("@/lib/ai/budget", () => ({ assertWithinBudget: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/services/chat/persist-user-turn", () => ({ persistUserTurn: vi.fn(async () => "test-convo-id") }));
vi.mock("@/lib/ai/agent-trace", () => ({ mintTraceId: vi.fn(() => "trace-id"), recordTrace: vi.fn() }));
vi.mock("@/lib/ai/chat/interceptors", () => ({ runInterceptors: vi.fn(async () => ({ kind: "unhandled" })) }));
vi.mock("@/lib/ai/chat/timing", () => ({
  createStageTracker: vi.fn(() => ({
    start: vi.fn(() => ({ end: vi.fn() })),
    summary: vi.fn(() => ({ stages: {} })),
  })),
}));

vi.mock("@/lib/feature-flags", () => ({
  loadFeatureFlagOverrides: vi.fn(async () => {}),
  getFlag: vi.fn(() => false),
}));

vi.mock("@/lib/settings/ai-config", () => ({
  getAiConfig: vi.fn(async () => ({
    defaultMode: "standard",
    disabledTools: [],
    alwaysOnTools: [],
  })),
}));

vi.mock("@/lib/ai/runtime/intent-router", () => ({
  classifyIntent: vi.fn(async () => ({ mode: "standard" })),
}));

vi.mock("@/lib/db/actor", () => ({
  withActor: vi.fn((actor, cb) => cb()),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatConversation: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    chatMessage: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/ai/business-knowledge", () => ({
  detectContentIntent: vi.fn(() => false),
}));

vi.mock("@/lib/ai/chat/sanitize-history", () => ({
  sanitizeMessageHistory: vi.fn(),
}));

vi.mock("@/lib/ai/domain-routing", () => ({
  detectDomain: vi.fn(() => ({ domain: "general", taskType: "reason", preferLargeContext: false })),
}));

vi.mock("@/lib/ai/chat/action-intent-detector", () => ({
  detectActionIntent: vi.fn(() => null),
}));

vi.mock("@/lib/ai/system-prompt", () => ({
  buildSystemPrompt: vi.fn(async () => "system prompt"),
  detectTopicTier: vi.fn(() => "core"),
}));

vi.mock("@/lib/ai/chat-mode", () => ({
  pruneTools: vi.fn(async () => ({})),
  detectChatMode: vi.fn(() => "standard"),
  describeMode: vi.fn(() => "mock mode"),
}));

vi.mock("@/lib/services/chat/brain-context", () => ({
  buildBrainContext: vi.fn(async () => ({
    systemPromptAddendum: "",
    contextBlocksFired: [],
    deeperContextCount: 0,
    deeperContextTypes: [],
  })),
}));

vi.mock("../../app/api/ai/chat/finalize-system-prompt", () => ({
  finalizeSystemPrompt: vi.fn(async () => ({
    systemPrompt: "finalized system prompt",
    greeneSummary: "",
    strategicLawCount: 0,
  })),
}));

vi.mock("../../app/api/ai/chat/build-model-messages", () => ({
  buildModelMessages: vi.fn(async () => []),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    streamText: vi.fn(async () => {
      // Return a mocked stream result that resolves immediately to avoid hanging
      return {
        toDataStreamResponse: () => new Response("mock stream response"),
      };
    }),
  };
});

// Helper to simulate request
async function invokeRoute(body: any) {
  const { POST } = await import("../../app/api/ai/chat/route");
  const req = new Request("http://localhost/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  try {
    await POST(req);
  } catch (e) {
    // Catch errors from streaming/SSE setup since we only care about getModel call
  }
}

describe("chat-route-provider-override", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selects anthropic when a supported override 'anthropic' is passed", async () => {
    await invokeRoute({
      messages: [{ role: "user", content: "hello" }],
      providerOverride: "anthropic",
    });

    expect(getModelMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ forceProviderFirst: "anthropic" })
    );
  });

  it("ignores 'venice' or garbage overrides and falls back to default", async () => {
    await invokeRoute({
      messages: [{ role: "user", content: "hello" }],
      providerOverride: "venice",
    });

    // Venice is retired, so forceProviderFirst should not be 'venice'
    expect(getModelMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ forceProviderFirst: "venice" })
    );

    await invokeRoute({
      messages: [{ role: "user", content: "hello" }],
      providerOverride: "garbage_provider",
    });

    expect(getModelMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ forceProviderFirst: "garbage_provider" })
    );
  });

  it("forces 'ollama' when python/action intent is present, even with an override", async () => {
    await invokeRoute({
      messages: [{ role: "user", content: "run this python code" }],
      providerOverride: "anthropic",
    });

    expect(getModelMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ forceProviderFirst: "ollama" })
    );
  });
});
