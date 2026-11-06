/**
 * The receptionist makes NO callback obligations (Nour, 2026-11-06: "the receptionist
 * doesnt need to do bookings or give me a callback text"). PR 3340 stopped it drafting
 * bookings; this stops escalate and scheduleCallback writing a callback_requests row
 * (the Today "Urgent callback" row), a Front Counter promise (the "Promise overdue" row)
 * and the on-duty manager text. The call's reason stays on the call trail only.
 *
 * Replaces voiceAgent.escalateOncePerCall.test.ts, whose one-row-per-call guard
 * guarded a row that no longer exists. DB-free: db-helper, the claim table and the
 * event bus are fakes (same fixture as that file).
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

describe("escalate makes no callback obligation", () => {
  it("writes no callback row, no promise and sends no manager text", async () => {
    const c = await caller();
    const res = await c.escalate({ reason: "rack check: 225/65R17", urgency: "high", callerNumber: CALLER, callId: "call_n1", bestTime: "after 3" });
    expect(res.success).toBe(true);
    await new Promise((r) => setTimeout(r, 50)); // the old alert was fire-and-forget
    expect(h.rows).toHaveLength(0);
    expect(h.promises).toHaveLength(0);
    expect(h.callbackRequested).not.toHaveBeenCalled();
  });

  it("marks the call escalated, so the missed-call lanes do not text or card it", async () => {
    const c = await caller();
    await c.escalate({ reason: "after hours", callerNumber: CALLER, callId: "call_m1" });
    expect([...h.claims].some((k) => k.startsWith("voice-escalated:call_m1|"))).toBe(true);
  });

  it("tells the assistant no callback is coming, so it never promises one", async () => {
    const c = await caller();
    const res = await c.escalate({ reason: "wants the counter", callerNumber: CALLER, callId: "call_n2" });
    expect(res.message).toMatch(/no callback/i);
    expect(res.message).toMatch(/never say anyone will call them back/i);
    expect(res.message).not.toMatch(/callback list|the shop will call/i);
  });

  it("does not ask for a number when caller ID is missing (nothing to call back on)", async () => {
    const c = await caller();
    const res = await c.escalate({ reason: "after hours", callId: "call_n3" });
    expect(res).toMatchObject({ success: true });
    expect(res).not.toHaveProperty("needs_number");
    expect(h.rows).toHaveLength(0);
  });
});

describe("scheduleCallback makes no callback obligation", () => {
  it("writes no callback row and no promise", async () => {
    const c = await caller();
    const res = await c.scheduleCallback({ name: "Sam", phone: "2165550123", reason: "alignment", preferredTime: "morning", callId: "call_s1" });
    expect(res.success).toBe(true);
    expect(h.rows).toHaveLength(0);
    expect(h.promises).toHaveLength(0);
    expect(h.callbackRequested).not.toHaveBeenCalled();
  });
});

describe("a complaint on an outbound follow-up call texts the on-duty manager (Nour 2026-11-06: \"yes\")", () => {
  it("outbound escalate sends ONE manager text per call, with no callback row and no promise", async () => {
    const c = await caller();
    await c.escalate({ reason: "Post-repair complaint: brakes squeal", urgency: "high", callerNumber: CALLER, callId: "call_o1", outbound: true });
    await c.escalate({ reason: "Post-repair complaint: brakes squeal", urgency: "high", callerNumber: CALLER, callId: "call_o1", outbound: true });
    await until(() => expect(h.callbackRequested).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(h.callbackRequested).toHaveBeenCalledTimes(1);
    expect(String((h.callbackRequested.mock.calls[0][0] as { reason: string }).reason)).toMatch(/^COMPLAINT \(follow-up call\): Post-repair complaint: brakes squeal/);
    expect(h.rows).toHaveLength(0);
    expect(h.promises).toHaveLength(0);
  });
});
