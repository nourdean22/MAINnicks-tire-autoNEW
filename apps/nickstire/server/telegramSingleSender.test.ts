/**
 * Telegram alert diet · one sender per lead, callback, chat lead and booking.
 *
 * The event bus's "telegram" destination is the canonical sender for these
 * events. Before this change each router ALSO called alertNewLead directly, so
 * one lead buzzed Nour's phone twice (three times counting the StateNour bridge,
 * which is the other lane's job). The bus emit below runs the REAL telegram
 * destination handler; the transport (services/telegram) is mocked and counted.
 * Every path is exercised the way production runs it: router + bus together.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sends: [] as Array<{ via: string; text: string; cls?: string }>,
  recordLeadDelivery: vi.fn(async () => undefined),
  fakeDb: null as unknown,
  getDb: null as unknown,
  selectRows: [] as unknown[],
  accept: true,
}));

vi.mock("./services/telegram", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/telegram")>()),
  sendTelegram: vi.fn(async (text: string, cls?: string) => {
    h.sends.push({ via: "sendTelegram", text, cls });
    return h.accept;
  }),
  sendTelegramMessage: vi.fn(async (text: string) => {
    h.sends.push({ via: "sendTelegramMessage", text });
    return true;
  }),
  alertNewLead: vi.fn(async (lead: { name: string }) => {
    h.sends.push({ via: "alertNewLead", text: lead.name });
    return true;
  }),
}));

// emit.* runs the REAL telegram destination of the bus (and only that one).
vi.mock("./services/eventBus", async (importOriginal) => {
  const real = await importOriginal<typeof import("./services/eventBus")>();
  const runTelegramDestination = async (type: Parameters<typeof real.__routeForTest>[0], data: Record<string, unknown>) => {
    const routes = await real.__routeForTest(type);
    const telegram = routes.find((r) => r.name === "telegram");
    if (telegram) {
      await telegram.handler({ type, data, priority: "high", source: "test", timestamp: new Date().toISOString() });
    }
  };
  return {
    ...real,
    emit: {
      ...real.emit,
      leadCaptured: (d: Record<string, unknown>) => runTelegramDestination("lead_captured", d),
      callbackRequested: (d: Record<string, unknown>) => runTelegramDestination("callback_requested", d),
      bookingCreated: (d: Record<string, unknown>) => runTelegramDestination("booking_created", d),
      bookingCompleted: (d: Record<string, unknown>) => runTelegramDestination("booking_completed", d),
    },
  };
});

vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getDb: async () => h.getDb,
  createCallbackRequest: vi.fn(async () => ({ success: true, id: 311 })),
}));
vi.mock("./lib/db-helper", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/db-helper")>()),
  db: async () => h.fakeDb,
}));
vi.mock("./gemini", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./gemini")>()),
  scoreLead: vi.fn(async () => ({ score: 3, reason: "test", recommendedService: "Brakes" })),
}));
vi.mock("./email-notify", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./email-notify")>()),
  notifyNewLead: vi.fn(async () => undefined),
  notifyCallbackRequest: vi.fn(async () => undefined),
}));
vi.mock("./sheets-sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sheets-sync")>()),
  syncLeadToSheet: vi.fn(async () => undefined),
  syncCallbackToSheet: vi.fn(async () => undefined),
}));
vi.mock("./sms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sms")>()),
  sendSms: vi.fn(async () => ({ success: true })),
  sendSmsOrThrow: vi.fn(async () => ({ success: true })),
}));
vi.mock("./meta-capi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./meta-capi")>()),
  sendLeadEvent: vi.fn(async () => undefined),
}));
vi.mock("./services/afterHours", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/afterHours")>()),
  isAfterHours: () => false,
  handleAfterHoursCapture: vi.fn(async () => undefined),
}));
vi.mock("./integration-failures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./integration-failures")>()),
  logIntegrationFailure: vi.fn(async () => undefined),
}));
vi.mock("./lead-delivery", () => ({ recordLeadDelivery: h.recordLeadDelivery }));
vi.mock("./services/complianceLog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/complianceLog")>()),
  logSmsOptIn: vi.fn(async () => undefined),
}));
vi.mock("./services/activityLedger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/activityLedger")>()),
  withActivityLedger: (opts: { next: () => unknown }) => opts.next(),
}));

import { leadRouter } from "./routers/lead";
import { callbackRouter } from "./routers/callback";
import { createChatLead } from "./routers/chat";
import { autoCreateLeadFromBooking } from "./services/workOrderAutomation";
import { emit } from "./services/eventBus";
import type { TrpcContext } from "./_core/context";

const PUBLIC_CTX = {
  user: null,
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: { clearCookie: () => {} } as TrpcContext["res"],
} as TrpcContext;

/** A drizzle-shaped chain: every builder method returns the chain; awaiting it yields h.selectRows. */
function chain(): unknown {
  const target = { then: (resolve: (v: unknown[]) => unknown) => resolve(h.selectRows) };
  return new Proxy(target, {
    get(t, prop) {
      if (prop === "then") return t.then;
      return () => chain();
    },
  });
}
const fakeDb = {
  select: () => chain(),
  insert: () => ({
    values: () => {
      const inserted = Promise.resolve([{ affectedRows: 1, insertId: 42 }]);
      return Object.assign(inserted, { $returningId: async () => [{ id: 42 }] });
    },
  }),
  update: () => ({ set: () => chain() }),
  execute: async () => [[], []],
};

async function settle() {
  await vi.dynamicImportSettled();
  await new Promise((r) => setTimeout(r, 20));
  await vi.dynamicImportSettled();
}

describe("one Telegram message per lead, callback, chat lead and booking", () => {
  beforeEach(() => {
    h.sends.length = 0;
    h.recordLeadDelivery.mockClear();
    h.fakeDb = fakeDb;
    h.getDb = fakeDb;
    h.selectRows = [];
    h.accept = true;
  });

  const submitLead = () =>
    leadRouter.createCaller(PUBLIC_CTX).submit({ name: "Ann Test", phone: "2165550142", problem: "brakes grind", source: "popup" });
  const telegramRows = () =>
    h.recordLeadDelivery.mock.calls.map((c) => c[0] as { leadId: number; channel: string; status: string }).filter((r) => r.channel === "telegram");

  it("records the lead's telegram delivery as sent only when the transport accepted the alert", async () => {
    await submitLead();
    await settle();
    expect(telegramRows()).toEqual([expect.objectContaining({ leadId: 42, status: "sent" })]);
  });

  it("records the lead's telegram delivery as failed when the transport did not accept the alert", async () => {
    h.accept = false;
    await submitLead();
    await settle();
    expect(telegramRows()).toEqual([expect.objectContaining({ leadId: 42, status: "failed" })]);
  });

  it("lead.submit sends exactly one Telegram alert when the router and the bus both run", async () => {
    const res = await leadRouter.createCaller(PUBLIC_CTX).submit({
      name: "Ann Test",
      phone: "2165550142",
      problem: "brakes grind",
      source: "popup",
    });
    await settle();
    expect(res).toMatchObject({ success: true, leadId: 42 });
    expect(h.sends.map((s) => s.via)).toEqual(["sendTelegram"]);
  });

  it("callback.submit sends exactly one Telegram alert (the CALLBACK REQUEST), not a second NEW LEAD", async () => {
    await callbackRouter.createCaller(PUBLIC_CTX).submit({ name: "Ann Test", phone: "2165550142" });
    await settle();
    expect(h.sends).toHaveLength(1);
    expect(h.sends[0].text).toContain("CALLBACK REQUEST");
  });

  it("a chat lead sends exactly one Telegram alert", async () => {
    await createChatLead(
      fakeDb as never,
      7,
      { vehicle: "2015 Civic", problem: "flat tire" },
      [{ role: "user", content: "I'm Ann Test, call me at 216-555-0142" }],
    );
    await settle();
    expect(h.sends).toHaveLength(1);
  });

  it("a completed job sends exactly one Telegram message and it is a receipt (held unless telegram_receipt is ON)", async () => {
    await emit.bookingCompleted({ id: 9, name: "Ann Test", service: "Brakes" });
    await settle();
    expect(h.sends).toHaveLength(1);
    expect(h.sends[0]).toMatchObject({ cls: "receipt" });
    expect(h.sends[0].text).toContain("JOB COMPLETED");
  });

  it("an online booking sends exactly one Telegram alert, not NEW BOOKING plus NEW LEAD", async () => {
    const booking = { id: 9, name: "Ann Test", phone: "2165550142", service: "Brakes" };
    await emit.bookingCreated(booking);
    await autoCreateLeadFromBooking(booking);
    await settle();
    expect(h.sends).toHaveLength(1);
    expect(h.sends[0].text).toContain("NEW BOOKING");
  });
});
