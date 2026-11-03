/**
 * morning-brief · delivery · 2026-10-18.
 *
 * Until now the morning push waited 35 minutes (hand-off row + sleep + backstop)
 * so the daily intelligence brief could fold it into one push. That brief was
 * stopped; the push now goes out straight after compose. What must NOT change:
 * the ledger row, the rating buttons, and the Telegram fallback when no device
 * took the push. These tests carry over the delivery half of the old
 * morning-brief-combine tests and pin the orchestrator's shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  sendPush: vi.fn(),
  sendTelegram: vi.fn(),
  sendTelegramWithButtons: vi.fn(),
  recordShown: vi.fn(),
  setShownSurface: vi.fn(),
  logError: vi.fn(),
  lifeGoalFindMany: vi.fn(),
  goalEventFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { lifeGoal: { findMany: h.lifeGoalFindMany }, goalEvent: { findMany: h.goalEventFindMany } },
}));
vi.mock("@/lib/inngest/client", () => ({
  getInngest: () => ({ createFunction: (_cfg: unknown, handler: unknown) => ({ handler }) }),
}));
vi.mock("@/lib/inngest/on-failure", () => ({ onInngestFailure: vi.fn() }));
vi.mock("@/lib/notifications/push", () => ({ sendPush: h.sendPush }));
vi.mock("@/lib/services/telegram", () => ({
  sendTelegram: h.sendTelegram,
  sendTelegramWithButtons: h.sendTelegramWithButtons,
}));
vi.mock("@/lib/utils/error-log", () => ({ logError: h.logError }));
vi.mock("@/lib/services/outcome-ledger", () => ({
  recordShown: h.recordShown,
  setShownSurface: h.setShownSurface,
}));

import { deliverMorningBrief, operatorMorningBrief } from "@/lib/inngest/functions/morning-brief";

const BRIEF = { date: "2026-10-18", text: "Drift: CRITICAL\nOpen tasks: 14", sectionCount: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  h.sendPush.mockResolvedValue({ sent: 1, failed: 0 });
  h.sendTelegram.mockResolvedValue(true);
  h.sendTelegramWithButtons.mockResolvedValue({ ok: true, messageId: 1 });
  h.recordShown.mockResolvedValue(null);
  h.setShownSurface.mockResolvedValue(true);
  h.lifeGoalFindMany.mockResolvedValue([]);
  h.goalEventFindMany.mockResolvedValue([]);
});

describe("deliverMorningBrief · the check-in count reaches the push (R2a, 2026-11-03)", () => {
  const DAY = 86_400_000;
  const ago = (d: number) => new Date(Date.now() - d * DAY);
  const GOALS = [
    { id: "g1", title: "Planted goal title one", horizon: "WEEK", createdAt: ago(40) },
    { id: "g2", title: "Planted goal title two", horizon: "MONTH", createdAt: ago(90) },
    { id: "g3", title: "Fresh goal", horizon: "WEEK", createdAt: ago(2) },
  ];

  it("two overdue goals put '2 goals need a check-in' in the push body, and no title", async () => {
    h.lifeGoalFindMany.mockResolvedValue(GOALS);
    await deliverMorningBrief(BRIEF);
    const body = (h.sendPush.mock.calls[0][0] as { body: string }).body;
    expect(body.endsWith(" · 2 goals need a check-in")).toBe(true);
    expect(body).not.toMatch(/Planted goal title|Fresh goal/);
  });

  it("a recent check-in takes a goal off the count", async () => {
    h.lifeGoalFindMany.mockResolvedValue(GOALS);
    h.goalEventFindMany.mockResolvedValue([{ goalId: "g1", createdAt: ago(1) }]);
    await deliverMorningBrief(BRIEF);
    expect((h.sendPush.mock.calls[0][0] as { body: string }).body.endsWith(" · 1 goal needs a check-in")).toBe(true);
  });

  it("a failed goal read adds no line and the brief still ships (unknown is not zero, and not a claim)", async () => {
    h.lifeGoalFindMany.mockRejectedValue(new Error("db down"));
    const result = await deliverMorningBrief(BRIEF);
    expect(result.status).toBe("sent");
    expect((h.sendPush.mock.calls[0][0] as { body: string }).body).toBe("Drift: CRITICAL · Open tasks: 14");
  });

  it("the Telegram fallback carries the same count line", async () => {
    h.lifeGoalFindMany.mockResolvedValue(GOALS);
    h.sendPush.mockResolvedValue({ sent: 0, failed: 1 });
    await deliverMorningBrief(BRIEF);
    expect(String(h.sendTelegram.mock.calls[0][0])).toContain("2 goals need a check-in");
    expect(String(h.sendTelegram.mock.calls[0][0])).not.toContain("Planted goal title");
  });
});

describe("deliverMorningBrief", () => {
  it("pushes once and reports sent when a device took it", async () => {
    const result = await deliverMorningBrief(BRIEF);
    expect(h.sendPush).toHaveBeenCalledTimes(1);
    expect(h.sendTelegram).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "sent", push: { sent: 1, failed: 0 } });
  });

  it("a push that reaches no device falls back to Telegram", async () => {
    h.sendPush.mockResolvedValue({ sent: 0, failed: 1 });
    const result = await deliverMorningBrief(BRIEF);
    expect(h.sendTelegram).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("telegram_fallback");
  });

  it("a ledgered brief that reaches no device falls back WITH the rating buttons, and the row's surface says so", async () => {
    h.recordShown.mockResolvedValue("led-9");
    h.sendPush.mockResolvedValue({ sent: 0, failed: 0 });
    const result = await deliverMorningBrief(BRIEF);
    expect(result.status).toBe("telegram_fallback");
    expect(h.sendTelegram).not.toHaveBeenCalled();
    const buttons = h.sendTelegramWithButtons.mock.calls[0][1] as Array<Array<{ callback_data: string }>>;
    expect(buttons.flat().map((b) => b.callback_data)).toEqual(["oc:u:led-9", "oc:n:led-9"]);
    expect(h.setShownSurface).toHaveBeenCalledWith("led-9", "telegram-fallback");
  });

  it("a brief that reached a device is surfaced as web-push and never falls back", async () => {
    h.recordShown.mockResolvedValue("led-10");
    h.sendPush.mockResolvedValue({ sent: 2, failed: 0 });
    await deliverMorningBrief(BRIEF);
    expect(h.setShownSurface).toHaveBeenCalledWith("led-10", "web-push");
    expect(h.sendTelegramWithButtons).not.toHaveBeenCalled();
  });

  it("push sent 0 AND Telegram rejects: undelivered, the ledger never says telegram-fallback or web-push", async () => {
    h.recordShown.mockResolvedValue("led-11");
    h.sendPush.mockResolvedValue({ sent: 0, failed: 0 });
    h.sendTelegramWithButtons.mockResolvedValue({ ok: false });
    const result = await deliverMorningBrief(BRIEF);
    expect(result.status).toBe("undelivered");
    expect(h.sendTelegramWithButtons).toHaveBeenCalledTimes(1);
    expect(h.setShownSurface).not.toHaveBeenCalled();
    expect(h.logError).toHaveBeenCalledTimes(1);
  });

  it("the shown surface is set only after the fallback is known to have landed", async () => {
    h.recordShown.mockResolvedValue("led-12");
    h.sendPush.mockResolvedValue({ sent: 0, failed: 1 });
    h.sendTelegramWithButtons.mockResolvedValue({ ok: true, messageId: 2 });
    const result = await deliverMorningBrief(BRIEF);
    expect(result.status).toBe("telegram_fallback");
    expect(h.setShownSurface).toHaveBeenCalledTimes(1);
    expect(h.setShownSurface).toHaveBeenCalledWith("led-12", "telegram-fallback");
  });
  it("the push no longer links to the retired /intelligence/brief page", async () => {
    await deliverMorningBrief(BRIEF);
    expect((h.sendPush.mock.calls[0][0] as { url: string }).url).toBe("/");
  });
});

describe("operator-morning-brief · pushes straight after compose", () => {
  it("runs compose, then deliver-push, with no sleep and no declared wait", async () => {
    const CANNED: Record<string, unknown> = {
      compose: BRIEF,
      "deliver-push": { status: "sent", push: { sent: 1, failed: 0 } },
      "voice-file": { status: "skipped" },
      "pin-scoreboard": { status: "pinned", numberCount: 3 },
    };
    const ids: string[] = [];
    const sleep = vi.fn();
    const step = {
      run: async (id: string) => {
        ids.push(id);
        return CANNED[id];
      },
      sleep,
    };
    const out = await (
      operatorMorningBrief as unknown as { handler: (ctx: unknown) => Promise<Record<string, unknown>> }
    ).handler({ step });

    expect(ids.slice(0, 2)).toEqual(["compose", "deliver-push"]);
    expect(ids).not.toContain("hand-off-for-combine");
    expect(ids).not.toContain("combine-backstop");
    expect(sleep).not.toHaveBeenCalled();
    expect(out.waitedMs).toBeUndefined();
    expect(out.pushSent).toBe(1);
    expect(out.delivery).toBe("sent");
  });

  it("an undelivered brief is declared partial with a reason, not a quiet success", async () => {
    const CANNED: Record<string, unknown> = {
      compose: BRIEF,
      "deliver-push": { status: "undelivered", push: { sent: 0, failed: 0 } },
      "voice-file": { status: "skipped" },
      "pin-scoreboard": { status: "pinned", numberCount: 3 },
    };
    const step = { run: async (id: string) => CANNED[id], sleep: vi.fn() };
    const out = await (
      operatorMorningBrief as unknown as { handler: (ctx: unknown) => Promise<Record<string, unknown>> }
    ).handler({ step });
    expect(out.status).toBe("partial");
    expect(String(out.degradedReason)).toMatch(/no device.*Telegram/i);
    expect(out.delivery).toBe("undelivered");
  });});
