/**
 * tests/ai/chat/stream-first-regen.test.ts · 2026-10-26 (job 2026-10-26-chat-latency)
 *
 * THE DEFECT (prod log, reqId r659o0s, 11:01:48Z): a 28-character message, tier
 * core, waited 106 s in `stream-config` before its stream began. The verified
 * regen lane (NICK_VERIFIED_REGEN, on in prod since 2026-07-22) gates factual,
 * decision, creative, instructional, procedural and analytical turns, and it
 * built the whole first draft (and, when the critic failed it, a second one)
 * with generateText BEFORE any byte reached the client.
 *
 * THE FIX: the first draft IS the normal stream. The same critic-gated best-of-2
 * runs after it, in the persist pipeline (persistBase.postFlushRegen), and a
 * better second draft replaces the bubble's text on message.persisted, the swap
 * the post-flush CoVe pass already uses.
 *
 * Harness clock: every model call advances the turn clock by MODEL_MS (a slow
 * local model). "ms before stream start" = clock at the moment runAlternatePaths
 * hands the turn to a stream (a lane Response or a fall-through null).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { classifyTurn } from "@/lib/ai/turn-intelligence";

const flags: Record<string, boolean> = {};
vi.mock("@/lib/feature-flags", () => ({ getFlag: (k: string) => ({ isOn: flags[k] ?? false }) }));

const generateText = vi.fn();
vi.mock("ai", () => ({ generateText: (...a: unknown[]) => generateText(...a), stepCountIs: () => () => false }));
vi.mock("@/lib/observability/langfuse", () => ({ langfuseTelemetry: () => ({}) }));
const recordToolObservations = vi.fn(async () => undefined);
vi.mock("@/lib/services/chat/tool-telemetry-walk", () => ({
  recordToolObservations: (...a: unknown[]) => recordToolObservations(...(a as [])),
}));
vi.mock("@/lib/services/chat/persist-assistant-turn", () => ({
  buildOnFinish: () => async () => undefined,
}));
vi.mock("@/lib/ai/chat/simulate-stream-from-text", () => ({
  simulateStreamFromText: () => new Response("stream"),
  simulateReasoningStream: () => new Response("reasoning"),
}));
vi.mock("@/lib/services/chat/active-stream", () => ({ trackActiveStream: () => () => undefined }));
vi.mock("@/lib/services/chat/response-shape", () => ({
  buildChatResponse: ({ streamResponse }: { streamResponse: Response }) => streamResponse,
}));
vi.mock("@/lib/services/metrics", () => ({ recordMetric: async () => undefined, recordMetricStrict: async () => ({}) }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/ai/chat/chain-of-verification", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/chat/chain-of-verification")>()),
  verifyAndRevise: async (draft: string) => ({ changed: false, revised: draft, questions: [] }),
}));
const runAutoDecompose = vi.fn();
vi.mock("@/lib/ai/chat/multi-agent-detect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/chat/multi-agent-detect")>()),
  runAutoDecompose: (...a: unknown[]) => runAutoDecompose(...a),
}));

import { runAlternatePaths } from "@/app/api/ai/chat/alternate-paths";
import { REGEN_SYSTEM_PREFIX } from "@/lib/ai/chat/pre-stream-regen";

// Same fixtures as tests/ai/chat/pre-stream-regen.test.ts: the critic repairs the first, passes the second.
const VAGUE_REPLY =
  "Yes that depends on various factors and there are many ways to look at it. " +
  "Consider the options and choose what works best for you in the situation. " +
  "The path forward will take many shapes based on the specifics of your case.";
const CONCRETE_REPLY =
  "Today: 12 leads opened, 3 callbacks pending, 5 estimates worth $4,200. " +
  "autonicks shows 8 drops booked this week. Nick handles 2 jobs at 9:30am.";

const MODEL_MS = 60_000;
const T0 = Date.parse("2026-10-26T11:01:48.000Z");
const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
const readTool = { description: "read", execute: vi.fn(async () => ({ ok: true })) };
const writeTool = { description: "write", execute: vi.fn(async () => ({ ok: true })) };

type PostFlushRegen = (a: { draft: string }) => Promise<{ text: string; steps?: unknown[] } | null>;

function modelReturning(...texts: string[]) {
  let i = 0;
  generateText.mockImplementation(async () => {
    vi.setSystemTime(Date.now() + MODEL_MS);
    const text = texts[Math.min(i, texts.length - 1)];
    i += 1;
    return { text, steps: [], toolCalls: [], toolResults: [], totalUsage: { inputTokens: 100, outputTokens: 10 } };
  });
}

function run(q: string, over: Record<string, unknown> = {}) {
  const persistBase: Record<string, unknown> = { startedAt: T0, userClientMessageId: "u1" };
  const p = runAlternatePaths({
    persistBase,
    provider: "ollama",
    modelId: "minimax-m3",
    model: {},
    sanitizedModelMessages: [{ role: "user", content: q }],
    prunedTools: { getRevenueStats: readTool, createTask: writeTool },
    mode: "standard",
    maxOutputTokens: 0,
    userContent: q,
    finalSystemPrompt: "SYSTEM",
    turnSignal: { ...classifyTurn(q), intent: "factual", complexity: "simple", temperature: 0.4 },
    actionIntent: null,
    toolsExpected: false,
    convId: "c1",
    traceId: "t_latency",
    modeOverride: undefined,
    personality: undefined,
    classification: undefined,
    recalledHits: [],
    deeperContextCount: 0,
    deeperContextTypes: [],
    contextBlocksFired: [],
    privateMode: false,
    log,
    ...over,
  } as unknown as Parameters<typeof runAlternatePaths>[0]);
  return { p, persistBase };
}

// 28 characters, tier core, as on reqId r659o0s.
const SHORT_Q = "how much did we make today??";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  for (const k of Object.keys(flags)) delete flags[k];
  // The lanes prod runs today (feature-flags.ts + the 2026-10-25/26 logs).
  flags.NICK_VERIFIED_REGEN = true;
  flags.NICK_COVE = true;
  flags.NICK_MULTI_AGENT_AUTO = true;
  generateText.mockReset();
  runAutoDecompose.mockReset();
  recordToolObservations.mockClear();
  log.info.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("stream first: a regen-gated turn starts its stream before any model call", () => {
  it("a 28-char core-tier factual turn runs no lane before the stream (0 ms of model time)", async () => {
    expect(SHORT_Q.length).toBe(28);
    modelReturning(VAGUE_REPLY, CONCRETE_REPLY);
    const { p, persistBase } = run(SHORT_Q);
    const res = await p;
    const msBeforeStream = Date.now() - T0;
    log.info("harness_ms_before_stream", { msBeforeStream, calls: generateText.mock.calls.length });

    expect(generateText, "a lane generated before the stream began").not.toHaveBeenCalled();
    expect(msBeforeStream).toBe(0);
    expect(res, "the turn must fall through to the real stream").toBeNull();
    expect(typeof persistBase.postFlushRegen, "the best-of-2 must still run, after the stream").toBe("function");
  });

  it("CONTROL: an action turn gets no post-flush regen (the action path is unchanged)", async () => {
    const { p, persistBase } = run("create a task to call the tire supplier", {
      actionIntent: { tool: "createTask" },
    });
    expect(await p).toBeNull();
    expect(persistBase.postFlushRegen).toBeUndefined();
    expect(generateText).not.toHaveBeenCalled();
  });

  it("CONTROL: a casual turn (intent not gated) gets no post-flush regen", async () => {
    const { p, persistBase } = run("hey nick", {
      turnSignal: { ...classifyTurn("hey nick"), intent: "casual", complexity: "simple", temperature: 0.7 },
    });
    expect(await p).toBeNull();
    expect(persistBase.postFlushRegen).toBeUndefined();
  });
});

describe("a complex multi-part turn still runs the lane that applies", () => {
  it("multi-agent auto-decompose still answers a multi-part comparison before the stream", async () => {
    runAutoDecompose.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + MODEL_MS);
      return CONCRETE_REPLY;
    });
    const q = "compare our three tire suppliers on price, delivery speed and return policy, and rank them";
    const { p, persistBase } = run(q, {
      turnSignal: { ...classifyTurn(q), intent: "analytical", complexity: "complex", temperature: 0.4 },
    });
    const res = await p;
    expect(runAutoDecompose).toHaveBeenCalledTimes(1);
    expect(res).not.toBeNull();
    expect(persistBase.postFlushRegen).toBeUndefined();
  });
});

describe("persistBase.postFlushRegen · the same critic-gated best-of-2, after the draft streamed", () => {
  async function attach(): Promise<PostFlushRegen> {
    const { p, persistBase } = run(SHORT_Q);
    await p;
    return persistBase.postFlushRegen as PostFlushRegen;
  }

  it("a draft the critic fails gets ONE second draft (read-only tools, repair prefix) and the better one wins", async () => {
    const regen = await attach();
    modelReturning(CONCRETE_REPLY);
    const out = await regen({ draft: VAGUE_REPLY });

    expect(generateText).toHaveBeenCalledTimes(1);
    const call = generateText.mock.calls[0][0] as { system: string; tools: Record<string, unknown> };
    expect(call.system.startsWith(REGEN_SYSTEM_PREFIX.slice(0, 40))).toBe(true);
    expect(call.system.endsWith("SYSTEM")).toBe(true);
    expect(Object.keys(call.tools)).toEqual(["getRevenueStats"]);
    expect(out?.text).toBe(CONCRETE_REPLY);
  });

  it("CONTROL: a draft the critic passes costs no model call and keeps the streamed text", async () => {
    const regen = await attach();
    modelReturning(VAGUE_REPLY);
    expect(await regen({ draft: CONCRETE_REPLY })).toBeNull();
    expect(generateText).not.toHaveBeenCalled();
  });

  it("a second draft that is not better keeps the streamed text, and its tool calls are still recorded once", async () => {
    const regen = await attach();
    generateText.mockResolvedValueOnce({
      text: VAGUE_REPLY,
      steps: [{ toolCalls: [{ toolName: "getRevenueStats" }], toolResults: [] }],
      totalUsage: { inputTokens: 100, outputTokens: 10 },
    });
    const out = await regen({ draft: VAGUE_REPLY });
    expect(out?.text ?? null).toBeNull();
    expect((out as { usage?: { inputTokens?: number } } | null)?.usage?.inputTokens, "a paid draft is counted").toBe(100);
    await vi.waitFor(() => expect(recordToolObservations).toHaveBeenCalledTimes(1));
  });
});
