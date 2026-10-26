/**
 * 2026-10-26 · the consumer end of envFailureClaims' read arm.
 *
 * The read arm needs the failed call's target (invokeTool's `name`), which only
 * capturedToolCalls carries; the verifier results hold the tool name alone. This
 * drives the real runPostPersistVerification so a caller that stops handing the
 * calls over goes red here, not just in the detector's unit tests. Synthetic prose.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/errors/record-error", () => ({ withErrorCapture: vi.fn() }));
vi.mock("@/lib/ai/track", () => ({ trackGeneration: vi.fn() }));

import { runPostPersistVerification } from "@/lib/services/chat/post-persist-verification";

function args(cleanedText: string, target: string) {
  const log = { info: vi.fn(), warn: vi.fn() };
  return {
    log,
    input: {
      cleanedText,
      reasoningText: "",
      createdAssistantId: null,
      capturedToolCalls: [
        { name: "invokeTool", ok: false, durationMs: 900, args: { name: target, args: {} }, resultObserved: true },
      ],
      envVerification: [{ toolName: "invokeTool", verified: false, reason: "Tool execution failed" }],
      usage: undefined,
      convId: undefined,
      traceId: "t1",
      provider: "ollama",
      modelId: "fake-model",
      mode: "standard",
      personality: "default",
      finalTaskType: "chat",
      userContent: "a synthetic question",
      turnSignal: { intent: "question", outputShape: "short" },
      contextBlocksFired: {},
      deeperContextCount: 0,
      deeperContextTypes: [],
      startedAt: Date.now(),
      firstTokenRef: { value: null },
      critic: null,
      recordTrace: vi.fn(),
      log,
    } as never,
  };
}

describe("runPostPersistVerification hands the failed read's target to the claim check", () => {
  it("an invented sleep result after a failed sleep read gets the verifier banner", async () => {
    const { input, log } = args("Your sleep streak is five days.", "getSleepSummary");
    const out = await runPostPersistVerification(input);

    expect(log.warn).toHaveBeenCalledWith("action_claim_without_tools", expect.objectContaining({ claims: 1 }));
    expect(out.cleanedText).not.toBe("Your sleep streak is five days.");
  });

  it("CONTROL · the same reply after a failed read of an unrelated target is left alone", async () => {
    const { input, log } = args("Your sleep streak is five days.", "searchEmails");
    const out = await runPostPersistVerification(input);

    expect(log.warn).not.toHaveBeenCalledWith("action_claim_without_tools", expect.anything());
    expect(out.cleanedText).toBe("Your sleep streak is five days.");
  });
});
