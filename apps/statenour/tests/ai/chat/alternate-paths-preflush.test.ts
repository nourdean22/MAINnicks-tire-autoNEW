/**
 * The selective pre-flush evidence lane (2026-09-15).
 *
 * assessTurnRisk() returned `buffer: true` since 2026-09-10 and nothing consumed
 * it. This drives the REAL runAlternatePaths with the flag pair on and proves:
 * a high-risk turn is generated fully BEFORE it ships (one generateText call,
 * receipts handed to the gate), a low-risk turn keeps streaming (null), the
 * lane refuses to buffer without a gate to act (enforcement off → null), an
 * action turn never enters, and a lookup that will hit a tool anyway streams.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const flags: Record<string, boolean> = {};
vi.mock("@/lib/feature-flags", () => ({ getFlag: (k: string) => ({ isOn: flags[k] ?? false }) }));

const generateText = vi.fn();
vi.mock("ai", () => ({ generateText: (...a: unknown[]) => generateText(...a), stepCountIs: () => () => false }));
vi.mock("@/lib/observability/langfuse", () => ({ langfuseTelemetry: () => ({}) }));
vi.mock("@/lib/services/chat/persist-assistant-turn", () => ({ buildOnFinish: () => async () => undefined }));
vi.mock("@/lib/ai/chat/simulate-stream-from-text", () => ({
  simulateStreamFromText: () => new Response("stream"),
  simulateReasoningStream: () => new Response("reasoning"),
}));
vi.mock("@/lib/services/chat/response-shape", () => ({ buildChatResponse: ({ streamResponse }: { streamResponse: Response }) => streamResponse }));
vi.mock("@/lib/ai/chat/pre-stream-regen", () => ({ shouldGateForIntent: () => false, maybePreStreamRegen: vi.fn() }));
vi.mock("@/lib/ai/chat/multi-agent-detect", () => ({ isMultiPartQuestion: () => false, runAutoDecompose: vi.fn() }));
const checkNamedSources = vi.fn(() => ({ claims: [], unreceipted: [], blind: false }));
vi.mock("@/lib/ai/chat/named-source-claims", () => ({ checkNamedSources: (...a: unknown[]) => checkNamedSources(...(a as [])) }));
vi.mock("@/lib/ai/chat/output-guardian", () => ({ shapeCeiling: () => 400 }));
const enforceGate = vi.fn(({ draft }: { draft: string }) => ({ text: draft, verdict: "pass", usedFallback: false, actions: [] }));
vi.mock("@/lib/ai/chat/gate-enforcement", () => ({ enforceGate: (a: unknown) => enforceGate(a as never) }));
// The deep lane's best-effort imports, stubbed so a CONTROL turn can really
// take that lane (it returns Response("reasoning") through the mock above).
vi.mock("@/lib/services/business-intel", () => ({ getDashboardSummary: async () => ({}) }));
vi.mock("@/lib/ai/reasoning/classifier", () => ({ classifyReasoning: () => ({ tier: "deep" }) }));

import { runAlternatePaths } from "@/app/api/ai/chat/alternate-paths";

const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
const base = (userContent: string, over: Partial<Parameters<typeof runAlternatePaths>[0]> = {}) =>
  ({
    persistBase: {},
    provider: "openai",
    modelId: "m",
    model: {},
    sanitizedModelMessages: [],
    prunedTools: {},
    mode: "standard",
    maxOutputTokens: 0,
    userContent,
    finalSystemPrompt: "sys",
    turnSignal: { intent: "factual", complexity: "simple", outputShape: "prose", urgency: "low", domain: "personal", temperature: 0.4, useChainOfThought: false, useTwoPassCritique: false, reasons: [] },
    actionIntent: null,
    toolsExpected: false,
    convId: "c1",
    traceId: "t1",
    modeOverride: undefined,
    personality: "x",
    classification: {},
    recalledHits: [],
    detectedContradictions: [],
    deeperContextCount: 0,
    deeperContextTypes: [],
    contextBlocksFired: {},
    privateMode: false,
    log,
    ...over,
  }) as unknown as Parameters<typeof runAlternatePaths>[0];

const HIGH = "recommend 5 podcasts on stoicism worth following";
const LOW = "thanks, that helps";

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(flags)) delete flags[k];
  generateText.mockResolvedValue({ text: "buffered answer", toolCalls: [{ toolName: "arsenalWebSearch" }], toolResults: [{ output: { hits: 3 } }] });
});

describe("pre-flush evidence lane", () => {
  it("positive control: both flags on + a buffer-worthy turn → ONE full generation, receipts handed to the gate, shipped as a stream", async () => {
    flags.NICK_EVIDENCE_PREFLUSH = true;
    flags.NICK_EVIDENCE_ENFORCEMENT = true;
    const res = await runAlternatePaths(base(HIGH));
    expect(res).toBeInstanceOf(Response);
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith("evidence_preflush_path", expect.objectContaining({ toolCalls: 1 }));
    // The gate saw what the lane called — not a blind receipt channel.
    const receipts = checkNamedSources.mock.calls[0][1] as { toolCalls: Array<{ name: string }>; receiptsAvailable: boolean; evidenceText: string };
    expect(receipts.toolCalls).toEqual([{ name: "arsenalWebSearch" }]);
    expect(receipts.receiptsAvailable).toBe(true);
    expect(receipts.evidenceText).toContain('"hits":3');
    expect(enforceGate).toHaveBeenCalledTimes(1);
  });

  it("a low-risk turn keeps streaming (null, no hidden generation)", async () => {
    flags.NICK_EVIDENCE_PREFLUSH = true;
    flags.NICK_EVIDENCE_ENFORCEMENT = true;
    // A casual acknowledgement: no resource ask, no health term, no lookup
    // shape, and turn-intelligence would classify it "casual", not "factual".
    const casual = base(LOW);
    (casual.turnSignal as { intent: string }).intent = "casual";
    expect(await runAlternatePaths(casual)).toBeNull();
    expect(generateText).not.toHaveBeenCalled();
  });

  it("refuses to buffer when there is no gate to act: PREFLUSH on, ENFORCEMENT off → null", async () => {
    flags.NICK_EVIDENCE_PREFLUSH = true;
    expect(await runAlternatePaths(base(HIGH))).toBeNull();
    expect(generateText).not.toHaveBeenCalled();
  });

  it("flag off (today's default) → every turn streams, even the buffer-worthy one", async () => {
    flags.NICK_EVIDENCE_ENFORCEMENT = true;
    expect(await runAlternatePaths(base(HIGH))).toBeNull();
    expect(generateText).not.toHaveBeenCalled();
  });

  it("an action turn never enters a buffered lane (tool forcing needs real streamText)", async () => {
    flags.NICK_EVIDENCE_PREFLUSH = true;
    flags.NICK_EVIDENCE_ENFORCEMENT = true;
    expect(await runAlternatePaths(base(HIGH, { actionIntent: { kind: "send" } as never }))).toBeNull();
    expect(generateText).not.toHaveBeenCalled();
  });

  // Codex #2335 P2 · the deep lane returns its reasoning stream BEFORE the
  // enforcement block, so with the gate on a buffer-worthy turn that also
  // qualified for deep reasoning was never examined. Risk is computed first
  // now; when it says buffer, the receipted lane pre-empts deep.
  it("a buffer-worthy turn pre-empts the deep lane when the gate is on; a low-risk one still takes deep", async () => {
    flags.NICK_DEEP_REASONING = true;
    flags.NICK_EVIDENCE_PREFLUSH = true;
    flags.NICK_EVIDENCE_ENFORCEMENT = true;
    const deepShape = { complexity: "complex", intent: "analytical" };
    const risky = base(HIGH);
    Object.assign(risky.turnSignal as object, deepShape);
    const shipped = await runAlternatePaths(risky);
    expect(shipped).toBeInstanceOf(Response);
    expect(await (shipped as Response).text()).toBe("stream"); // the pre-flush lane, not the reasoning stream
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(enforceGate).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith("evidence_preflush_path", expect.anything());

    // CONTROL: same flags, same deep-eligible shape, a turn the risk model
    // does not buffer → deep still wins and the gate is not involved.
    vi.clearAllMocks();
    const calm = base("weigh the trade-offs of the two approaches we discussed");
    Object.assign(calm.turnSignal as object, deepShape);
    const reasoned = await runAlternatePaths(calm);
    expect(reasoned).toBeInstanceOf(Response);
    expect(await (reasoned as Response).text()).toBe("reasoning");
    expect(generateText).not.toHaveBeenCalled();
  });

  // Codex #2335 P2 · the streaming path pins arsenalWebSearch on step 0 for an
  // explicit web-search ask; the buffered lane dropped that pin, so the model
  // could skip the search and the gate then stripped the unreceipted results.
  it("an explicit web-search ask keeps its step-0 arsenalWebSearch pin inside the pre-flush lane, and the last step is text-only", async () => {
    flags.NICK_EVIDENCE_PREFLUSH = true;
    flags.NICK_EVIDENCE_ENFORCEMENT = true;
    const ask = "search the web and recommend five youtube channels on woodworking";
    expect(await runAlternatePaths(base(ask, { toolsExpected: true, webSearchIntent: true }))).toBeInstanceOf(Response);
    const cfg = generateText.mock.calls[0][0] as { prepareStep: (s: { stepNumber: number }) => { toolChoice: unknown } };
    expect(cfg.prepareStep({ stepNumber: 0 }).toolChoice).toEqual({ type: "tool", toolName: "arsenalWebSearch" });
    expect(cfg.prepareStep({ stepNumber: 1 }).toolChoice).toBe("auto");
    expect(cfg.prepareStep({ stepNumber: 2 }).toolChoice).toBe("none"); // standard mode: 3 steps, last is text-only
    expect(log.info).toHaveBeenCalledWith("evidence_preflush_path", expect.objectContaining({ webSearchPinned: true }));

    // CONTROL: no web-search intent → step 0 is left to the model.
    vi.clearAllMocks();
    expect(await runAlternatePaths(base(HIGH))).toBeInstanceOf(Response);
    const plain = generateText.mock.calls[0][0] as { prepareStep: (s: { stepNumber: number }) => { toolChoice: unknown } };
    expect(plain.prepareStep({ stepNumber: 0 }).toolChoice).toBe("auto");
  });

  it("a lookup that will hit a tool anyway streams (its receipt will exist); the same lookup with no tool expected is buffered", async () => {
    flags.NICK_EVIDENCE_PREFLUSH = true;
    flags.NICK_EVIDENCE_ENFORCEMENT = true;
    const lookup = "who is the current mayor of Euclid Ohio";
    expect(await runAlternatePaths(base(lookup, { toolsExpected: true }))).toBeNull();
    expect(generateText).not.toHaveBeenCalled();
    expect(await runAlternatePaths(base(lookup, { toolsExpected: false }))).toBeInstanceOf(Response);
    expect(generateText).toHaveBeenCalledTimes(1);
  });
});
