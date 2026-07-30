/**
 * tests/ai/chat/derive-turn-signals.test.ts — contract tests for the
 * chat-route decomposition slice (2026-07-25).
 *
 * Pins the behavior that used to live inline in route.ts:
 *   1. Mode priority ladder: per-request override > AI-config default >
 *      classification-derived.
 *   2. Task-type mapping: deep mode → "deep", standard → "reason",
 *      client taskTypeOverride always wins.
 *   3. Python-execute intent suppresses BOTH action + web-search
 *      detection (mutual exclusivity the provider force depends on).
 *   4. Explicit web-search phrasing fires webSearchIntent; ordinary
 *      questions do not.
 *   5. The classify stage-timer records a "classify" stage on the
 *      injected tracker (the chat-pipeline log line depends on it).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/settings/ai-config", () => ({
  getAiConfig: vi.fn(async () => null),
}));
vi.mock("@/lib/ai/runtime/intent-router", () => ({
  classifyIntent: vi.fn(async () => ({ mode: "casual", persona: "default" })),
}));

import { deriveTurnSignals } from "@/app/api/ai/chat/derive-turn-signals";
import { createStageTracker } from "@/lib/ai/chat/timing";
import { getAiConfig } from "@/lib/settings/ai-config";
import { classifyIntent } from "@/lib/ai/runtime/intent-router";

const logStub = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as any;

function callWith(userContent: string, overrides?: {
  modeOverride?: "standard" | "deep";
  taskTypeOverride?: any;
}) {
  return deriveTurnSignals({
    userContent,
    messages: [{ role: "user", parts: [{ type: "text", text: userContent }] }],
    modeOverride: overrides?.modeOverride,
    taskTypeOverride: overrides?.taskTypeOverride,
    contentMode: false,
    traceId: "trace-test",
    stageTracker: createStageTracker(),
    log: logStub,
  });
}

beforeEach(() => {
  vi.mocked(getAiConfig).mockResolvedValue(null as any);
  vi.mocked(classifyIntent).mockResolvedValue({ mode: "casual", persona: "default" } as any);
});

describe("deriveTurnSignals · mode priority ladder", () => {
  it("per-request modeOverride wins over everything", async () => {
    vi.mocked(getAiConfig).mockResolvedValue({ defaultMode: "standard" } as any);
    vi.mocked(classifyIntent).mockResolvedValue({ mode: "engineer" } as any);
    const s = await callWith("hello", { modeOverride: "deep" });
    expect(s.mode).toBe("deep");
  });

  it("AI-config default beats classification", async () => {
    vi.mocked(getAiConfig).mockResolvedValue({ defaultMode: "deep" } as any);
    vi.mocked(classifyIntent).mockResolvedValue({ mode: "casual" } as any);
    const s = await callWith("hello");
    expect(s.mode).toBe("deep");
  });

  it("engineer/operator classification falls back to deep; casual to standard", async () => {
    vi.mocked(classifyIntent).mockResolvedValue({ mode: "engineer" } as any);
    expect((await callWith("hello")).mode).toBe("deep");
    vi.mocked(classifyIntent).mockResolvedValue({ mode: "casual" } as any);
    expect((await callWith("hello")).mode).toBe("standard");
  });
});

describe("deriveTurnSignals · task-type mapping", () => {
  it("deep mode maps to deep task type, standard to reason", async () => {
    expect((await callWith("hi", { modeOverride: "deep" })).taskTypeForMode).toBe("deep");
    expect((await callWith("hi", { modeOverride: "standard" })).taskTypeForMode).toBe("reason");
  });

  it("client taskTypeOverride always wins", async () => {
    const s = await callWith("hi", { modeOverride: "standard", taskTypeOverride: "fast" });
    expect(s.taskTypeForMode).toBe("fast");
    // and domain routing cannot displace an explicit override
    expect(s.finalTaskType).toBe("fast");
  });
});

describe("deriveTurnSignals · tool-mandatory intent exclusivity", () => {
  it("python-execute suppresses action + web-search detection", async () => {
    const s = await callWith("run this python to compute the numbers and search the web for rates");
    expect(s.pythonExecuteIntent).toBe(true);
    expect(s.actionIntent).toBeNull();
    expect(s.webSearchIntent).toBe(false);
    expect(s.webSearchRecency).toBe(false);
  });

  it("explicit web-search phrasing fires webSearchIntent", async () => {
    const s = await callWith("search the web for the latest tire trends");
    expect(s.pythonExecuteIntent).toBe(false);
    expect(s.webSearchIntent).toBe(true);
    // the force subsumes availability — recency stays quiet
    expect(s.webSearchRecency).toBe(false);
  });

  it("an ordinary question fires none of the mandatory intents", async () => {
    const s = await callWith("what do you think about the estimate follow-ups?");
    expect(s.pythonExecuteIntent).toBe(false);
    expect(s.webSearchIntent).toBe(false);
    expect(s.webSearchRecency).toBe(false);
  });
});

describe("deriveTurnSignals · webSearchRecency (availability, never force)", () => {
  it("THE REPORTED GAP: recency-phrased recommendation ask fires recency, not the force", async () => {
    // 2026-07-29 telemetry: this exact ask got "I don't have web search
    // available this turn", then a reply with three invented percentages.
    const s = await callWith(
      "Best top rated movies n shows I would find interesting right now or will get me hooked please",
    );
    expect(s.webSearchIntent).toBe(false);
    expect(s.webSearchRecency).toBe(true);
  });

  it("trending / what's-hot phrasing fires recency", async () => {
    expect((await callWith("what's hot in AI this week")).webSearchRecency).toBe(true);
    expect((await callWith("anything trending I should know about")).webSearchRecency).toBe(true);
  });

  it("bare 'latest' without a live-content noun does NOT fire (my latest journal entry)", async () => {
    const s = await callWith("summarize my latest journal entry");
    expect(s.webSearchIntent).toBe(false);
    expect(s.webSearchRecency).toBe(false);
  });
});

describe("deriveTurnSignals · stage timing", () => {
  it("records a classify stage on the injected tracker", async () => {
    const tracker = createStageTracker();
    await deriveTurnSignals({
      userContent: "hello",
      messages: [],
      modeOverride: undefined,
      taskTypeOverride: undefined,
      contentMode: false,
      traceId: "t",
      stageTracker: tracker,
      log: logStub,
    });
    const summary = tracker.summary();
    expect(JSON.stringify(summary)).toContain("classify");
  });
});
