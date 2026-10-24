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
import { describe, it, expect, vi } from "vitest";
import { createInFlightToolCalls, terminateWhenDrained } from "@/lib/services/chat/in-flight-tool-calls";

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
  it("a stream that has shown no tool chunk so far lists none, and says it is not final", () => {
    expect(observed()).toEqual({ trustworthy: true, terminal: false, receipts: [] });
    expect(observed({ type: "text-delta", id: "t1", text: "Hello" })).toEqual({ trustworthy: true, terminal: false, receipts: [] });
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

  it.each(["setMit", "clearMit"])("a tool-call for %s, which writes without a write flag, is recorded as a write", (toolName) => {
    expect(trustedRows(call(toolName))[0]).toMatchObject({ toolName, sideEffecting: true });
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

  // An SDK event-shape change (a renamed `type`, a wrapped chunk) must not turn
  // into a trustworthy [] that reads as "nothing ran".
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "tool-call"],
    ["a number", 42],
    ["an object with no type", {}],
    ["an object whose type is not a string", { type: 7 }],
  ])("a chunk it cannot read (%s) makes the snapshot stop vouching, and never throws", (_label, chunk) => {
    const acc = createInFlightToolCalls();
    expect(() => acc.observe(chunk)).not.toThrow();
    expect(acc.snapshot()).toEqual({ trustworthy: false });
  });

  it("CONTROL: readable non-tool chunks (text, reasoning, source, raw) keep it trustworthy", () => {
    const snap = observed(
      { type: "text-delta", id: "t1", text: "Hello" },
      { type: "reasoning-delta", id: "r1", text: "hm" },
      { type: "source", sourceType: "url", id: "s1", url: "https://example.com" },
      { type: "raw", rawValue: {} },
    );
    expect(snap.trustworthy).toBe(true);
  });
});

describe("terminal state: the record is final only once the stream has ended", () => {
  it("a snapshot is not terminal until terminate() runs, then it is", () => {
    const acc = createInFlightToolCalls();
    acc.observe(call("createTask"));
    expect(acc.snapshot()).toMatchObject({ trustworthy: true, terminal: false });
    void acc.terminate();
    expect(acc.snapshot()).toMatchObject({ trustworthy: true, terminal: true });
  });

  it("afterTerminal callbacks wait for terminate(), run once, and run at once when already terminal", async () => {
    const acc = createInFlightToolCalls();
    const early = vi.fn();
    acc.afterTerminal(early);
    expect(early).not.toHaveBeenCalled();

    await acc.terminate();
    await acc.terminate();
    expect(early).toHaveBeenCalledTimes(1);

    const late = vi.fn();
    acc.afterTerminal(late);
    await Promise.resolve();
    expect(late).toHaveBeenCalledTimes(1);
  });

  it("a callback that throws or rejects neither stops the others nor breaks terminate()", async () => {
    const acc = createInFlightToolCalls();
    const after = vi.fn();
    acc.afterTerminal(() => {
      throw new Error("sync boom");
    });
    acc.afterTerminal(() => Promise.reject(new Error("async boom")));
    acc.afterTerminal(after);

    await expect(acc.terminate()).resolves.toBeUndefined();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("an untrustworthy snapshot stays untrustworthy after terminate()", async () => {
    const acc = createInFlightToolCalls();
    acc.observe(result("createTask"));
    await acc.terminate();
    expect(acc.snapshot()).toEqual({ trustworthy: false });
  });
});

describe("terminateWhenDrained: the route marks the record final when the stream is drained", () => {
  it("terminates after the drain promise resolves, not before", async () => {
    const acc = createInFlightToolCalls();
    let finish!: () => void;
    terminateWhenDrained(acc, new Promise<void>((resolve) => (finish = resolve)));
    expect(acc.snapshot()).toMatchObject({ terminal: false });

    finish();
    await new Promise((r) => setTimeout(r, 0));
    expect(acc.snapshot()).toMatchObject({ terminal: true });
  });

  it("no drain promise (a stub result without consumeStream): never terminal, so an errored row keeps saying unavailable", async () => {
    const acc = createInFlightToolCalls();
    terminateWhenDrained(acc, undefined);
    await new Promise((r) => setTimeout(r, 0));
    expect(acc.snapshot()).toMatchObject({ terminal: false });
  });

  it("a drain that rejects is not proof the stream ended: stays non-terminal", async () => {
    const acc = createInFlightToolCalls();
    terminateWhenDrained(acc, Promise.reject(new Error("drain failed")));
    await new Promise((r) => setTimeout(r, 0));
    expect(acc.snapshot()).toMatchObject({ terminal: false });
  });
});

describe('terminateWhenDrained: the promise it returns', () => {
  it('resolves only after the callbacks waiting on the final record have finished', async () => {
    const acc = createInFlightToolCalls();
    let finish!: () => void;
    let settleRow!: () => void;
    acc.afterTerminal(() => new Promise<void>((resolve) => (settleRow = resolve)));
    const done = terminateWhenDrained(acc, new Promise<void>((resolve) => (finish = resolve)));
    const state = () => Promise.race([done.then(() => 'done'), new Promise((r) => setTimeout(() => r('pending'), 10))]);

    expect(await state()).toBe('pending'); // stream still open
    finish();
    expect(await state()).toBe('pending'); // drained, row not settled yet
    settleRow();
    expect(await state()).toBe('done');
  });

  it('never rejects: a failed drain, a missing drain and a throwing callback all resolve', async () => {
    const acc = createInFlightToolCalls();
    await expect(terminateWhenDrained(acc, Promise.reject(new Error('drain failed')))).resolves.toBeUndefined();
    await expect(terminateWhenDrained(acc, undefined)).resolves.toBeUndefined();

    const other = createInFlightToolCalls();
    other.afterTerminal(() => {
      throw new Error('settle failed');
    });
    await expect(terminateWhenDrained(other, Promise.resolve())).resolves.toBeUndefined();
  });
});
