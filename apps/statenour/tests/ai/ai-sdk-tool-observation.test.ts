import { describe, expect, it } from "vitest";
import { normalizeAiSdkToolObservations } from "@/lib/ai/chat/ai-sdk-tool-observation";

describe("AI SDK tool observation compatibility", () => {
  it("normalizes the app's AI SDK 6-style result/args shape", () => {
    const [obs] = normalizeAiSdkToolObservations({
      steps: [
        {
          toolResults: [
            {
              toolName: "createTask",
              toolCallId: "tc_1",
              args: { title: "Call vendor" },
              result: { id: "task-1", ok: true },
              executionDurationMs: 17,
            },
          ],
        },
      ],
    });

    expect(obs).toEqual(
      expect.objectContaining({
        toolName: "createTask",
        toolCallId: "tc_1",
        input: { title: "Call vendor" },
        output: { id: "task-1", ok: true },
        outputObserved: true,
        durationMs: 17,
        shape: "sdk6-result",
        source: "tool-result",
      }),
    );
  });

  it("normalizes AI SDK 7-style output/input without losing evidence", () => {
    const [obs] = normalizeAiSdkToolObservations({
      steps: [
        {
          toolResults: [
            {
              toolName: "createTask",
              toolCallId: "tc_7",
              input: { title: "Call vendor" },
              output: { id: "task-7", ok: true },
              durationMs: 9,
            },
          ],
        },
      ],
    });

    expect(obs).toEqual(
      expect.objectContaining({
        toolName: "createTask",
        toolCallId: "tc_7",
        input: { title: "Call vendor" },
        output: { id: "task-7", ok: true },
        outputObserved: true,
        durationMs: 9,
        shape: "sdk7-output",
        source: "tool-result",
      }),
    );
  });

  it("treats an explicit null output as observed terminal evidence", () => {
    const [obs] = normalizeAiSdkToolObservations({
      steps: [{ toolResults: [{ toolName: "getTasks", output: null }] }],
    });

    expect(obs.outputObserved).toBe(true);
    expect(obs.output).toBeNull();
  });

  it("treats isError:true tool results as known failure evidence", () => {
    const [obs] = normalizeAiSdkToolObservations({
      steps: [
        {
          toolResults: [
            {
              toolName: "createTask",
              toolCallId: "tc_error_flag",
              input: { title: "X" },
              output: "provider rejected write",
              isError: true,
            },
          ],
        },
      ],
    });

    expect(obs).toEqual(
      expect.objectContaining({
        toolName: "createTask",
        toolCallId: "tc_error_flag",
        outputObserved: true,
        output: "provider rejected write",
        error: "provider rejected write",
        shape: "sdk7-output",
      }),
    );
  });

  it("normalizes a content-only tool-error as terminal known failure", () => {
    const [obs] = normalizeAiSdkToolObservations({
      steps: [
        {
          content: [
            {
              type: "tool-error",
              toolName: "createTask",
              toolCallId: "tc_failed",
              input: { title: "X" },
              error: "database unavailable",
            },
          ],
        },
      ],
    });

    expect(obs).toEqual(
      expect.objectContaining({
        toolName: "createTask",
        toolCallId: "tc_failed",
        input: { title: "X" },
        outputObserved: false,
        error: "database unavailable",
        source: "tool-error",
        shape: "tool-error-part",
      }),
    );
  });

  it("hydrates tool-error metadata from its matching tool call", () => {
    const [obs] = normalizeAiSdkToolObservations({
      steps: [
        {
          toolCalls: [
            {
              toolName: "createTask",
              toolCallId: "tc_hydrate",
              input: { title: "Call John" },
              durationMs: 11,
            },
          ],
          content: [
            {
              type: "tool-error",
              toolCallId: "tc_hydrate",
              error: { message: "write failed" },
            },
          ],
        },
      ],
    });

    expect(obs).toEqual(
      expect.objectContaining({
        toolName: "createTask",
        toolCallId: "tc_hydrate",
        input: { title: "Call John" },
        durationMs: 11,
        error: { message: "write failed" },
        source: "tool-error",
      }),
    );
  });

  it("tool-error beats a same-id result instead of double-counting the operation", () => {
    const observations = normalizeAiSdkToolObservations({
      steps: [
        {
          toolResults: [
            {
              toolName: "createTask",
              toolCallId: "tc_conflict",
              output: { id: "task-maybe" },
            },
          ],
          content: [
            {
              type: "tool-error",
              toolName: "createTask",
              toolCallId: "tc_conflict",
              error: "transaction rolled back",
            },
          ],
        },
      ],
    });

    expect(observations).toHaveLength(1);
    expect(observations[0]).toEqual(
      expect.objectContaining({
        toolCallId: "tc_conflict",
        error: "transaction rolled back",
        shape: "tool-error-part",
      }),
    );
  });

  it("retains call-only activity as ambiguous completion", () => {
    const [obs] = normalizeAiSdkToolObservations({
      steps: [
        {
          toolCalls: [
            { toolName: "createTask", toolCallId: "tc_pending", input: { title: "X" } },
          ],
        },
      ],
    });

    expect(obs).toEqual(
      expect.objectContaining({
        toolName: "createTask",
        toolCallId: "tc_pending",
        outputObserved: false,
        shape: "call-only",
        source: "tool-call",
      }),
    );
  });

  it("preserves an unmatched call when another tool in the step has a result", () => {
    const observations = normalizeAiSdkToolObservations({
      steps: [
        {
          toolCalls: [
            { toolName: "getTasks", toolCallId: "tc_read", input: {} },
            { toolName: "createTask", toolCallId: "tc_write", input: { title: "X" } },
          ],
          toolResults: [
            { toolName: "getTasks", toolCallId: "tc_read", output: { tasks: [] } },
          ],
        },
      ],
    });

    expect(observations).toHaveLength(2);
    expect(observations[0]).toEqual(
      expect.objectContaining({ toolCallId: "tc_read", outputObserved: true }),
    );
    expect(observations[1]).toEqual(
      expect.objectContaining({
        toolCallId: "tc_write",
        outputObserved: false,
        source: "tool-call",
      }),
    );
  });

  it("keeps a successful read and a failed write from the same step distinct", () => {
    const observations = normalizeAiSdkToolObservations({
      steps: [
        {
          toolCalls: [
            { toolName: "getTasks", toolCallId: "tc_read", input: {} },
            { toolName: "createTask", toolCallId: "tc_write", input: { title: "X" } },
          ],
          toolResults: [
            { toolName: "getTasks", toolCallId: "tc_read", output: { tasks: [] } },
          ],
          content: [
            {
              type: "tool-error",
              toolCallId: "tc_write",
              error: "write denied",
            },
          ],
        },
      ],
    });

    expect(observations).toHaveLength(2);
    expect(observations[0]).toEqual(
      expect.objectContaining({ toolCallId: "tc_read", error: undefined }),
    );
    expect(observations[1]).toEqual(
      expect.objectContaining({
        toolCallId: "tc_write",
        toolName: "createTask",
        error: "write denied",
        source: "tool-error",
      }),
    );
  });
});
