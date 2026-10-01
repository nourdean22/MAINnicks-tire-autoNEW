/**
 * Q-23 phase 11 · smsPerformance.laneHealth keeps each read's failure to itself.
 *
 * Four reads feed the strip. One failing must mark only its own part unreadable:
 * a cron_log outage must not blank the send counts, and no failure may come back
 * as an empty-but-readable result (which the strip would draw as zeros and
 * "no run in 7d").
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fail: new Set<string>(),
  cronRows: [] as unknown[],
  smsRows: [] as unknown[],
  flags: {} as Record<string, boolean>,
  executeCalls: 0,
}));

function chain(kind: "cron" | "sms") {
  const result = () => (h.fail.has(kind) ? Promise.reject(new Error(`boom ${kind} 2165550188`)) : Promise.resolve(kind === "cron" ? h.cronRows : h.smsRows));
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "groupBy", "limit"]) c[m] = () => c;
  c.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => result().then(ok, bad);
  return c;
}

vi.mock("./lib/db-helper", () => ({
  db: async () => ({
    // The cron select names `ageMinutes`; the sms select names `attempted`.
    select: (shape: Record<string, unknown>) => chain("ageMinutes" in shape ? "cron" : "sms"),
    execute: vi.fn(async () => {
      h.executeCalls++;
      if (h.fail.has("holdout")) throw new Error("boom holdout");
      return [[]];
    }),
  }),
}));

vi.mock("./services/featureFlags", () => ({
  isEnabled: vi.fn(async (key: string) => {
    if (h.fail.has("flags")) throw new Error("flags down");
    return h.flags[key] ?? false;
  }),
}));

import { smsPerformanceRouter } from "./routers/smsPerformance";
import type { TrpcContext } from "./_core/context";

function ctx(): TrpcContext {
  return {
    user: { id: 1, openId: "admin", email: "a@b.com", name: "A", loginMethod: "manus", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext;
}

const call = () => smsPerformanceRouter.createCaller(ctx()).laneHealth();

afterEach(() => {
  h.fail.clear();
  h.cronRows = [];
  h.smsRows = [];
  h.flags = {};
  h.executeCalls = 0;
});

describe("smsPerformance.laneHealth", () => {
  it("a clean read is readable everywhere and keeps the newest and newest-completed run per job", async () => {
    h.cronRows = [
      { jobName: "winback-auto-process", status: "skipped", startedAt: new Date(), recordsProcessed: 0, details: "cross-dyno lock held by another process", ageMinutes: 2 },
      { jobName: "winback-auto-process", status: "completed", startedAt: new Date(), recordsProcessed: 3, details: null, ageMinutes: 62 },
      { jobName: "winback-auto-process", status: "completed", startedAt: new Date(), recordsProcessed: 9, details: null, ageMinutes: 122 },
    ];
    h.smsRows = [{ variantKey: "winback", attempted: "4", sent: "3" }];
    h.flags = { contact_holdouts_enabled: true, contact_holdout_winback: true };
    const res = await call();
    expect(res.cron.readable).toBe(true);
    expect(res.cron.runs["winback-auto-process"]?.latest?.status).toBe("skipped");
    expect(res.cron.runs["winback-auto-process"]?.latestCompleted?.recordsProcessed).toBe(3);
    expect(res.sms).toEqual({ readable: true, byVariant: [{ variantKey: "winback", attempted: 4, sent: 3 }] });
    expect(res.holdout.state).toBe("read");
    expect(res.holdoutArmed.winback).toBe(true);
    expect(res.holdoutArmed.retention).toBe(false);
    expect(res.holdoutArmed).not.toHaveProperty("drip");
  });

  it("a cron_log failure marks only the run log unreadable", async () => {
    h.fail.add("cron");
    h.smsRows = [{ variantKey: "drip", attempted: 1, sent: 1 }];
    const res = await call();
    expect(res.cron).toEqual({ readable: false, runs: {} });
    expect(res.sms.readable).toBe(true);
    expect(res.holdout.state).toBe("read");
  });

  it("a send-log failure marks only the sends unreadable", async () => {
    h.fail.add("sms");
    const res = await call();
    expect(res.sms).toEqual({ readable: false, byVariant: [] });
    expect(res.cron.readable).toBe(true);
  });

  it("a holdout failure is state 'error', not an empty read", async () => {
    h.fail.add("holdout");
    const res = await call();
    expect(res.holdout).toEqual({ state: "error", byLane: [] });
  });

  it("a flag failure is null (unread) for holdout lanes, not false", async () => {
    h.fail.add("flags");
    const res = await call();
    expect(res.holdoutArmed.winback).toBeNull();
    expect(res.holdoutArmed).not.toHaveProperty("declined_recovery");
  });
});
