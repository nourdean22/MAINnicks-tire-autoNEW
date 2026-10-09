/**
 * The churn-detection job fails its run when the customer read failed (2026-10-09).
 *
 * analyzeCustomers marks a failed read `unavailable: true` (its zeros are placeholders), and a
 * failed lapsed/at-risk sub-read `atRiskUnavailable: true`. The job ignored both and returned
 * `{ recordsProcessed: 0, details: "0 at-risk, 0% retention" }`, which cron_log records as a
 * completed run with confident zeros. Driven through the real job handler
 * (runTierJobHandlerUnlocked), with the customer read mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendTelegram = vi.fn(async () => undefined);

function customers(over: Record<string, unknown>) {
  return {
    totalCustomers: 0, activeCustomers: 0, lapsedCustomers: 0, lostCustomers: 0, retentionRate: 0,
    avgVisitsPerCustomer: 0, avgTicket: 0, avgLifetimeValue: 0, topSpenders: [], atRiskCustomers: [],
    busiestDay: "", busiestHour: 0, repeatRate: 0,
    ...over,
  };
}

async function runChurn(data: Record<string, unknown>) {
  vi.doMock("../services/customerIntelligence", () => ({
    analyzeCustomers: vi.fn(async () => data),
    getCustomerActionPlan: vi.fn(async () => ""),
  }));
  vi.doMock("../services/telegram", () => ({ sendTelegram }));
  const { getJobCadences, runTierJobHandlerUnlocked } = await import("./scheduler");
  getJobCadences(); // builds the tiers
  return runTierJobHandlerUnlocked("churn-detection");
}

describe("churn-detection on a failed customer read", () => {
  beforeEach(() => {
    vi.resetModules();
    sendTelegram.mockClear();
  });
  afterEach(() => {
    vi.doUnmock("../services/customerIntelligence");
    vi.doUnmock("../services/telegram");
  });

  it("fails the run instead of recording 0 at-risk and 0% retention", async () => {
    await expect(runChurn(customers({ unavailable: true }))).rejects.toThrow(/customer read failed/);
    expect(sendTelegram).not.toHaveBeenCalled();
  });

  it("says the at-risk count is unknown when only that sub-read failed", async () => {
    const r = await runChurn(customers({ totalCustomers: 900, retentionRate: 41, atRiskUnavailable: true }));
    expect(r.details).toBe("at-risk unknown (lapsed read failed), 41% retention");
  });

  it("control: a measured quiet day still completes with its numbers", async () => {
    const r = await runChurn(customers({ totalCustomers: 900, retentionRate: 41 }));
    expect(r).toEqual({ recordsProcessed: 0, details: "0 at-risk, 41% retention" });
    expect(sendTelegram).not.toHaveBeenCalled();
  });
});
