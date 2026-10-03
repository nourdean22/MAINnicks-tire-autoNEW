/**
 * Sentry NICKSTIRE-8 (2026-09-27 17:40 UTC): a website visitor asked whether
 * the shop fixes interior door handles; the assistant composed a good answer;
 * then `insert into chat_sessions` failed and the procedure threw. The visitor
 * got an error instead of the reply that already existed.
 *
 * The failing params were short (vehicleInfo/problemSummary both null), so it
 * was NOT a width/enum/STRICT_TRANS_TABLES rejection — the innermost cause was
 * TiDB Cloud's usage-quota restriction (same outage as NICKSTIRE-6/7). The
 * code defect: the persist was unguarded, so ANY transient DB failure after the
 * LLM call discarded a reply the customer was owed.
 *
 * Contract pinned here, through the REAL chat.message procedure:
 *  - a failed persist is LOGGED (not silent) and the reply is still returned;
 *  - no session id/token is handed out for a row that was never written;
 *  - the healthy path still persists and returns a token (positive control).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  insert: vi.fn(),
  logError: vi.fn(),
}));

/** Reads fail (as in the outage) but are all inside try blocks; the insert is under test. */
const fakeDb = {
  select: () => { throw new Error("reads unavailable"); },
  insert: () => ({ values: (v: unknown) => h.insert(v) }),
  update: () => ({ set: () => ({ where: () => Promise.reject(new Error("update failed")) }) }),
};

vi.mock("./lib/db-helper", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, db: async () => fakeDb };
});

// The business-intel block opens its own handle; a dead one keeps it inert.
vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getDb: async () => null };
});

vi.mock("./gemini", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    chatWithAssistant: async () => ({
      reply: "Yes — interior door handles are a common repair we handle.",
      extractedInfo: null,
    }),
    extractMemories: async () => [],
  };
});

vi.mock("./lib/logger", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createLogger: (name: string) =>
      name === "routers:chat"
        ? { error: (...a: unknown[]) => h.logError(...a), warn: () => {}, info: () => {}, debug: () => {} }
        : (actual.createLogger as (n: string) => unknown)(name),
  };
});

async function sendFirstMessage() {
  const { chatRouter } = await import("./routers/chat");
  return chatRouter.createCaller({} as never).message({
    message: "The interior door handle of my car is not working, is this a place that can fix it?",
  });
}

describe("chat.message survives a failed chat_sessions insert (NICKSTIRE-8)", () => {
  beforeEach(() => {
    h.insert.mockReset();
    h.logError.mockReset();
  });

  it("positive control: a healthy insert persists and returns a session token", async () => {
    h.insert.mockResolvedValue([{ insertId: 42 }]);
    const res = await sendFirstMessage();
    expect(h.insert).toHaveBeenCalledTimes(1);
    expect(res.sessionId).toBe(42);
    expect(res.sessionToken).toMatch(/^[a-f0-9]{32}$/);
    expect(res.reply).toMatch(/door handles/);
  });

  it("still returns the reply when the insert fails, and logs the lost persist", async () => {
    h.insert.mockRejectedValue(new Error(
      "Due to the usage quota being exhausted, access to the cluster has been restricted.",
    ));
    const res = await sendFirstMessage();
    expect(res.reply).toMatch(/door handles/);
    // No row was written, so no capability token may be issued for one.
    expect(res.sessionId).toBeUndefined();
    expect(res.sessionToken).toBeUndefined();
    const logged = h.logError.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toMatch(/persist/i);
  });
});
