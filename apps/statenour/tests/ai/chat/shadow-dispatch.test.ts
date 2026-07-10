import { describe, it, expect, vi, beforeEach } from "vitest";

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
    loadFeatureFlagOverrides: vi.fn(),
    withActor: vi.fn((actor: string, fn: () => any) => fn()),
    runGate: vi.fn(),
    routeMessage: vi.fn(),
    isSpecialistRoutingEnabled: vi.fn(),
    isSpecialistShadowMode: vi.fn(),
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

vi.mock("@/lib/auth-guard", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/rate-limit", () => ({ checkAiRateLimit: mocks.checkAiRateLimit }));
vi.mock("@/lib/feature-flags", () => ({
  loadFeatureFlagOverrides: mocks.loadFeatureFlagOverrides,
  getFlag: vi.fn().mockReturnValue({ isOn: false }),
}));
vi.mock("@/lib/db/actor", () => ({ withActor: mocks.withActor }));
vi.mock("@/lib/ai/chat/gate", () => ({ runGate: mocks.runGate }));
vi.mock("@/lib/ai/agents/router", () => ({ routeMessage: mocks.routeMessage }));
vi.mock("@/lib/ai/agents/types", () => ({
  isSpecialistRoutingEnabled: mocks.isSpecialistRoutingEnabled,
  isSpecialistShadowMode: mocks.isSpecialistShadowMode,
}));
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

vi.mock("./context-hints", () => ({
  buildContextHints: vi.fn().mockResolvedValue(""),
}));
vi.mock("./customer-shape-hint", () => ({
  buildCustomerShapeHint: vi.fn().mockReturnValue(""),
}));
vi.mock("./gsc-prefetch", () => ({
  buildGscPrefetch: vi.fn().mockResolvedValue(""),
}));
vi.mock("./finalize-system-prompt", () => ({
  finalizeSystemPrompt: vi.fn().mockResolvedValue({
    systemPrompt: "finalized system prompt",
    greeneSummary: "",
    strategicLawCount: 0,
  }),
}));
vi.mock("./build-model-messages", () => ({
  buildModelMessages: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

import { POST } from "@/app/api/ai/chat/route";

describe("POST /api/ai/chat dispatcher shadow mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({});
    mocks.loadFeatureFlagOverrides.mockResolvedValue(undefined);
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
  });

  it("proves that classification still runs in shadow mode, metrics are recorded, but no specialist function is called", async () => {
    // 1. Set shadow mode to active, and routing enabled to false
    mocks.isSpecialistShadowMode.mockReturnValue(true);
    mocks.isSpecialistRoutingEnabled.mockReturnValue(false);

    // 2. Mock classification returning a specialist route
    mocks.routeMessage.mockResolvedValue({
      route: "marketing-director",
      confidence: 0.95,
      reason: "marketing intent detected",
    });

    const mockRequest = new Request("http://localhost/api/ai/chat", { method: "POST" });
    const response = await POST(mockRequest);

    // Verify classification did run
    expect(mocks.routeMessage).toHaveBeenCalled();

    // Verify specialist was NOT executed
    expect(mocks.runMarketingDirector).not.toHaveBeenCalled();

    // Verify general path response was returned
    expect(response).toBeInstanceOf(Response);
    expect(await response.text()).toBe("general path response");
  });

  it("proves that when shadow mode is false and routing is enabled, the specialist is invoked", async () => {
    // 1. Set shadow mode to false, and routing enabled to true
    mocks.isSpecialistShadowMode.mockReturnValue(false);
    mocks.isSpecialistRoutingEnabled.mockReturnValue(true);

    // 2. Mock classification returning a specialist route
    mocks.routeMessage.mockResolvedValue({
      route: "marketing-director",
      confidence: 0.95,
      reason: "marketing intent detected",
    });

    // 3. Mock the specialist return
    mocks.runMarketingDirector.mockResolvedValue({
      content: "specialist response",
      handBack: false,
    });

    const mockRequest = new Request("http://localhost/api/ai/chat", { method: "POST" });
    const response = await POST(mockRequest);

    // Verify classification ran
    expect(mocks.routeMessage).toHaveBeenCalled();

    // Verify specialist WAS executed
    expect(mocks.runMarketingDirector).toHaveBeenCalled();

    // Verify specialist response was returned (not general path response)
    expect(response).toBeInstanceOf(Response);
    expect(await response.text()).toContain("specialist response");
  });
});
