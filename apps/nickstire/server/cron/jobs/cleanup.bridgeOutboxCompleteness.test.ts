/**
 * Q-12 phase 1c · the cleanup cron is the standing reader of the ADR-0019 §9
 * completeness report: while the shadow flag is ON it logs the 7-day totals
 * (counts only); while it is OFF it does not read at all.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  isEnabled: vi.fn<(key: string) => Promise<boolean>>(),
  report: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("../../db", () => ({
  getDb: async () => ({
    execute: async () => [{ affectedRows: 0 }, []],
    delete: () => ({ where: async () => [{ affectedRows: 0 }] }),
  }),
}));
vi.mock("../../lib/jobQueue", () => ({ jobQueue: { cleanup: () => 0 } }));
vi.mock("../../lib/cache", () => ({ cleanupMemCache: () => 0 }));
vi.mock("../../lib/logger", () => ({
  createLogger: () => ({ info: h.info, warn: h.warn, error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("../../services/featureFlags", () => ({ isEnabled: h.isEnabled }));
vi.mock("../../services/bridgeOutboxCompleteness", () => ({ bridgeOutboxCompleteness: h.report }));

import { cleanupOldData } from "./cleanup";

const MEASURED = {
  state: "measured",
  shadowEnabled: true,
  windowDays: 7,
  asOf: "2026-10-06T12:00:00.000Z",
  families: [
    { family: "leads", eventType: "lead.created", days: [], source: 5, matched: 4, missing: 1, extra: 0 },
    { family: "callbacks", eventType: "lead.callback_requested", days: [], source: 2, matched: 2, missing: 0, extra: 1 },
  ],
  totals: { source: 7, matched: 6, missing: 1, extra: 1 },
};

const completenessLog = () => h.info.mock.calls.find((c) => c[0] === "bridge_outbox completeness");

describe("cleanupOldData · bridge_outbox completeness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.report.mockResolvedValue(MEASURED);
  });

  it("logs the 7-day totals and per-family counts while the shadow flag is ON", async () => {
    h.isEnabled.mockResolvedValue(true);
    await cleanupOldData();
    expect(h.isEnabled).toHaveBeenCalledWith("bridge_outbox_shadow");
    expect(h.report).toHaveBeenCalledWith({ windowDays: 7 });
    expect(completenessLog()?.[1]).toEqual({
      windowDays: 7,
      shadowEnabled: true,
      source: 7,
      matched: 6,
      missing: 1,
      extra: 1,
      byFamily: { leads: { source: 5, missing: 1, extra: 0 }, callbacks: { source: 2, missing: 0, extra: 1 } },
    });
  });

  it("does not read or log anything while the flag is OFF", async () => {
    h.isEnabled.mockResolvedValue(false);
    await cleanupOldData();
    expect(h.report).not.toHaveBeenCalled();
    expect(completenessLog()).toBeUndefined();
  });

  it("warns on a failed read instead of logging zeros", async () => {
    h.isEnabled.mockResolvedValue(true);
    h.report.mockResolvedValue({ state: "error", family: "leads" });
    await cleanupOldData();
    expect(completenessLog()).toBeUndefined();
    expect(h.warn).toHaveBeenCalledWith("bridge_outbox completeness unavailable", { family: "leads" });
  });
});
