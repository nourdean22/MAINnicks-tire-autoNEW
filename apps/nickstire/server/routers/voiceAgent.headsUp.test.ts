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
  claims: new Set<string>(),
  customerRows: [] as Array<Record<string, unknown>>,
  inserted: [] as Array<Record<string, unknown>>,
  insertFails: false,
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

const fakeDrizzle = {
  update: () => ({ set: () => ({ where: async () => undefined }) }),
  select: () => ({ from: () => ({ where: () => ({ limit: async () => h.customerRows }) }) }),
  insert: () => ({
    values: async (v: Record<string, unknown>) => {
      if (h.insertFails) throw new Error("db down");
      h.inserted.push(v);
      return [{ insertId: 77 }];
    },
  }),
};

function createVoiceContext(): TrpcContext {
  return {
    user: null,
    isVoiceAgentInternal: true,
    req: { protocol: "https", headers: {} } as any,
    res: { clearCookie: () => {} } as any,
  };
}

const MOCKED = [
  "../services/expectedArrivals",
  "../services/featureFlags",
  "../lib/db-helper",
  "../db",
  "../lib/logger",
  "../services/voice-call-state",
  "../services/promiseLedger",
  "../services/eventBus",
  "../services/vapi",
  "../sms",
];

async function loadCaller(opts: { realEventBus?: boolean } = {}) {
  vi.resetModules();
  vi.doMock("../services/expectedArrivals", async (orig) => ({
    ...(await orig<typeof import("../services/expectedArrivals")>()),
    recordExpectedArrival: h.recordExpectedArrival,
  }));
  vi.doMock("../services/featureFlags", async (orig) => ({
    ...(await orig<typeof import("../services/featureFlags")>()),
    isEnabled: h.isEnabled,
  }));
  vi.doMock("../lib/db-helper", () => ({ db: async () => fakeDrizzle }));
  vi.doMock("../db", async (orig) => ({
    ...(await orig<typeof import("../db")>()),
    getDb: async () => ({
      execute: async (q: { queryChunks?: unknown[] }) => {
        const { text, params } = render(q);
        const key = `${params[0]}|${params[1]}`;
        if (/INSERT IGNORE/i.test(text)) {
          if (h.claims.has(key)) return [{ affectedRows: 0 }];
          h.claims.add(key);
          return [{ affectedRows: 1 }];
        }
        if (/DELETE/i.test(text)) { h.claims.delete(key); return [{ affectedRows: 1 }]; }
        return [[]];
      },
    }),
  }));
  vi.doMock("../lib/logger", async (orig) => ({
    ...(await orig<typeof import("../lib/logger")>()),
    createLogger: () => ({ info: () => {}, debug: () => {}, error: () => {}, warn: h.warn }),
  }));
  vi.doMock("../services/voice-call-state", () => ({ recordCallState: vi.fn(async () => {}) }));
  vi.doMock("../services/promiseLedger", () => ({ createVoicePromise: vi.fn(async () => ({ skipped: true, reason: "test" })) }));
  if (opts.realEventBus) {
    vi.doMock("../services/vapi", async (orig) => ({
      ...(await orig<typeof import("../services/vapi")>()),
      getOnDutyManagerPhone: h.onDuty,
    }));
    vi.doMock("../sms", async (orig) => ({ ...(await orig<typeof import("../sms")>()), sendSms: h.sendSms }));
  } else {
    vi.doMock("../services/eventBus", () => ({
      textOnDutyManager: h.textOnDutyManager,
      emit: { callbackRequested: h.callbackRequested },
    }));
  }
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
  h.isEnabled.mockResolvedValue(false);
  h.textOnDutyManager.mockResolvedValue({ status: "sent" });
  h.recordExpectedArrival.mockResolvedValue({ id: 9, created: true });
  h.callbackRequested.mockResolvedValue(undefined);
});

afterEach(() => {
  for (const m of MOCKED) vi.doUnmock(m);
  vi.resetModules();
  vi.useRealTimers();
  for (const f of [h.recordExpectedArrival, h.textOnDutyManager, h.callbackRequested, h.isEnabled, h.warn, h.sendSms, h.onDuty]) f.mockReset();
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

  it("empty name, no record → 'Name not given', and nothing re-asks", async () => {
    const res = await (await loadCaller()).bookSlot({ ...TOW, name: "" });
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
    await vi.waitFor(() => expect(h.callbackRequested).toHaveBeenCalledTimes(1));
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
