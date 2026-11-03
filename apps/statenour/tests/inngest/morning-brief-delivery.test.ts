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
  memFindMany: vi.fn(),
  memCreate: vi.fn(),
  memDeleteMany: vi.fn(),
  memFindUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lifeGoal: { findMany: h.lifeGoalFindMany },
    goalEvent: { findMany: h.goalEventFindMany },
    brainMemory: { findMany: h.memFindMany, create: h.memCreate, deleteMany: h.memDeleteMany, findUnique: h.memFindUnique },
  },
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
  h.memFindMany.mockResolvedValue([]);
  h.memCreate.mockResolvedValue({ id: "nudge-1" });
  h.memDeleteMany.mockResolvedValue({ count: 1 });
  h.memFindUnique.mockResolvedValue(null);
  // clearAllMocks keeps implementations: a test that makes the logger throw must not leak into the next.
  h.logError.mockReset();
});

describe("deliverMorningBrief · manager round 1 (R2a, 2026-11-03)", () => {
  const DAY = 86_400_000;
  const ago = (d: number) => new Date(Date.now() - d * DAY);
  const B = (date: string, text = "Drift: LOW\nOpen tasks: 3") => ({ date, text, sectionCount: 2 });
  const body = (i = 0) => (h.sendPush.mock.calls[i][0] as { body: string }).body;
  // A key-honouring read: only rows whose key is in where.key.in come back.
  const reviewRows = (...keys: string[]) =>
    h.memFindMany.mockImplementation(async (a: { where: { key: { in: string[] } } }) =>
      keys.filter((k) => a.where.key.in.includes(k)).map((key) => ({ key })));
  const claimedKey = () => (h.memCreate.mock.calls[0]?.[0] as { data: { key: string } } | undefined)?.data.key;
  const p2002 = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

  describe("G1 · a failed claim read or create is no line, never a thrown step", () => {
    it("review read rejects: brief ships, no line, no claim, logged as a warn", async () => {
      h.memFindMany.mockRejectedValue(new Error("db blip"));
      const r = await deliverMorningBrief(B("2026-11-09"));
      expect(r.status).toBe("sent");
      expect(body()).toBe("Drift: LOW · Open tasks: 3");
      expect(h.memCreate).not.toHaveBeenCalled();
      expect(h.logError).toHaveBeenCalledWith("inngest/morning-brief", expect.anything(), expect.objectContaining({ stage: "weekly-review-claim" }), "warn");
    });
    it("claim create rejects with a non-P2002 error: brief ships, no line", async () => {
      reviewRows("weekly:2026-11-02");
      h.memCreate.mockRejectedValue(Object.assign(new Error("conn reset"), { code: "P1001" }));
      const r = await deliverMorningBrief(B("2026-11-09"));
      expect(r.status).toBe("sent");
      expect(body()).toBe("Drift: LOW · Open tasks: 3");
    });
  });

  describe("G2 · the key set follows the brief's weekday through a key-honouring read", () => {
    it("Tuesday after an undelivered Monday still finds last week's review and claims its week", async () => {
      reviewRows("weekly:2026-11-02");
      await deliverMorningBrief(B("2026-11-10"));
      expect(claimedKey()).toBe("2026-W45");
      expect(body().endsWith("Weekly review is ready")).toBe(true);
    });
    it("Sunday 2026-11-08 (before that night's cron) reads 11-02's and 10-26's keys and claims 2026-W44", async () => {
      reviewRows("weekly:2026-10-26");
      await deliverMorningBrief(B("2026-11-08"));
      expect(claimedKey()).toBe("2026-W44");
    });
    it("the fall-back Monday 2026-11-02 finds the review keyed 2026-10-26 and claims 2026-W44", async () => {
      reviewRows("weekly:2026-10-26");
      await deliverMorningBrief(B("2026-11-02"));
      expect(claimedKey()).toBe("2026-W44");
    });
    it("two rows: the newest review wins", async () => {
      reviewRows("weekly:2026-11-02", "weekly:2026-11-09");
      await deliverMorningBrief(B("2026-11-10"));
      expect(claimedKey()).toBe("2026-W46");
    });
    it("ISO year boundary: 2026-12-28 claims 2026-W53, 2029-12-31 claims 2030-W01", async () => {
      reviewRows("weekly:2026-12-28");
      await deliverMorningBrief(B("2027-01-04"));
      expect(claimedKey()).toBe("2026-W53");
      vi.clearAllMocks();
      h.sendPush.mockResolvedValue({ sent: 1, failed: 0 });
      h.memCreate.mockResolvedValue({ id: "nudge-2" });
      reviewRows("weekly:2029-12-31");
      await deliverMorningBrief(B("2030-01-07"));
      expect(claimedKey()).toBe("2030-W01");
    });
  });

  describe("F3 + round 2 · a claim is this brief's own only when the same Inngest run made it", () => {
    const ownWhere = (id: string, runId: string) => ({
      where: { id, category: "weekly_review_nudge", key: "2026-W45", metadata: { path: ["runId"], equals: runId } },
    });
    it("the claim carries the run's id", async () => {
      reviewRows("weekly:2026-11-02");
      await deliverMorningBrief(B("2026-11-09"), "run-A");
      expect((h.memCreate.mock.calls[0][0] as { data: { metadata: Record<string, unknown> } }).data.metadata).toMatchObject({ runId: "run-A", briefDate: "2026-11-09" });
    });
    it("(b) P2002 on a row the SAME run made (a step retry): the line is sent", async () => {
      reviewRows("weekly:2026-11-02");
      h.memCreate.mockRejectedValue(p2002());
      h.memFindUnique.mockResolvedValue({ id: "earlier-attempt", metadata: { briefDate: "2026-11-09", runId: "run-A" } });
      await deliverMorningBrief(B("2026-11-09"), "run-A");
      expect(body().endsWith("Weekly review is ready")).toBe(true);
      const where = (h.memFindUnique.mock.calls[0][0] as { where: { category_key: { category: string; key: string } } }).where;
      expect(where.category_key).toEqual({ category: "weekly_review_nudge", key: "2026-W45" });
    });
    it("(a) P2002 on a row another run made TODAY (a manual Invoke or Replay): no line", async () => {
      reviewRows("weekly:2026-11-02");
      h.memCreate.mockRejectedValue(p2002());
      h.memFindUnique.mockResolvedValue({ id: "run-a-claim", metadata: { briefDate: "2026-11-09", runId: "run-A" } });
      await deliverMorningBrief(B("2026-11-09"), "run-B");
      expect(body()).toBe("Drift: LOW · Open tasks: 3");
    });
    it("(c) an undelivered run B never deletes run A's claim", async () => {
      reviewRows("weekly:2026-11-02");
      h.memCreate.mockRejectedValue(p2002());
      h.memFindUnique.mockResolvedValue({ id: "run-a-claim", metadata: { briefDate: "2026-11-09", runId: "run-A" } });
      h.sendPush.mockResolvedValue({ sent: 0, failed: 1 });
      h.sendTelegram.mockResolvedValue(false);
      await deliverMorningBrief(B("2026-11-09"), "run-B");
      expect(h.memDeleteMany).not.toHaveBeenCalled();
    });
    it("P2002 on a row from yesterday's brief: no line", async () => {
      reviewRows("weekly:2026-11-02");
      h.memCreate.mockRejectedValue(p2002());
      h.memFindUnique.mockResolvedValue({ id: "monday", metadata: { briefDate: "2026-11-09", runId: "run-mon" } });
      await deliverMorningBrief(B("2026-11-10"), "run-tue");
      expect(body()).toBe("Drift: LOW · Open tasks: 3");
    });
    it("a retried run that then reaches nobody releases its own row by compare-and-swap (id AND runId)", async () => {
      reviewRows("weekly:2026-11-02");
      h.memCreate.mockRejectedValue(p2002());
      h.memFindUnique.mockResolvedValue({ id: "earlier-attempt", metadata: { briefDate: "2026-11-09", runId: "run-A" } });
      h.sendPush.mockResolvedValue({ sent: 0, failed: 1 });
      h.sendTelegram.mockResolvedValue(false);
      await deliverMorningBrief(B("2026-11-09"), "run-A");
      expect(h.memDeleteMany).toHaveBeenCalledWith(ownWhere("earlier-attempt", "run-A"));
    });
  });

  it("round 2 · a logger that throws never throws out of the brief", async () => {
    h.memFindMany.mockRejectedValue(new Error("db blip"));
    h.lifeGoalFindMany.mockRejectedValue(new Error("db blip"));
    h.logError.mockImplementation(() => {
      throw new Error("logger down");
    });
    await expect(deliverMorningBrief(B("2026-11-09"), "run-A")).resolves.toMatchObject({ status: "sent", checkInsDue: null });
  });

  describe("F4 · a failed check-in read is visible, never a quiet zero", () => {
    it("the goal read fails: no line, checkInsDue null in the result, logged as a warn", async () => {
      h.lifeGoalFindMany.mockRejectedValue(new Error("db down"));
      const r = await deliverMorningBrief(B("2026-11-03"));
      expect(r.checkInsDue).toBeNull();
      expect(body()).toBe("Drift: LOW · Open tasks: 3");
      expect(h.logError).toHaveBeenCalledWith("inngest/morning-brief", expect.anything(), expect.objectContaining({ stage: "check-in-count" }), "warn");
    });
    it("G5 · the goal read works but the event read fails: no count line (never every goal 'overdue')", async () => {
      h.lifeGoalFindMany.mockResolvedValue([{ id: "g1", horizon: "WEEK", createdAt: ago(40) }]);
      h.goalEventFindMany.mockRejectedValue(new Error("db blip"));
      const r = await deliverMorningBrief(B("2026-11-03"));
      expect(body()).toBe("Drift: LOW · Open tasks: 3");
      expect(r.checkInsDue).toBeNull();
    });
    it("a working read reports the count in the result", async () => {
      h.lifeGoalFindMany.mockResolvedValue([{ id: "g1", horizon: "WEEK", createdAt: ago(40) }]);
      expect((await deliverMorningBrief(B("2026-11-03"))).checkInsDue).toBe(1);
    });
    it("F6 · the goal read is ordered, so take: 50 is not an arbitrary 50", async () => {
      await deliverMorningBrief(B("2026-11-03"));
      expect((h.lifeGoalFindMany.mock.calls[0][0] as { orderBy?: unknown }).orderBy).toBeDefined();
    });
  });

  it("G4 · Telegram fallback: both lines whole, a planted title and the Goals header stay out", async () => {
    reviewRows("weekly:2026-11-02");
    h.lifeGoalFindMany.mockResolvedValue([
      { id: "g1", horizon: "WEEK", createdAt: ago(40) },
      { id: "g2", horizon: "MONTH", createdAt: ago(90) },
    ]);
    h.sendPush.mockResolvedValue({ sent: 0, failed: 1 });
    const r = await deliverMorningBrief(B("2026-11-09", "Drift: LOW\nOpen tasks: 3\n<b>Goals</b> · 2 active\nCheck in on: Planted goal title"));
    expect(r.status).toBe("telegram_fallback");
    const msg = String(h.sendTelegram.mock.calls[0][0]);
    expect(msg).toContain("Drift: LOW · Open tasks: 3 · 2 goals need a check-in · Weekly review is ready\n\n");
    expect(msg).not.toContain("Planted goal title");
    expect(msg).not.toContain("Goals");
  });

  describe("M12 · a failed release never masks the result or the push error", () => {
    it("undelivered + release rejects: still undelivered, and the logged error names the claim", async () => {
      reviewRows("weekly:2026-11-02");
      h.sendPush.mockResolvedValue({ sent: 0, failed: 1 });
      h.sendTelegram.mockResolvedValue(false);
      h.memDeleteMany.mockRejectedValue(new Error("db blip"));
      await expect(deliverMorningBrief(B("2026-11-09"))).resolves.toMatchObject({ status: "undelivered" });
      const undelivered = h.logError.mock.calls.find((c) => String((c[1] as Error).message).includes("reached no device"));
      expect(undelivered?.[2]).toMatchObject({ weeklyClaim: "2026-W45" });
    });
    it("push throws + release rejects: the PUSH error is what the step sees", async () => {
      reviewRows("weekly:2026-11-02");
      h.sendPush.mockRejectedValue(new Error("vapid down"));
      h.memDeleteMany.mockRejectedValue(new Error("db blip"));
      await expect(deliverMorningBrief(B("2026-11-09"))).rejects.toThrow("vapid down");
    });
  });
});

describe("deliverMorningBrief · 'Weekly review is ready' rides the morning push once per ISO week (R2a ruling, 2026-11-03)", () => {
  // The review cron writes Sunday ~22:00 ET with key weekly:<that week's Monday>. 2026-11-09 is a Monday.
  const MONDAY = { date: "2026-11-09", text: "Drift: LOW\nOpen tasks: 3", sectionCount: 2 };
  const TUESDAY = { ...MONDAY, date: "2026-11-10" };
  const REVIEW_ROW = [{ key: "weekly:2026-11-02" }];
  const bodies = () => h.sendPush.mock.calls.map((c) => (c[0] as { body: string }).body);
  const p2002 = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

  it("Monday after a written review: the line is in the push once, after the count line, claimed for the review's week", async () => {
    h.memFindMany.mockResolvedValue(REVIEW_ROW);
    h.lifeGoalFindMany.mockResolvedValue([{ id: "g1", horizon: "WEEK", createdAt: new Date(Date.now() - 40 * 86_400_000) }]);
    await deliverMorningBrief(MONDAY);
    expect(bodies()[0]).toBe("Drift: LOW · Open tasks: 3 · 1 goal needs a check-in · Weekly review is ready");
    const data = (h.memCreate.mock.calls[0][0] as { data: { category: string; key: string } }).data;
    expect(data).toMatchObject({ category: "weekly_review_nudge", key: "2026-W45" });
    expect(h.memDeleteMany).not.toHaveBeenCalled();
  });

  it("Monday then Tuesday in one week: the line appears once (Tuesday's claim hits P2002)", async () => {
    h.memFindMany.mockResolvedValue(REVIEW_ROW);
    h.memCreate.mockResolvedValueOnce({ id: "nudge-1" }).mockRejectedValueOnce(p2002());
    await deliverMorningBrief(MONDAY);
    await deliverMorningBrief(TUESDAY);
    expect(bodies().filter((b) => b.includes("Weekly review is ready"))).toHaveLength(1);
    expect(bodies()[1]).toBe("Drift: LOW · Open tasks: 3");
  });

  it("no review row for this week or the one just ended: no line and no claim", async () => {
    await deliverMorningBrief(MONDAY);
    expect(bodies()[0]).not.toContain("Weekly review");
    expect(h.memCreate).not.toHaveBeenCalled();
    const where = (h.memFindMany.mock.calls[0][0] as { where: { category: string; key: { in: string[] } } }).where;
    expect(where.category).toBe("weekly_review");
    expect(where.key.in.sort()).toEqual(["weekly:2026-11-02", "weekly:2026-11-09"]);
  });

  it("a brief that reached nobody releases the claim by its id AND its run, so tomorrow's brief can carry the line", async () => {
    h.memFindMany.mockResolvedValue(REVIEW_ROW);
    h.sendPush.mockResolvedValue({ sent: 0, failed: 1 });
    h.sendTelegram.mockResolvedValue(false);
    const result = await deliverMorningBrief(MONDAY, "run-1");
    expect(result.status).toBe("undelivered");
    expect(h.memDeleteMany).toHaveBeenCalledWith({
      where: { id: "nudge-1", category: "weekly_review_nudge", key: "2026-W45", metadata: { path: ["runId"], equals: "run-1" } },
    });
  });

  it("a push that throws releases the claim and still throws (the step retries)", async () => {
    h.memFindMany.mockResolvedValue(REVIEW_ROW);
    h.sendPush.mockRejectedValue(new Error("vapid down"));
    await expect(deliverMorningBrief(MONDAY)).rejects.toThrow("vapid down");
    expect(h.memDeleteMany).toHaveBeenCalledTimes(1);
  });

  it("a brief the Telegram fallback delivered keeps the claim and carries the line", async () => {
    h.memFindMany.mockResolvedValue(REVIEW_ROW);
    h.sendPush.mockResolvedValue({ sent: 0, failed: 1 });
    await deliverMorningBrief(MONDAY);
    expect(String(h.sendTelegram.mock.calls[0][0])).toContain("Weekly review is ready");
    expect(h.memDeleteMany).not.toHaveBeenCalled();
  });

  it("GUARD: the review read selects the key only, so review text and goal titles never reach the body", async () => {
    h.memFindMany.mockResolvedValue(REVIEW_ROW);
    h.lifeGoalFindMany.mockResolvedValue([{ id: "g1", title: "Planted goal title", horizon: "WEEK", createdAt: new Date(Date.now() - 40 * 86_400_000) }]);
    await deliverMorningBrief({ ...MONDAY, text: `${MONDAY.text}\n<b>Goals</b> · 1 active\nCheck in on: Planted goal title` });
    expect((h.memFindMany.mock.calls[0][0] as { select: Record<string, boolean> }).select).toEqual({ key: true });
    expect(bodies()[0]).not.toContain("Planted goal title");
    expect(bodies()[0].endsWith("Weekly review is ready")).toBe(true);
  });
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
    expect(result).toEqual({ status: "sent", push: { sent: 1, failed: 0 }, checkInsDue: 0 });
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
      "deliver-push": { status: "sent", push: { sent: 1, failed: 0 }, checkInsDue: null },
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
    // F4: a failed check-in read stays visible in the run's result (null, never 0).
    expect(out).toHaveProperty("checkInsDue", null);
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
  });

  it("round 2 · the handler hands Inngest's runId to the claim (the consumer of the run identity)", async () => {
    h.memFindMany.mockResolvedValue([{ key: "weekly:2026-11-02" }]);
    const CANNED: Record<string, unknown> = {
      compose: { date: "2026-11-09", text: "Drift: LOW", sectionCount: 1 },
      "voice-file": { status: "skipped" },
      "pin-scoreboard": { status: "pinned", numberCount: 0 },
    };
    const step = {
      run: async (id: string, fn: () => Promise<unknown>) => (id === "deliver-push" ? fn() : CANNED[id]),
      sleep: vi.fn(),
    };
    await (
      operatorMorningBrief as unknown as { handler: (ctx: unknown) => Promise<Record<string, unknown>> }
    ).handler({ step, runId: "01RUNX" });
    expect((h.memCreate.mock.calls[0][0] as { data: { metadata: { runId: string } } }).data.metadata.runId).toBe("01RUNX");
  });
});
