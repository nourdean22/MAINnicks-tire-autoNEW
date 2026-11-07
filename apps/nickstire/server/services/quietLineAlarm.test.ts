/**
 * JOB 2026-11-07-quiet-line-alarm · page Nour once when the receptionist line takes 0 calls
 * for a 2 h window that lies wholly inside open hours (Fri 2026-10-31: 0 calls for 25.1 h
 * while callers retried and nobody was told).
 *
 * Pins the class ("incident") and the state key, not the message text.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  execute: vi.fn(),
  isEnabled: vi.fn<(key: string) => Promise<boolean>>(),
  sendOncePerState: vi.fn(),
  sendTelegramResult: vi.fn(),
  warn: vi.fn(),
  dbAvailable: true,
}));

vi.mock("../db", () => ({
  getDb: async () => (h.dbAvailable ? { execute: h.execute } : null),
}));
vi.mock("./featureFlags", () => ({ isEnabled: h.isEnabled }));
vi.mock("./alertClaim", () => ({ sendOncePerState: h.sendOncePerState }));
vi.mock("./telegram", () => ({ sendTelegramResult: h.sendTelegramResult }));
vi.mock("../lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: h.warn, error: vi.fn(), debug: vi.fn() }),
}));

import { checkQuietLine } from "./quietLineAlarm";

// 2026-11-06 is a Friday on EST (UTC-5): 11:00 ET = 16:00Z.
const FRI_11_00_ET = new Date("2026-11-06T16:00:00Z");
const FRI_08_30_ET = new Date("2026-11-06T13:30:00Z");
const FRI_17_30_ET = new Date("2026-11-06T22:30:00Z");
// 2026-11-08 is a Sunday (hours 09:00-16:00): 16:30 ET is after close.
const SUN_16_30_ET = new Date("2026-11-08T21:30:00Z");
// 2026-10-30 is a Friday on EDT (UTC-4): 11:00 ET = 15:00Z.
const FRI_EDT_11_00_ET = new Date("2026-10-30T15:00:00Z");

const callCount = (n: unknown) => h.execute.mockResolvedValue([[{ n }], []]);

beforeEach(() => {
  vi.clearAllMocks();
  h.dbAvailable = true;
  h.isEnabled.mockResolvedValue(true);
  callCount(0);
  // Claim granted: run the sender, as the real sendOncePerState does on a fresh state.
  h.sendOncePerState.mockImplementation(async (_key: string, send: () => Promise<unknown>) => send());
  h.sendTelegramResult.mockResolvedValue({ status: "delivered" });
});

describe("checkQuietLine", () => {
  it("0 calls at 11:00 ET (window 09:00 to 11:00) pages once, class incident, key per ET day", async () => {
    const out = await checkQuietLine(FRI_11_00_ET);
    expect(out.details).toBe("QUIET: paged");
    expect(h.sendOncePerState).toHaveBeenCalledTimes(1);
    expect(h.sendOncePerState.mock.calls[0][0]).toBe("quiet-line:2026-11-06");
    expect(h.sendTelegramResult).toHaveBeenCalledTimes(1);
    expect(h.sendTelegramResult.mock.calls[0][1]).toBe("incident");
    // The window start is told in ET, not UTC (16:00Z would read 14:00 here).
    expect(h.sendTelegramResult.mock.calls[0][0]).toContain("09:00");
  });

  it("the same page on an EDT date still reads the ET clock", async () => {
    await checkQuietLine(FRI_EDT_11_00_ET);
    expect(h.sendOncePerState.mock.calls[0][0]).toBe("quiet-line:2026-10-30");
    expect(h.sendTelegramResult.mock.calls[0][0]).toContain("09:00");
  });

  it("1 call in the window does not page", async () => {
    callCount(1);
    const out = await checkQuietLine(FRI_11_00_ET);
    expect(out.details).toBe("ok: 1 calls in 120 min");
    expect(h.sendOncePerState).not.toHaveBeenCalled();
    expect(h.sendTelegramResult).not.toHaveBeenCalled();
  });

  it("0 calls at 08:30 ET (window starts 06:30, before 09:00) does not page and does not even read", async () => {
    const out = await checkQuietLine(FRI_08_30_ET);
    expect(h.sendOncePerState).not.toHaveBeenCalled();
    expect(h.sendTelegramResult).not.toHaveBeenCalled();
    expect(h.execute).not.toHaveBeenCalled();
    expect(out.details).toMatch(/^skip/);
  });

  it("0 calls at 17:30 ET (window ends after 17:00, shop still open) does not page", async () => {
    await checkQuietLine(FRI_17_30_ET);
    expect(h.sendOncePerState).not.toHaveBeenCalled();
  });

  it("0 calls on Sunday 16:30 ET (window inside 09 to 17, shop closed) does not page", async () => {
    await checkQuietLine(SUN_16_30_ET);
    expect(h.sendOncePerState).not.toHaveBeenCalled();
  });

  it("a thrown count read never pages, warns, and says the read failed", async () => {
    h.execute.mockRejectedValue(new Error("Lost connection to MySQL server"));
    const out = await checkQuietLine(FRI_11_00_ET);
    expect(out.details).toBe("count read failed");
    expect(h.sendOncePerState).not.toHaveBeenCalled();
    expect(h.warn).toHaveBeenCalled();
  });

  it("an unreadable count (no rows, or no database) is a failed read, never zero", async () => {
    h.execute.mockResolvedValue([[], []]);
    expect((await checkQuietLine(FRI_11_00_ET)).details).toBe("count read failed");
    h.execute.mockResolvedValue([[{ n: null }], []]);
    expect((await checkQuietLine(FRI_11_00_ET)).details).toBe("count read failed");
    h.dbAvailable = false;
    expect((await checkQuietLine(FRI_11_00_ET)).details).toBe("count read failed");
    expect(h.sendOncePerState).not.toHaveBeenCalled();
    expect(h.warn).toHaveBeenCalledTimes(3);
  });

  it("a second tick the same day does not page again (claim already held)", async () => {
    h.sendOncePerState.mockResolvedValue(null);
    const out = await checkQuietLine(FRI_11_00_ET);
    expect(out.details).toBe("QUIET: already paged today");
    expect(h.sendTelegramResult).not.toHaveBeenCalled();
  });

  it("a failed Telegram send is reported as not delivered (the claim is handed back by sendOncePerState)", async () => {
    h.sendOncePerState.mockResolvedValue({ status: "failed" });
    const out = await checkQuietLine(FRI_11_00_ET);
    expect(out.details).not.toBe("QUIET: paged");
    expect(h.warn).toHaveBeenCalled();
  });

  it("a send held by telegram_incident_muted is not reported as paged", async () => {
    h.sendOncePerState.mockResolvedValue({ status: "held", heldBy: "telegram_incident_muted" });
    const out = await checkQuietLine(FRI_11_00_ET);
    expect(out.details).not.toBe("QUIET: paged");
  });

  it("flag off: nothing is read or sent and details say off", async () => {
    h.isEnabled.mockResolvedValue(false);
    const out = await checkQuietLine(FRI_11_00_ET);
    expect(h.isEnabled).toHaveBeenCalledWith("quiet_line_alarm");
    expect(out.details).toBe("off: quiet_line_alarm");
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.sendOncePerState).not.toHaveBeenCalled();
  });

  it("a thrown flag read counts as off", async () => {
    h.isEnabled.mockRejectedValue(new Error("flag table unreadable"));
    const out = await checkQuietLine(FRI_11_00_ET);
    expect(out.details).toBe("off: quiet_line_alarm");
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.sendOncePerState).not.toHaveBeenCalled();
  });
});
