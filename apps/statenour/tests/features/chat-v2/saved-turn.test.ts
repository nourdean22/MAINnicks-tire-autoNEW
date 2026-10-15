/**
 * What the saved record of the latest turn says, for the one case a live bubble
 * cannot answer: a turn that ended in a stream error. ai@6 forwards an error part
 * and keeps going (a later tool-call plus finish(tool-calls) still runs the tool
 * on the server), but the client SDK rethrows on the error chunk, so the live
 * bubble never shows it. Only the saved rows can say, and they are judged by the
 * same gate as any reloaded row.
 */
import { describe, it, expect } from "vitest";
import {
  judgeAfterUnansweredReplay,
  judgeSavedTurn,
  latestTurnRows,
  savedTurnVerdict,
  RETRY_HELD_NO_RECORD,
  RETRY_HELD_RAN,
  RETRY_HELD_UNCONFIRMED,
  RETRY_STILL_CHECKING,
} from "@/features/chat-v2/lib/saved-turn";

const receipt = (toolName: string, sideEffecting: boolean) => ({
  toolName,
  category: "x",
  sideEffecting,
  verifiable: true,
  status: "partial",
  verificationState: "UNKNOWN_COMPLETION",
  entityType: null,
  entityId: null,
});
const assistant = (tokenUsage: unknown, extra: Record<string, unknown> = {}) => ({
  id: "a1",
  role: "assistant",
  content: "Created the task and then",
  streamingState: "errored",
  tokenUsage,
  ...extra,
});

describe("latestTurnRows: the saved rows of the latest turn", () => {
  it("keeps every assistant row after the last user message, and nothing from earlier turns", () => {
    const rows = latestTurnRows([
      { id: "u0", role: "user" },
      assistant({ toolReceipts: [receipt("createTask", true)] }, { id: "old" }),
      { id: "u1", role: "user" },
      assistant({ receiptsUnavailable: true }, { id: "stub" }),
      assistant({ toolReceipts: [] }, { id: "finish" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["stub", "finish"]);
  });

  it("no user message at all: every assistant row counts", () => {
    expect(latestTurnRows([assistant({ toolReceipts: [] })])).toHaveLength(1);
  });

  it("an empty conversation has no rows", () => {
    expect(latestTurnRows([])).toEqual([]);
  });
});

describe("savedTurnVerdict", () => {
  it("safe: the saved row settled to an empty receipts list (nothing ran)", () => {
    expect(savedTurnVerdict([assistant({ toolReceipts: [] })])).toBe("safe");
  });

  it("safe: reads only", () => {
    expect(savedTurnVerdict([assistant({ toolReceipts: [receipt("searchMemories", false)] })])).toBe("safe");
  });

  it("ran: a row lists a write, even a write that the stored flags call harmless (judged by name)", () => {
    expect(savedTurnVerdict([assistant({ toolReceipts: [receipt("createTask", true)] })])).toBe("ran");
    expect(savedTurnVerdict([assistant({ toolReceipts: [receipt("setMit", false)] })])).toBe("ran");
  });

  it("ran: the action block in the saved text", () => {
    const row = assistant({ toolReceipts: [] }, { content: '```action\n{"type":"task.create","params":{}}\n```' });
    expect(savedTurnVerdict([row])).toBe("ran");
  });

  it("unconfirmed: the row is not settled yet (receiptsUnavailable), or there is no saved row, or none was read", () => {
    expect(savedTurnVerdict([assistant({ receiptsUnavailable: true })])).toBe("unconfirmed");
    expect(savedTurnVerdict([])).toBe("unconfirmed");
    expect(savedTurnVerdict(null)).toBe("unconfirmed");
    expect(savedTurnVerdict(undefined)).toBe("unconfirmed");
  });

  it("a stub that settled to [] beside a finish row that lists a write: the write decides", () => {
    const rows = [assistant({ toolReceipts: [] }, { id: "stub" }), assistant({ toolReceipts: [receipt("createTask", true)] }, { id: "finish" })];
    expect(savedTurnVerdict(rows)).toBe("ran");
  });

  it("an unsettled row beside a clean one is unconfirmed, not safe", () => {
    const rows = [assistant({ receiptsUnavailable: true }, { id: "stub" }), assistant({ toolReceipts: [] }, { id: "finish" })];
    expect(savedTurnVerdict(rows)).toBe("unconfirmed");
  });

  it("ran beats unconfirmed: a known write is said plainly", () => {
    const rows = [assistant({ receiptsUnavailable: true }), assistant({ toolReceipts: [receipt("createTask", true)] })];
    expect(savedTurnVerdict(rows)).toBe("ran");
  });

  it("a persisted row with no receipts array at all is unconfirmed (older rows, malformed rows)", () => {
    expect(savedTurnVerdict([assistant(null)])).toBe("unconfirmed");
    expect(savedTurnVerdict([assistant({ traceId: "T0" })])).toBe("unconfirmed");
  });
});

describe("savedTurnVerdict never throws: a row the gate cannot read is unconfirmed", () => {
  it("a null entry in a row's parts", () => {
    expect(savedTurnVerdict([assistant({ toolReceipts: [] }, { parts: [null] })])).toBe("unconfirmed");
  });

  it("a row that is itself null, or a list that is not a list", () => {
    expect(savedTurnVerdict([null as never])).toBe("unconfirmed");
    expect(savedTurnVerdict({ length: 1 } as never)).toBe("unconfirmed");
  });

  it("CONTROL: a well-formed parts array is still judged normally", () => {
    expect(savedTurnVerdict([assistant({ toolReceipts: [] }, { parts: [{ type: "text", text: "Working on it" }] })])).toBe("safe");
  });
});

// A regenerate resends the same user message and persistUserTurn dedupes it, so an older
// attempt's assistant row stays in the latest turn's rows. A safe row from attempt 1 says
// nothing about attempt 2: the verdict needs a saved row that names the attempt that failed.
describe("judgeSavedTurn: safe needs a saved row bound to the attempt that failed", () => {
  const user = { id: "u1", role: "user" };
  const attempt = (trace: string, tokenUsage: Record<string, unknown> = { toolReceipts: [] }, extra: Record<string, unknown> = {}) =>
    assistant({ traceId: trace, ...tokenUsage }, { id: `a-${trace}`, ...extra });

  it("safe: the attempt that failed has its own settled, clean row", () => {
    expect(judgeSavedTurn([user, attempt("T2")], "T2")).toBe("safe");
  });

  it("THE SCENARIO: attempt 1 is clean, attempt 2 is mid-tool and has written nothing yet; Retry must not replay", () => {
    expect(judgeSavedTurn([user, attempt("T1")], "T2")).toBe("unconfirmed");
  });

  it("an older clean attempt beside the failed attempt's own clean row: safe", () => {
    expect(judgeSavedTurn([user, attempt("T1"), attempt("T2")], "T2")).toBe("safe");
  });

  it("an older attempt that listed a write still decides, even when the failed attempt is clean: ran", () => {
    const older = attempt("T1", { toolReceipts: [receipt("createTask", true)] });
    expect(judgeSavedTurn([user, older, attempt("T2")], "T2")).toBe("ran");
  });

  it("the failed attempt's row not settled yet: unconfirmed", () => {
    expect(judgeSavedTurn([user, attempt("T2", { receiptsUnavailable: true })], "T2")).toBe("unconfirmed");
  });

  it("a row with the failed trace but from BEFORE the latest user message is another turn's: unconfirmed", () => {
    expect(judgeSavedTurn([attempt("T2"), { id: "u2", role: "user" }], "T2")).toBe("unconfirmed");
  });

  // The row named T2 is clean and settled, but a newer user message came after it, so it belongs to
  // an earlier turn. The only row in the latest turn (T3) is clean and names another attempt.
  it("DISCRIMINATING: [attempt T2, user u2, attempt T3] judged for T2 is unconfirmed, not safe", () => {
    expect(judgeSavedTurn([attempt("T2"), { id: "u2", role: "user" }, attempt("T3")], "T2")).toBe("unconfirmed");
  });

  it("a clean errored row with NO traceId at all is no proof for any attempt: unconfirmed", () => {
    const unbound = assistant({ toolReceipts: [] }, { id: "old-shape" });
    expect(judgeSavedTurn([user, unbound], "T2")).toBe("unconfirmed");
  });

  it("no trace to bind to (none, empty, not a string) is unconfirmed", () => {
    for (const trace of [null, undefined, "", 7 as never]) {
      expect(judgeSavedTurn([user, attempt("T2")], trace), String(trace)).toBe("unconfirmed");
    }
  });

  it("nothing read, or something that is not a list of rows: unconfirmed", () => {
    expect(judgeSavedTurn(null, "T2")).toBe("unconfirmed");
    expect(judgeSavedTurn([], "T2")).toBe("unconfirmed");
    expect(judgeSavedTurn({ messages: [] } as never, "T2")).toBe("unconfirmed");
  });

  it("a malformed row anywhere in the turn fails closed instead of throwing", () => {
    expect(() => judgeSavedTurn([user, attempt("T2", { toolReceipts: [] }, { parts: [null] })], "T2")).not.toThrow();
    expect(judgeSavedTurn([user, attempt("T2", { toolReceipts: [] }, { parts: [null] })], "T2")).toBe("unconfirmed");
  });
});

// A replay's POST can die before any response header, so the client holds no trace for it. The server
// does not stop when the client disconnects, so that attempt may still run its tools. Unknown means
// refuse: Retry is judged safe only when a LATER attempt (a trace other than the one replayed)
// has a settled clean row, and every row of the turn is clean.
describe("judgeAfterUnansweredReplay: a replay with no response header", () => {
  const user = { id: "u1", role: "user" };
  const attempt = (trace: string, tokenUsage: Record<string, unknown> = { toolReceipts: [] }, extra: Record<string, unknown> = {}) =>
    assistant({ traceId: trace, ...tokenUsage }, { id: `a-${trace}`, ...extra });

  it("safe: a later attempt answered and did nothing", () => {
    expect(judgeAfterUnansweredReplay([user, attempt("T2"), attempt("T3")], "T2")).toBe("safe");
  });

  it("unconfirmed: only the replayed attempt's own row exists (the replay may be running unseen)", () => {
    expect(judgeAfterUnansweredReplay([user, attempt("T2")], "T2")).toBe("unconfirmed");
  });

  it("ran: the later attempt listed a write", () => {
    expect(judgeAfterUnansweredReplay([user, attempt("T2"), attempt("T3", { toolReceipts: [receipt("createTask", true)] })], "T2")).toBe("ran");
  });

  it("unconfirmed: the later attempt's row is not settled yet", () => {
    expect(judgeAfterUnansweredReplay([user, attempt("T2"), attempt("T3", { receiptsUnavailable: true })], "T2")).toBe("unconfirmed");
  });

  it("unconfirmed: a row with no traceId is not a later attempt", () => {
    expect(judgeAfterUnansweredReplay([user, attempt("T2"), assistant({ toolReceipts: [] }, { id: "old-shape" })], "T2")).toBe("unconfirmed");
  });

  it("unconfirmed: a later attempt's row from before the latest user message is another turn's", () => {
    expect(judgeAfterUnansweredReplay([attempt("T3"), { id: "u2", role: "user" }, attempt("T2")], "T2")).toBe("unconfirmed");
  });

  it("unconfirmed: nothing to compare with, nothing read, or not a list; it never throws", () => {
    expect(judgeAfterUnansweredReplay([user, attempt("T3")], null)).toBe("unconfirmed");
    expect(judgeAfterUnansweredReplay([user, attempt("T3")], "")).toBe("unconfirmed");
    expect(judgeAfterUnansweredReplay(null, "T2")).toBe("unconfirmed");
    expect(judgeAfterUnansweredReplay({ messages: [] } as never, "T2")).toBe("unconfirmed");
    expect(judgeAfterUnansweredReplay([user, attempt("T3", { toolReceipts: [] }, { parts: [null] })], "T2")).toBe("unconfirmed");
  });
});

describe("the copy never promises a Retry the gate will refuse", () => {
  const COPIES = [RETRY_HELD_RAN, RETRY_HELD_UNCONFIRMED, RETRY_HELD_NO_RECORD];

  it("names what happened and the next step, with no 'tap Retry to continue' promise", () => {
    for (const copy of COPIES) {
      expect(copy.length).toBeGreaterThan(30);
      expect(copy).not.toMatch(/tap Retry to continue/i);
      expect(copy).toMatch(/send a new message/i);
    }
  });

  // Some holds never clear (the accumulator was untrusted, the settle update failed, a follow-up
  // row, a dropped duplicate row), so the copy asks for one more tap and then names the way out.
  it("the unconfirmed hold asks for one more tap and does not promise it clears", () => {
    expect(RETRY_HELD_UNCONFIRMED).toMatch(/tap Retry again in a moment/i);
    expect(RETRY_HELD_UNCONFIRMED).toMatch(/if it keeps holding, send a new message/i);
    expect(RETRY_HELD_UNCONFIRMED).not.toMatch(/wait a moment and tap/i);
    expect(RETRY_HELD_RAN).not.toMatch(/again/i);
    expect(RETRY_HELD_NO_RECORD).not.toMatch(/again/i);
  });

  it("the still-checking notice is short, plain and ASCII", () => {
    expect(RETRY_STILL_CHECKING.length).toBeGreaterThan(15);
    expect(RETRY_STILL_CHECKING.length).toBeLessThan(80);
    expect(RETRY_STILL_CHECKING).toMatch(/still checking/i);
    expect(RETRY_STILL_CHECKING).toMatch(/^[\x20-\x7e]+$/);
  });

  it("the records are lower bounds, so the copy says 'may', not 'did'", () => {
    expect(RETRY_HELD_RAN).toMatch(/may already have run an action/i);
    expect(RETRY_HELD_RAN).not.toMatch(/already ran an action/i);
  });

  it("is plain ASCII: no em dash, no emoji", () => {
    for (const copy of COPIES) expect(copy).toMatch(/^[\x20-\x7e]+$/);
  });
});
