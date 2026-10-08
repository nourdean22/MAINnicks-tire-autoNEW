/**
 * The deep-reasoning lane must not hand the model an unread section as real zeros.
 *
 * The lane prepends `JSON.stringify(getDashboardSummary())` to the reasoning
 * context under "LIVE DATA SNAPSHOT (real ... reason from THESE numbers)". A
 * section whose shop-bridge read failed carries its zero defaults plus
 * `bridgeHealth.<section>: false`, and the header tells the model to trust the
 * numbers, not the flag. `customer_stats` has never had a nickstire handler
 * (found 2026-10-08 by the bridge contract guard), so until this fix every deep
 * turn said `customers: { total: 0, newThisMonth: 0 }` was real.
 *
 * Drives the REAL runAlternatePaths into the deep lane and reads the
 * `brainContext` it hands the reasoning stream. The redaction itself is the real
 * `redactUnreadableSections` (not mocked).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const flags: Record<string, boolean> = {};
vi.mock("@/lib/feature-flags", () => ({ getFlag: (k: string) => ({ isOn: flags[k] ?? false }) }));
vi.mock("ai", () => ({ generateText: vi.fn(), stepCountIs: () => () => false }));
vi.mock("@/lib/observability/langfuse", () => ({ langfuseTelemetry: () => ({}) }));
vi.mock("@/lib/services/chat/persist-assistant-turn", () => ({ buildOnFinish: () => async () => undefined }));
const simulateReasoningStream = vi.fn((_args: unknown) => new Response("reasoning"));
vi.mock("@/lib/ai/chat/simulate-stream-from-text", () => ({
  simulateStreamFromText: () => new Response("stream"),
  simulateReasoningStream: (a: unknown) => simulateReasoningStream(a),
}));
vi.mock("@/lib/services/chat/response-shape", () => ({ buildChatResponse: ({ streamResponse }: { streamResponse: Response }) => streamResponse }));
vi.mock("@/lib/ai/chat/pre-stream-regen", () => ({ shouldGateForIntent: () => false, maybePreStreamRegen: vi.fn() }));
vi.mock("@/lib/ai/chat/multi-agent-detect", () => ({ isMultiPartQuestion: () => false, runAutoDecompose: vi.fn() }));
vi.mock("@/lib/ai/chat/named-source-claims", () => ({ checkNamedSources: () => ({ claims: [], unreceipted: [], blind: false }) }));
vi.mock("@/lib/ai/chat/output-guardian", () => ({ shapeCeiling: () => 400 }));
vi.mock("@/lib/ai/chat/gate-enforcement", () => ({ enforceGate: ({ draft }: { draft: string }) => ({ text: draft, verdict: "pass", usedFallback: false, actions: [] }) }));
vi.mock("@/lib/ai/reasoning/classifier", () => ({ classifyReasoning: () => ({ tier: "deep" }) }));
const getDashboardSummary = vi.fn();
vi.mock("@/lib/services/business-intel", () => ({ getDashboardSummary: () => getDashboardSummary() }));

import { runAlternatePaths } from "@/app/api/ai/chat/alternate-paths";

const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
const deepTurn = () =>
  ({
    persistBase: {},
    provider: "openai",
    modelId: "m",
    model: {},
    sanitizedModelMessages: [],
    prunedTools: {},
    mode: "standard",
    maxOutputTokens: 0,
    userContent: "weigh the trade-offs of the two approaches we discussed",
    finalSystemPrompt: "sys",
    turnSignal: { intent: "analytical", complexity: "complex", outputShape: "prose", urgency: "low", domain: "personal", temperature: 0.4, useChainOfThought: false, useTwoPassCritique: false, reasons: [] },
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
  }) as unknown as Parameters<typeof runAlternatePaths>[0];

const summary = (customersReadable: boolean) => ({
  revenue: { period: "month", totalRevenue: "18422.75", jobCount: 41, bridgeAvailable: true },
  customers: customersReadable ? { total: 412, newThisMonth: 9 } : { total: 0, newThisMonth: 0 },
  reviews: { average: 4.8, total: 120, unresponded: 2 },
  jobs: { today: 3 },
  bridgeHealth: { revenue: true, customers: customersReadable, jobsToday: true },
});

async function brainContextFor(s: ReturnType<typeof summary>): Promise<string> {
  getDashboardSummary.mockResolvedValue(s);
  const out = await runAlternatePaths(deepTurn());
  expect(await (out as Response).text()).toBe("reasoning"); // the deep lane, not another one
  const req = (simulateReasoningStream.mock.calls[0][0] as { request: { brainContext: string } }).request;
  return req.brainContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(flags)) delete flags[k];
  flags.NICK_DEEP_REASONING = true;
});

describe("deep lane live snapshot", () => {
  it("an unread section reaches the model as unknown, not as zeros", async () => {
    const ctx = await brainContextFor(summary(false));
    expect(ctx).toContain("LIVE DATA SNAPSHOT");
    expect(ctx).toContain('"customers":null');
    expect(ctx).toContain('"unavailable":["customers"]');
    expect(ctx).not.toContain('"total":0');
    // Partial, not all-or-nothing: the readable revenue figure survives.
    expect(ctx).toContain('"totalRevenue":"18422.75"');
  });

  it("CONTROL: a fully readable summary reaches the model unchanged", async () => {
    const ctx = await brainContextFor(summary(true));
    expect(ctx).toContain('"customers":{"total":412,"newThisMonth":9}');
    expect(ctx).not.toContain('"unavailable"');
  });
});
