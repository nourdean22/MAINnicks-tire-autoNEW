/**
 * The overdue-reply alert closes a "computed and thrown away" gap: #1074 stamped a
 * 30-minute SLA on every needs-review reply, and nothing ever read it. So the tests
 * that matter are about the alert being TRUSTWORTHY — an alert channel that cries
 * wolf gets muted, and a muted channel is identical to the silence it replaced.
 *
 *   - a still-waiting customer must not re-alert every 15 minutes;
 *   - an undelivered alert must NOT be recorded as sent (a Telegram outage would
 *     otherwise buy an hour of silence with nobody having seen anything);
 *   - a database failure must propagate, because an unreadable queue rendering as
 *     an empty one is the exact ROS-059 failure shape;
 *   - the message must name who is waiting and what they asked, since a bare count
 *     cannot be acted on from a phone.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ listOverdue: vi.fn(), sendTelegram: vi.fn() }));

vi.mock("./services/smsResponseJobs", () => ({
  listOverdueHumanPending: (...a: unknown[]) => h.listOverdue(...a),
}));
vi.mock("./services/telegram", () => ({
  sendTelegram: (...a: unknown[]) => h.sendTelegram(...a),
}));

import {
  alertOverdueObligations,
  composeOverdueAlert,
  __resetAlertThrottle,
} from "./services/humanPendingAlerts";

const waiting = (over: Partial<Record<string, unknown>> = {}) => ({
  jobId: 1,
  conversationId: 10,
  phone: "+12165550100",
  body: "you got a 225/50R17 used?",
  waitingMinutes: 47,
  overdueMinutes: 17,
  ...over,
});

beforeEach(() => {
  // singleFork shares ONE process across files (apps/nickstire/AGENTS.md §3) — the
  // throttle is module state, so a leak here would silently mute a later test.
  h.listOverdue.mockReset();
  h.sendTelegram.mockReset();
  __resetAlertThrottle();
});

describe("composeOverdueAlert — a count cannot be acted on from a phone", () => {
  it("names who is waiting, how long, and what they asked", () => {
    const text = composeOverdueAlert([waiting()], 1);
    expect(text).toContain("...0100");
    expect(text).toContain("waiting 47m");
    expect(text).toContain("17m past SLA");
    expect(text).toContain("225/50R17");
  });

  it("redacts all but the last 4 digits of the phone", () => {
    const text = composeOverdueAlert([waiting()], 1);
    expect(text).not.toContain("2165550100");
    expect(text).not.toContain("+1216");
  });

  it("agrees in number for a single waiting customer", () => {
    expect(composeOverdueAlert([waiting()], 1)).toContain("1 CUSTOMER IS WAITING");
    expect(composeOverdueAlert([waiting()], 4)).toContain("4 CUSTOMERS ARE WAITING");
  });

  it("caps the list and reports the remainder instead of scrolling forever", () => {
    const many = Array.from({ length: 9 }, (_, i) => waiting({ jobId: i + 1 }));
    const text = composeOverdueAlert(many, 9);
    expect(text).toContain("...and 4 more"); // 9 total, 5 listed
    expect(text.split("• ").length - 1).toBe(5);
  });

  it("truncates a long message body", () => {
    const text = composeOverdueAlert([waiting({ body: "x".repeat(200) })], 1);
    expect(text).toContain("...");
    expect(text.length).toBeLessThan(400);
  });
});

describe("alertOverdueObligations", () => {
  it("does nothing when nobody is overdue", async () => {
    h.listOverdue.mockResolvedValue([]);
    const result = await alertOverdueObligations();
    expect(result).toEqual({ overdue: 0, alerted: 0, delivered: false, skippedReason: "none overdue" });
    expect(h.sendTelegram).not.toHaveBeenCalled();
  });

  it("alerts once, then throttles the same obligation on the next sweep", async () => {
    h.listOverdue.mockResolvedValue([waiting()]);
    h.sendTelegram.mockResolvedValue(true);

    const first = await alertOverdueObligations();
    expect(first.alerted).toBe(1);
    expect(first.delivered).toBe(true);

    // 15 minutes later the sweep runs again and the customer is STILL overdue.
    const second = await alertOverdueObligations();
    expect(second.overdue).toBe(1); // still reported as waiting...
    expect(second.alerted).toBe(0); // ...but not re-sent
    expect(second.skippedReason).toBe("all recently alerted");
    expect(h.sendTelegram).toHaveBeenCalledTimes(1);
  });

  it("does NOT mark an obligation alerted when delivery failed", async () => {
    // Optimistic marking would let a Telegram outage buy an hour of silence.
    h.listOverdue.mockResolvedValue([waiting()]);
    h.sendTelegram.mockResolvedValue(false);

    const first = await alertOverdueObligations();
    expect(first.delivered).toBe(false);

    h.sendTelegram.mockResolvedValue(true);
    const retry = await alertOverdueObligations();
    expect(retry.alerted).toBe(1);
    expect(retry.delivered).toBe(true);
  });

  it("still alerts about a NEW customer while an older one is throttled", async () => {
    h.sendTelegram.mockResolvedValue(true);
    h.listOverdue.mockResolvedValue([waiting({ jobId: 1 })]);
    await alertOverdueObligations();

    h.listOverdue.mockResolvedValue([waiting({ jobId: 1 }), waiting({ jobId: 2, phone: "+12165554455" })]);
    const second = await alertOverdueObligations();
    expect(second.alerted).toBe(1);
    expect(second.overdue).toBe(2);
    // The digest names the new customer, not the throttled one.
    const sent = h.sendTelegram.mock.calls[1][0] as string;
    expect(sent).toContain("...4455");
    expect(sent).toContain("2 CUSTOMERS ARE WAITING"); // header still reports the truth
  });

  it("propagates a database failure rather than reporting an empty queue", async () => {
    h.listOverdue.mockRejectedValue(new Error("database unavailable — waiting customers are UNKNOWN, not none"));
    await expect(alertOverdueObligations()).rejects.toThrow(/UNKNOWN, not none/);
    expect(h.sendTelegram).not.toHaveBeenCalled();
  });
});

describe("review #1099 — paging and markup safety", () => {
  it("escapes customer text so it cannot inject Telegram HTML", () => {
    const text = composeOverdueAlert([waiting({ body: "do you have <b>225/50R17</b> & a spare?" })], 1);
    expect(text).not.toMatch(/<b>/);
    expect(text).toContain("&lt;b&gt;");
    expect(text).toContain("&amp;");
  });

  it("surfaces a customer sitting past the listing cap", async () => {
    h.sendTelegram.mockResolvedValue(true);
    const many = Array.from({ length: 40 }, (_, i) => waiting({ jobId: i + 1 }));
    h.listOverdue.mockResolvedValue(many);

    const first = await alertOverdueObligations();
    expect(first.alerted).toBe(40);
    const sent = h.sendTelegram.mock.calls[0][0] as string;
    expect(sent).toContain("40 CUSTOMERS ARE WAITING");
    expect(sent).toContain("...and 35 more");

    const second = await alertOverdueObligations();
    expect(second.alerted).toBe(0);
  });

  it("requests a scan window larger than the listing cap", async () => {
    h.listOverdue.mockResolvedValue([]);
    await alertOverdueObligations();
    expect(h.listOverdue).toHaveBeenCalledWith(200);
  });
});
