/**
 * escalate writes ONE callback_requests row per call (claim-before-act, 2026-10-31).
 *
 * The fallback of an unanswered transfer hands the caller back to the assistant,
 * which runs CALLBACK CAPTURE -> escalate. The alert was already once per call
 * (sendOncePerState voice-callback:<callId>), but the ROW insert had no guard: a
 * Vapi tool retry or a second model call wrote a second row, so the crew saw two
 * callbacks for one caller. Now a persisted per-call claim (INSERT IGNORE on
 * cron_alerts_fired, the same compare-and-swap the alert uses) gates the insert;
 * the loser re-reads the winner's row and never writes or alerts. escalate also
 * carries the caller's best time.
 *
 * DB-free: db-helper, the claim table and the event bus are fakes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import type { TrpcContext } from "../_core/context";

const h = vi.hoisted(() => ({
  claims: new Set<string>(),
  rows: [] as Array<{ id: number; context: string; name: string; phone: string }>,
  insertFailsOnce: false,
  callbackRequested: vi.fn(),
  promises: [] as Array<Record<string, unknown>>,
}));

/** Collect the bound string values of a drizzle SQL fragment (for the fake LIKE). */
function boundStrings(node: unknown, out: string[] = [], seen = new Set<unknown>()): string[] {
  if (typeof node === "string") { out.push(node); return out; }
  if (!node || typeof node !== "object" || seen.has(node)) return out;
  seen.add(node);
  const v = (node as { value?: unknown }).value;
  if (typeof v === "string") out.push(v);
  for (const c of ((node as { queryChunks?: unknown[] }).queryChunks ?? [])) boundStrings(c, out, seen);
  return out;
}

function render(q: { queryChunks?: unknown[] }): { text: string; params: unknown[] } {
  let text = "";
  const params: unknown[] = [];
  for (const c of q.queryChunks ?? []) {
    const v = (c as { value?: unknown })?.value;
    if (Array.isArray(v)) text += v.join("");
    else { text += "?"; params.push(c); }
  }
  return { text, params };
}

function fakeDrizzle() {
  return {
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    select: () => ({
      from: (table: unknown) => {
        const isCallbacks = getTableName(table as never) === "callback_requests";
        const run = (where: unknown) => {
          if (!isCallbacks) return [];
          const needles = boundStrings(where).map((s) => s.replace(/^%|%$/g, ""));
          return h.rows.filter((r) => needles.some((n) => n && r.context.includes(n))).sort((a, b) => b.id - a.id);
        };
        return {
          where: (w: unknown) => ({
            limit: async (n: number) => run(w).slice(0, n),
            orderBy: () => ({ limit: async (n: number) => run(w).slice(0, n) }),
          }),
        };
      },
    }),
    insert: () => ({
      values: async (v: { context: string; name: string; phone: string }) => {
        if (h.insertFailsOnce) { h.insertFailsOnce = false; throw new Error("db down"); }
        const id = 100 + h.rows.length;
        h.rows.push({ id, context: v.context, name: v.name, phone: v.phone });
        return [{ insertId: id }];
      },
    }),
  };
}

async function fakeExecute(q: { queryChunks?: unknown[] }) {
  const { text, params } = render(q);
  const key = `${params[0]}|${params[1]}`;
  if (/INSERT IGNORE/i.test(text)) {
    if (h.claims.has(key)) return [{ affectedRows: 0 }];
    h.claims.add(key);
    return [{ affectedRows: 1 }];
  }
  if (/DELETE/i.test(text)) { h.claims.delete(key); return [{ affectedRows: 1 }]; }
  return [[]];
}

type Fn = (...a: unknown[]) => unknown;
vi.mock("../lib/db-helper", () => ({ db: async () => fakeDrizzle() }));
vi.mock("../db", async (orig) => ({
  ...(await orig<typeof import("../db")>()),
  getDb: async () => ({ execute: fakeExecute }),
  getDbTyped: async () => null,
}));
vi.mock("../lib/logger", async (orig) => ({
  ...(await orig<typeof import("../lib/logger")>()),
  createLogger: () => ({ info: () => {}, debug: () => {}, error: () => {}, warn: () => {} }),
}));
vi.mock("../services/voice-call-state", () => ({ recordCallState: async () => {} }));
vi.mock("../services/promiseLedger", () => ({
  createVoicePromise: async (p: Record<string, unknown>) => { h.promises.push(p); return { skipped: true, reason: "test" }; },
}));
vi.mock("../services/telegram", () => ({ sendTelegram: async () => ({ status: "delivered" }) }));
vi.mock("../services/eventBus", async (orig) => {
  const real = await orig<typeof import("../services/eventBus")>();
  return { ...real, emit: { ...real.emit, callbackRequested: (...a: unknown[]) => (h.callbackRequested as Fn)(...a) } };
});

function ctx(): TrpcContext {
  return { user: null, isVoiceAgentInternal: true, req: { protocol: "https", headers: {} } as any, res: { clearCookie: () => {} } as any };
}
async function caller() {
  const { voiceAgentRouter } = await import("./voiceAgent");
  return voiceAgentRouter.createCaller(ctx());
}
const CALLER = "+12165550123";
const until = (fn: () => void) => vi.waitFor(fn, { timeout: 15_000, interval: 20 });

beforeEach(() => {
  h.claims.clear();
  h.rows = [];
  h.insertFailsOnce = false;
  h.promises = [];
  h.callbackRequested.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", async () => { throw new Error("network call in a unit test"); });
});
afterEach(() => {
  vi.unstubAllGlobals();
  h.callbackRequested.mockReset();
});

describe("(2) one row and one alert per call", () => {
  it("two escalates with the same callId give 1 row and 1 alert; the second reports the first's row", async () => {
    const c = await caller();
    const first = await c.escalate({ reason: "wants the counter", callerNumber: CALLER, callId: "call_x1" });
    const second = await c.escalate({ reason: "wants the counter", callerNumber: CALLER, callId: "call_x1" });
    expect(first).toMatchObject({ success: true });
    expect(second).toMatchObject({ success: true, duplicate: true });
    expect(h.rows).toHaveLength(1);
    await until(() => expect(h.callbackRequested).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(h.callbackRequested).toHaveBeenCalledTimes(1);
  });

  it("two escalates racing on one call still give 1 row", async () => {
    const c = await caller();
    await Promise.all([
      c.escalate({ reason: "a", callerNumber: CALLER, callId: "call_x2" }),
      c.escalate({ reason: "a", callerNumber: CALLER, callId: "call_x2" }),
    ]);
    expect(h.rows).toHaveLength(1);
  });

  it("POSITIVE CONTROL: different calls each get their row", async () => {
    const c = await caller();
    await c.escalate({ reason: "a", callerNumber: CALLER, callId: "call_x3" });
    await c.escalate({ reason: "a", callerNumber: CALLER, callId: "call_x4" });
    expect(h.rows).toHaveLength(2);
  });

  it("a failed insert hands the claim back, so the retry writes the row", async () => {
    h.insertFailsOnce = true;
    const c = await caller();
    const failed = await c.escalate({ reason: "a", callerNumber: CALLER, callId: "call_x5" });
    expect(failed.success).toBe(false);
    expect(h.rows).toHaveLength(0);
    const retry = await c.escalate({ reason: "a", callerNumber: CALLER, callId: "call_x5" });
    expect(retry).toMatchObject({ success: true });
    expect(h.rows).toHaveLength(1);
  });

  it("a claim held with no row yet (the winner is mid-write) is not a promise", async () => {
    const c = await caller();
    // Plant the winner's claim without its row.
    const { getBusinessDateKey } = await import("../lib/timezoneAssert");
    h.claims.add(`voice-callback-row:call_x6|${getBusinessDateKey(new Date())}`);
    const res = await c.escalate({ reason: "a", callerNumber: CALLER, callId: "call_x6" });
    expect(res.success).toBe(false);
    expect(h.rows).toHaveLength(0);
  });
});

describe("escalate carries the caller's best time", () => {
  it("lands in the row, the crew alert and the line the assistant reads back", async () => {
    const c = await caller();
    const res = await c.escalate({ reason: "rack check: 225/65R17", callerNumber: CALLER, callId: "call_bt1", bestTime: "after 3" });
    expect(h.rows[0].context).toContain("after 3");
    await until(() => expect(h.callbackRequested).toHaveBeenCalledTimes(1));
    expect(String((h.callbackRequested.mock.calls[0][0] as { reason: string }).reason)).toContain("after 3");
    expect(res.message).toContain("after 3");
  });

  it("is optional: no best time, no 'best time' text", async () => {
    const c = await caller();
    await c.escalate({ reason: "status check", callerNumber: CALLER, callId: "call_bt2" });
    expect(h.rows[0].context).not.toMatch(/best time/i);
  });
});
