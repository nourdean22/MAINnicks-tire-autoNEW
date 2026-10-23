/**
 * Chat route WIRING for server-side turn idempotency (2026-10-15).
 *
 * turn-guard.test.ts pins the decision and turn-claim.test.ts the lease. This drives the real POST
 * handler (harness from route-tool-receipts-wiring.test.ts) to pin the three things neither can see:
 *   1. a refusal short-circuits BEFORE any work: no interceptor, no user-row write, no model run;
 *   2. body.trigger and the message id reach the guard, and the claim carries the SAME trace id the
 *      response header and the rows get;
 *   3. the lease is held exactly as long as the run: through the stream drain AND the onFinish persist
 *      on the streaming path, and not a moment past the handler on every other return.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Gate = {
  messages: Array<Record<string, unknown>>;
  conversationId: string | undefined;
  trigger: string | undefined;
  privateMode: boolean;
  ephemeral: boolean;
};

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
    model,
    seen: {} as Record<string, unknown>,
    drain: undefined as undefined | (() => Promise<void>),
    gate: {} as Gate,
    claimResult: undefined as unknown,
    claimCalls: [] as Array<Record<string, unknown>>,
    claim: undefined as unknown as {
      setConversation: ReturnType<typeof vi.fn>;
      settleWith: ReturnType<typeof vi.fn>;
      finish: ReturnType<typeof vi.fn>;
      holdWhileBodyOpen: ReturnType<typeof vi.fn>;
    },
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
      body: { trigger: h.gate.trigger },
      messages: h.gate.messages,
      conversationId: h.gate.conversationId,
      userContent: "what changed on the lease",
      personality: "master",
      historyOffset: undefined,
      privateMode: h.gate.privateMode,
      ephemeral: h.gate.ephemeral,
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
      ...(h.drain ? { consumeStream: () => h.drain!() } : {}),
    },
    attempts: [{ provider: "ollama", errorClass: null, failedAt: null }],
  })),
  inferProviderName: vi.fn(),
}));
vi.mock("@/app/api/ai/chat/build-stream-config", () => ({
  buildStreamConfigFactory: vi.fn((input: { resolveOnFinish?: () => void; toolCalls?: unknown; persistBase?: { traceId?: unknown } }) => {
    h.seen.resolveOnFinish = input.resolveOnFinish;
    h.seen.toolCalls = input.toolCalls;
    h.seen.persistTraceId = input.persistBase?.traceId;
    return () => ({});
  }),
}));
vi.mock("@/lib/services/chat/response-shape", () => ({
  buildChatResponse: vi.fn(({ streamResponse, traceId }: { streamResponse: Response; traceId?: unknown }) => {
    h.seen.responseTraceId = traceId;
    return streamResponse;
  }),
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
vi.mock("@/lib/ai/chat/timing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/chat/timing")>();
  return {
    ...actual,
    createStageTracker: () => {
      const tracker = actual.createStageTracker();
      const start = tracker.start.bind(tracker);
      tracker.start = (name: Parameters<typeof start>[0]) => {
        (h.seen.stages as string[]).push(String(name));
        const timer = start(name);
        const end = timer.end.bind(timer);
        timer.end = () => {
          (h.seen.ended as string[]).push(String(name));
          return end();
        };
        return timer;
      };
      return tracker;
    },
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/services/chat/brain-context", () => ({
  buildBrainContext: vi.fn(async () => ({
    systemPromptAddendum: "",
    contextBlocksFired: {},
    deeperContextCount: 0,
    deeperContextTypes: [],
    recalledHits: [],
  })),
}));
vi.mock("@/app/api/ai/chat/prepare-tools", () => ({
  prepareTools: vi.fn(async () => ({ prunedTools: {}, maxOutputTokens: 100, capabilityPlan: {} })),
}));
vi.mock("@/lib/services/chat/turn-claim", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/chat/turn-claim")>()),
  claimTurn: vi.fn(async (input: Record<string, unknown>) => {
    h.claimCalls.push(input);
    return h.claimResult;
  }),
}));

import { POST } from "@/app/api/ai/chat/route";
import { streamWithFallback } from "@/lib/ai/stream-with-fallback";
import { runInterceptors } from "@/lib/ai/chat/interceptors";
import { persistUserTurn } from "@/lib/services/chat/persist-user-turn";
import { assertWithinBudget } from "@/lib/ai/budget";

vi.setConfig({ testTimeout: 60_000 });

const post = () => POST(new Request("http://localhost/api/ai/chat", { method: "POST" }));
const settle = () => new Promise((r) => setTimeout(r, 25));
const pending = async (p: Promise<unknown>) => (await Promise.race([p.then(() => "done"), settle().then(() => "pending")])) === "pending";

beforeEach(() => {
  for (const k of Object.keys(h.seen)) delete h.seen[k];
  h.seen.stages = [];
  h.seen.ended = [];
  h.drain = undefined;
  h.claimCalls = [];
  h.claim = { setConversation: vi.fn(), settleWith: vi.fn(), finish: vi.fn(), holdWhileBodyOpen: vi.fn((r: Response) => r) };
  h.claimResult = { kind: "claimed", claim: h.claim };
  h.gate = {
    messages: [{ id: "c-1", role: "user", parts: [{ type: "text", text: "what changed on the lease" }] }],
    conversationId: "conv-123",
    trigger: "submit-message",
    privateMode: false,
    ephemeral: false,
  };
  for (const fn of Object.values(h.model)) fn.mockClear();
  h.model.findFirst.mockResolvedValue(null);
  h.model.findMany.mockResolvedValue([]);
  vi.mocked(streamWithFallback).mockClear();
  vi.mocked(runInterceptors).mockClear();
  vi.mocked(persistUserTurn).mockClear();
  vi.mocked(runInterceptors).mockResolvedValue({ kind: "unhandled" } as never);
  vi.mocked(assertWithinBudget).mockResolvedValue({ ok: true } as never);
});

describe("a refused attempt does no work at all", () => {
  it("a live run holds the message: 409, run identity on the headers, and nothing downstream is touched", async () => {
    h.claimResult = { kind: "in_flight", traceId: "T-live", conversationId: "conv-123" };

    const res = await post();

    expect(res.status).toBe(409);
    expect(res.headers.get("X-Trace-Id")).toBe("T-live");
    expect(res.headers.get("X-Conversation-Id")).toBe("conv-123");
    expect(await res.json()).toMatchObject({ code: "turn_in_flight" });
    expect(runInterceptors).not.toHaveBeenCalled();
    expect(persistUserTurn).not.toHaveBeenCalled();
    expect(streamWithFallback).not.toHaveBeenCalled();
  });

  it("body.trigger reaches the guard: a regenerate over a reply that wrote is refused before the model runs", async () => {
    h.gate.trigger = "regenerate-message";
    // The saved turn: the user's row, then a reply whose receipts record a write.
    h.model.findFirst.mockImplementation(async (a: { where: { role?: string; createdAt?: unknown } }) =>
      a.where.role === "user" && !a.where.createdAt
        ? { id: "U1", conversationId: "conv-123", clientMessageId: "c-1", createdAt: new Date(1_000) }
        : null,
    );
    h.model.findMany.mockResolvedValue([
      {
        id: "A1",
        content: "Done",
        parts: null,
        streamingState: "complete",
        tokenUsage: { traceId: "T-old", toolReceipts: [{ toolName: "createTask", category: "task", sideEffecting: true, verifiable: true, status: "success" }] },
      },
    ]);

    const res = await post();

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "turn_ran" });
    expect(h.claim.finish).toHaveBeenCalledTimes(1);
    expect(streamWithFallback).not.toHaveBeenCalled();
    expect(persistUserTurn).not.toHaveBeenCalled();
  });

  it("CONTROL - the same saved turn with trigger submit-message is also refused, and a first send is not", async () => {
    h.gate.trigger = "submit-message";
    h.model.findFirst.mockImplementation(async (a: { where: { role?: string; createdAt?: unknown } }) =>
      a.where.role === "user" && !a.where.createdAt
        ? { id: "U1", conversationId: "conv-123", clientMessageId: "c-1", createdAt: new Date(1_000) }
        : null,
    );
    h.model.findMany.mockResolvedValue([{ id: "A1", content: "Done", parts: null, streamingState: "complete", tokenUsage: { traceId: "T-old", toolReceipts: [] } }]);
    expect((await post()).status).toBe(409);

    h.model.findFirst.mockResolvedValue(null);
    h.model.findMany.mockResolvedValue([]);
    h.drain = () => Promise.resolve();
    expect((await post()).status).toBe(200);
  });
});

describe("the guard shows up in the stage log", () => {
  it("is timed as its own stage, so a slow guard is not unexplained pre-interceptor time", async () => {
    h.drain = () => Promise.resolve();
    await post();
    const stages = h.seen.stages as string[];
    expect(stages).toContain("guard");
    expect(stages.indexOf("guard"), "after the gate, before the interceptors").toBeGreaterThan(stages.indexOf("gate"));
  });

  // A timer that is started and never ended reports 0 ms, so the stage log would always say the guard was free.
  it("the guard's timer is ended, so its milliseconds reach the log", async () => {
    h.drain = () => Promise.resolve();
    await post();
    expect(h.seen.ended as string[]).toContain("guard");
  });

  it("the guard's timer is ended on a refusal too (the slow case worth explaining)", async () => {
    h.claimResult = { kind: "in_flight", traceId: "T-live", conversationId: "conv-123" };
    expect((await post()).status).toBe(409);
    expect(h.seen.ended as string[]).toContain("guard");
  });
});

describe("a claimed turn", () => {
  it("a first-send replay is run in the thread the first attempt created, not in a new one", async () => {
    h.gate.conversationId = undefined;
    h.gate.trigger = "regenerate-message";
    h.model.findFirst.mockImplementation(async (a: { where: { role?: string; createdAt?: unknown } }) =>
      a.where.role === "user" && !a.where.createdAt
        ? { id: "U1", conversationId: "conv-first", clientMessageId: "c-1", createdAt: new Date(1_000) }
        : null,
    );
    h.model.findMany.mockResolvedValue([]); // the first run died before saving a reply
    h.drain = () => Promise.resolve();

    await post();

    expect(vi.mocked(persistUserTurn).mock.calls[0][0]).toMatchObject({ convId: "conv-first" });
    expect(h.claimCalls[0]).toMatchObject({ conversationId: "conv-first" });
  });

  it("is claimed under the message id, the thread, and the SAME trace the response header and the rows get", async () => {
    h.drain = () => Promise.resolve();

    await post();

    expect(h.claimCalls).toHaveLength(1);
    expect(h.claimCalls[0]).toMatchObject({ clientMessageId: "c-1", conversationId: "conv-123" });
    const trace = h.seen.responseTraceId;
    expect(typeof trace === "string" && trace.length > 0).toBe(true);
    expect(h.claimCalls[0].traceId, "the lease would name a different run than the header").toBe(trace);
    expect(h.seen.persistTraceId).toBe(trace);
  });

  it("learns its thread once the user row has resolved it (a new conversation has none at claim time)", async () => {
    h.drain = () => Promise.resolve();
    await post();
    expect(h.claim.setConversation).toHaveBeenCalledWith("conv-123");
  });

  it("is held until the stream has drained AND the onFinish persist has finished", async () => {
    let drained!: () => void;
    h.drain = () => new Promise<void>((resolve) => (drained = resolve));

    await post();
    expect(h.claim.settleWith).toHaveBeenCalledTimes(1);
    const run = h.claim.settleWith.mock.calls[0][0] as Promise<unknown>;

    expect(await pending(run), "released before anything finished").toBe(true);
    drained();
    expect(await pending(run), "released at the drain, before the persist").toBe(true);
    (h.seen.resolveOnFinish as () => void)();
    expect(await pending(run)).toBe(false);
  });

  it("an error part resolves onFinish EARLY while tools may still run: the hold waits for the drain", async () => {
    let drained!: () => void;
    h.drain = () => new Promise<void>((resolve) => (drained = resolve));

    await post();
    const run = h.claim.settleWith.mock.calls[0][0] as Promise<unknown>;
    (h.seen.resolveOnFinish as () => void)(); // stream-error-handler's finally, mid-stream

    expect(await pending(run), "released while the stream could still run a tool").toBe(true);
    drained();
    expect(await pending(run)).toBe(false);
  });

  it("is not let go until the errored row has been settled to its final record (a replay must not read a row that still says 'cannot vouch')", async () => {
    let drained!: () => void;
    h.drain = () => new Promise<void>((resolve) => (drained = resolve));
    let settledRow!: () => void;

    await post();
    // stream-error-handler registers this while the stream is still open.
    const toolCalls = h.seen.toolCalls as { afterTerminal(cb: () => Promise<void>): void };
    toolCalls.afterTerminal(() => new Promise<void>((resolve) => (settledRow = resolve)));
    const run = h.claim.settleWith.mock.calls[0][0] as Promise<unknown>;
    (h.seen.resolveOnFinish as () => void)();
    drained();

    expect(await pending(run), "released before the row was settled").toBe(true);
    settledRow();
    expect(await pending(run)).toBe(false);
  });

  it("a drain that REJECTS still ends the hold once onFinish has run (the errored row, not the lease, guards the replay)", async () => {
    h.drain = () => Promise.reject(new Error("consumeStream failed"));

    await post();
    const run = h.claim.settleWith.mock.calls[0][0] as Promise<unknown>;
    (h.seen.resolveOnFinish as () => void)();

    expect(await pending(run)).toBe(false);
  });

  it("the streaming response goes through holdWhileBodyOpen too (a no-op once the lease is bound to the run)", async () => {
    h.drain = () => new Promise<void>(() => {});

    const res = await post();

    expect(h.claim.settleWith).toHaveBeenCalledTimes(1);
    expect(h.claim.holdWhileBodyOpen).toHaveBeenCalledTimes(1);
    expect(h.claim.holdWhileBodyOpen.mock.calls[0][0]).toBe(res);
    expect(h.claim.finish).not.toHaveBeenCalled();
  });
});

describe("every other way out of the handler lets go of the message", () => {
  it("daily budget refusal (402): handed to holdWhileBodyOpen, which releases an error status at once", async () => {
    vi.mocked(assertWithinBudget).mockResolvedValue({ ok: false, status: { spent: 600, limit: 500 } } as never);

    const res = await post();

    expect(res.status).toBe(402);
    expect(h.claim.holdWhileBodyOpen).toHaveBeenCalledTimes(1);
    expect((h.claim.holdWhileBodyOpen.mock.calls[0][0] as Response).status).toBe(402);
    expect(h.claim.settleWith).not.toHaveBeenCalled();
  });

  it("an interceptor fast path whose BODY does the work (an image): the lease follows the body, and the client gets the wrapped response", async () => {
    const imageStream = new Response("generating");
    const wrapped = new Response("generating");
    vi.mocked(runInterceptors).mockResolvedValue({ kind: "handled", convId: "conv-123", response: imageStream } as never);
    h.claim.holdWhileBodyOpen.mockReturnValue(wrapped);

    const res = await post();

    expect(h.claim.holdWhileBodyOpen).toHaveBeenCalledWith(imageStream);
    expect(res, "the unwrapped response went to the client: the lease would end at handler return").toBe(wrapped);
    expect(h.claim.settleWith).not.toHaveBeenCalled();
    expect(streamWithFallback).not.toHaveBeenCalled();
  });

  it("a throw inside the turn: the message is let go and the error still surfaces", async () => {
    vi.mocked(runInterceptors).mockRejectedValue(new Error("interceptor blew up"));

    await expect(post()).rejects.toThrow("interceptor blew up");

    expect(h.claim.finish).toHaveBeenCalledTimes(1);
    expect(h.claim.holdWhileBodyOpen).not.toHaveBeenCalled();
  });
});

describe("what is not guarded", () => {
  it.each([
    ["Private Lab", { privateMode: true }],
    ["an ephemeral turn", { ephemeral: true }],
  ])("%s never claims anything", async (_n, over) => {
    Object.assign(h.gate, over);
    h.drain = () => Promise.resolve();

    const res = await post();

    expect(res.status).toBe(200);
    expect(h.claimCalls).toHaveLength(0);
  });

  it("an unavailable claim store fails open: the turn runs", async () => {
    h.claimResult = { kind: "unavailable" };
    h.drain = () => Promise.resolve();

    const res = await post();

    expect(res.status).toBe(200);
    expect(streamWithFallback).toHaveBeenCalledTimes(1);
  });
});
