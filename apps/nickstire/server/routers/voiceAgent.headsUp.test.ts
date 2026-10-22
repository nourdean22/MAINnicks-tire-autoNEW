/**
 * 2026-10-21 · Nour's two voice orders.
 *
 * (1) A caller coming in now/today, or a tow on its way, produces an INTERNAL
 *     text to the on-duty manager and NO expected_arrivals row. A later day
 *     keeps the row. One text per call (persisted claim), handed back on a
 *     failed send so the visit is never lost.
 * (2) escalate takes the number from caller ID and never needs a name.
 *
 * DB-free: db-helper, the claim table and every outbound channel are fakes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const h = vi.hoisted(() => ({
  recordExpectedArrival: vi.fn(),
  textOnDutyManager: vi.fn(),
  callbackRequested: vi.fn(),
  isEnabled: vi.fn(),
  warn: vi.fn(),
  sendSms: vi.fn(),
  onDuty: vi.fn(),
  sendTelegram: vi.fn(),
  claims: new Set<string>(),
  customerRows: [] as Array<Record<string, unknown>>,
  inserted: [] as Array<Record<string, unknown>>,
  insertFails: false,
  claimTries: 0,
  realText: false,
  fetchCalls: [] as string[],
}));

/** drizzle sql`` -> text with ? placeholders + the bound values, for the fake claim table. */
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
    select: () => ({ from: () => ({ where: () => ({ limit: async () => h.customerRows }) }) }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        const p: Promise<unknown> = h.insertFails ? Promise.reject(new Error("db down")) : Promise.resolve([{ insertId: 77 }]);
        p.catch(() => {});
        if (!h.insertFails) h.inserted.push(v);
        return Object.assign(p, { $returningId: async () => { await p; return [{ id: 78 }]; } });
      },
    }),
  };
}

/** The claim table: INSERT IGNORE / DELETE on (alert_key, fired_for). */
async function fakeExecute(q: { queryChunks?: unknown[] }) {
  const { text, params } = render(q);
  const key = `${params[0]}|${params[1]}`;
  if (/INSERT IGNORE/i.test(text)) {
    h.claimTries++;
    if (h.claims.has(key)) return [{ affectedRows: 0 }];
    h.claims.add(key);
    return [{ affectedRows: 1 }];
  }
  if (/DELETE/i.test(text)) { h.claims.delete(key); return [{ affectedRows: 1 }]; }
  return [[]];
}

// Hoisted, file-wide mocks: they survive vi.resetModules and every concurrent dynamic
// import. A per-test vi.doMock let a fire-and-forget emit reach the REAL eventBus and
// real ../db once (2026-10-21, an HTTP 401 from NOUR OS): never again in this file.
type Fn = (...a: unknown[]) => unknown;
vi.mock("../services/expectedArrivals", async (orig) => ({
  ...(await orig<typeof import("../services/expectedArrivals")>()),
  recordExpectedArrival: (...a: unknown[]) => (h.recordExpectedArrival as Fn)(...a),
}));
vi.mock("../services/featureFlags", async (orig) => ({
  ...(await orig<typeof import("../services/featureFlags")>()),
  isEnabled: (...a: unknown[]) => (h.isEnabled as Fn)(...a),
}));
vi.mock("../lib/db-helper", () => ({ db: async () => fakeDrizzle() }));
vi.mock("../db", async (orig) => ({
  ...(await orig<typeof import("../db")>()),
  getDb: async () => ({ execute: fakeExecute }),
  getDbTyped: async () => null,
}));
vi.mock("../lib/logger", async (orig) => ({
  ...(await orig<typeof import("../lib/logger")>()),
  createLogger: () => ({ info: () => {}, debug: () => {}, error: () => {}, warn: (...a: unknown[]) => (h.warn as Fn)(...a) }),
}));
vi.mock("../services/voice-call-state", () => ({ recordCallState: async () => {} }));
vi.mock("../services/promiseLedger", () => ({ createVoicePromise: async () => ({ skipped: true, reason: "test" }) }));
vi.mock("../services/telegram", () => ({ sendTelegram: (...a: unknown[]) => (h.sendTelegram as Fn)(...a) }));
vi.mock("../services/vapi", async (orig) => ({
  ...(await orig<typeof import("../services/vapi")>()),
  getOnDutyManagerPhone: (...a: unknown[]) => (h.onDuty as Fn)(...a),
}));
vi.mock("../sms", async (orig) => ({ ...(await orig<typeof import("../sms")>()), sendSms: (...a: unknown[]) => (h.sendSms as Fn)(...a) }));
vi.mock("../services/eventBus", async (orig) => {
  const real = await orig<typeof import("../services/eventBus")>();
  return {
    ...real,
    emit: { ...real.emit, callbackRequested: (...a: unknown[]) => (h.callbackRequested as Fn)(...a) },
    textOnDutyManager: (body: string) => (h.realText ? real.textOnDutyManager(body) : (h.textOnDutyManager as Fn)(body)),
  };
});

function createVoiceContext(): TrpcContext {
  return {
    user: null,
    isVoiceAgentInternal: true,
    req: { protocol: "https", headers: {} } as any,
    res: { clearCookie: () => {} } as any,
  };
}

async function loadCaller(opts: { realEventBus?: boolean } = {}) {
  h.realText = Boolean(opts.realEventBus);
  const { voiceAgentRouter } = await import("./voiceAgent");
  return voiceAgentRouter.createCaller(createVoiceContext());
}

const CALLER = "+12165550123";
const TOW = {
  name: "Ray",
  service: "tow incoming — won't start",
  vehicle: "2014 Honda Civic",
  eta: "30 minutes",
  callId: "call_test_1",
  callerNumber: CALLER,
};

beforeEach(() => {
  h.claims.clear();
  h.customerRows = [];
  h.inserted = [];
  h.insertFails = false;
  h.claimTries = 0;
  h.fetchCalls = [];
  // No network from a unit test: any fetch is recorded and refused, and afterEach fails the test.
  vi.stubGlobal("fetch", async (u: unknown) => { h.fetchCalls.push(String(u)); throw new Error("network call in a unit test"); });
  h.isEnabled.mockResolvedValue(false);
  h.textOnDutyManager.mockResolvedValue({ status: "sent" });
  h.recordExpectedArrival.mockResolvedValue({ id: 9, created: true });
  h.callbackRequested.mockResolvedValue(undefined);
});

afterEach(() => {
  h.realText = false;
  vi.unstubAllGlobals();
  expect(h.fetchCalls, "network calls from this test").toEqual([]);
  vi.useRealTimers();
  for (const f of [h.recordExpectedArrival, h.textOnDutyManager, h.callbackRequested, h.isEnabled, h.warn, h.sendSms, h.onDuty, h.sendTelegram]) f.mockReset();
});

const bodyOf = (n = 0) => String(h.textOnDutyManager.mock.calls[n]?.[0] ?? "");

describe("bookSlot: coming in today / tow → one internal text, no expected_arrivals row", () => {
  it("today (not a tow): one text to the shop, no row, status shop_texted", async () => {
    const res = await (await loadCaller()).bookSlot({
      name: "Ray", service: "brake check", vehicle: "2014 Honda Civic", preferredDay: "today", callId: "call_t1", callerNumber: CALLER,
    });
    expect(h.textOnDutyManager).toHaveBeenCalledTimes(1);
    expect(bodyOf()).toContain("COMING IN");
    expect(bodyOf()).toContain("Ray - (216) 555-0123");
    expect(bodyOf()).toContain("For: brake check");
    expect(h.recordExpectedArrival).not.toHaveBeenCalled();
    expect(res).toMatchObject({ success: true, status: "shop_texted" });
  });

  it("tow on a LATER day still texts now: TOW COMING with name, caller ID, vehicle, what happened, ETA", async () => {
    const res = await (await loadCaller()).bookSlot({ ...TOW, preferredDay: "tomorrow" });
    expect(h.textOnDutyManager).toHaveBeenCalledTimes(1);
    const body = bodyOf();
    for (const part of ["TOW COMING", "Ray", "(216) 555-0123", "2014 Honda Civic", "won't start", "ETA: 30 minutes"]) {
      expect(body).toContain(part);
    }
    expect(body).not.toMatch(/tow incoming/i);
    expect(body.length).toBeLessThan(320);
    expect(body).toMatch(/^[\x00-\x7F]*$/);
    expect(h.recordExpectedArrival).not.toHaveBeenCalled();
    expect(res.status).toBe("shop_texted");
  });

  it("a later day (saturday said on a Wednesday) keeps the row path and sends no text", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T16:00:00Z")); // Wed 12:00 PM in Cleveland
    const res = await (await loadCaller()).bookSlot({
      name: "Ray", service: "brake check", preferredDay: "saturday", callId: "call_t2", callerNumber: CALLER,
    });
    expect(h.textOnDutyManager).not.toHaveBeenCalled();
    expect(h.recordExpectedArrival).toHaveBeenCalledWith(expect.objectContaining({ preferredDay: "saturday", phone: CALLER, sourceRef: "call_t2" }));
    expect(res.status).toBe("walk_in_guidance");
  });
});

describe("a queued or uncertain text is not a delivered one (review P1-1)", () => {
  it.each(["queued", "uncertain"])("%s → the row path files the visit, the claim is kept, a second bookSlot sends nothing", async (reason) => {
    h.textOnDutyManager.mockResolvedValue({ status: "pending", reason });
    const caller = await loadCaller();
    const first = await caller.bookSlot(TOW);
    expect(first.status).toBe("walk_in_guidance");
    expect(h.recordExpectedArrival).toHaveBeenCalledTimes(1);
    expect([...h.claims].some((k) => k.startsWith("voice-arrival:call_test_1|"))).toBe(true);
    await caller.bookSlot(TOW);
    expect(h.textOnDutyManager).toHaveBeenCalledTimes(1);
  });

  it("plain success → 0 rows", async () => {
    h.textOnDutyManager.mockResolvedValue({ status: "sent" });
    await (await loadCaller()).bookSlot(TOW);
    expect(h.recordExpectedArrival).not.toHaveBeenCalled();
  });
});

describe("bookSlot needs no name when caller ID has a record (review P2-3, P2-9)", () => {
  it("no name, later day, record on file → no zod error, the row carries the record name", async () => {
    h.customerRows = [{ firstName: "Raymond", lastName: "Smith" }];
    const res = await (await loadCaller()).bookSlot({ service: "brake check", preferredDay: "tomorrow", callId: "call_n1", callerNumber: CALLER });
    expect(res.status).toBe("walk_in_guidance");
    expect(h.recordExpectedArrival).toHaveBeenCalledWith(expect.objectContaining({ name: "Raymond S." }));
  });

  it("no name, today, record on file → the text carries the record name", async () => {
    h.customerRows = [{ firstName: "Raymond", lastName: "Smith" }];
    await (await loadCaller()).bookSlot({ service: "brake check", callId: "call_n2", callerNumber: CALLER });
    expect(bodyOf()).toContain("Raymond S. - (216) 555-0123");
  });

  it("no name, later day, no record → still asks once (name_incomplete)", async () => {
    const res = await (await loadCaller()).bookSlot({ service: "brake check", preferredDay: "tomorrow", callerNumber: CALLER });
    expect(res.status).toBe("name_incomplete");
  });

  it("a name in Arabic script uses the record name instead of 'Name not given'", async () => {
    h.customerRows = [{ firstName: "Raymond", lastName: "Smith" }];
    await (await loadCaller()).bookSlot({ ...TOW, name: "محمد" });
    expect(bodyOf()).toContain("Raymond S. - (216) 555-0123");
  });
});

describe("textOnDutyManager reports a queued or uncertain send as pending (review P1-1)", () => {
  it.each([[{ success: true, queued: true }, "queued"], [{ success: true, uncertain: true }, "uncertain"]])("%o → pending:%s, and bookSlot files the row", async (smsResult, reason) => {
    h.onDuty.mockResolvedValue("+12165550188");
    h.sendSms.mockResolvedValue(smsResult);
    const caller = await loadCaller({ realEventBus: true });
    const { textOnDutyManager } = await import("../services/eventBus");
    await expect(textOnDutyManager("x")).resolves.toEqual({ status: "pending", reason });
    const res = await caller.bookSlot({ ...TOW, callId: `call_p_${reason}` });
    expect(res.status).toBe("walk_in_guidance");
    expect(h.recordExpectedArrival).toHaveBeenCalledTimes(1);
  });
});

describe("name ask before the shop text (2026-10-22)", () => {
  const NEEDED = "Not sent yet. Ask once: 'Who should we expect?' Then call bookSlot again with their first name. If they won't say, call bookSlot again with name 'not given'.";

  it("coming now, no name, no record → name_needed: no text, no claim, no row", async () => {
    const res = await (await loadCaller()).bookSlot({ service: "brake check", callId: "call_n10", callerNumber: CALLER });
    expect(res).toMatchObject({ success: false, reference: "WALKIN-INFO", status: "name_needed", message: NEEDED });
    expect(h.textOnDutyManager).not.toHaveBeenCalled();
    expect(h.claimTries).toBe(0);
    expect(h.recordExpectedArrival).not.toHaveBeenCalled();
  });

  it("tow, no name, no record → name_needed too", async () => {
    const res = await (await loadCaller()).bookSlot({ ...TOW, name: undefined, callId: "call_n11" });
    expect(res.status).toBe("name_needed");
    expect(h.textOnDutyManager).not.toHaveBeenCalled();
    expect(h.recordExpectedArrival).not.toHaveBeenCalled();
  });

  it("coming now, no name, record on file → no ask; the text carries the record name", async () => {
    h.customerRows = [{ firstName: "Raymond", lastName: "Smith" }];
    const res = await (await loadCaller()).bookSlot({ service: "brake check", callId: "call_n12", callerNumber: CALLER });
    expect(res.status).toBe("shop_texted");
    expect(bodyOf()).toContain("Raymond S. - (216) 555-0123");
  });

  it("coming now, given name → no ask; the text carries it", async () => {
    const res = await (await loadCaller()).bookSlot({ name: "Dana", service: "brake check", callId: "call_n13", callerNumber: CALLER });
    expect(res.status).toBe("shop_texted");
    expect(bodyOf()).toContain("Dana - (216) 555-0123");
  });

  it.each(["not given", "  Not Given ", "NOT GIVEN"])("sentinel %j → the text goes out with 'Name not given', never the literal as a name", async (name) => {
    const res = await (await loadCaller()).bookSlot({ name, service: "brake check", callId: "call_n14", callerNumber: CALLER });
    expect(res.status).toBe("shop_texted");
    expect(bodyOf().split("\n")[1]).toBe("Name not given - (216) 555-0123");
  });

  it("sentinel on a fallback files the row with no name, not the literal", async () => {
    h.textOnDutyManager.mockResolvedValue({ status: "failed", reason: "gateway down" });
    await (await loadCaller()).bookSlot({ name: "not given", service: "brake check", callId: "call_n15", callerNumber: CALLER });
    expect(h.recordExpectedArrival).toHaveBeenCalledTimes(1);
    expect(h.recordExpectedArrival.mock.calls[0][0].name ?? null).toBeNull();
  });

  it("later day, no name, no record → unchanged: name_incomplete", async () => {
    const res = await (await loadCaller()).bookSlot({ service: "brake check", preferredDay: "tomorrow", callerNumber: CALLER });
    expect(res.status).toBe("name_incomplete");
  });
});

describe("Codex re-review: one callback event per call", () => {
  // The emit is fire-and-forget behind a cold dynamic import, so wait on observed
  // state (claim attempts, emits), never on a fixed number of ticks.
  const until = (fn: () => void) => vi.waitFor(fn, { timeout: 15_000, interval: 20 });

  it("two escalate calls with the same callId emit once", async () => {
    const caller = await loadCaller();
    await caller.escalate({ reason: "wants the manager", callerNumber: CALLER, callId: "call_e9" });
    await until(() => expect(h.callbackRequested).toHaveBeenCalledTimes(1));
    await caller.escalate({ reason: "wants the manager", callerNumber: CALLER, callId: "call_e9" });
    await until(() => expect(h.claimTries).toBe(2)); // the second escalate tried, and lost, the claim
    await new Promise((r) => setImmediate(r));
    expect(h.callbackRequested).toHaveBeenCalledTimes(1);
  });

  it("different callIds emit twice", async () => {
    const caller = await loadCaller();
    await caller.escalate({ reason: "x", callerNumber: CALLER, callId: "call_e10" });
    await caller.escalate({ reason: "x", callerNumber: CALLER, callId: "call_e11" });
    await until(() => expect(h.callbackRequested).toHaveBeenCalledTimes(2));
    expect(h.claimTries).toBe(2);
  });

  it("no callId: each escalate emits", async () => {
    const caller = await loadCaller();
    await caller.escalate({ reason: "x", callerNumber: CALLER });
    await caller.escalate({ reason: "x", callerNumber: CALLER });
    await until(() => expect(h.callbackRequested).toHaveBeenCalledTimes(2));
    expect(h.claimTries).toBe(0);
  });

  it("an emit that throws hands the claim back, so a retry emits", async () => {
    h.callbackRequested.mockRejectedValueOnce(new Error("bus down"));
    const caller = await loadCaller();
    await caller.escalate({ reason: "x", callerNumber: CALLER, callId: "call_e12" });
    await until(() => expect(h.callbackRequested).toHaveBeenCalledTimes(1));
    await until(() => expect([...h.claims].some((k) => k.startsWith("voice-callback:call_e12|"))).toBe(false));
    await caller.escalate({ reason: "x", callerNumber: CALLER, callId: "call_e12" });
    await until(() => expect(h.callbackRequested).toHaveBeenCalledTimes(2));
  });
});

describe("Codex review on PR 3212", () => {
  it("P1: a fallback from the heads-up never re-asks the name; the row files with no name", async () => {
    h.textOnDutyManager.mockResolvedValue({ status: "pending", reason: "queued" });
    // 2026-10-22: with no name and no record the heads-up asks first; "not given" is the post-ask call.
    const res = await (await loadCaller()).bookSlot({ name: "not given", service: "brake check", callId: "call_c1", callerNumber: CALLER });
    expect(res.status).not.toBe("name_incomplete");
    expect(res.success).toBe(true);
    expect(h.recordExpectedArrival).toHaveBeenCalledTimes(1);
    expect(h.recordExpectedArrival.mock.calls[0][0].name ?? null).toBeNull();
  });

  it("P1: a send that never returns is cut at 12 s; the row files and the claim is kept", async () => {
    const caller = await loadCaller();
    // Warm every lazy import on this path with real timers (vitest's loader stalls under faked setTimeout).
    await caller.bookSlot({ ...TOW, callId: "call_warm" });
    h.recordExpectedArrival.mockClear();
    h.textOnDutyManager.mockReset();
    h.textOnDutyManager.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let settled: { status?: string } | null = null;
    void caller.bookSlot({ ...TOW, callId: "call_c2" }).then((r) => { settled = r; });
    // Real ticks until the send starts (dynamic imports resolve on real I/O); the cut timer is armed in the same tick.
    for (let i = 0; i < 2000 && h.textOnDutyManager.mock.calls.length === 0; i++) await new Promise((r) => setImmediate(r));
    expect(h.textOnDutyManager, "the send started").toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(11_900);
    expect(settled, "still waiting just before 12 s").toBeNull();
    await vi.advanceTimersByTimeAsync(100);
    for (let i = 0; i < 2000 && !settled; i++) await new Promise((r) => setImmediate(r));
    expect(settled, "bookSlot returned at 12 s").not.toBeNull();
    expect(settled!.status).toBe("walk_in_guidance");
    expect(h.recordExpectedArrival).toHaveBeenCalledTimes(1);
    expect([...h.claims].some((k) => k.startsWith("voice-arrival:call_c2|"))).toBe(true);
  });

  it("P2: a high-urgency escalate sends no direct Telegram; the bus event carries HIGH URGENCY", async () => {
    await (await loadCaller()).escalate({ reason: "brakes gone", urgency: "high", callerNumber: CALLER, callId: "call_c3" });
    await vi.waitFor(() => expect(h.callbackRequested).toHaveBeenCalledTimes(1), { timeout: 15_000, interval: 20 });
    expect(h.callbackRequested).toHaveBeenCalledWith(expect.objectContaining({ reason: "HIGH URGENCY: brakes gone" }));
    expect(h.sendTelegram).not.toHaveBeenCalled();
  });

  it("P2: a medium escalate passes the reason as said", async () => {
    await (await loadCaller()).escalate({ reason: "status check", callerNumber: CALLER });
    await vi.waitFor(() => expect(h.callbackRequested).toHaveBeenCalledTimes(1), { timeout: 15_000, interval: 20 });
    expect(h.callbackRequested).toHaveBeenCalledWith(expect.objectContaining({ reason: "status check" }));
  });

  it.each(["need a tow truck", "tow truck referral", "tow truck number"])("P2: %j on a later day is not a tow", async (service) => {
    await (await loadCaller()).bookSlot({ name: "Ray", service, preferredDay: "tomorrow", callerNumber: CALLER });
    expect(h.textOnDutyManager).not.toHaveBeenCalled();
    expect(h.recordExpectedArrival).toHaveBeenCalledTimes(1);
  });

  it.each(["it's coming on a tow truck", "tow truck is bringing it"])("P2: %j → TOW COMING", async (service) => {
    await (await loadCaller()).bookSlot({ name: "Ray", service, preferredDay: "tomorrow", callId: "call_c5", callerNumber: CALLER });
    expect(bodyOf().split("\n")[0]).toBe("TOW COMING (phone)");
  });
});

describe("a tow means a car being towed in, not tow gear", () => {
  it("'tow hitch install' on saturday → the row path, no TOW COMING text", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T16:00:00Z")); // Wed 12:00 PM in Cleveland
    const res = await (await loadCaller()).bookSlot({ name: "Ray", service: "tow hitch install", preferredDay: "saturday", callId: "call_h1", callerNumber: CALLER });
    expect(h.recordExpectedArrival).toHaveBeenCalledTimes(1);
    expect(h.textOnDutyManager).not.toHaveBeenCalled();
    expect(res.status).toBe("walk_in_guidance");
  });

  it("'tow hitch install' today → 0 rows, one COMING IN text", async () => {
    await (await loadCaller()).bookSlot({ name: "Ray", service: "tow hitch install", preferredDay: "today", callId: "call_h2", callerNumber: CALLER });
    expect(h.recordExpectedArrival).not.toHaveBeenCalled();
    expect(h.textOnDutyManager).toHaveBeenCalledTimes(1);
    expect(bodyOf().split("\n")[0]).toBe("COMING IN (phone)");
    expect(bodyOf()).toContain("For: tow hitch install");
  });

  it.each(["tow package", "tow mirrors", "tow bar install", "tow hook", "tow straps", "tow rating check"])("%j on a later day is not a tow", async (service) => {
    await (await loadCaller()).bookSlot({ name: "Ray", service, preferredDay: "tomorrow", callId: "call_h3", callerNumber: CALLER });
    expect(h.textOnDutyManager).not.toHaveBeenCalled();
    expect(h.recordExpectedArrival).toHaveBeenCalledTimes(1);
  });

  it.each([
    "tow incoming: won't start",
    "getting it towed",
    "tow coming, won't start",
    "tow on the way",
    "car being towed",
    "towing it in",
    "tow truck bringing it",
  ])("%j on a later day → TOW COMING now", async (service) => {
    await (await loadCaller()).bookSlot({ name: "Ray", service, preferredDay: "tomorrow", callId: "call_h4", callerNumber: CALLER });
    expect(h.textOnDutyManager).toHaveBeenCalledTimes(1);
    expect(bodyOf().split("\n")[0]).toBe("TOW COMING (phone)");
    expect(h.recordExpectedArrival).not.toHaveBeenCalled();
  });
});

describe("only a caller who says today gets the text (part 2: strict routing)", () => {
  it.each(["next week", "this weekend", "soon", "sometime"])("%j → the row path: 1 row, 0 texts", async (preferredDay) => {
    const res = await (await loadCaller()).bookSlot({ name: "Ray", service: "brake check", preferredDay, callId: "call_r1", callerNumber: CALLER });
    expect(h.textOnDutyManager).not.toHaveBeenCalled();
    expect(h.recordExpectedArrival).toHaveBeenCalledTimes(1);
    expect(res.status).toBe("walk_in_guidance");
  });

  it.each(["in 20 minutes", "on my way", "right now", "this afternoon", ""])("%j → 0 rows, 1 text", async (preferredDay) => {
    const res = await (await loadCaller()).bookSlot({ name: "Ray", service: "brake check", preferredDay, callId: "call_r2", callerNumber: CALLER });
    expect(h.textOnDutyManager).toHaveBeenCalledTimes(1);
    expect(h.recordExpectedArrival).not.toHaveBeenCalled();
    expect(res.status).toBe("shop_texted");
  });

  it("no preferredDay at all → today → the text", async () => {
    await (await loadCaller()).bookSlot({ name: "Ray", service: "brake check", callId: "call_r3", callerNumber: CALLER });
    expect(h.textOnDutyManager).toHaveBeenCalledTimes(1);
    expect(h.recordExpectedArrival).not.toHaveBeenCalled();
  });
});

describe("shopInfo says payment programs and names no person", () => {
  it("no key or value mentions financing; after-hours names nobody", async () => {
    const info = await (await loadCaller()).shopInfo();
    const keys = JSON.stringify(Object.keys(info));
    expect(keys).not.toMatch(/financ/i);
    expect(info).toMatchObject({ paymentProgramsAvailable: true });
    expect((info as Record<string, unknown>).paymentPrograms).toEqual(["Kafene", "Acima", "Snap Finance", "Koalafi", "American First"]);
    expect((info as Record<string, unknown>).emergencyAfterHours).toBe("Call or text the shop number; the shop sees it when it opens.");
  });
});

describe("tireInquiry needs no name or number from the caller", () => {
  it("a rack check with only a size files the lead under caller ID and the record name", async () => {
    h.customerRows = [{ firstName: "Raymond", lastName: "Smith" }];
    const res = await (await loadCaller()).tireInquiry({ tireSize: "225/65R17", notes: "rack check", callerNumber: CALLER, callId: "call_ti1" });
    expect(res.success).toBe(true);
    expect(h.inserted[0]).toMatchObject({ phone: "2165550123", name: "Raymond S." });
  });

  it("an ordinary inquiry with no name or phone still answers", async () => {
    const res = await (await loadCaller()).tireInquiry({ tireSize: "225/65R17", callerNumber: CALLER });
    expect(res.success).toBe(true);
    expect(h.inserted).toHaveLength(0);
  });
});

describe("one text per call (persisted claim)", () => {
  it("two bookSlot calls with the same callId send exactly one text", async () => {
    const caller = await loadCaller();
    const a = await caller.bookSlot(TOW);
    const b = await caller.bookSlot(TOW);
    expect(h.textOnDutyManager).toHaveBeenCalledTimes(1);
    expect(a.status).toBe("shop_texted");
    expect(b.status).toBe("shop_texted");
    expect(h.recordExpectedArrival).not.toHaveBeenCalled();
  });

  it("different calls each get their own text", async () => {
    const caller = await loadCaller();
    await caller.bookSlot(TOW);
    await caller.bookSlot({ ...TOW, callId: "call_test_2" });
    expect(h.textOnDutyManager).toHaveBeenCalledTimes(2);
  });

  it("a failed send hands the claim back, so the next attempt sends", async () => {
    h.textOnDutyManager.mockResolvedValueOnce({ status: "failed", reason: "gateway down" });
    const caller = await loadCaller();
    const first = await caller.bookSlot(TOW);
    expect(first.status).toBe("walk_in_guidance"); // the row path caught the visit
    expect(h.recordExpectedArrival).toHaveBeenCalledTimes(1);
    const second = await caller.bookSlot(TOW);
    expect(h.textOnDutyManager).toHaveBeenCalledTimes(2);
    expect(second.status).toBe("shop_texted");
  });
});

describe("fallbacks keep the visit", () => {
  it("vapi_arrival_text_paused ON → no text, row path runs", async () => {
    h.isEnabled.mockImplementation(async (k: string) => k === "vapi_arrival_text_paused");
    const res = await (await loadCaller()).bookSlot(TOW);
    expect(h.isEnabled).toHaveBeenCalledWith("vapi_arrival_text_paused");
    expect(h.textOnDutyManager).not.toHaveBeenCalled();
    expect(h.recordExpectedArrival).toHaveBeenCalledTimes(1);
    expect(res.status).toBe("walk_in_guidance");
  });

  it.each([
    ["skipped", () => h.textOnDutyManager.mockResolvedValue({ status: "skipped", reason: "no on-duty number" })],
    ["failed", () => h.textOnDutyManager.mockResolvedValue({ status: "failed", reason: "gateway down" })],
    ["thrown", () => h.textOnDutyManager.mockRejectedValue(new Error("boom"))],
  ])("text %s → row path runs and VOICE_ARRIVAL_TEXT_FAILED is logged without PII", async (_label, arrange) => {
    arrange();
    const res = await (await loadCaller()).bookSlot(TOW);
    expect(h.recordExpectedArrival).toHaveBeenCalledTimes(1);
    expect(res.status).toBe("walk_in_guidance");
    const warned = h.warn.mock.calls.find((c) => (c[1] as { errorId?: string } | undefined)?.errorId === "VOICE_ARRIVAL_TEXT_FAILED");
    expect(warned).toBeDefined();
    expect(JSON.stringify(warned)).not.toMatch(/Ray|555-?0123|5550123/);
  });
});

describe("the name never blocks the heads-up", () => {
  it("short name + caller ID on file → the record's name", async () => {
    h.customerRows = [{ firstName: "Raymond", lastName: "Smith" }];
    const res = await (await loadCaller()).bookSlot({ ...TOW, name: "R" });
    expect(res.status).toBe("shop_texted");
    expect(bodyOf()).toContain("Raymond S. - (216) 555-0123");
  });

  // 2026-10-22: an empty name with no record now asks once (name_needed); the
  // sentinel "not given" is how the model says they wouldn't tell.
  it("empty name, no record → asks once; 'not given' then sends 'Name not given'", async () => {
    const caller = await loadCaller();
    expect((await caller.bookSlot({ ...TOW, name: "" })).status).toBe("name_needed");
    const res = await caller.bookSlot({ ...TOW, name: "not given" });
    expect(res.status).toBe("shop_texted");
    expect(bodyOf()).toContain("Name not given - (216) 555-0123");
  });

  it("the text stays ASCII without losing the name: accents fold, a non-Latin name falls back", async () => {
    const caller = await loadCaller();
    await caller.bookSlot({ ...TOW, name: "José" });
    expect(bodyOf(0)).toContain("Jose - (216) 555-0123");
    await caller.bookSlot({ ...TOW, callId: "call_test_9", name: "محمد" });
    expect(bodyOf(1)).toContain("Name not given - (216) 555-0123");
  });

  it("a different 10-digit spoken number rides along as Callback:", async () => {
    await (await loadCaller()).bookSlot({ ...TOW, phone: "216-555-0177" });
    expect(bodyOf()).toContain("Ray - (216) 555-0123");
    expect(bodyOf()).toContain("Callback: (216) 555-0177");
  });
});

describe("the text goes to the on-duty number, never the caller", () => {
  it("sendSms destination is the on-duty manager, internal class, shop line", async () => {
    h.onDuty.mockResolvedValue("+12165550188");
    h.sendSms.mockResolvedValue({ success: true });
    const res = await (await loadCaller({ realEventBus: true })).bookSlot(TOW);
    expect(res.status).toBe("shop_texted");
    expect(h.sendSms).toHaveBeenCalledTimes(1);
    expect(h.sendSms.mock.calls[0][0]).toBe("+12165550188");
    expect(h.sendSms.mock.calls[0][2]).toMatchObject({ via: "shop", messageClass: "internal" });
    expect(String(h.sendSms.mock.calls[0][1])).toContain("TOW COMING");
  });

  it("on-duty number is the shop gateway → skipped, row path runs", async () => {
    h.onDuty.mockResolvedValue("+12168620005");
    const res = await (await loadCaller({ realEventBus: true })).bookSlot(TOW);
    expect(h.sendSms).not.toHaveBeenCalled();
    expect(res.status).toBe("walk_in_guidance");
  });
});

describe("escalate uses caller ID", () => {
  it("{ reason, callerNumber } only → saved under caller ID as 'Caller', callbackRequested once", async () => {
    const res = await (await loadCaller()).escalate({ reason: "wants the manager", callerNumber: CALLER, callId: "call_e1" });
    expect(res).toMatchObject({ success: true });
    expect(h.inserted).toHaveLength(1);
    expect(h.inserted[0]).toMatchObject({ name: "Caller", phone: "2165550123" });
    await vi.waitFor(() => expect(h.callbackRequested).toHaveBeenCalledTimes(1), { timeout: 15_000, interval: 20 });
    expect(h.callbackRequested).toHaveBeenCalledWith(expect.objectContaining({ id: 77, name: "Caller", phone: "2165550123" }));
  });

  it("caller ID on file → the record's name", async () => {
    h.customerRows = [{ firstName: "Raymond", lastName: "Smith" }];
    await (await loadCaller()).escalate({ reason: "status check", callerNumber: CALLER });
    expect(h.inserted[0]).toMatchObject({ name: "Raymond S.", phone: "2165550123" });
  });

  it("no 10-digit number anywhere → needs_number, no insert, no throw", async () => {
    const res = await (await loadCaller()).escalate({ reason: "callback", callerNumber: "anonymous" });
    expect(res).toMatchObject({ success: false, needs_number: true });
    expect(h.inserted).toHaveLength(0);
  });

  it("DB failure → success:false with the NOT saved message, no throw", async () => {
    h.insertFails = true;
    const res = await (await loadCaller()).escalate({ reason: "callback", callerNumber: CALLER });
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/NOT saved/);
    expect(h.callbackRequested).not.toHaveBeenCalled();
  });
});
