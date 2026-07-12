import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => {
  const mockPrismaModel = {
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    findUnique: vi.fn().mockResolvedValue({ id: "conv-123", topicTier: "tier1" }),
    findFirst: vi.fn().mockResolvedValue({}),
    findMany: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue({}),
  };

  return {
    requireSession: vi.fn(),
    checkAiRateLimit: vi.fn(() => null),
    withActor: vi.fn((actor: string, fn: () => any) => fn()),
    runGate: vi.fn(),
    routeMessage: vi.fn(),
    assertWithinBudget: vi.fn(),
    runMarketingDirector: vi.fn(),
    streamWithFallback: vi.fn(),
    buildChatResponse: vi.fn(),
    prisma: {
      systemMetric: mockPrismaModel,
      aiGeneration: mockPrismaModel,
      chatConversation: mockPrismaModel,
      chatMessage: mockPrismaModel,
      errorLog: mockPrismaModel,
      userPreference: mockPrismaModel,
      agentTrace: mockPrismaModel,
    },
  };
});

// Mock the AI provider before importing POST
vi.mock("@/lib/ai/provider", () => ({
  inferProviderName: vi.fn().mockReturnValue("openrouter"),
  getActiveProviderInfo: vi.fn().mockReturnValue({ name: "openrouter", modelId: "x-ai/grok-4.3" }),
  isRuntimeProvider: vi.fn().mockReturnValue(true),
  getModel: vi.fn().mockReturnValue({
    modelId: "mocked-model-id",
    provider: "openrouter",
  }),
  aiChat: vi.fn().mockResolvedValue({
    content: "{}",
    model: "mocked-model",
    provider: "mocked-provider",
  }),
  GEMINI_SAFETY_OFF: {},
}));

vi.mock("@/lib/ai/traced-aichat", () => ({
  tracedAiChat: vi.fn().mockResolvedValue({
    content: "{}",
    model: "mocked-model",
    provider: "mocked-provider",
  }),
  makeTracedAiChat: vi.fn().mockReturnValue(vi.fn().mockResolvedValue({
    content: "{}",
    model: "mocked-model",
    provider: "mocked-provider",
  })),
}));

vi.mock("@/lib/ai/runtime/intent-router", () => ({
  classifyIntent: vi.fn().mockResolvedValue({
    intent: "general_chat",
    mode: "standard",
    model: "mocked-model",
    provider: "mocked-provider",
    targets: ["general"],
  }),
}));

// Synchronous Metrics Spy Setup
const recordedMetrics: any[] = [];
vi.mock("@/lib/ai/agents/router-metrics", () => ({
  recordSpecialistRouteMetric: vi.fn().mockImplementation((route, confidence, reason) => {
    recordedMetrics.push({ route, confidence, reason });
    return Promise.resolve();
  }),
  alertFirstSpecialistDispatch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/auth-guard", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/rate-limit", () => ({ checkAiRateLimit: mocks.checkAiRateLimit }));
vi.mock("@/lib/db/actor", () => ({ withActor: mocks.withActor }));
vi.mock("@/lib/ai/chat/gate", () => ({ runGate: mocks.runGate }));
vi.mock("@/lib/ai/agents/router", () => ({ routeMessage: mocks.routeMessage }));
vi.mock("@/lib/ai/budget", () => ({ assertWithinBudget: mocks.assertWithinBudget }));
vi.mock("@/lib/ai/agents/specialists/marketing-director", () => ({
  runMarketingDirector: mocks.runMarketingDirector,
}));
vi.mock("@/lib/ai/stream-with-fallback", () => ({
  streamWithFallback: mocks.streamWithFallback,
  inferProviderName: vi.fn().mockReturnValue("anthropic"),
}));
vi.mock("@/lib/services/chat/response-shape", () => ({
  buildChatResponse: mocks.buildChatResponse,
}));

// Mock absolute resolved application paths reached by the tested route
vi.mock("@/app/api/ai/chat/context-hints", () => ({
  buildContextHints: vi.fn().mockResolvedValue(""),
}));
vi.mock("@/app/api/ai/chat/customer-shape-hint", () => ({
  buildCustomerShapeHint: vi.fn().mockReturnValue(""),
}));
vi.mock("@/app/api/ai/chat/gsc-prefetch", () => ({
  buildGscPrefetch: vi.fn().mockResolvedValue(""),
}));
vi.mock("@/app/api/ai/chat/finalize-system-prompt", () => ({
  finalizeSystemPrompt: vi.fn().mockResolvedValue({
    systemPrompt: "finalized system prompt",
    greeneSummary: "",
    strategicLawCount: 0,
  }),
}));
vi.mock("@/app/api/ai/chat/build-model-messages", () => ({
  buildModelMessages: vi.fn().mockResolvedValue([]),
}));

// Mock all internal chatPostInner dependencies to avoid network/DB/LLM execution
vi.mock("@/lib/ai/tool-embeddings", () => ({
  embedUserMessage: vi.fn().mockResolvedValue([]),
  warmToolEmbeddings: vi.fn().mockResolvedValue(undefined),
  isToolEmbeddingCacheWarm: vi.fn().mockReturnValue(true),
}));
vi.mock("@/lib/ai/conversation-compress", () => ({
  compressConversation: vi.fn().mockResolvedValue({
    compressed: false,
    messages: [],
    summary: null,
    compressedCount: 0,
  }),
}));
vi.mock("@/lib/ai/system-prompt", () => ({
  buildSystemPrompt: vi.fn().mockResolvedValue("mock system prompt"),
  detectTopicTier: vi.fn().mockReturnValue("tier1"),
  computePromptVariant: vi.fn().mockResolvedValue({ slot: "default", formatKey: "", variant: "default" }),
}));
vi.mock("@/lib/ai/query-shape", () => ({
  detectQueryShape: vi.fn().mockReturnValue({ shape: "casual", tokenBudget: 100, needsTool: false }),
  toolFirstDirective: vi.fn().mockReturnValue(""),
}));
vi.mock("@/lib/ai/turn-intelligence", () => ({
  classifyTurn: vi.fn().mockResolvedValue({ intent: "casual", complexity: "simple", temperature: 0.5 }),
  buildOutputShapePrompt: vi.fn().mockReturnValue(""),
  buildChainOfThoughtPrompt: vi.fn().mockReturnValue(""),
}));
vi.mock("@/lib/ai/response-contract", () => ({
  buildResponseContract: vi.fn().mockReturnValue({ reasons: [] }),
  buildContractDirective: vi.fn().mockReturnValue(""),
}));
vi.mock("@/lib/ai/context-reranker", () => ({
  rerankContextBlocks: vi.fn().mockResolvedValue([]),
  formatRerankSummary: vi.fn().mockReturnValue(""),
}));
vi.mock("@/lib/ai/system-prompt-cache", () => ({
  getCachedPrompt: vi.fn().mockReturnValue(null),
  setCachedPrompt: vi.fn(),
}));
vi.mock("@/lib/ai/chat-mode", () => ({
  detectChatMode: vi.fn().mockReturnValue("standard"),
  pruneTools: vi.fn().mockResolvedValue({}),
  describeMode: vi.fn().mockReturnValue("mode=standard"),
}));
vi.mock("@/lib/ai/predictive-prefetch", () => ({
  prefetchIntents: vi.fn().mockResolvedValue({}),
  formatPrefetchContext: vi.fn().mockReturnValue(""),
}));
vi.mock("@/lib/settings/ai-config", () => ({
  getAiConfig: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/ai/business-knowledge", () => ({
  detectContentIntent: vi.fn().mockReturnValue(false),
}));
vi.mock("@/lib/ai/chat/interceptors", () => ({
  runInterceptors: vi.fn().mockResolvedValue({ kind: "unhandled" }),
}));
vi.mock("@/lib/services/chat/persist-user-turn", () => ({
  persistUserTurn: vi.fn().mockResolvedValue("conv-123"),
}));
vi.mock("@/lib/services/chat/brain-context", () => ({
  buildBrainContext: vi.fn().mockResolvedValue({
    systemPromptAddendum: "",
    contextBlocksFired: [],
    deeperContextCount: 0,
    deeperContextTypes: [],
    recalledHits: [],
    detectedContradictions: [],
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

// Now import the route and features
import { POST } from "@/app/api/ai/chat/route";
import { loadFeatureFlagOverrides } from "@/lib/feature-flags";
import { isSpecialistShadowMode, isSpecialistRoutingEnabled } from "@/lib/ai/agents/types";

const fetchSpy = vi.spyOn(global, "fetch");

describe("POST /api/ai/chat dispatcher shadow mode", () => {
  const originalEnv = process.env.ENABLE_SPECIALIST_ROUTING;

  beforeEach(() => {
    vi.clearAllMocks();
    recordedMetrics.length = 0;
    fetchSpy.mockClear();
    
    mocks.requireSession.mockResolvedValue({});
    mocks.checkAiRateLimit.mockReturnValue(null);
    mocks.assertWithinBudget.mockResolvedValue({ ok: true });
    
    mocks.runGate.mockResolvedValue({
      kind: "pass",
      body: {},
      messages: [{ role: "user", content: "we need a marketing campaign" }],
      conversationId: "conv-123",
      userContent: "we need a marketing campaign",
      personality: "master",
    });

    mocks.streamWithFallback.mockResolvedValue({
      result: {
        toUIMessageStreamResponse: () => new Response("general path response"),
      },
      attempts: [{ provider: "anthropic", errorClass: "ok" }],
    });

    mocks.buildChatResponse.mockImplementation(({ streamResponse }) => {
      return streamResponse;
    });

    mocks.runMarketingDirector.mockResolvedValue({
      content: "specialist response",
      handBack: false,
    });
  });

  afterEach(() => {
    process.env.ENABLE_SPECIALIST_ROUTING = originalEnv;
  });

  it("proves that classification still runs in shadow mode, metrics are recorded synchronously, and general path executes", async () => {
    // 1. Set shadow mode to active via env
    process.env.ENABLE_SPECIALIST_ROUTING = "shadow";
    mocks.prisma.userPreference.findMany.mockResolvedValue([]);
    await loadFeatureFlagOverrides(true);

    expect(isSpecialistShadowMode()).toBe(true);
    expect(isSpecialistRoutingEnabled()).toBe(false);

    // 2. Mock classification returning a specialist route
    mocks.routeMessage.mockResolvedValue({
      route: "marketing-director",
      confidence: 0.95,
      reason: "marketing intent detected",
    });

    const mockRequest = new Request("http://localhost/api/ai/chat", { method: "POST" });
    const response = await POST(mockRequest);

    // Assert classification was executed
    expect(mocks.routeMessage).toHaveBeenCalled();

    // Assert specialist was NOT executed
    expect(mocks.runMarketingDirector).not.toHaveBeenCalled();

    // Assert metric was recorded deterministically and synchronously
    expect(recordedMetrics.length).toBe(1);
    expect(recordedMetrics[0]).toEqual({
      route: "marketing-director",
      confidence: 0.95,
      reason: "marketing intent detected",
    });

    // Assert general path response was returned
    expect(response).toBeInstanceOf(Response);
    expect(await response.text()).toBe("general path response");

    // Prove no real provider function or network request executes
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("runs the full sequence of override-removal in a single context: shadow override -> shadow behavior -> empty override -> normal routing", async () => {
    // 1. Set base environment variable to true
    process.env.ENABLE_SPECIALIST_ROUTING = "true";

    // 2. Mock database override as "shadow"
    mocks.prisma.userPreference.findMany.mockResolvedValue([
      { key: "ENABLE_SPECIALIST_ROUTING", value: "shadow" },
    ]);

    // 3. Force-load overrides
    await loadFeatureFlagOverrides(true);

    // 4. Assert shadow mode is active
    expect(isSpecialistShadowMode()).toBe(true);
    expect(isSpecialistRoutingEnabled()).toBe(false);

    // 5. Run classification and confirm shadow behavior (falls back to general path)
    mocks.routeMessage.mockResolvedValue({
      route: "marketing-director",
      confidence: 0.95,
      reason: "marketing intent detected",
    });

    const mockRequest1 = new Request("http://localhost/api/ai/chat", { method: "POST" });
    const response1 = await POST(mockRequest1);
    expect(mocks.runMarketingDirector).not.toHaveBeenCalled();
    expect(await response1.text()).toBe("general path response");
    expect(recordedMetrics.length).toBe(1);

    // Reset call counts and metrics spy array
    mocks.routeMessage.mockClear();
    mocks.runMarketingDirector.mockClear();
    recordedMetrics.length = 0;

    // 6. Change database override to empty list (removal)
    mocks.prisma.userPreference.findMany.mockResolvedValue([]);

    // 7. Force-load overrides again
    await loadFeatureFlagOverrides(true);

    // 8. Assert overrides are removed and base environment becomes authoritative
    expect(isSpecialistShadowMode()).toBe(false);
    expect(isSpecialistRoutingEnabled()).toBe(true);

    // 9. Confirm the normal enabled routing behavior becomes authoritative
    const mockRequest2 = new Request("http://localhost/api/ai/chat", { method: "POST" });
    const response2 = await POST(mockRequest2);

    expect(mocks.routeMessage).toHaveBeenCalled();
    expect(mocks.runMarketingDirector).toHaveBeenCalled();
    expect(await response2.text()).toContain("specialist response");
    // 2026-07-12 · the route metric is now recorded in LIVE mode too (not
    // just shadow) so routing telemetry survives the shadow→live flip — the
    // operator previously went blind the moment routing went live.
    expect(recordedMetrics.length).toBe(1);
    expect(recordedMetrics[0].route).toBe("marketing-director");

    // Prove no real provider function or network request executes
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
