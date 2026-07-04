/**
 * Cron rethrow-contract test · wave-181.18 · Gap 4 from test-analyzer audit
 *
 * Wave-181.3 changed warrantyAlerts.ts catch from `return {recordsProcessed: 0}`
 * to `throw err` — the silent-failure F3 fix. Wave-181.15 did the same
 * for vapiLatencySync.ts. Wave-181.16 did the same for campaigns.ts
 * resumeStuckCampaigns.
 *
 * This is a CONTRACT CHANGE that the cron runner depends on (status='failed'
 * vs status='completed' in cron_log). A future engineer "cleaning up error
 * handling" — or an AI-assisted refactor — could re-introduce
 * `return { recordsProcessed: 0 }` because that pattern still exists in
 * ~30 other cron jobs in this repo.
 *
 * This test asserts these specific crons REJECT (don't resolve) when
 * their core dependency throws. If the test fails, someone reverted the
 * silent-failure fix and customers lose alerts again.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

describe("cron rethrow contract · wave-181.3 + .15 silent-failure fixes", () => {
  describe("processWarrantyAlerts", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      // vi.doMock registrations are not file-scoped in singleFork serial
      // mode — drop them so later files get the real featureFlags module.
      vi.doUnmock("../../services/featureFlags");
    });

    it("REJECTS when an inner dependency throws (wave-181.3 contract)", async () => {
      // Mock the feature-flag service to throw — it's the first dynamic
      // import inside the try block. That bypasses the early-return
      // guards (flag-disabled, db-null) and exercises the outer catch
      // block which wave-181.3 changed to rethrow instead of swallow.
      vi.doMock("../../services/featureFlags", () => ({
        isEnabled: async () => {
          throw new Error("feature-flag service unreachable");
        },
      }));
      const { processWarrantyAlerts } = await import("./warrantyAlerts");
      await expect(processWarrantyAlerts()).rejects.toThrow();
    });
  });

  describe("processVapiLatencySync", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      // vi.doMock registrations are not file-scoped in singleFork serial
      // mode — drop them so later files get the real featureFlags module.
      vi.doUnmock("../../services/featureFlags");
    });

    // wave-181.60 · switched from `rejects.toThrow(/regex/)` to manual
    // try/catch + .message inspection. Vitest 2.1.4 has a quirk where
    // `rejects.toThrow(regex)` reports "Received: ''" against a rejection
    // whose .message clearly contains the pattern (confirmed via log
    // output showing the right error landed in the catch block). The
    // bare `rejects.toThrow()` form works (see warrantyAlerts above), so
    // we use a manual catch which inspects .message directly and is
    // immune to the matcher quirk.
    it("REJECTS when VAPI_API_KEY is unset (wave-181.15 contract)", async () => {
      vi.stubEnv("VAPI_API_KEY", "");
      const { processVapiLatencySync } = await import("./vapiLatencySync");
      let caught: unknown;
      try {
        await processVapiLatencySync();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toMatch(/VAPI_API_KEY/);
    });

    it("REJECTS when VAPI /call upstream returns 5xx (wave-181.15 contract)", async () => {
      vi.stubEnv("VAPI_API_KEY", "fake-test-key");
      // Stub global fetch to simulate a 503 from VAPI's API.
      const fetchStub = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => [],
      } as unknown as Response);
      vi.stubGlobal("fetch", fetchStub);

      const { processVapiLatencySync } = await import("./vapiLatencySync");
      let caught: unknown;
      try {
        await processVapiLatencySync();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toMatch(/VAPI \/call returned 503/);
    });
  });
});
