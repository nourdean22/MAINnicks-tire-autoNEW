/**
 * tests/features/chat-v2/turn-lifecycle.test.ts · task B6 (audit 04-F2, 04-F6, 04-F8, 09-F29).
 *
 * The two client decisions that used to be missing:
 *   · bindPersistedMessage: when `message.persisted` arrived, nothing bound
 *     the streamed bubble to its DB row, so message actions held a client id
 *     and the bubble kept the raw stream text instead of the stored text.
 *   · stopTurn: Stop only aborted the client reader. The server never learned
 *     the operator stopped, and the turn persisted as "complete".
 */
import { describe, it, expect, vi } from "vitest";
import {
  bindPersistedMessage,
  stopTurn,
  stoppedLabel,
} from "@/features/chat-v2/lib/turn-lifecycle";

type Msg = { id: string; role: string; parts: Array<Record<string, unknown> & { type: string }> };

const user: Msg = { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] };

describe("bindPersistedMessage", () => {
  it("binds the streamed bubble to the DB id and replaces its text with the stored text", () => {
    const streamed: Msg = { id: "client-abc", role: "assistant", parts: [{ type: "text", text: "raw stream" }] };
    const out = bindPersistedMessage([user, streamed], { id: "row_1", content: "[banner] raw stream" });

    expect(out[1].id).toBe("row_1");
    expect(out[1].parts).toEqual([{ type: "text", text: "[banner] raw stream", state: "done" }]);
    expect(out[0]).toBe(user);
  });

  it("keeps tool, reasoning and file parts; all streamed text collapses into the one stored text", () => {
    const tool = { type: "tool-search", state: "output-available", output: { hits: 1 } };
    const streamed: Msg = {
      id: "client-abc",
      role: "assistant",
      parts: [{ type: "text", text: "step 1" }, tool, { type: "text", text: "step 2" }],
    };
    const out = bindPersistedMessage([user, streamed], { id: "row_1", content: "step 1\nstep 2" });
    expect(out[1].parts).toEqual([{ type: "text", text: "step 1\nstep 2", state: "done" }, tool]);
  });

  it("a resumed turn (resume-<conv>-<traceId>) takes the DB id too (04-F8)", () => {
    const resumed: Msg = { id: "resume-conv-1-T1", role: "assistant", parts: [{ type: "text", text: "x" }] };
    expect(bindPersistedMessage([user, resumed], { id: "row_9", content: "x" })[1].id).toBe("row_9");
  });

  it("appends the stored text when the bubble streamed no text part", () => {
    const tool = { type: "tool-search", state: "output-available" };
    const streamed: Msg = { id: "c", role: "assistant", parts: [tool] };
    const out = bindPersistedMessage([user, streamed], { id: "row_1", content: "done" });
    expect(out[1].parts).toEqual([tool, { type: "text", text: "done", state: "done" }]);
  });

  it("never rewrites an OLDER reply when the last message is the operator's", () => {
    const older: Msg = { id: "row_0", role: "assistant", parts: [{ type: "text", text: "old" }] };
    const messages = [user, older, { ...user, id: "u2" }];
    expect(bindPersistedMessage(messages, { id: "row_1", content: "new" })).toBe(messages);
  });
});

describe("stopTurn", () => {
  it("sends DELETE /api/ai/chat/<conv>/stream BEFORE aborting the client stream", async () => {
    const order: string[] = [];
    const fetchImpl = vi.fn(async () => {
      order.push("delete");
      return new Response(JSON.stringify({ stopped: true, traceId: "T1" }), { status: 200 });
    });
    const abort = vi.fn(() => order.push("abort"));

    const outcome = await stopTurn({ conversationId: "conv 1", abort, fetchImpl });

    expect(order).toEqual(["delete", "abort"]);
    expect(fetchImpl).toHaveBeenCalledWith("/api/ai/chat/conv%201/stream", {
      method: "DELETE",
      credentials: "same-origin",
    });
    expect(outcome).toBe("stopped");
  });

  it("a 409 (nothing marked) still aborts locally and reports unconfirmed", async () => {
    const abort = vi.fn();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ stopped: false }), { status: 409 }));
    await expect(stopTurn({ conversationId: "c", abort, fetchImpl })).resolves.toBe("unconfirmed");
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it("a network failure still aborts locally and reports unconfirmed", async () => {
    const abort = vi.fn();
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(stopTurn({ conversationId: "c", abort, fetchImpl })).resolves.toBe("unconfirmed");
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it("no conversation id (private, or not assigned yet) aborts without a request", async () => {
    const abort = vi.fn();
    const fetchImpl = vi.fn();
    await expect(stopTurn({ conversationId: null, abort, fetchImpl })).resolves.toBe("unconfirmed");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledTimes(1);
  });
});

describe("stoppedLabel", () => {
  // DELETE only records the stop; consumeStream keeps the model and its
  // tools running (route.ts DELETE docstring), so no label may claim a halt.
  it("never claims the server halted, even when the stop was recorded", () => {
    expect(stoppedLabel("pending")).toBe("Stopped here; Nick finishes in the background");
    expect(stoppedLabel("stopped")).toBe("Stopped here; Nick finishes in the background");
  });

  it("also says the stop was not recorded when the DELETE failed", () => {
    expect(stoppedLabel("unconfirmed")).toBe("Stopped here; Nick finishes in the background, stop not recorded");
  });
});
