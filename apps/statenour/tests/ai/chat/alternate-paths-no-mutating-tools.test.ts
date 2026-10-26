/**
 * tests/ai/chat/alternate-paths-no-mutating-tools.test.ts · 2026-10-10
 * (audit 04-F5, 04-F7 server half)
 *
 * THE DEFECT: the sampled lanes (verified regen: up to 2 generations;
 * self-consistency: 3) spread `genBase`, whose `tools` was the turn's full
 * prunedTools, so every sample could EXECUTE a write (createTask ran once per
 * sample). Then an empty winner or a throw fell through to the main
 * streamText path, which got the same tools and could run it again.
 *
 * Pinned:
 *   1. Regen and self-consistency samples never see a mutating tool (they
 *      still see reads), so a write runs 0 times across the samples.
 *   2. With no write executed, the fall-through leaves the main stream's tools
 *      intact (its single execution is the only one).
 *   3. The single-generation pre-flush lane keeps its tools, but if it ran a
 *      write and then fell through (empty text or a throw), the main stream
 *      gets the read-only set, so the write is not offered a second time.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const flags: Record<string, boolean> = {};
vi.mock("@/lib/feature-flags", () => ({ getFlag: (k: string) => ({ isOn: flags[k] ?? false }) }));

const generateText = vi.fn();
const recordToolInvocation = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/ai/tool-telemetry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/tool-telemetry")>()),
  recordToolInvocation,
}));
vi.mock("ai", () => ({ generateText: (...a: unknown[]) => generateText(...a), stepCountIs: () => () => false }));
vi.mock("@/lib/observability/langfuse", () => ({ langfuseTelemetry: () => ({}) }));
// The persist event and the text each buffered lane ships (audit 04-X12, 04-X11).
const persistEvents: Array<Record<string, unknown>> = [];
const shippedTexts: string[] = [];
vi.mock("@/lib/services/chat/persist-assistant-turn", () => ({
  buildOnFinish: () => async (ev: Record<string, unknown>) => {
    persistEvents.push(ev);
  },
}));
vi.mock("@/lib/ai/chat/simulate-stream-from-text", () => ({
  simulateStreamFromText: ({ text, onComplete }: { text: string; onComplete?: () => unknown }) => {
    shippedTexts.push(text);
    void onComplete?.();
    return new Response("stream");
  },
  simulateReasoningStream: () => new Response("reasoning"),
}));
// No DB row from a unit test: the turn registration is a prisma upsert.
vi.mock("@/lib/services/chat/active-stream", () => ({ trackActiveStream: () => () => undefined }));
vi.mock("@/lib/services/chat/response-shape", () => ({ buildChatResponse: ({ streamResponse }: { streamResponse: Response }) => streamResponse }));
// Empty by default so the turn falls through; a test sets it to ship a reply.
let regenWinner = "";
let regenFired = true;
vi.mock("@/lib/ai/chat/pre-stream-regen", () => ({
  shouldGateForIntent: () => true,
  // Drive BOTH generations, then return `regenWinner`. Since 2026-10-26 the regen
  // lane runs after the stream (persistBase.postFlushRegen): generateOnce returns the
  // streamed draft, so only regenOnce reaches the model.
  maybePreStreamRegen: async (o: { generateOnce: () => Promise<string>; regenOnce: (a: { suggestedSystemPrefix: string }) => Promise<string> }) => {
    await o.generateOnce();
    await o.regenOnce({ suggestedSystemPrefix: "be better" });
    return {
      text: regenWinner,
      regenFired,
      durationMs: { first: 0, regen: 1, total: 1 },
      regenScore: null,
      regenWasBetter: false,
      selectionReason: "test",
      firstScore: { overall: 0 },
      firstAssessment: { severity: "low" },
      regenAssessment: null,
    };
  },
  formatRegenTelemetry: () => ({ metric: "m", value: 0, unit: "count", tags: {}, source: "test" }),
}));
const recordMetricStrict = vi.fn(async (..._a: unknown[]) => ({}));
vi.mock("@/lib/services/metrics", () => ({
  recordMetric: async () => undefined,
  recordMetricStrict: (...a: unknown[]) => recordMetricStrict(...a),
}));
const logError = vi.fn();
vi.mock("@/lib/utils/error-log", () => ({ logError: (...a: unknown[]) => logError(...a) }));
const verifyAndRevise = vi.fn();
vi.mock("@/lib/ai/chat/chain-of-verification", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/chat/chain-of-verification")>()),
  verifyAndRevise: (...a: unknown[]) => verifyAndRevise(...a),
}));
// Empty by default so a self-consistency turn falls through; a test sets it to ship a reply.
let scAnswer = "";
vi.mock("@/lib/ai/chat/self-consistency", () => ({
  selfConsistentAnswer: async ({ samples, generate }: { samples: number; generate: () => Promise<string> }) => {
    for (let i = 0; i < samples; i++) await generate();
    return { answer: scAnswer, agreed: false, samples };
  },
}));
vi.mock("@/lib/ai/chat/multi-agent-detect", () => ({ isMultiPartQuestion: () => false, runAutoDecompose: vi.fn() }));
vi.mock("@/lib/ai/chat/named-source-claims", () => ({ checkNamedSources: () => ({ claims: [], unreceipted: [], blind: false }) }));
vi.mock("@/lib/ai/chat/output-guardian", () => ({ shapeCeiling: () => 400 }));
const gateDrafts: string[] = [];
vi.mock("@/lib/ai/chat/gate-enforcement", () => ({
  enforceGate: ({ draft }: { draft: string }) => {
    gateDrafts.push(draft);
    return { text: draft, verdict: "pass", usedFallback: false, actions: [] };
  },
}));

import { runAlternatePaths } from "@/app/api/ai/chat/alternate-paths";

type ToolLike = { execute: (a: unknown, o?: unknown) => Promise<unknown> };
let createTaskRuns = 0;
let readRuns = 0;
function freshTools(): Record<string, ToolLike> {
  return {
    createTask: { execute: async () => ((createTaskRuns += 1), { ok: true, id: "task_1" }) },
    getHealthToday: { execute: async () => ((readRuns += 1), { steps: 1 }) },
  };
}

/** A model that calls every tool it is offered, then answers with `text`. */
function modelThatUsesItsTools(text: string, thenThrow = false) {
  return async (cfg: { tools?: Record<string, ToolLike> }) => {
    const offered = Object.keys(cfg.tools ?? {});
    for (const name of offered) await cfg.tools![name].execute({ title: "x" }, {});
    if (thenThrow) throw new Error("provider dropped the stream");
    return { text, toolCalls: offered.map((toolName) => ({ toolName })), toolResults: [] };
  };
}

const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
const base = (userContent: string, prunedTools: Record<string, ToolLike>, intent = "factual") =>
  ({
    persistBase: {},
    provider: "openai",
    modelId: "m",
    model: {},
    sanitizedModelMessages: [],
    prunedTools,
    mode: "standard",
    maxOutputTokens: 0,
    userContent,
    finalSystemPrompt: "sys",
    turnSignal: { intent, complexity: "simple", outputShape: "prose", urgency: "low", domain: "personal", temperature: 0.4, useChainOfThought: false, useTwoPassCritique: false, reasons: [] },
    actionIntent: null,
    toolsExpected: false,
    convId: "c1",
    traceId: "t1",
    modeOverride: undefined,
    personality: "x",
    classification: {},
    recalledHits: [],
    deeperContextCount: 0,
    deeperContextTypes: [],
    contextBlocksFired: {},
    privateMode: false,
    log,
  }) as unknown as Parameters<typeof runAlternatePaths>[0];

type PostFlushOut = { text: string | null; steps?: unknown[]; usage?: unknown } | null;
/** The regen lane since 2026-10-26: no model call before the stream; the best-of-2 runs on the streamed draft. */
async function postFlushRegen(userContent: string, tools: Record<string, ToolLike>, intent: string, draft = "the streamed draft") {
  const args = base(userContent, tools, intent);
  expect(await runAlternatePaths(args), "the regen lane must not buffer the reply").toBeNull();
  expect(generateText, "no model call before the stream").not.toHaveBeenCalled();
  const fn = (args.persistBase as { postFlushRegen?: (a: { draft: string }) => Promise<PostFlushOut> }).postFlushRegen;
  expect(typeof fn).toBe("function");
  return fn!({ draft });
}

const offeredTools = () => generateText.mock.calls.map((c) => Object.keys((c[0] as { tools?: object }).tools ?? {}));

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(flags)) delete flags[k];
  createTaskRuns = 0;
  readRuns = 0;
  regenWinner = "";
  regenFired = true;
  scAnswer = "";
  persistEvents.length = 0;
  shippedTexts.length = 0;
  gateDrafts.length = 0;
  recordMetricStrict.mockResolvedValue({});
  generateText.mockImplementation(modelThatUsesItsTools(""));
});

describe("sampled lanes never execute a write", () => {
  it("verified regen (after the stream): the second draft sees reads but no createTask; 0 executions; the stream keeps its tools", async () => {
    flags.NICK_VERIFIED_REGEN = true;
    const tools = freshTools();
    await postFlushRegen("what did I decide about the shop hours", tools, "decision");
    expect(generateText).toHaveBeenCalledTimes(1);
    for (const offered of offeredTools()) {
      expect(offered).toContain("getHealthToday");
      expect(offered).not.toContain("createTask");
    }
    expect(createTaskRuns).toBe(0);
    expect(readRuns).toBe(1);
    // Nothing was written, so the main stream may still make the one real call.
    expect(Object.keys(tools)).toEqual(["createTask", "getHealthToday"]);
  });

  it("self-consistency: three samples, none sees createTask, 0 executions", async () => {
    flags.NICK_SELF_CONSISTENCY = true;
    const tools = freshTools();
    expect(await runAlternatePaths(base("how many open tasks do I have", tools, "factual"))).toBeNull();
    expect(generateText).toHaveBeenCalledTimes(3);
    for (const offered of offeredTools()) expect(offered).not.toContain("createTask");
    expect(createTaskRuns).toBe(0);
  });
});

describe("a lane that already wrote is not re-run by the main stream", () => {
  const HIGH = "recommend 5 podcasts on stoicism worth following";

  it("pre-flush ran createTask, then produced no text: the main stream gets the read-only set", async () => {
    flags.NICK_EVIDENCE_PREFLUSH = true;
    flags.NICK_EVIDENCE_ENFORCEMENT = true;
    const tools = freshTools();
    expect(await runAlternatePaths(base(HIGH, tools))).toBeNull();
    expect(createTaskRuns).toBe(1);
    expect(Object.keys(tools)).toEqual(["getHealthToday"]);
    expect(log.warn).toHaveBeenCalledWith("alt_lane_write_fallthrough", expect.objectContaining({ ran: ["createTask"] }));
  });

  it("pre-flush ran createTask, then threw: the main stream gets the read-only set", async () => {
    flags.NICK_EVIDENCE_PREFLUSH = true;
    flags.NICK_EVIDENCE_ENFORCEMENT = true;
    generateText.mockImplementation(modelThatUsesItsTools("", true));
    const tools = freshTools();
    expect(await runAlternatePaths(base(HIGH, tools))).toBeNull();
    expect(createTaskRuns).toBe(1);
    expect(Object.keys(tools)).toEqual(["getHealthToday"]);
  });

  it("positive control: pre-flush that only READ and fell through leaves the tools alone", async () => {
    flags.NICK_EVIDENCE_PREFLUSH = true;
    flags.NICK_EVIDENCE_ENFORCEMENT = true;
    const tools = { getHealthToday: freshTools().getHealthToday, createTask: { execute: async () => ({}) } };
    generateText.mockImplementation(async (cfg: { tools?: Record<string, ToolLike> }) => {
      await cfg.tools!.getHealthToday.execute({}, {});
      return { text: "", toolCalls: [{ toolName: "getHealthToday" }], toolResults: [] };
    });
    expect(await runAlternatePaths(base(HIGH, tools))).toBeNull();
    expect(Object.keys(tools).sort()).toEqual(["createTask", "getHealthToday"]);
  });

  it("positive control: pre-flush that wrote AND answered ships its reply (no fall-through, nothing to strip)", async () => {
    flags.NICK_EVIDENCE_PREFLUSH = true;
    flags.NICK_EVIDENCE_ENFORCEMENT = true;
    generateText.mockImplementation(modelThatUsesItsTools("Here are five podcasts."));
    const tools = freshTools();
    expect(await runAlternatePaths(base(HIGH, tools))).toBeInstanceOf(Response);
    expect(createTaskRuns).toBe(1);
  });
});

const PAID = { inputTokens: 100, outputTokens: 40, totalTokens: 140 };
/** Every generation reports a final-step `usage` that is NOT the run total. */
const paidReply = (text: string) => async () => ({ text, toolCalls: [], toolResults: [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, totalUsage: PAID });

describe("buffered lanes count every paid generation (audit 04-X12)", () => {
  it("verified regen (after the stream): the second draft's run total goes to persist, which adds it to the stream's usage", async () => {
    flags.NICK_VERIFIED_REGEN = true;
    regenWinner = "A considered reply about the shop hours.";
    generateText.mockImplementation(paidReply(regenWinner));
    const out = await postFlushRegen("what did I decide about the shop hours", {}, "decision");
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(out?.text).toBe(regenWinner);
    expect(out?.usage).toEqual(PAID);
    expect(log.info).toHaveBeenCalledWith("verified_regen_path", expect.objectContaining({ postFlush: true, regenFired: true }));
  });

  it("verified regen (after the stream): a LOSING second draft is still counted", async () => {
    flags.NICK_VERIFIED_REGEN = true;
    regenFired = false;
    generateText.mockImplementation(paidReply("A worse draft."));
    const out = await postFlushRegen("what did I decide about the shop hours", {}, "decision");
    expect(out?.text).toBeNull();
    expect(out?.usage).toEqual(PAID);
  });

  it("control: the single pre-flush generation is counted once, not twice", async () => {
    flags.NICK_EVIDENCE_PREFLUSH = true;
    flags.NICK_EVIDENCE_ENFORCEMENT = true;
    generateText.mockImplementation(paidReply("Here are five podcasts."));
    expect(await runAlternatePaths(base("recommend 5 podcasts on stoicism worth following", {}))).toBeInstanceOf(Response);
    expect(persistEvents[0].usage).toEqual(PAID);
  });
});

describe("every executed sample's tool calls reach tool_telemetry exactly once; tool.chosen stays winner-only", () => {
  const stepOf = (toolName: string, output: unknown = { ok: true }) => [
    { toolCalls: [{ toolName, toolCallId: `id-${toolName}`, input: {} }], toolResults: [{ toolName, toolCallId: `id-${toolName}`, output }] },
  ];
  const settle = () => new Promise((r) => setTimeout(r, 100));
  // The recorder is fire-and-forget, so an earlier test's samples can land after its own
  // assertions: let them drain, then clear, so this window holds only this test's calls.
  beforeEach(async () => {
    await settle();
    recordToolInvocation.mockClear();
  });
  // Earlier tests in this file also run samples (getHealthToday, createTask), and their fire-and-forget
  // recordings can land late under a loaded full run. Count only the tools THIS describe's samples call.
  const MINE = new Set(["getCommitments", "searchMemories", "getTasks"]);
  const recorded = () => recordToolInvocation.mock.calls.map((c) => c[0] as { toolName: string }).filter((c) => MINE.has(c.toolName));
  const recordedNames = () => recorded().map((c) => c.toolName).sort();

  it("verified regen (after the stream): a LOSING second draft's tool call is recorded here, once, with its real failure", async () => {
    flags.NICK_VERIFIED_REGEN = true;
    regenFired = false;
    generateText.mockImplementation(async () => ({
      text: "A losing draft.",
      steps: stepOf("searchMemories", { error: "db down" }),
      toolCalls: [],
      toolResults: [],
    }));
    const out = await postFlushRegen("what did I decide about the shop hours", {}, "decision");
    expect(out?.steps, "a losing draft's steps never reach the persist walk").toBeUndefined();
    await vi.waitFor(() => expect(recordedNames()).toEqual(["searchMemories"]));
    await settle();
    expect(recorded()).toHaveLength(1);
    expect(recordToolInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "searchMemories", success: false, errorMessage: "db down" }),
    );
  });

  it("verified regen (after the stream): a WINNING second draft's steps go to the persist walk, not recorded here", async () => {
    flags.NICK_VERIFIED_REGEN = true;
    regenWinner = "The winning reply about the shop hours.";
    const steps = stepOf("getCommitments");
    generateText.mockImplementation(async () => ({ text: regenWinner, steps, toolCalls: [], toolResults: [] }));
    const out = await postFlushRegen("what did I decide about the shop hours", {}, "decision");
    expect(out?.steps).toEqual(steps);
    await settle();
    expect(recorded()).toHaveLength(0);
  });

  it("self-consistency that falls through to the streaming path: all three samples are recorded once, and nothing is left for the stream to double", async () => {
    flags.NICK_SELF_CONSISTENCY = true;
    generateText.mockImplementation(async () => ({ text: "same answer", steps: stepOf("getTasks"), toolCalls: [], toolResults: [] }));
    expect(await runAlternatePaths(base("how many open tasks do I have", {}, "factual"))).toBeNull();
    await vi.waitFor(() => expect(recorded()).toHaveLength(3));
    await settle();
    expect(recorded()).toHaveLength(3);
    expect(persistEvents).toHaveLength(0);
  });

  it("CONTROL · a sample that executed no tool records nothing", async () => {
    flags.NICK_VERIFIED_REGEN = true;
    regenFired = false;
    generateText.mockImplementation(async () => ({ text: "A plain reply.", steps: [], toolCalls: [], toolResults: [] }));
    await postFlushRegen("what did I decide about the shop hours", {}, "decision");
    await settle();
    expect(recorded()).toHaveLength(0);
  });

  it("CONTROL · the pre-flush lane records nothing here: its single generation is recorded by the persist walk from ev.steps", async () => {
    flags.NICK_EVIDENCE_PREFLUSH = true;
    flags.NICK_EVIDENCE_ENFORCEMENT = true;
    const steps = stepOf("getCommitments");
    generateText.mockImplementation(async () => ({ text: "Here are five podcasts.", steps, toolCalls: [], toolResults: [] }));
    expect(await runAlternatePaths(base("recommend 5 podcasts on stoicism worth following", {}))).toBeInstanceOf(Response);
    await settle();
    expect(recorded()).toHaveLength(0);
    expect(persistEvents[0].steps).toBe(steps);
  });
});

describe("CoVe runs before display on a buffered lane (audit 04-X11 part A)", () => {
  const DRAFT = "The shop opens at 8 and closes at 6 on weekdays, per the posted hours.";

  it("NICK_COVE on + factual intent: the stream carries the REVISED text and the event says CoVe is done", async () => {
    flags.NICK_SELF_CONSISTENCY = true;
    flags.NICK_COVE = true;
    scAnswer = DRAFT;
    generateText.mockImplementation(paidReply(DRAFT));
    verifyAndRevise.mockResolvedValue({ changed: true, revised: "R", questions: ["q"] });
    expect(await runAlternatePaths(base("what time does the shop open", {}, "factual"))).toBeInstanceOf(Response);
    expect(verifyAndRevise).toHaveBeenCalledTimes(1);
    expect(verifyAndRevise).toHaveBeenCalledWith(DRAFT, "what time does the shop open");
    expect(shippedTexts.join("")).toBe("R");
    expect(persistEvents[0].text).toBe("R");
    expect(persistEvents[0].coveDone).toBe(true);
  });

  it("the evidence gate judges the REVISED text, the one that ships (CoVe runs before the gate)", async () => {
    flags.NICK_SELF_CONSISTENCY = true;
    flags.NICK_COVE = true;
    flags.NICK_EVIDENCE_ENFORCEMENT = true;
    scAnswer = DRAFT;
    generateText.mockImplementation(paidReply(DRAFT));
    verifyAndRevise.mockResolvedValue({ changed: true, revised: "R", questions: ["q"] });
    expect(await runAlternatePaths(base("what time does the shop open", {}, "factual"))).toBeInstanceOf(Response);
    expect(gateDrafts).toEqual(["R"]);
    expect(shippedTexts.join("")).toBe("R");
  });

  it("control: NICK_COVE off ships the draft, never calls CoVe, and leaves coveDone unset for the persist pipeline", async () => {
    flags.NICK_SELF_CONSISTENCY = true;
    scAnswer = DRAFT;
    generateText.mockImplementation(paidReply(DRAFT));
    expect(await runAlternatePaths(base("what time does the shop open", {}, "factual"))).toBeInstanceOf(Response);
    expect(verifyAndRevise).not.toHaveBeenCalled();
    expect(shippedTexts.join("")).toBe(DRAFT);
    expect(persistEvents[0].coveDone).toBeUndefined();
  });

  it("control: a non-factual intent is not verified here (same set the persist pipeline uses)", async () => {
    flags.NICK_SELF_CONSISTENCY = true;
    flags.NICK_COVE = true;
    scAnswer = DRAFT;
    generateText.mockImplementation(paidReply(DRAFT));
    expect(await runAlternatePaths(base("what did I decide about the shop hours", {}, "decision"))).toBeInstanceOf(Response);
    expect(verifyAndRevise).not.toHaveBeenCalled();
    expect(persistEvents[0].coveDone).toBeUndefined();
  });

  it("a CoVe failure ships the draft and leaves coveDone unset, so the persist pipeline still tries", async () => {
    flags.NICK_SELF_CONSISTENCY = true;
    flags.NICK_COVE = true;
    scAnswer = DRAFT;
    generateText.mockImplementation(paidReply(DRAFT));
    verifyAndRevise.mockRejectedValue(new Error("provider down"));
    expect(await runAlternatePaths(base("what time does the shop open", {}, "factual"))).toBeInstanceOf(Response);
    expect(shippedTexts.join("")).toBe(DRAFT);
    expect(persistEvents[0].coveDone).toBeUndefined();
  });
});

describe("regen telemetry failures reach the instrument channel (audit 01-F6)", () => {
  it("a rejected chat.pre_stream_regen write is logged under instrument.chat.pre_stream_regen with the traceId", async () => {
    flags.NICK_VERIFIED_REGEN = true;
    const boom = new Error("insert failed");
    recordMetricStrict.mockRejectedValue(boom);
    await postFlushRegen("what did I decide about the shop hours", {}, "decision");
    await vi.waitFor(() => expect(logError).toHaveBeenCalled());
    expect(logError).toHaveBeenCalledWith("instrument.chat.pre_stream_regen", boom, { traceId: "t1" }, "warn");
  });

  it("control: a successful write logs nothing", async () => {
    flags.NICK_VERIFIED_REGEN = true;
    await postFlushRegen("what did I decide about the shop hours", {}, "decision");
    expect(recordMetricStrict).toHaveBeenCalledTimes(1);
    expect(logError).not.toHaveBeenCalled();
  });
});
