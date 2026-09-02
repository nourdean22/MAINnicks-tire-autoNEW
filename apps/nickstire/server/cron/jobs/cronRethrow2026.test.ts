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

  it("CANARY — a job that still swallows would RESOLVE here, proving `rejects` bites", async () => {
    const swallowing = async () => {
      try { throw new Error("boom"); } catch (err) { return { recordsProcessed: 0, details: `Failed: ${(err as Error).message}` }; }
    };
    await expect(swallowing()).resolves.toMatchObject({ recordsProcessed: 0 });
  });
});
