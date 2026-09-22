/**
 * A zero-record run says WHY (2026-09-22)
 *
 * WHAT WAS WRONG. Five tier jobs returned `{ recordsProcessed: 0 }` with no
 * `details` for three different facts — the feature flag is off, nothing was
 * due, or the job is a documented no-op — so cron_log carried `<null>` for
 * 439 runs of sms-scheduler, 439 of abandoned-forms, 36 of
 * customer-segment-refresh, 7 of customer-segmentation and 7 of
 * warranty-alerts in 30 days. "Flag off" and "nothing to send" read the same,
 * and the 2026-09-22 cron census could not tell them apart without opening
 * the code. This is the empty-vs-unmeasured shape, in the job log.
 *
 * WHAT THIS PINS. Each exit names its reason in `details`; the successful path
 * reports the counts it already had. Flags are doubled at the module boundary;
 * nothing sends.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("zero-record cron runs say why", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.doUnmock("../../services/featureFlags");
    vi.doUnmock("../../services/sms-scheduler");
  });

  describe("appointment reminders (sms-scheduler tier job)", () => {
    it("flag off → the flag is named", async () => {
      vi.doMock("../../services/featureFlags", () => ({ isEnabled: async () => false }));
      const { processAppointmentReminders24h } = await import("./appointmentReminders");
      const r = await processAppointmentReminders24h();
      expect(r.recordsProcessed).toBe(0);
      expect(r.details).toBe("flag sms_appointment_reminders off");
    });

    it("POSITIVE CONTROL: flag on → the scheduler's own counts are reported", async () => {
      vi.doMock("../../services/featureFlags", () => ({ isEnabled: async () => true }));
      vi.doMock("../../services/sms-scheduler", () => ({ processScheduledSms: async () => ({ sent: 2, failed: 1 }) }));
      const { processAppointmentReminders24h } = await import("./appointmentReminders");
      const r = await processAppointmentReminders24h();
      expect(r.recordsProcessed).toBe(3);
      expect(r.details).toBe("2 sent · 1 failed");
    });
  });

  describe("warranty alerts", () => {
    it("flag off → the flag is named", async () => {
      vi.doMock("../../services/featureFlags", () => ({ isEnabled: async () => false }));
      const { processWarrantyAlerts } = await import("./warrantyAlerts");
      const r = await processWarrantyAlerts();
      expect(r.recordsProcessed).toBe(0);
      expect(r.details).toBe("flag predictive_maintenance_alerts off");
    });
  });

  describe("customer segmentation (a documented no-op)", () => {
    it("says who owns the work now, instead of a bare zero", async () => {
      const { processCustomerSegmentation } = await import("./customerSegmentation");
      const r = await processCustomerSegmentation();
      expect(r.recordsProcessed).toBe(0);
      expect(r.details).toContain("enrichCustomerData");
    });
  });
});
