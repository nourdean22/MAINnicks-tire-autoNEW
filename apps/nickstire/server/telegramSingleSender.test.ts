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
  flags: {} as Record<string, boolean>,
  // Every emit.emergencyRequest call (the bridge emit statenour alerts and retries on), and
  // whether the stub also runs the bus's real telegram destination for it (pins router and bus apart).
  emergencyEmits: [] as Array<Record<string, unknown>>,
  runEmergencyBus: true,
}));

vi.mock("./services/featureFlags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/featureFlags")>()),
  isEnabled: vi.fn(async (key: string) => h.flags[key] === true),
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
      emergencyRequest: (d: Record<string, unknown>) => {
        h.emergencyEmits.push(d);
        return h.runEmergencyBus ? runTelegramDestination("emergency_request", d) : undefined;
      },
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
import { emergencyRouter } from "./routers/emergency";
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
    h.flags = {};
    h.emergencyEmits.length = 0;
    h.runEmergencyBus = true;
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

  it("records the lead's telegram delivery as skipped, never sent, when the incident class is muted", async () => {
    h.flags.telegram_incident_muted = true; // the real transport returns true for a held send
    await submitLead();
    await settle();
    expect(telegramRows()).toEqual([expect.objectContaining({ leadId: 42, status: "skipped", detail: expect.stringContaining("telegram_incident_muted") })]);
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

// Nour, 2026-10-17: "drop nickstire". An emergency request reaches Telegram through statenour's
// bridge route only (its copy is the one with retry); nickstire sends none of its own. The bridge
// emit itself stays: statenour needs it to alert and to retry an undelivered emergency.
describe("an emergency request sends no Telegram from nickstire and still emits to the bridge once", () => {
  const submitEmergency = () =>
    emergencyRouter.createCaller(PUBLIC_CTX).submit({
      name: "Ann Test",
      phone: "2165550142",
      vehicle: "2015 Civic",
      problem: "Flat tire on I-90",
      urgency: "emergency",
    });

  beforeEach(() => {
    h.sends.length = 0;
    h.fakeDb = fakeDb;
    h.getDb = fakeDb;
    h.accept = true;
    h.flags = {};
    h.emergencyEmits.length = 0;
    h.runEmergencyBus = true;
    h.selectRows = [{ id: 77 }]; // the emergency_requests row the router reads back after its insert
  });

  it("emergency.submit sends zero Telegram messages with the router and the bus both running", async () => {
    await submitEmergency();
    await settle();
    expect(h.sends.map((s) => s.text)).toEqual([]);
    // the bridge emit statenour alerts and retries on is untouched: once, carrying the persisted row id
    expect(h.emergencyEmits).toHaveLength(1);
    expect(h.emergencyEmits[0]).toMatchObject({
      id: 77,
      name: "Ann Test",
      phone: expect.any(String),
      problem: "Flat tire on I-90",
      urgency: "emergency",
    });
    // positive control: this counter is live, the bus still alerts on a booking and it counts once
    await emit.bookingCreated({ id: 9, name: "Ann Test", phone: "2165550142", service: "Brakes" });
    await settle();
    expect(h.sends.map((s) => s.text)).toEqual([expect.stringContaining("NEW BOOKING")]);
  });

  it("the router sends no Telegram of its own (bus off)", async () => {
    h.runEmergencyBus = false;
    await submitEmergency();
    await settle();
    expect(h.sends.map((s) => s.text)).toEqual([]);
    expect(h.emergencyEmits).toHaveLength(1);
  });

  it("the bus's telegram destination does not alert on an emergency_request (router bypassed)", async () => {
    await emit.emergencyRequest({ id: 77, name: "Ann Test", phone: "2165550142", problem: "Flat tire on I-90", urgency: "emergency" });
    await settle();
    expect(h.sends.map((s) => s.text)).toEqual([]);
  });
});
