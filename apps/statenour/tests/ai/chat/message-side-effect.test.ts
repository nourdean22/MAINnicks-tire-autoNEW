/**
 * messageMayHaveWritten - the one "would a replay repeat an action?" judgement, shared by the
 * client's Retry gate (turnHasSideEffect) and the server's turn guard (2026-10-15). The client's
 * own suites (use-chat-stream-glue, chat-resume-regenerate-gate, fast-path-receipts-marker) pin
 * the behaviour through the wrapper; this pins the lifted function directly, and the wrapper's one
 * addition, so a change to either side cannot slip past the other.
 */
import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { messageMayHaveWritten } from "@/lib/ai/chat/message-side-effect";
import { turnHasSideEffect } from "@/features/chat-v2/lib/turn-side-effect";

const receipt = (toolName: string, sideEffecting: boolean, verifiable = true) => ({ toolName, category: "x", sideEffecting, verifiable, status: "success" });
const row = (over: Record<string, unknown> = {}) =>
  ({ id: "a1", role: "assistant", parts: [{ type: "text", text: "All good." }], streamingState: "complete", tokenUsage: { toolReceipts: [] }, ...over }) as unknown as UIMessage;

describe("messageMayHaveWritten", () => {
  it("an empty receipts array is the one honest 'no SDK tool ran'", () => {
    expect(messageMayHaveWritten(row())).toBe(false);
  });

  it("a reviewed read-only receipt does not count", () => {
    expect(messageMayHaveWritten(row({ tokenUsage: { toolReceipts: [receipt("searchMemories", false)] } }))).toBe(false);
  });

  it.each([
    ["a side-effecting receipt", { tokenUsage: { toolReceipts: [receipt("createTask", true)] } }],
    ["a receipt flagged read-only on the day it was written but a writer by name now", { tokenUsage: { toolReceipts: [receipt("setMit", false)] } }],
    ["an unverifiable receipt", { tokenUsage: { toolReceipts: [receipt("searchMemories", false, false)] } }],
    ["a malformed receipt", { tokenUsage: { toolReceipts: [null] } }],
    ["a receipts value that is not an array", { tokenUsage: { toolReceipts: "none" } }],
    ["a row that says it cannot vouch (errored writer)", { tokenUsage: { traceId: "t", receiptsUnavailable: true } }],
    ["a persisted row with no receipts array (fast path, old row)", { tokenUsage: {} }],
    ["a bubble whose start chunk says receipts are unavailable", { tokenUsage: undefined, streamingState: undefined, metadata: { receiptsUnavailable: true } }],
    ["an action block in the reply text", { parts: [{ type: "text", text: 'Done.\n```action\n{"type":"task.create","params":{}}\n```' }] }],
    ["an action block only in reasoning", { parts: [{ type: "reasoning", text: '```action\n{"type":"task.create","params":{}}\n```' }] }],
    ["a live write-tool part", { tokenUsage: undefined, streamingState: undefined, parts: [{ type: "tool-createTask", state: "output-available" }] }],
    ["a live tool part the registry does not know", { tokenUsage: undefined, streamingState: undefined, parts: [{ type: "tool-notInTheCatalog", state: "output-available" }] }],
  ])("%s counts as a possible write", (_name, over) => {
    expect(messageMayHaveWritten(row(over))).toBe(true);
  });
});

describe("turnHasSideEffect (the client wrapper)", () => {
  it("agrees with the shared judgement for an ordinary bubble", () => {
    const clean = row();
    const wrote = row({ tokenUsage: { toolReceipts: [receipt("createTask", true)] } });
    expect(turnHasSideEffect(clean)).toBe(messageMayHaveWritten(clean));
    expect(turnHasSideEffect(wrote)).toBe(messageMayHaveWritten(wrote));
  });

  it("adds exactly one signal of its own: a resumed bubble holds replayed text only, so it counts as a write", () => {
    const resumed = row({ metadata: { resumed: true } });
    expect(messageMayHaveWritten(resumed)).toBe(false);
    expect(turnHasSideEffect(resumed)).toBe(true);
  });
});
