/**
 * 2026-10-10 · the step-0 toolChoice forces key on the tools actually offered.
 *
 * The Private Lab strip (prepare-tools) removes every non-read-safe tool at any
 * permission, but the force ladder only stood down for a Read turn. A private
 * ask therefore sent tool_choice naming a tool absent from `tools`, and an
 * action ask forced "required" against a read-only set. A force must never name a tool the turn does not
 * offer, and "required" needs a write tool on offer.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/services/chat/stream-error-handler", () => ({ buildStreamErrorHandler: vi.fn(() => vi.fn()) }));
vi.mock("@/lib/services/chat/persist-assistant-turn", () => ({ buildOnFinish: vi.fn(() => vi.fn()) }));
vi.mock("@/lib/ai/chat/repair-tool-call", () => ({ buildRepairToolCall: vi.fn(() => vi.fn()) }));
vi.mock("@/lib/ai/tool-selection-telemetry", () => ({ noteForcedTool: vi.fn() }));

import { buildStreamConfigFactory } from "@/app/api/ai/chat/build-stream-config";

type Step = { toolChoice?: unknown };
function step0(overrides: Record<string, unknown>): Step {
  const build = buildStreamConfigFactory({
    persistBase: { recordTrace: vi.fn() } as never,
    provider: "ollama" as never,
    modelId: "m",
    finalSystemPrompt: "system",
    sanitizedModelMessages: [{ role: "user", content: "hi" }],
    prunedTools: {},
    mode: "standard" as never,
    maxOutputTokens: 1000,
    turnSignal: { kind: "conversational" } as never,
    webSearchIntent: false,
    actionIntent: null,
    actionPermission: "draft",
    privateMode: false,
    convId: "c1",
    conversationId: "conv-1",
    traceId: "t1",
    startedAt: Date.now(),
    firstTokenRef: { value: null },
    partialRef: { text: "" },
    recordTrace: vi.fn() as never,
    resolveOnFinish: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    ...overrides,
  } as never);
  const cfg = build({ modelId: "m" } as never) as unknown as { prepareStep: (a: { stepNumber: number }) => Step };
  return cfg.prepareStep({ stepNumber: 0 });
}

const READS_ONLY = { getTasks: {}, searchMemories: {} };
const WITH_WRITES = { getTasks: {}, createTask: {}, arsenalWebSearch: {} };
const ACTION = { intent: "create_task", expectedTool: "createTask" };

describe("prepareStep forces only name offered tools", () => {
  it("action ask against a read-only tool set: no 'required' force", () => {
    expect(step0({ actionIntent: ACTION, prunedTools: READS_ONLY }).toolChoice).toBeUndefined();
  });
  it("CONTROL · action ask with a write tool offered: 'required'", () => {
    expect(step0({ actionIntent: ACTION, prunedTools: WITH_WRITES }).toolChoice).toBe("required");
  });

  it("web ask with arsenalWebSearch absent: no web pin; present: pinned", () => {
    expect(step0({ webSearchIntent: true, prunedTools: READS_ONLY }).toolChoice).toBeUndefined();
    expect(step0({ webSearchIntent: true, prunedTools: WITH_WRITES }).toolChoice).toEqual({
      type: "tool",
      toolName: "arsenalWebSearch",
    });
  });

  it("CONTROL · Read permission still stands every mutating force down, even with writes offered", () => {
    expect(step0({ actionPermission: "read", actionIntent: ACTION, prunedTools: WITH_WRITES }).toolChoice).toBeUndefined();
  });
});
