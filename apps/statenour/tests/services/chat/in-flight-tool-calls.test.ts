/**
 * The accumulator behind the errored-turn receipts. It watches the chunks
 * streamText hands onChunk, so when the stream dies the errored row can say
 * which tools were started. The rule it exists to keep: a call that never
 * produced a result is ATTEMPTED, not "finished with no effect", and anything
 * the accumulator cannot vouch for makes the whole snapshot untrustworthy.
 *
 * Chunk shapes are the ai@6 ones (node_modules/ai/dist/index.d.ts
 * StreamTextOnChunkCallback): tool-call and tool-result carry toolCallId and
 * toolName; tool-input-start carries id and toolName; tool-error never reaches
 * onChunk but is handled in case a later SDK delivers it.
 */
import { describe, it, expect } from "vitest";
import { createInFlightToolCalls } from "@/lib/services/chat/in-flight-tool-calls";

const call = (toolName: string, toolCallId = "c1") => ({ type: "tool-call", toolCallId, toolName, input: { title: "Call Mike" } });
const result = (toolName: string, toolCallId = "c1") => ({ type: "tool-result", toolCallId, toolName, output: { ok: true } });

function observed(...chunks: unknown[]) {
  const acc = createInFlightToolCalls();
  for (const c of chunks) acc.observe(c);
  return acc.snapshot();
}

function trustedRows(...chunks: unknown[]) {
  const snap = observed(...chunks);
  if (!snap.trustworthy) throw new Error("expected a trustworthy snapshot");
  return snap.receipts;
}

describe("a trustworthy snapshot", () => {
  it("a stream that showed no tool chunk records zero tools: the only case where [] is honest", () => {
    expect(observed()).toEqual({ trustworthy: true, receipts: [] });
    expect(observed({ type: "text-delta", id: "t1", text: "Hello" })).toEqual({ trustworthy: true, receipts: [] });
  });

  it("a tool whose input was still streaming never ran, so it is not a receipt", () => {
    const rows = trustedRows(
      { type: "tool-input-start", id: "c1", toolName: "createTask" },
      { type: "tool-input-delta", id: "c1", delta: '{"title":"Ca' },
    );
    expect(rows).toEqual([]);
  });

  it("a tool-call with no result is ATTEMPTED: a write by the classifier, unverified, never 'finished'", () => {
    const [row] = trustedRows(call("createTask"));
    expect(row).toMatchObject({
      toolName: "createTask",
      category: "personal_write",
      sideEffecting: true,
      verifiable: true,
      status: "partial",
      verificationState: "UNKNOWN_COMPLETION",
    });
  });

  it("the effect class comes from the classifier, not from whether a result arrived", () => {
    const withoutResult = trustedRows(call("createTask"));
    const withResult = trustedRows(call("createTask"), result("createTask"));
    expect(withResult).toEqual(withoutResult);
    expect(withResult).toHaveLength(1);
    expect(withResult[0].status).toBe("partial");
  });

  it("a read tool is recorded as a read", () => {
    const [row] = trustedRows(call("searchMemories"), result("searchMemories"));
    expect(row).toMatchObject({ toolName: "searchMemories", sideEffecting: false, verifiable: true });
  });

  it("a tool the classifier cannot place is recorded as unverifiable, which the Retry gate treats as a write", () => {
    const [row] = trustedRows(call("notInTheCatalog"));
    expect(row).toMatchObject({ toolName: "notInTheCatalog", verifiable: false });
  });

  it("two calls to the same tool with different ids are two attempts", () => {
    expect(trustedRows(call("createTask", "c1"), call("createTask", "c2"))).toHaveLength(2);
  });

  it("a repeated tool-call chunk for the same id is one attempt", () => {
    expect(trustedRows(call("createTask", "c1"), call("createTask", "c1"))).toHaveLength(1);
  });

  it("a tool-error for a known call keeps the snapshot trustworthy", () => {
    const snap = observed(call("createTask"), { type: "tool-error", toolCallId: "c1", toolName: "createTask", error: "boom" });
    expect(snap.trustworthy).toBe(true);
  });
});

describe("an untrustworthy snapshot: the writer must not claim anything", () => {
  it.each([
    ["a result for a call it never saw", [result("createTask")]],
    ["a tool-call with no toolCallId", [{ type: "tool-call", toolName: "createTask" }]],
    ["a tool-call with no toolName", [{ type: "tool-call", toolCallId: "c1" }]],
    ["one id used for two different tools", [call("createTask", "c1"), call("pinMemory", "c1")]],
    ["a tool part type it does not recognise", [call("searchMemories"), { type: "tool-approval-request", toolCallId: "c9" }]],
    ["a tool-error for a call it never saw", [{ type: "tool-error", toolCallId: "c7", toolName: "createTask" }]],
  ])("%s", (_label, chunks) => {
    expect(observed(...chunks)).toEqual({ trustworthy: false });
  });

  it("stays untrustworthy once it has been: a later clean chunk does not restore it", () => {
    const acc = createInFlightToolCalls();
    acc.observe(result("createTask"));
    acc.observe(call("searchMemories", "c2"));
    expect(acc.snapshot()).toEqual({ trustworthy: false });
  });

  it("a chunk that throws when read does not break the stream; the snapshot stops vouching", () => {
    const acc = createInFlightToolCalls();
    const hostile = {
      get type(): string {
        throw new Error("getter blew up");
      },
    };
    expect(() => acc.observe(hostile)).not.toThrow();
    expect(acc.snapshot()).toEqual({ trustworthy: false });
  });

  it("never throws on a malformed chunk; ignores what is not a tool part", () => {
    const acc = createInFlightToolCalls();
    expect(() => {
      acc.observe(undefined);
      acc.observe(null);
      acc.observe("tool-call");
      acc.observe(42);
      acc.observe({});
    }).not.toThrow();
    expect(acc.snapshot()).toEqual({ trustworthy: true, receipts: [] });
  });
});
