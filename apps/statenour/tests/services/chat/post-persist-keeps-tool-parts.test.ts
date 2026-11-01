/**
 * B1 (2026-11-01): the L2 fabrication patch rebuilds the stored row's `parts`. Before B1 that was
 * harmless (the row held text only); now it must carry the turn's tool parts forward, or a
 * bannered reply would lose its cards on reload exactly when they matter most. Drives the real
 * runPostPersistVerification against a recording prisma. Synthetic prose.
 */
import { describe, it, expect, vi } from "vitest";

const db = vi.hoisted(() => {
  const updates: Array<{ data: { parts?: Array<{ type: string }> } }> = [];
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method) => {
          if (typeof method !== "string" || method === "then") return undefined;
          return (args: never) => {
            if (name === "chatMessage" && method === "update") updates.push(args);
            return Promise.resolve(null);
          };
        },
      },
    );
  const prisma = new Proxy({}, { get: (_t, name) => (typeof name === "string" && name !== "then" ? model(name) : undefined) });
  return { updates, prisma };
});
vi.mock("@/lib/prisma", () => ({ prisma: db.prisma }));
vi.mock("@/lib/errors/record-error", () => ({ withErrorCapture: vi.fn() }));
vi.mock("@/lib/ai/track", () => ({ trackGeneration: vi.fn() }));

import { runPostPersistVerification } from "@/lib/services/chat/post-persist-verification";

const toolPart = { type: "tool-invokeTool" as const, toolCallId: "c1", input: { name: "getSleepSummary" }, state: "output-error" as const, errorText: "Tool execution failed" };

function input(toolParts?: unknown[]) {
  return {
    cleanedText: "Your sleep streak is five days.",
    reasoningText: "",
    createdAssistantId: "m1",
    capturedToolCalls: [
      { name: "invokeTool", ok: false, durationMs: 900, args: { name: "getSleepSummary", args: {} }, resultObserved: true },
    ],
    toolParts,
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
    log: { info: vi.fn(), warn: vi.fn() },
  } as never;
}

describe("the L2 banner patch keeps the row's tool parts", () => {
  it("the patched parts hold the tool card, then the bannered text", async () => {
    db.updates.length = 0;
    await runPostPersistVerification(input([toolPart]));
    const parts = db.updates.at(-1)?.data.parts ?? [];
    expect(parts.map((p) => p.type)).toEqual(["tool-invokeTool", "text"]);
  });

  it("POSITIVE CONTROL: the patch did fire (a row with no tool parts is patched to text only)", async () => {
    db.updates.length = 0;
    await runPostPersistVerification(input());
    expect(db.updates.at(-1)?.data.parts?.map((p) => p.type)).toEqual(["text"]);
  });
});
