/**
 * Telegram alert diet · the follow-up run report reaches the owner once.
 *
 * It used to go through notifyOwner (which only logged when no webhook was set, yet reported
 * true) AND through Telegram, every run. notifyOwner now reports false for a log-only
 * fallback, and Telegram is the rail only when notifyOwner did not deliver.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ notifyOwner: vi.fn(async () => true), sendTelegram: vi.fn(async (_t: string) => true) }));

vi.mock("./_core/notification", () => ({ notifyOwner: h.notifyOwner }));
vi.mock("./services/telegram", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/telegram")>()),
  sendTelegram: h.sendTelegram,
}));

import { reportFollowUpsToOwner } from "./follow-ups";

describe("reportFollowUpsToOwner", () => {
  beforeEach(() => {
    h.notifyOwner.mockReset().mockResolvedValue(true);
    h.sendTelegram.mockClear();
  });

  it("sends nothing to Telegram when notifyOwner delivered", async () => {
    await reportFollowUpsToOwner("Follow-Up Report", "body");
    expect(h.notifyOwner).toHaveBeenCalledTimes(1);
    expect(h.sendTelegram).not.toHaveBeenCalled();
  });

  it("falls back to exactly one Telegram message when notifyOwner did not deliver", async () => {
    h.notifyOwner.mockResolvedValue(false);
    await reportFollowUpsToOwner("Follow-Up Report", "body");
    expect(h.sendTelegram).toHaveBeenCalledTimes(1);
    expect(h.sendTelegram.mock.calls[0][0]).toContain("Follow-Up Report");
  });

  it("falls back to Telegram when notifyOwner throws", async () => {
    h.notifyOwner.mockRejectedValue(new Error("boom"));
    await reportFollowUpsToOwner("Follow-Up Report", "body");
    expect(h.sendTelegram).toHaveBeenCalledTimes(1);
  });
});
