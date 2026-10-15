/**
 * Chat route WRITER for the errored-turn receipts: the route owns one tool record per turn,
 * hands it to the stream-config factory, and marks it final only when the stream has drained.
 *
 * tests/ai/chat/errored-turn-receipts-e2e.test.ts proves the record, the handler and the
 * real SDK together, and used to pin the route half with a regex over the comment-stripped
 * source. This drives the real POST handler instead (harness from route-turn-identity-window.test.ts),
 * so a rename, a moved line or a reformat cannot hide a broken hand-off, and a comment that
 * merely mentions the call cannot satisfy it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Drain = { promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void };

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
    seen: {} as Record<string, unknown>,
    // What the fake model stream's consumeStream() hands back; undefined = the result has no consumeStream.
    consume: undefined as undefined | (() => Promise<void>),
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
      messages: [{ id: "c-1", role: "user", parts: [{ type: "text", text: "what changed on the lease" }] }],
      conversationId: "conv-123",
      userContent: "what changed on the lease",
      personality: "master",
      historyOffset: undefined,
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
    result: {
      toUIMessageStreamResponse: () => new Response("ok"),
      ...(h.consume ? { consumeStream: () => h.consume!() } : {}),
    },
    attempts: [{ provider: "ollama", errorClass: null, failedAt: null }],
  })),
  inferProviderName: vi.fn(),
}));
vi.mock("@/app/api/ai/chat/build-stream-config", () => ({
  buildStreamConfigFactory: vi.fn((input: { toolCalls?: unknown }) => {
    h.seen.toolCalls = input.toolCalls;
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
  compressConversation: vi.fn().mockResolvedValue({ compressed: false, messages: [], summary: null, compressedCount: 0 }),
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
import type { InFlightToolCalls } from "@/lib/services/chat/in-flight-tool-calls";

vi.setConfig({ testTimeout: 60_000 });

function drain(): Drain {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => {}); // a deliberate rejection is not an unhandled one
  return { promise, resolve, reject };
}

/** Drive one turn; resolves once the response is read, with the stream still undrained. */
async function turn(): Promise<InFlightToolCalls> {
  const res = await POST(new Request("http://localhost/api/ai/chat", { method: "POST" }));
  await res.text().catch(() => "");
  return h.seen.toolCalls as InFlightToolCalls;
}

const settle = () => new Promise((r) => setTimeout(r, 25));

beforeEach(() => {
  for (const k of Object.keys(h.seen)) delete h.seen[k];
  h.consume = undefined;
});

describe("chat route - the turn's tool record (errored-turn receipts)", () => {
  it("hands the stream-config factory a live record, still open while the stream runs", async () => {
    const stream = drain();
    h.consume = () => stream.promise;

    const toolCalls = await turn();

    expect(toolCalls, "the route did not give the factory a tool record").toBeDefined();
    expect(toolCalls.snapshot()).toEqual({ trustworthy: true, terminal: false, receipts: [] });
  });

  it("marks that same record final once the stream has drained", async () => {
    const stream = drain();
    h.consume = () => stream.promise;
    const toolCalls = await turn();

    stream.resolve();

    await vi.waitFor(() => expect(toolCalls.snapshot()).toMatchObject({ terminal: true }));
  });

  it("runs the errored row's settle callbacks only after the drain, not at hand-off", async () => {
    const stream = drain();
    h.consume = () => stream.promise;
    const toolCalls = await turn();
    const settleRow = vi.fn();
    toolCalls.afterTerminal(settleRow);

    await settle();
    expect(settleRow, "settled while the stream could still run a tool").not.toHaveBeenCalled();

    stream.resolve();
    await vi.waitFor(() => expect(settleRow).toHaveBeenCalledTimes(1));
  });

  it("CONTROL - a drain that rejects is not proof the stream ended: the record stays open", async () => {
    const stream = drain();
    h.consume = () => stream.promise;
    const toolCalls = await turn();

    stream.reject(new Error("consumeStream failed"));
    await settle();

    expect(toolCalls.snapshot()).toMatchObject({ terminal: false });
  });

  it("CONTROL - a result with no consumeStream still answers, and the record stays open", async () => {
    h.consume = undefined;

    const toolCalls = await turn();
    await settle();

    expect(toolCalls, "the harness did not reach the factory").toBeDefined();
    expect(toolCalls.snapshot()).toMatchObject({ terminal: false });
  });
});
