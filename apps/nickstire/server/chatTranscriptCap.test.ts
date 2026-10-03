/**
 * chat_sessions.messagesJson must never be written over its column limit
 * (2026-10-03).
 *
 * chat.ts stores JSON.stringify of the WHOLE conversation every turn. The
 * column was TEXT (64 KB); TiDB's STRICT_TRANS_TABLES rejects an over-width
 * write, so a long chat lost its transcript (chat.ts catches and still
 * replies, so the loss was silent). 0142 widens it to MEDIUMTEXT and
 * serializeTranscript caps the write at that limit, dropping the OLDEST
 * messages first.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { serializeTranscript } from "./lib/chatTranscript";

const MEDIUMTEXT_MAX_BYTES = 16_777_215;

const msg = (role: string, content: string) => ({ role, content });

describe("serializeTranscript", () => {
  it("under the limit: byte-identical to JSON.stringify, nothing dropped", () => {
    const m = [msg("user", "hi"), msg("assistant", "hello")];
    expect(serializeTranscript(m)).toEqual({ json: JSON.stringify(m), droppedMessages: 0, truncatedNewest: false });
  });

  it("over the limit: drops the OLDEST messages and keeps the newest", () => {
    const m = [msg("user", "a".repeat(40)), msg("assistant", "b".repeat(40)), msg("user", "c".repeat(40))];
    const max = JSON.stringify(m.slice(1)).length; // room for the newest two only
    const out = serializeTranscript(m, max);
    expect(out.droppedMessages).toBe(1);
    expect(out.truncatedNewest).toBe(false);
    expect(JSON.parse(out.json)).toEqual(m.slice(1));
  });

  it("measures BYTES, not characters (multi-byte text)", () => {
    const m = [msg("user", "é".repeat(30)), msg("assistant", "é".repeat(30))];
    const charLen = JSON.stringify(m).length;
    // Fits by character count, not by UTF-8 byte count.
    const out = serializeTranscript(m, charLen);
    expect(Buffer.byteLength(out.json, "utf8")).toBeLessThanOrEqual(charLen);
    expect(out.droppedMessages).toBe(1);
  });

  it("a single newest message over the limit is shortened, never rejected", () => {
    const out = serializeTranscript([msg("assistant", "x".repeat(1000))], 200);
    expect(Buffer.byteLength(out.json, "utf8")).toBeLessThanOrEqual(200);
    expect(out.truncatedNewest).toBe(true);
    expect(JSON.parse(out.json)[0].role).toBe("assistant");
  });
});

// ── Through the real chat.message procedure ─────────────────────────────────
const h = vi.hoisted(() => ({ insert: vi.fn(), reply: "" }));

const fakeDb = {
  select: () => { throw new Error("reads unavailable"); },
  insert: () => ({ values: (v: unknown) => h.insert(v) }),
  update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
};

vi.mock("./lib/db-helper", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, db: async () => fakeDb };
});
vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getDb: async () => null };
});
vi.mock("./gemini", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    chatWithAssistant: async () => ({ reply: h.reply, extractedInfo: null }),
    extractMemories: async () => [],
  };
});

describe("chat.message · the persisted transcript always fits messagesJson", () => {
  beforeEach(() => {
    h.insert.mockReset();
    h.insert.mockResolvedValue([{ insertId: 7 }]);
  });

  it("an over-limit transcript is written within MEDIUMTEXT, newest message kept", async () => {
    h.reply = "z".repeat(MEDIUMTEXT_MAX_BYTES + 10);
    const { chatRouter } = await import("./routers/chat");
    const res = await chatRouter.createCaller({} as never).message({ message: "My brakes squeal." });

    expect(res.reply.length).toBeGreaterThan(MEDIUMTEXT_MAX_BYTES); // the visitor still gets the full reply
    expect(h.insert).toHaveBeenCalledTimes(1);
    const written = (h.insert.mock.calls[0][0] as { messagesJson: string }).messagesJson;
    expect(Buffer.byteLength(written, "utf8")).toBeLessThanOrEqual(MEDIUMTEXT_MAX_BYTES);
    const stored = JSON.parse(written) as Array<{ role: string }>;
    expect(stored.at(-1)?.role).toBe("assistant");
  });

  it("control: a normal transcript is written unchanged", async () => {
    h.reply = "We can inspect the brakes today.";
    const { chatRouter } = await import("./routers/chat");
    await chatRouter.createCaller({} as never).message({ message: "My brakes squeal." });
    const written = (h.insert.mock.calls[0][0] as { messagesJson: string }).messagesJson;
    expect(JSON.parse(written)).toEqual([
      { role: "user", content: "My brakes squeal." },
      { role: "assistant", content: "We can inspect the brakes today." },
    ]);
  });
});
