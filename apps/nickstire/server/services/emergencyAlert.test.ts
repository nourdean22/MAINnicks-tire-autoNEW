/**
 * Nour's emergency Telegram, now sent by nickstire: statenour's exact text, and a bounded retry
 * (5 tries, 5 s doubling) in place of the bridge queue re-post statenour's 500 used to trigger.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ sendTelegram: vi.fn(), logError: vi.fn() }));
vi.mock("./telegram", () => ({ sendTelegram: h.sendTelegram }));
vi.mock("../lib/logger", () => ({
  createLogger: () => ({ error: h.logError, warn: () => {}, info: () => {}, debug: () => {} }),
}));

import { emergencyTelegramText, sendEmergencyTelegram } from "./emergencyAlert";

const ALERT = { emergencyId: 12, name: "Ann <Lee>", phone: "2165550199", problem: "Flat on I-90 & no spare" };

beforeEach(() => {
  vi.useFakeTimers();
  h.sendTelegram.mockReset();
  h.logError.mockReset();
});
afterEach(() => vi.useRealTimers());

/** Run the send while advancing fake time through every backoff. */
async function send(): Promise<boolean> {
  const p = sendEmergencyTelegram(ALERT);
  await vi.advanceTimersByTimeAsync(80_000);
  return p;
}

describe("emergencyTelegramText", () => {
  it("is statenour's alert, with customer text escaped for HTML mode", () => {
    expect(emergencyTelegramText(ALERT)).toBe(
      "🚨 <b>EMERGENCY REQUEST</b>\n\n" +
      "Ann &lt;Lee&gt; — 2165550199\n" +
      "Flat on I-90 &amp; no spare\n\n" +
      "After-hours emergency. Respond ASAP.",
    );
  });
});

describe("sendEmergencyTelegram", () => {
  it("one accepted try is one send", async () => {
    h.sendTelegram.mockResolvedValue(true);
    expect(await send()).toBe(true);
    expect(h.sendTelegram).toHaveBeenCalledTimes(1);
    expect(h.sendTelegram).toHaveBeenCalledWith(emergencyTelegramText(ALERT));
  });

  it("fails twice, then lands on the third try", async () => {
    h.sendTelegram.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("socket hang up")).mockResolvedValueOnce(true);
    expect(await send()).toBe(true);
    expect(h.sendTelegram).toHaveBeenCalledTimes(3);
    expect(h.logError).not.toHaveBeenCalled();
  });

  it("every try failing is reported failed after 5 tries, with no name or phone in the log", async () => {
    h.sendTelegram.mockResolvedValue(false);
    expect(await send()).toBe(false);
    expect(h.sendTelegram).toHaveBeenCalledTimes(5);
    expect(h.logError).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(h.logError.mock.calls[0]);
    expect(logged).toContain('"emergencyId":12');
    expect(logged).not.toContain("Ann");
    expect(logged).not.toContain("2165550199");
  });

  it("waits between tries (5 s, then 10 s): the second try is not sent before 5 s", async () => {
    h.sendTelegram.mockResolvedValue(false);
    const p = sendEmergencyTelegram(ALERT);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(h.sendTelegram).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sendTelegram).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(80_000);
    await p;
  });
});
