/**
 * What the saved record of the latest turn says, for the one case a live bubble
 * cannot answer: a turn that ended in a stream error. ai@6 forwards an error part
 * and keeps going (a later tool-call plus finish(tool-calls) still runs the tool
 * on the server), but the client SDK rethrows on the error chunk, so the live
 * bubble never shows it. Only the saved rows can say, and they are judged by the
 * same gate as any reloaded row.
 */
import { describe, it, expect } from "vitest";
import { latestTurnRows, savedTurnVerdict, RETRY_HELD_RAN, RETRY_HELD_UNCONFIRMED } from "@/features/chat-v2/lib/saved-turn";

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

describe("the copy never promises a Retry the gate will refuse", () => {
  it("names what happened and the next step, with no 'tap Retry to continue' promise", () => {
    for (const copy of [RETRY_HELD_RAN, RETRY_HELD_UNCONFIRMED]) {
      expect(copy.length).toBeGreaterThan(30);
      expect(copy).not.toMatch(/tap Retry to continue/i);
    }
    expect(RETRY_HELD_RAN).toMatch(/send a new message/i);
    expect(RETRY_HELD_UNCONFIRMED).toMatch(/send a new message/i);
    expect(RETRY_HELD_UNCONFIRMED).toMatch(/again/i);
  });
});
