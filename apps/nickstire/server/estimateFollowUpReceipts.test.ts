/**
 * Estimate follow-up must not consume an estimate it did not text (audit F-6),
 * and must fail loudly when its column is missing (audit F-17).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const execute = vi.fn();
const sendSms = vi.fn();
const isEnabled = vi.fn();

vi.mock("./db", () => ({ getDb: async () => ({ execute: (...a: unknown[]) => execute(...a) }) }));
vi.mock("./sms", () => ({
  sendSms: (...a: unknown[]) => sendSms(...a),
  withOptOut: (s: string) => s,
}));
vi.mock("./services/featureFlags", () => ({ isEnabled: (...a: unknown[]) => isEnabled(...a) }));

const estimateRows = [
  { id: 11, customerName: "A", customerPhone: "2165550101", serviceType: "brakes", totalEstimate: 300 },
  { id: 12, customerName: "B", customerPhone: "2165550102", serviceType: "tires", totalEstimate: 400 },
];

function sqlText(call: unknown[]): string {
  // drizzle sql`` tagged template object: join its string chunks for matching
  const q = call[0] as { queryChunks?: Array<{ value?: string[] } | string> } | undefined;
  const chunks = q?.queryChunks ?? [];
  return chunks.map((c) => (typeof c === "string" ? c : Array.isArray((c as { value?: string[] }).value) ? (c as { value: string[] }).value.join("") : "")).join("");
}

describe("processEstimateFollowUp · consume only what was texted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockImplementation(async (...a: unknown[]) => {
      const text = sqlText(a);
      if (/SELECT/i.test(text)) return [estimateRows];
      return [{ affectedRows: 1 }];
    });
  });

  it("flag OFF: no UPDATE is issued, nothing sent, details say Skipped with the reason", async () => {
    isEnabled.mockResolvedValue(false);
    const { processEstimateFollowUp } = await import("./services/workOrderAutomation");
    const r = await processEstimateFollowUp();
    const updates = execute.mock.calls.filter((c) => /UPDATE estimates/i.test(sqlText(c)));
    expect(updates).toHaveLength(0);
    expect(sendSms).not.toHaveBeenCalled();
    expect(r.recordsProcessed).toBe(0);
    expect(r.details).toMatch(/^Skipped · sms_retention_sequences is off/);
  });

  it("delivered: the estimate is marked followed-up and counted as sent", async () => {
    isEnabled.mockResolvedValue(true);
    sendSms.mockResolvedValue({ success: true, sid: "SM" });
    const { processEstimateFollowUp } = await import("./services/workOrderAutomation");
    const r = await processEstimateFollowUp();
    const updates = execute.mock.calls.filter((c) => /UPDATE estimates/i.test(sqlText(c)));
    expect(updates).toHaveLength(2);
    expect(r.recordsProcessed).toBe(2);
    expect(r.details).toMatch(/sent 2 · queued 0 · failed 0/);
  });

  it("gateway failure: the estimate is LEFT eligible (no UPDATE) and counted as failed", async () => {
    isEnabled.mockResolvedValue(true);
    sendSms.mockResolvedValue({ success: false, error: "down" });
    const { processEstimateFollowUp } = await import("./services/workOrderAutomation");
    const r = await processEstimateFollowUp();
    const updates = execute.mock.calls.filter((c) => /UPDATE estimates/i.test(sqlText(c)));
    expect(updates).toHaveLength(0);
    expect(r.recordsProcessed).toBe(0);
    expect(r.details).toMatch(/failed 2/);
  });

  it("queued: consumed (it will go out) but counted as queued, not sent", async () => {
    isEnabled.mockResolvedValue(true);
    sendSms.mockResolvedValue({ success: true, queued: true });
    const { processEstimateFollowUp } = await import("./services/workOrderAutomation");
    const r = await processEstimateFollowUp();
    const updates = execute.mock.calls.filter((c) => /UPDATE estimates/i.test(sqlText(c)));
    expect(updates).toHaveLength(2);
    expect(r.recordsProcessed).toBe(0);
    expect(r.details).toMatch(/sent 0 · queued 2/);
  });

  it("uncertain (gateway timeout): CONSUMED — the relay may have delivered, so it is never re-texted — and counted as uncertain, not sent", async () => {
    isEnabled.mockResolvedValue(true);
    sendSms.mockResolvedValue({ success: true, uncertain: true });
    const { processEstimateFollowUp } = await import("./services/workOrderAutomation");
    const r = await processEstimateFollowUp();
    const updates = execute.mock.calls.filter((c) => /UPDATE estimates/i.test(sqlText(c)));
    expect(updates).toHaveLength(2);
    expect(r.recordsProcessed).toBe(0);
    expect(r.details).toMatch(/sent 0 · queued 0 · failed 0 · uncertain 2/);
  });

  it("the eligibility band is 2–7 days (a busy day catches up on later runs)", async () => {
    isEnabled.mockResolvedValue(false);
    const { processEstimateFollowUp } = await import("./services/workOrderAutomation");
    await processEstimateFollowUp();
    const select = execute.mock.calls.find((c) => /SELECT/i.test(sqlText(c)));
    expect(sqlText(select!)).toMatch(/INTERVAL 7 DAY\) AND DATE_SUB\(NOW\(\), INTERVAL 2 DAY\)/);
  });

  it("missing followUpSent column REJECTS (loud), naming the migration — never a silent skip", async () => {
    execute.mockRejectedValueOnce(new Error("Unknown column 'e.followUpSent' in 'where clause'"));
    const { processEstimateFollowUp } = await import("./services/workOrderAutomation");
    await expect(processEstimateFollowUp()).rejects.toThrow(/0114_estimates_followupsent/);
  });
});
