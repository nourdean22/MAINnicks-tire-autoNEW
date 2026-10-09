/**
 * The payment-status cron fails its run when the invoice read failed (2026-10-09).
 *
 * getServicePaymentBreakdown answered a missing database and a failed query with [], which
 * runPricingIntelligenceJob reported as "No invoice data to analyze": cron_log recorded a
 * completed run, and the job's own audit F-9 rethrow never saw the error.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ db: null as null | { execute: ReturnType<typeof vi.fn> } }));
vi.mock("../db", () => ({ getDb: async () => h.db }));
vi.mock("./telegram", () => ({ sendTelegram: vi.fn() }));

import { runPricingIntelligenceJob } from "./pricingIntelligence";

afterEach(() => {
  h.db = null;
});

describe("runPricingIntelligenceJob on a failed invoice read", () => {
  it("no database fails the run", async () => {
    await expect(runPricingIntelligenceJob()).rejects.toThrow(/payment state is unknown/);
  });

  it("a failed query fails the run", async () => {
    h.db = { execute: vi.fn().mockRejectedValue(new Error("TiDB timeout")) };
    await expect(runPricingIntelligenceJob()).rejects.toThrow(/TiDB timeout/);
  });

  it("control: a readable empty month is still 'No invoice data to analyze'", async () => {
    h.db = { execute: vi.fn().mockResolvedValue([[], []]) };
    await expect(runPricingIntelligenceJob()).resolves.toEqual({ recordsProcessed: 0, details: "No invoice data to analyze" });
  });
});
