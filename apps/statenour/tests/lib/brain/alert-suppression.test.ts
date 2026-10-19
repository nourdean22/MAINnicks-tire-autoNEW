/**
 * UI v3 W5b: dismiss an alert with a reason, stored as a BrainMemory row (category alert_dismiss),
 * honoured by ONE shared reader (lib/brain/alert-suppression.ts) in every consumer.
 *
 * What a dismissal can cover depends on how each producer keys its rows (read 2026-10-18):
 *   correlation_alert    key `<a>__<b>`, one per metric pair             -> the pair (signal)
 *   creation_spike_alert key `<entityType>:<YYYY-MM-DDTHH>`, one per hour -> the entity type (signal)
 *   decision_quality_drift key = week-ending date, one per week          -> this row only
 *   brain_bus_alert      key `dead-event:<eventId>`, one per dead event   -> this row only
 *   schema_drift_alert, storage_quota_alert, update_spike_alert: no producer in this repo -> row only
 *
 * This file pins the identity function, the server mutation (closed reason list, idempotent upsert,
 * 30-day expiry, the key derived from the row the server read, never from the client) and the
 * first consumer, buildActiveAlerts. The Telegram and command-center consumers have their own
 * tests (tests/telegram/status-alerts-honest.test.ts, tests/ai/command-center-alert-suppression.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const DAY = 86_400_000;

const h = vi.hoisted(() => {
  const state = {
    suppression: [] as { category: string; key: string }[],
    alerts: [] as { id: string; category: string; key: string; content: string; createdAt: Date; metadata: null }[],
    byId: null as null | { category: string; key: string },
  };
  const brainMemory = {
    findMany: vi.fn(async (a: { where: { category: { in: string[] } | string } }) => {
      const c = a.where.category;
      const cats = typeof c === "string" ? [c] : c.in;
      if (cats.includes("alert_dismiss") || cats.includes("alert_mute")) {
        return state.suppression.filter((r) => cats.includes(r.category));
      }
      return state.alerts.filter((r) => cats.includes(r.category));
    }),
    findFirst: vi.fn(async () => state.byId),
    upsert: vi.fn(async () => ({})),
  };
  return { state, prisma: { brainMemory } };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
// Codex P2 on #3161: a dismissal or mute must drop the cached views that list alerts
// (command-center 15 s, dashboard brief 30 s, nudges 300 s), or they stay visible for minutes.
const inv = vi.hoisted(() => ({ invalidate: vi.fn(), invalidateNudgeCache: vi.fn() }));
vi.mock("@/lib/utils/cache", async (orig) => ({
  ...(await orig<typeof import("@/lib/utils/cache")>()),
  invalidate: inv.invalidate,
}));
vi.mock("@/lib/brain/cross-system-nudge", async (orig) => ({
  ...(await orig<typeof import("@/lib/brain/cross-system-nudge")>()),
  invalidateNudgeCache: inv.invalidateNudgeCache,
}));

import {
  ALERT_CATEGORIES,
  ALERT_LANE,
  ALERT_DISMISS_REASONS,
  alertDismissKey,
  alertSignal,
} from "@/lib/brain/alert-lanes";
import { buildActiveAlerts } from "@/lib/services/brain-domain";
import { brainRouter } from "@/lib/trpc/routers/brain";

const caller = brainRouter.createCaller({
  session: { id: "op", email: "op@statenour.local", role: "owner" },
} as never);

const alert = (id: string, category: string, key: string, content: string) => ({
  id,
  category,
  key,
  content,
  createdAt: new Date(),
  metadata: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.state.suppression = [];
  h.state.alerts = [];
  h.state.byId = null;
});

describe("lanes and signal identity", () => {
  it("every category has a lane, and Priority is exactly the four the brief named", () => {
    for (const c of ALERT_CATEGORIES) expect(["priority", "other"]).toContain(ALERT_LANE[c]);
    const priority = ALERT_CATEGORIES.filter((c) => ALERT_LANE[c] === "priority").sort();
    expect(priority).toEqual(["brain_bus_alert", "correlation_alert", "schema_drift_alert", "storage_quota_alert"]);
  });

  it("a creation spike's identity is its entity type, so another hour of the same entity matches", () => {
    expect(alertSignal("creation_spike_alert", "task:2026-10-18T09")).toEqual({ scope: "signal", identity: "task" });
    expect(alertDismissKey("creation_spike_alert", "task:2026-10-18T09")).toBe(
      alertDismissKey("creation_spike_alert", "task:2026-10-19T14"),
    );
    expect(alertDismissKey("creation_spike_alert", "task:2026-10-18T09")).not.toBe(
      alertDismissKey("creation_spike_alert", "journal:2026-10-18T09"),
    );
  });

  it("a correlation's identity is its pair key", () => {
    expect(alertSignal("correlation_alert", "sleep__revenue")).toEqual({ scope: "signal", identity: "sleep__revenue" });
  });

  it("a per-occurrence key covers only that row", () => {
    for (const [c, k] of [
      ["decision_quality_drift", "2026-10-17"],
      ["brain_bus_alert", "dead-event:abc123"],
      ["schema_drift_alert", "anything"],
      ["storage_quota_alert", "neon"],
      ["update_spike_alert", "task:2026-10-18T09"],
      ["creation_spike_alert", "malformed-no-hour"],
    ] as const) {
      expect(alertSignal(c, k)).toEqual({ scope: "row", identity: k });
    }
    expect(alertDismissKey("brain_bus_alert", "dead-event:a")).not.toBe(alertDismissKey("brain_bus_alert", "dead-event:b"));
  });

  it("the reason list is closed: expected, fixed, noise", () => {
    expect([...ALERT_DISMISS_REASONS]).toEqual(["expected", "fixed", "noise"]);
  });
});

describe("brain.dismissAlert", () => {
  it("upserts an alert_dismiss row keyed from the row the server read, reason as content, 30-day expiry", async () => {
    h.state.byId = { category: "creation_spike_alert", key: "task:2026-10-18T09" };
    const before = Date.now();
    const res = await caller.dismissAlert({ id: "a3", reason: "noise" });
    expect(res).toMatchObject({ ok: true, scope: "signal" });
    expect(h.prisma.brainMemory.upsert).toHaveBeenCalledTimes(1);
    const arg = h.prisma.brainMemory.upsert.mock.calls[0][0] as {
      where: { category_key: { category: string; key: string } };
      create: { category: string; key: string; content: string; expiresAt: Date };
      update: { content: string; expiresAt: Date; deletedAt: null };
    };
    const key = alertDismissKey("creation_spike_alert", "task:2026-10-18T09");
    expect(arg.where.category_key).toEqual({ category: "alert_dismiss", key });
    expect(arg.create).toMatchObject({ category: "alert_dismiss", key, content: "noise" });
    expect(arg.update).toMatchObject({ content: "noise", deletedAt: null });
    const ttl = arg.create.expiresAt.getTime() - before;
    expect(ttl).toBeGreaterThanOrEqual(30 * DAY - 1000);
    expect(ttl).toBeLessThanOrEqual(30 * DAY + 5000);
  });

  it("dismissAlert and muteAlertCategory drop the command-center, dashboard and nudge caches", async () => {
    h.state.byId = { category: "brain_bus_alert", key: "dead-event:e1" };
    for (const run of [
      () => caller.dismissAlert({ id: "b1", reason: "fixed" }),
      () => caller.muteAlertCategory({ category: "brain_bus_alert", days: 7 }),
    ]) {
      inv.invalidate.mockClear();
      inv.invalidateNudgeCache.mockClear();
      await run();
      expect(inv.invalidate).toHaveBeenCalledWith("ultron_command_center_state_v1");
      expect(inv.invalidate).toHaveBeenCalledWith("dashboard_brief");
      expect(inv.invalidateNudgeCache).toHaveBeenCalledTimes(1);
    }
  });

  it("a reason outside the closed list is refused before any write", async () => {
    h.state.byId = { category: "correlation_alert", key: "sleep__revenue" };
    await expect(caller.dismissAlert({ id: "a1", reason: "because" as never })).rejects.toThrow();
    expect(h.prisma.brainMemory.upsert).not.toHaveBeenCalled();
  });

  it("an id that is not a live alert row is refused before any write", async () => {
    h.state.byId = { category: "wisdom", key: "w1" };
    await expect(caller.dismissAlert({ id: "w1", reason: "noise" })).rejects.toThrow();
    h.state.byId = null;
    await expect(caller.dismissAlert({ id: "gone", reason: "noise" })).rejects.toThrow();
    expect(h.prisma.brainMemory.upsert).not.toHaveBeenCalled();
  });
});

describe("consumer 1: buildActiveAlerts honours dismissals and mutes", () => {
  it("a dismissed alert is absent; an undismissed one in the same category is present", async () => {
    h.state.alerts = [
      alert("a1", "brain_bus_alert", "dead-event:one", "Dead event one"),
      alert("a2", "brain_bus_alert", "dead-event:two", "Dead event two"),
    ];
    h.state.suppression = [{ category: "alert_dismiss", key: alertDismissKey("brain_bus_alert", "dead-event:one") }];
    const view = await buildActiveAlerts({ limit: 10, sinceDays: 30 });
    const ids = view.alerts.brain_bus_alert.map((a) => a.id);
    expect(ids).toEqual(["a2"]);
    expect(view.counts.brain_bus_alert).toBe(1);
  });

  it("a signal dismissal covers a later occurrence of the same signal, not a different one", async () => {
    h.state.alerts = [
      alert("s1", "creation_spike_alert", "task:2026-10-19T14", "Task spike later hour"),
      alert("s2", "creation_spike_alert", "journal:2026-10-19T14", "Journal spike"),
    ];
    h.state.suppression = [{ category: "alert_dismiss", key: alertDismissKey("creation_spike_alert", "task:2026-10-18T09") }];
    const view = await buildActiveAlerts({ limit: 10, sinceDays: 30 });
    expect(view.alerts.creation_spike_alert.map((a) => a.id)).toEqual(["s2"]);
  });

  it("a muted category is still absent (the W3 mute keeps working through the shared reader)", async () => {
    h.state.alerts = [alert("c1", "correlation_alert", "a__b", "Pair")];
    h.state.suppression = [{ category: "alert_mute", key: "correlation_alert" }];
    const view = await buildActiveAlerts({ limit: 10, sinceDays: 30 });
    expect(view.alerts.correlation_alert).toEqual([]);
  });

  it("the suppression read asks only for live rows (not deleted, not expired)", async () => {
    await buildActiveAlerts({ limit: 10, sinceDays: 30 });
    const call = h.prisma.brainMemory.findMany.mock.calls.find((c) =>
      JSON.stringify((c[0] as { where: { category: unknown } }).where.category).includes("alert_dismiss"),
    );
    expect(call).toBeTruthy();
    const where = (call![0] as { where: Record<string, unknown> }).where;
    expect(where.deletedAt).toBeNull();
    expect(JSON.stringify(where.OR)).toContain("expiresAt");
  });

  it("CONTROL: with no suppression rows every alert shows", async () => {
    h.state.alerts = [alert("a1", "brain_bus_alert", "dead-event:one", "Dead event one")];
    const view = await buildActiveAlerts({ limit: 10, sinceDays: 30 });
    expect(view.alerts.brain_bus_alert.map((a) => a.id)).toEqual(["a1"]);
  });
});
