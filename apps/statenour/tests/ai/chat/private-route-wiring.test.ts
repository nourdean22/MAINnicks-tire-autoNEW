/**
 * tests/ai/chat/private-route-wiring.test.ts · 2026-10-10 (audit 04-F10, 07-SN-05, 07-SN-06)
 *
 * The WIRING half of Private Lab: every downstream gate (tool strip, policy
 * deny, recall sideEffects:false, Langfuse off) keys on a flag the route must
 * hand over, and must hand over BEFORE the stage that reads it. The audit's
 * finding was exactly a seam: "privateMode not threaded below the route".
 *
 * Drives the real POST handler (harness pattern from shadow-dispatch.test.ts)
 * and records what each stage SAW: its arguments and the live turn context at
 * the moment it ran. Three turns: normal (control), private, ephemeral.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const MARKER = "QQZ7731";
const USER = `${MARKER} note the private lease terms for the warehouse`;

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
    gate: { privateMode: false, ephemeral: false, actionPermission: "draft" } as {
      privateMode: boolean;
      ephemeral: boolean;
      actionPermission: "read" | "draft" | "execute";
    },
    logLines: [] as unknown[],
    seen: {} as Record<string, unknown>,
    persistUserTurn: vi.fn().mockResolvedValue("conv-123"),
    runInterceptors: vi.fn().mockResolvedValue({ kind: "unhandled" }),
    streamWithFallback: vi.fn(),
    prisma: new Proxy({}, { get: () => model }),
  };
});

vi.mock("@/lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/logger")>();
  const rec = (msg: string, meta?: unknown) => h.logLines.push([msg, meta]);
  const make = (): unknown => ({
    debug: rec,
    info: rec,
    warn: rec,
    error: rec,
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
      messages: [{ role: "user", content: USER }],
      conversationId: "conv-123",
      userContent: USER,
      personality: "master",
      privateMode: h.gate.privateMode,
      ephemeral: h.gate.ephemeral,
      posture: "auto",
      actionPermission: h.gate.actionPermission,
    })),
  };
});
// The real module drags the Inngest client graph into a cold transform; its
// own private-mode refusal is pinned in tests/ai/decision-plane/shadow.test.ts.
vi.mock("@/lib/ai/decision-plane/shadow", () => ({
  scheduleTurnDecisionShadow: vi.fn(async () => ({ queued: false, reason: "feature_disabled" })),
}));
vi.mock("@/lib/ai/budget", () => ({ assertWithinBudget: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/ai/stream-with-fallback", () => ({ streamWithFallback: h.streamWithFallback, inferProviderName: vi.fn() }));
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
vi.mock("@/lib/ai/chat/interceptors", () => ({ runInterceptors: h.runInterceptors }));
vi.mock("@/lib/services/chat/persist-user-turn", () => ({ persistUserTurn: h.persistUserTurn }));
vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));

// The two stages under test record their input AND the live turn context.
vi.mock("@/lib/services/chat/brain-context", async () => {
  const { currentTurn } = await import("@/lib/agent/turn-context");
  return {
    buildBrainContext: vi.fn(async (input: Record<string, unknown>) => {
      h.seen.brainInput = input;
      h.seen.turnAtBrain = { ...currentTurn() };
      return { systemPromptAddendum: "", contextBlocksFired: {}, deeperContextCount: 0, deeperContextTypes: [], recalledHits: [], detectedContradictions: [] };
    }),
  };
});
vi.mock("@/app/api/ai/chat/prepare-tools", async () => {
  const { currentTurn } = await import("@/lib/agent/turn-context");
  return {
    prepareTools: vi.fn(async (args: Record<string, unknown>) => {
      h.seen.prepareArgs = args;
      h.seen.turnAtPrepare = { ...currentTurn() };
      return { prunedTools: {}, maxOutputTokens: 100, capabilityPlan: {} };
    }),
  };
});

import { POST } from "@/app/api/ai/chat/route";
import { currentTurn } from "@/lib/agent/turn-context";

// The first POST in a cold worker transforms the whole route graph on demand.
vi.setConfig({ testTimeout: 60_000 });

async function turn(gate: { privateMode?: boolean; ephemeral?: boolean; actionPermission?: "read" | "draft" | "execute" }) {
  h.gate = { privateMode: !!gate.privateMode, ephemeral: !!gate.ephemeral, actionPermission: gate.actionPermission ?? "draft" };
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((k) => vi.spyOn(console, k));
  const res = await POST(new Request("http://localhost/api/ai/chat", { method: "POST" }));
  await res.text().catch(() => "");
  await new Promise((r) => setTimeout(r, 10));
  const consoleText = JSON.stringify(spies.map((s) => s.mock.calls));
  for (const s of spies) s.mockRestore();
  return { logged: JSON.stringify(h.logLines) + consoleText };
}

beforeEach(() => {
  h.logLines.length = 0;
  for (const k of Object.keys(h.seen)) delete h.seen[k];
  h.persistUserTurn.mockClear();
  h.runInterceptors.mockClear();
  h.streamWithFallback.mockReset();
  // Tools execute inside streamWithFallback: record the turn as a tool would see it.
  h.streamWithFallback.mockImplementation(async () => {
    h.seen.turnAtStream = { ...currentTurn() };
    return {
      result: { toUIMessageStreamResponse: () => new Response("ok"), consumeStream: () => Promise.resolve() },
      attempts: [{ provider: "ollama", errorClass: null, failedAt: null }],
    };
  });
});

describe("chat route · a normal turn (CONTROL)", () => {
  it("persists the transcript, is not private anywhere, and logs a preview (so the log instrument sees user text)", async () => {
    const { logged } = await turn({});
    expect(h.persistUserTurn).toHaveBeenCalled();
    expect((h.seen.prepareArgs as Record<string, unknown>).privateMode).toBe(false);
    expect((h.seen.brainInput as Record<string, unknown>).privateMode).toBe(false);
    expect((h.seen.turnAtPrepare as Record<string, unknown>).privateMode).toBe(false);
    expect(logged).toContain(MARKER);
  });
});

describe("chat route · a Private Lab turn", () => {
  it("publishes privateMode on the turn BEFORE brain recall and tool preparation run", async () => {
    await turn({ privateMode: true });
    expect((h.seen.turnAtBrain as Record<string, unknown>).privateMode).toBe(true);
    expect((h.seen.turnAtPrepare as Record<string, unknown>).privateMode).toBe(true);
  });

  it("threads privateMode into prepareTools and buildBrainContext, with no conversation id for recall", async () => {
    await turn({ privateMode: true });
    expect((h.seen.prepareArgs as Record<string, unknown>).privateMode).toBe(true);
    const brain = h.seen.brainInput as Record<string, unknown>;
    expect(brain.privateMode).toBe(true);
    expect(brain.convId, "the 'private' placeholder is truthy and made the contradiction injector write").toBeUndefined();
    expect(h.persistUserTurn).not.toHaveBeenCalled();
  });

  it("no log or console line carries the user's words", async () => {
    const { logged } = await turn({ privateMode: true });
    expect(logged).not.toContain(MARKER);
  });
});

describe("chat route · an ephemeral turn (home /task, /capture)", () => {
  it("keeps no transcript but is NOT private: tools and memory stay on", async () => {
    await turn({ ephemeral: true });
    expect(h.persistUserTurn, "transcript not kept").not.toHaveBeenCalled();
    expect(h.runInterceptors, "interceptors persist a transcript of their own").not.toHaveBeenCalled();
    expect((h.seen.prepareArgs as Record<string, unknown>).privateMode).toBe(false);
    expect((h.seen.brainInput as Record<string, unknown>).privateMode).toBe(false);
    expect((h.seen.turnAtPrepare as Record<string, unknown>).privateMode).toBe(false);
  });

  it("the turn context carries the request's action permission for the tool wrapper", async () => {
    await turn({ ephemeral: true });
    expect((h.seen.turnAtPrepare as Record<string, unknown>).actionPermission).toBe("draft");
  });

  it("brain context gets NO conversation id (not the 'private' placeholder) and knows the turn is ephemeral", async () => {
    await turn({ ephemeral: true });
    const brain = h.seen.brainInput as Record<string, unknown>;
    expect(brain.convId, "a placeholder id made every ephemeral turn share one conversation").toBeUndefined();
    expect(brain.ephemeral).toBe(true);
  });
});

describe("chat route · action permission reaches every reader (Task 4 relay)", () => {
  it("a read-permission turn shows actionPermission 'read' where tools execute and to persistUserTurn", async () => {
    await turn({ actionPermission: "read" });
    expect((h.seen.turnAtStream as Record<string, unknown>).actionPermission).toBe("read");
    expect(h.persistUserTurn).toHaveBeenCalledWith(expect.objectContaining({ actionPermission: "read" }));
    // The contradiction lanes need it too: Read refuses the resolve tool they ask Nick to call.
    expect((h.seen.brainInput as Record<string, unknown>).actionPermission).toBe("read");
  });

  it("CONTROL · an execute turn reads 'execute', not a stale or default value", async () => {
    await turn({ actionPermission: "execute" });
    expect((h.seen.turnAtStream as Record<string, unknown>).actionPermission).toBe("execute");
    expect(h.persistUserTurn).toHaveBeenCalledWith(expect.objectContaining({ actionPermission: "execute" }));
  });
});
