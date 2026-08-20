/**
 * push · per-tag flood control + TTL. 2026-08-20.
 *
 * The cron-healer storm (#1735) delivered 2,279 CRITICAL pushes to the
 * operator's phone in ~5.5h against a 2-3/day baseline. The coach bridge
 * believed `tag: key` made re-fires replace the notification — but tag
 * replacement is display-only; every push still delivers and buzzes.
 * Content dedup could not have helped: bodies differ per run
 * ("duration: 54608ms" vs "54415ms"). The transport now suppresses
 * same-tag pushes inside a per-level cooldown, logs the suppression
 * (visible, never silent), and stamps TTL so a stale CRITICAL page
 * cannot deliver days later (web-push default TTL is four weeks).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  // Module-scope const in push.ts reads this at import time; vi.hoisted runs
  // before the hoisted imports, a plain top-level statement does not.
  process.env.VAPID_PRIVATE_KEY = "test-private-key";
  return {
  findMany: vi.fn(),
  auditFindFirst: vi.fn(),
  auditCreate: vi.fn().mockResolvedValue({ id: "audit" }),
  sendNotification: vi.fn().mockResolvedValue(undefined),
    setVapidDetails: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    userPreference: { findMany: h.findMany, upsert: vi.fn(), deleteMany: vi.fn() },
    auditEvent: { findFirst: h.auditFindFirst, create: h.auditCreate },
  },
}));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));
vi.mock("web-push", () => ({
  setVapidDetails: h.setVapidDetails,
  sendNotification: h.sendNotification,
}));

import { sendPush, resolveCooldownMs, pushTransportOptions, PUSH_COOLDOWN_BY_LEVEL } from "@/lib/notifications/push";

const SUB = { endpoint: "https://push.example/e1", keys: { p256dh: "k", auth: "a" } };

beforeEach(() => {
  vi.clearAllMocks();
  h.findMany.mockResolvedValue([{ value: JSON.stringify(SUB) }]);
  h.auditFindFirst.mockResolvedValue(null);
  h.auditCreate.mockResolvedValue({ id: "audit" });
  h.sendNotification.mockResolvedValue(undefined);
});

describe("resolveCooldownMs", () => {
  it("critical tagged pushes default to the 30-minute cooldown", () => {
    expect(resolveCooldownMs({ tag: "coach:x", level: "critical" })).toBe(30 * 60 * 1000);
  });

  it("an untagged push is never suppressed — the level-default tag is shared across callers", () => {
    expect(resolveCooldownMs({ level: "critical" })).toBe(0);
  });

  it("explicit 0 disables suppression (the lead exemption)", () => {
    expect(resolveCooldownMs({ tag: "lead", level: "critical", cooldownMs: 0 })).toBe(0);
  });

  it("every level has a positive default", () => {
    for (const v of Object.values(PUSH_COOLDOWN_BY_LEVEL)) expect(v).toBeGreaterThan(0);
  });
});

describe("sendPush · flood control", () => {
  it("delivers the first tagged push and stamps the tag into the audit row", async () => {
    const res = await sendPush({ title: "Cron Healer: Rescued x", body: "b", level: "critical", tag: "coach:system-alert:cron-heal:x" });
    expect(res.sent).toBe(1);
    expect(h.sendNotification).toHaveBeenCalledTimes(1);
    expect(h.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: "push_sent",
          payload: expect.objectContaining({ tag: "coach:system-alert:cron-heal:x" }),
        }),
      }),
    );
  });

  it("suppresses a same-tag re-fire inside the cooldown — the storm shape — and logs it visibly", async () => {
    h.auditFindFirst.mockResolvedValue({ id: "prior" });
    const res = await sendPush({ title: "Cron Healer: Rescued x", body: "duration: 54415ms", level: "critical", tag: "coach:system-alert:cron-heal:x" });
    expect(res).toEqual({ sent: 0, failed: 0 });
    expect(h.sendNotification).not.toHaveBeenCalled();
    expect(h.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventType: "push_suppressed" }) }),
    );
  });

  it("cooldownMs: 0 skips the suppression check entirely — a lead always pages", async () => {
    h.auditFindFirst.mockResolvedValue({ id: "prior" });
    const res = await sendPush({ title: "URGENT LEAD", body: "John — brakes", level: "critical", tag: "lead", cooldownMs: 0 });
    expect(h.auditFindFirst).not.toHaveBeenCalled();
    expect(res.sent).toBe(1);
  });

  it("a failing cooldown check falls through to sending — flood control never eats a real page", async () => {
    h.auditFindFirst.mockRejectedValue(new Error("db down"));
    const res = await sendPush({ title: "T", body: "b", level: "critical", tag: "t1" });
    expect(res.sent).toBe(1);
  });

  it("stamps TTL + urgency on the wire — a critical page must not deliver days late", async () => {
    await sendPush({ title: "T", body: "b", level: "critical", tag: "t2" });
    expect(h.sendNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      { TTL: 4 * 3600, urgency: "high" },
    );
  });
});

describe("pushTransportOptions", () => {
  it("critical is short-lived and high urgency; low is long-lived and low urgency", () => {
    expect(pushTransportOptions("critical")).toEqual({ TTL: 4 * 3600, urgency: "high" });
    expect(pushTransportOptions("low")).toEqual({ TTL: 24 * 3600, urgency: "low" });
  });
});
