/**
 * ROS-083 · the review-request queue must not report itself drained when it
 * could not be read. This is the highest-consequence site in the class: the
 * number the operator sees gates a batch of REAL outbound customer SMS.
 *
 * Two independent failures lived here.
 *
 * (1) THE READS. getReviewRequests / getPendingReviewRequests / getReviewRequestStats
 *     each returned [] or zeros on an unreadable database. The admin page then
 *     rendered "0 review requests", five zeroed tiles, and — inside the danger
 *     confirm dialog that authorises the send — "~0 due now". That last one is
 *     a measurement that was never taken, presented as a reassuring one.
 *
 * (2) THE CRON. cron/jobs/reviewRequests.ts caught everything and returned
 *     { recordsProcessed: 0 }. Both cron runners treat a RESOLVED handler as a
 *     COMPLETED run (cron/index.ts:218, cron/scheduler.ts:418) and only log
 *     "failed" when the handler THROWS — so an outage on the job that texts
 *     customers was filed in cron_log as a successful run that happened to do
 *     nothing. Indistinguishable, in the admin cron table, from a genuinely
 *     empty queue.
 *
 * And a third thing found while reading (2): `typeof result === "number"` was
 * never true, because processReviewRequestQueue returns an object from all five
 * of its exits and always has. Every run this job has ever made logged
 * recordsProcessed: 0, including runs that sent real SMS. The count was not
 * low — it was not a count.
 *
 * DB-unavailable is induced by clearing DATABASE_URL, which is what getDb()
 * actually branches on, rather than by mocking it — getDb is defined inside
 * db.ts and called through its local binding, so a module mock of the export
 * would not intercept the internal call sites and the test would pass while
 * exercising nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => {
  vi.resetModules(); // db.ts caches its pool in module state
  vi.stubEnv("DATABASE_URL", "");
});

afterEach(() => {
  vi.doUnmock("./services/featureFlags");
  vi.doUnmock("./routers/reviewRequests");
  vi.doUnmock("./services/invoiceReviewRequests");
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the reads · DB-down is unknown, not an empty queue", () => {
  it("getReviewRequests throws instead of returning []", async () => {
    const { getReviewRequests } = await import("./db");
    await expect(getReviewRequests(100)).rejects.toThrow(/unknown, not empty/i);
  });

  it("getPendingReviewRequests throws — this is the cron's read", async () => {
    const { getPendingReviewRequests } = await import("./db");
    await expect(getPendingReviewRequests()).rejects.toThrow(/unknown, not empty/i);
  });

  it("getReviewRequestStats throws instead of returning all zeros", async () => {
    const { getReviewRequestStats } = await import("./db");
    await expect(getReviewRequestStats()).rejects.toThrow(/unknown, not zero/i);
  });
});

/** 2026-10-02 · the cron creates invoice-sourced rows before sending. Default: 0139 not applied. */
const NOT_APPLIED = {
  created: 0, onCooldown: 0, duplicate: 0, candidates: 0,
  reason: "migration 0139_review_requests_invoice_source not applied — no invoice-sourced rows created",
};
const mockInvoiceLane = (impl: () => Promise<unknown> = async () => NOT_APPLIED) =>
  vi.doMock("./services/invoiceReviewRequests", () => ({ createInvoiceReviewRequests: vi.fn(impl) }));

describe("the cron · a failed run must be recorded as failed", () => {
  it("re-throws so both runners log status 'failed' rather than 'completed'", async () => {
    vi.doMock("./services/featureFlags", () => ({ isEnabled: vi.fn().mockResolvedValue(true) }));
    mockInvoiceLane();
    vi.doMock("./routers/reviewRequests", () => ({
      processReviewRequestQueue: vi.fn().mockRejectedValue(new Error("Database unavailable — boom")),
    }));

    const { processReviewRequests } = await import("./cron/jobs/reviewRequests");
    await expect(processReviewRequests()).rejects.toThrow(/boom/);
  });

  it("reports the REAL processed count, not the literal 0 the old typeof branch always produced", async () => {
    vi.doMock("./services/featureFlags", () => ({ isEnabled: vi.fn().mockResolvedValue(true) }));
    mockInvoiceLane();
    vi.doMock("./routers/reviewRequests", () => ({
      processReviewRequestQueue: vi.fn().mockResolvedValue({ processed: 7, sent: 6, failed: 1 }),
    }));

    const { processReviewRequests } = await import("./cron/jobs/reviewRequests");
    const result = await processReviewRequests();
    expect(result.recordsProcessed).toBe(7);
    expect(result.details).toMatch(/sent 6, queued 0, holdout controls 0, failed 1/);
  });

  it("keeps a declined run legible — a real zero carries its reason", async () => {
    vi.doMock("./services/featureFlags", () => ({ isEnabled: vi.fn().mockResolvedValue(true) }));
    mockInvoiceLane();
    vi.doMock("./routers/reviewRequests", () => ({
      processReviewRequestQueue: vi.fn().mockResolvedValue({
        processed: 0, sent: 0, failed: 0, reason: "Daily cap reached",
      }),
    }));

    const { processReviewRequests } = await import("./cron/jobs/reviewRequests");
    const result = await processReviewRequests();
    expect(result.recordsProcessed).toBe(0);
    expect(result.details).toContain("Daily cap reached");
    // The invoice lane's own decline is legible too, not a silent zero.
    expect(result.details).toContain("migration 0139_review_requests_invoice_source not applied");
  });

  it("invoice-sourced rows created this run count as processed work", async () => {
    vi.doMock("./services/featureFlags", () => ({ isEnabled: vi.fn().mockResolvedValue(true) }));
    mockInvoiceLane(async () => ({ created: 3, onCooldown: 1, duplicate: 0, candidates: 4 }));
    vi.doMock("./routers/reviewRequests", () => ({
      processReviewRequestQueue: vi.fn().mockResolvedValue({ processed: 0, sent: 0, failed: 0, reason: "Outside send window" }),
    }));
    const { processReviewRequests } = await import("./cron/jobs/reviewRequests");
    const result = await processReviewRequests();
    expect(result.recordsProcessed).toBe(3);
    expect(result.details).toContain("invoice rows created 3 of 4 (cooldown 1, dup 0)");
  });

  it("a failed invoice lane fails the run (recorded as failed) but the existing send queue STILL runs", async () => {
    vi.doMock("./services/featureFlags", () => ({ isEnabled: vi.fn().mockResolvedValue(true) }));
    mockInvoiceLane(async () => { throw new Error("database unavailable"); });
    const send = vi.fn().mockResolvedValue({ processed: 2, sent: 2, failed: 0 });
    vi.doMock("./routers/reviewRequests", () => ({ processReviewRequestQueue: send }));
    const { processReviewRequests } = await import("./cron/jobs/reviewRequests");
    await expect(processReviewRequests()).rejects.toThrow(/invoice review lane failed \(database unavailable\); send queue still ran: sent 2/);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
