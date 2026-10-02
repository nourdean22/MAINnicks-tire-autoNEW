/**
 * Kill switch · bug-hunt 2026-10-02
 *
 * 1. The two mega slots run as Inngest functions `mega-fanout-morning` /
 *    `mega-fanout-evening`, but the switch is written under the manifest names
 *    `mega` / `mega-evening`, so they never matched.
 * 2. The decision is made once per run: a kill landing between a run's
 *    requests used to stop the remaining steps and still log a clean skip.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state: Record<string, boolean> = {};
const isCronEnabled = vi.fn(async (name: string) => state[name] ?? true);

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/services/cron-control", () => ({ isCronEnabled: (n: string) => isCronEnabled(n) }));

import {
  CronLifecycleMiddleware,
  KILL_SWITCH_SKIP_REASON,
  __resetKillSwitchCache,
  __resetRunKillDecisions,
  killSwitchNameOf,
} from "@/lib/inngest/cron-lifecycle";

const cronFn = (id: string) => ({ opts: { id, triggers: [{ cron: "0 9 * * *" }] } });

beforeEach(() => {
  for (const k of Object.keys(state)) delete state[k];
  isCronEnabled.mockClear();
  __resetKillSwitchCache();
  __resetRunKillDecisions();
});

describe("kill switch · manifest names", () => {
  it("maps the mega Inngest ids to their manifest names; others pass through", () => {
    expect(killSwitchNameOf(cronFn("mega-fanout-morning"))).toBe("mega");
    expect(killSwitchNameOf(cronFn("mega-fanout-evening"))).toBe("mega-evening");
    expect(killSwitchNameOf(cronFn("goal-pruner"))).toBe("goal-pruner");
  });

  it("killing mega-evening on /system/crons now stops the evening Inngest run", async () => {
    state["mega-evening"] = false;
    const mw = new CronLifecycleMiddleware({ client: {} as never });
    const next = vi.fn(async () => "ran");
    const out = await mw.wrapFunctionHandler({ ctx: { runId: "e1" }, fn: cronFn("mega-fanout-evening"), next });
    expect(next).not.toHaveBeenCalled();
    expect(out).toEqual({ skipped: true, reason: KILL_SWITCH_SKIP_REASON, jobName: "mega-evening" });
    expect(isCronEnabled).toHaveBeenCalledWith("mega-evening");
  });
});

describe("kill switch · one decision per run", () => {
  it("a kill that lands after a run started does not stop that run's later requests", async () => {
    const mw = new CronLifecycleMiddleware({ client: {} as never });
    const next = vi.fn(async () => "ran");
    // request 1 of run r1: enabled → runs
    expect(await mw.wrapFunctionHandler({ ctx: { runId: "r1" }, fn: cronFn("intelligence-daily-brief"), next })).toBe("ran");
    // operator kills it; cache expires
    state["intelligence-daily-brief"] = false;
    __resetKillSwitchCache();
    // request 2 of the SAME run still runs (save/push/telegram steps complete)
    expect(await mw.wrapFunctionHandler({ ctx: { runId: "r1" }, fn: cronFn("intelligence-daily-brief"), next })).toBe("ran");
    // the NEXT run is killed
    const out = await mw.wrapFunctionHandler({ ctx: { runId: "r2" }, fn: cronFn("intelligence-daily-brief"), next });
    expect(out).toMatchObject({ skipped: true, reason: KILL_SWITCH_SKIP_REASON });
  });

  it("a run killed at its start stays killed on every later request", async () => {
    state["goal-pruner"] = false;
    const mw = new CronLifecycleMiddleware({ client: {} as never });
    const next = vi.fn(async () => "ran");
    await mw.wrapFunctionHandler({ ctx: { runId: "k1" }, fn: cronFn("goal-pruner"), next });
    state["goal-pruner"] = true;
    __resetKillSwitchCache();
    expect(await mw.wrapFunctionHandler({ ctx: { runId: "k1" }, fn: cronFn("goal-pruner"), next })).toMatchObject({ skipped: true });
    expect(next).not.toHaveBeenCalled();
  });
});
