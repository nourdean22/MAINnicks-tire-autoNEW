/**
 * Cron rethrow contract · 2026-09-01 admin audit (F-9).
 *
 * Nine cron jobs swallowed their outer error into
 * `return { recordsProcessed: 0, details: "Failed: …" }` — which cron_log
 * records as `completed`, and which the observer (cron/observer.ts) never
 * reads, so a job could fail every run for weeks with no alert. Same contract
 * as cron-rethrow.test.ts (wave-181.3): the handler must REJECT when its core
 * dependency throws.
 *
 * Each case mocks the FIRST awaited dependency inside the job's try block so
 * exactly the changed catch is exercised. runIntelligenceAutopilot also
 * rethrows now, but every dependency it awaits is wrapped in its own inner
 * catch (the engines swallow), so its outer catch cannot be reached by a
 * mock — it is covered by source assertion only, not pretended here.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

describe("cron rethrow contract · 2026-09-01 audit F-9", () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    // doMocks are not file-scoped under singleFork serial — drop them.
    vi.doUnmock("../../db");
    vi.doUnmock("../../services/featureFlags");
  });

  it("processChatFaqPipeline REJECTS when the DB is unreachable", async () => {
    vi.doMock("../../db", () => ({ getDb: async () => { throw new Error("database unreachable (canary)"); } }));
    const mod = await import("./chatFaqPipeline");
    const fn = Object.values(mod).find((v) => typeof v === "function") as () => Promise<unknown>;
    await expect(fn()).rejects.toThrow(/database unreachable/);
  });

  it("processReviewMonitor REJECTS when Google is unreachable (key present, fetch throws)", async () => {
    // Without a key the job legitimately SKIPS before touching anything —
    // that is a skip, not a swallow. Give it a key so the try block runs.
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "canary-key");
    vi.stubGlobal("fetch", async () => { throw new Error("network down (canary)"); });
    const { processReviewMonitor } = await import("./reviewMonitor");
    await expect(processReviewMonitor()).rejects.toThrow(/network down/);
  });

  it("runConfirmationCalls REJECTS when the candidate query throws (all four safety gates satisfied)", async () => {
    // The job skips — legitimately — unless VAPI is configured, the feature
    // flag is on, an outbound number resolves, and it is 3–6 PM Cleveland.
    // Satisfy every gate so the ONLY thing between the job and a clean run is
    // the throwing query; that is the catch this test pins.
    vi.stubEnv("VAPI_API_KEY", "canary");
    vi.stubEnv("FEATURE_CONFIRMATION_CALLS", "1");
    vi.doMock("../../services/vapi", () => ({ resolveVapiPhoneNumberId: async () => "pn_canary" }));
    vi.doMock("../../lib/timezoneAssert", () => ({
      getBusinessHour: () => 16,
      getBusinessDateKey: () => "2026-09-02",
    }));
    vi.doMock("../../db", () => ({
      getDb: async () => ({
        select: () => { throw new Error("select exploded (canary)"); },
      }),
    }));
    try {
      const { runConfirmationCalls } = await import("./confirmationCalls");
      await expect(runConfirmationCalls()).rejects.toThrow(/select exploded/);
    } finally {
      vi.doUnmock("../../services/vapi");
      vi.doUnmock("../../lib/timezoneAssert");
    }
  });

  // 2026-09-23 widening of cronNoSwallowedFailure: ten crudAutomation catches
  // returned "<X> failed: …" as a completed run. Each now REJECTS with the same
  // text, so cron_log's details column still reads the same words.
  it.each([
    ["detectNoShows", /No-show detection failed: database unreachable/],
    ["autoCleanStaleBookings", /Stale booking cleanup failed: database unreachable/],
    ["alertLowStock", /Low-stock check failed: database unreachable/],
    ["autoAdvanceWorkOrders", /WO auto-advance failed: database unreachable/],
    ["autoEscalateBookingPriority", /Booking escalation failed: database unreachable/],
    ["autoFetchAndDraftReviews", /Review drafting failed: database unreachable/],
    ["closeReferralLoop", /Referral loop failed: database unreachable/],
    ["notifyNewVips", /VIP notification failed: database unreachable/],
  ])("crudAutomation.%s REJECTS when the DB is unreachable", async (name, expected) => {
    vi.doMock("../../db", () => ({ getDb: async () => { throw new Error("database unreachable (canary)"); } }));
    // closeReferralLoop / notifyNewVips skip before their try when their flag is off.
    vi.doMock("../../services/featureFlags", () => ({ isEnabled: async () => true }));
    const mod = (await import("./crudAutomation")) as unknown as Record<string, () => Promise<unknown>>;
    await expect(mod[name]()).rejects.toThrow(expected);
  });

  it("crudAutomation.autoGenerateContent REJECTS when article generation throws (on a content day)", async () => {
    // The job only runs Wed/Sat (shop TZ) — pin the clock so this is not a
    // test that passes two days a week.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-23T16:00:00Z")); // Wednesday noon ET
    vi.doMock("../../content-generator", () => ({ generateArticle: async () => { throw new Error("llm down (canary)"); } }));
    try {
      const { autoGenerateContent } = await import("./crudAutomation");
      await expect(autoGenerateContent()).rejects.toThrow(/Content gen failed: llm down/);
    } finally {
      vi.doUnmock("../../content-generator");
      vi.useRealTimers();
    }
  });

  it("crudAutomation.processReminders REJECTS when the reminder queue throws", async () => {
    vi.doMock("../../routers/reminders", () => ({ processReminderQueue: async () => { throw new Error("queue exploded (canary)"); } }));
    try {
      const { processReminders } = await import("./crudAutomation");
      await expect(processReminders()).rejects.toThrow(/Reminders failed: queue exploded/);
    } finally {
      vi.doUnmock("../../routers/reminders");
    }
  });

  it("processReviewMonitor REJECTS on a non-OK Google response (not only on a thrown fetch)", async () => {
    vi.stubEnv("GOOGLE_PLACES_API_KEY", "canary-key");
    vi.stubGlobal("fetch", async () => new Response("quota", { status: 429 }));
    const { processReviewMonitor } = await import("./reviewMonitor");
    await expect(processReviewMonitor()).rejects.toThrow(/Google API error: 429/);
  });

  it("checkWeatherTriggers (weather-intel handler) REJECTS on a non-OK NWS response", async () => {
    vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
    const { checkWeatherTriggers } = await import("../../services/weatherIntelligence");
    await expect(checkWeatherTriggers()).rejects.toThrow(/NWS 503/);
  });

  it("CANARY — a job that still swallows would RESOLVE here, proving `rejects` bites", async () => {
    const swallowing = async () => {
      try { throw new Error("boom"); } catch (err) { return { recordsProcessed: 0, details: `Failed: ${(err as Error).message}` }; }
    };
    await expect(swallowing()).resolves.toMatchObject({ recordsProcessed: 0 });
  });
});
