/**
 * Q-12 phase 1c · the three emit sites that give bridge_outbox its keys.
 *
 * bridgeOutbox.ts keys callback_requested by `data.id`, emergency_request by
 * `data.id` and review_detected by `data.reviewId`. The type `id: number | null`
 * stops a caller leaving the field out, not passing null, so these pin the
 * value each site actually sends: if one regresses, that family's shadow rows
 * go back to "bridge_outbox unkeyed" while every other test stays green
 * (the orchestrator's review of #2799 found exactly that: 3 surviving mutants).
 *
 * Every side effect of the three paths (SMS, email, Sheets, Meta CAPI,
 * Telegram, integration-failure log) is stubbed; each mock spreads the real
 * module so serial vitest never sees a partial one (apps/nickstire/AGENTS.md §3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  emit: { callbackRequested: vi.fn(async () => undefined), emergencyRequest: vi.fn(async () => undefined) },
  dispatch: vi.fn(async () => undefined),
  createCallbackRequest: vi.fn(async () => ({ success: true, id: 311 })),
  helperDb: null as unknown,
  getDb: null as unknown,
  selectRows: [] as unknown[],
}));

vi.mock("./services/eventBus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/eventBus")>()),
  emit: h.emit,
  dispatch: h.dispatch,
}));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  createCallbackRequest: h.createCallbackRequest,
  getDb: async () => h.getDb,
}));
vi.mock("./lib/db-helper", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/db-helper")>()),
  db: async () => h.helperDb,
}));
vi.mock("./email-notify", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./email-notify")>()),
  notifyCallbackRequest: vi.fn(async () => undefined),
  notifySystemAlert: vi.fn(async () => undefined),
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
vi.mock("./services/telegram", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/telegram")>()),
  alertNewLead: vi.fn(async () => undefined),
  sendTelegram: vi.fn(async () => undefined),
}));
vi.mock("./integration-failures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./integration-failures")>()),
  logIntegrationFailure: vi.fn(async () => undefined),
}));

import { callbackRouter } from "./routers/callback";
import { emergencyRouter } from "./routers/emergency";
import { processReviewMonitor } from "./cron/jobs/reviewMonitor";
import { stableReviewId } from "./lib/reviewIdentity";
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
  insert: () => ({ values: async () => [{ affectedRows: 1, insertId: 12 }] }),
  update: () => ({ set: () => chain() }),
  execute: async () => [[], []],
};

describe("bridge_outbox emit sites carry the row id the key names", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.helperDb = null;
    h.getDb = null;
    h.selectRows = [];
  });
  afterEach(async () => {
    await vi.dynamicImportSettled();
  });

  it("callback.submit emits the callback_requests id it inserted", async () => {
    h.createCallbackRequest.mockResolvedValueOnce({ success: true, id: 311 });
    await callbackRouter.createCaller(PUBLIC_CTX).submit({ name: "Ann Test", phone: "2165550142" });
    await vi.dynamicImportSettled();
    expect(h.emit.callbackRequested).toHaveBeenCalledTimes(1);
    expect(h.emit.callbackRequested).toHaveBeenCalledWith(expect.objectContaining({ id: 311 }));
  });

  it("emergency.submit emits the emergency_requests id of the row it persisted", async () => {
    h.helperDb = fakeDb;
    h.selectRows = [{ id: 12 }];
    await emergencyRouter.createCaller(PUBLIC_CTX).submit({
      name: "Ann Test",
      phone: "2165550142",
      problem: "Flat tire on the highway",
      urgency: "emergency",
    });
    await vi.dynamicImportSettled();
    expect(h.emit.emergencyRequest).toHaveBeenCalledTimes(1);
    expect(h.emit.emergencyRequest).toHaveBeenCalledWith(expect.objectContaining({ id: 12 }));
  });

  describe("review monitor", () => {
    const saved = process.env.GOOGLE_PLACES_API_KEY;
    const review = { author_name: "Pat Q", rating: 5, text: "Great tire work", time: 1790000000 };
    beforeEach(() => {
      process.env.GOOGLE_PLACES_API_KEY = "test-key";
      vi.stubGlobal("fetch", async () =>
        new Response(JSON.stringify({ status: "OK", result: { reviews: [review] } })),
      );
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      if (saved === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
      else process.env.GOOGLE_PLACES_API_KEY = saved;
    });

    it("dispatches review_detected with the review's stableReviewId", async () => {
      h.getDb = fakeDb;
      h.selectRows = []; // not seen before
      const res = await processReviewMonitor();
      await vi.dynamicImportSettled();
      expect(res.recordsProcessed).toBe(1);
      const call = h.dispatch.mock.calls.find((c) => (c as unknown[])[0] === "review_detected") as unknown[] | undefined;
      expect(call).toBeDefined();
      expect(call![1]).toMatchObject({ reviewId: stableReviewId(review) });
      expect(stableReviewId(review)).toBe("1790000000");
    });
  });
});
