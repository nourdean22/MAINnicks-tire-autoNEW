/**
 * Kill switch · opt-in coverage for EVENT-triggered Inngest functions
 * (audit 2026-10-10, 03-F15).
 *
 * `wrapFunctionHandler` gated cron-triggered functions only, so the 9 event
 * functions (social-publish, nick-action-approved, nick-action-approved, ...) had
 * no operator stop. The fix is an explicit list, EMPTY by default: nothing
 * changes until the operator names a function there, then flips its switch
 * (systemAutomation.setCronEnabled with the function id).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state: Record<string, boolean> = {};
const isCronEnabled = vi.fn(async (name: string) => state[name] ?? true);

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/services/cron-control", () => ({ isCronEnabled: (n: string) => isCronEnabled(n) }));

import {
  CronLifecycleMiddleware,
  KILL_SWITCH_SKIP_REASON,
  KILLABLE_EVENT_FUNCTIONS,
  __resetKillSwitchCache,
  __resetRunKillDecisions,
} from "@/lib/inngest/cron-lifecycle";

const eventFn = (id: string) => ({ opts: { id, triggers: [{ event: "social/publish" }] } });
const mw = () => new CronLifecycleMiddleware({ client: {} as never });

// The shipped list, restored after each case so a test that edits it cannot leak.
const SHIPPED = [...KILLABLE_EVENT_FUNCTIONS];

beforeEach(() => {
  for (const k of Object.keys(state)) delete state[k];
  isCronEnabled.mockClear();
  __resetKillSwitchCache();
  __resetRunKillDecisions();
});
afterEach(() => {
  KILLABLE_EVENT_FUNCTIONS.clear();
  for (const id of SHIPPED) KILLABLE_EVENT_FUNCTIONS.add(id);
});

describe("event-function kill switch · opt-in", () => {
  it("the shipped list names the two side-effecting event functions", () => {
    expect([...KILLABLE_EVENT_FUNCTIONS].sort()).toEqual(["nick-action-approved", "social-publish"]);
  });

  it("a shipped event function with its switch off does not run", async () => {
    state["social-publish"] = false;
    const next = vi.fn(async () => "ran");
    const out = await mw().wrapFunctionHandler({ ctx: { runId: "e0" }, fn: eventFn("social-publish"), next });
    expect(next).not.toHaveBeenCalled();
    expect(out).toEqual({ skipped: true, reason: KILL_SWITCH_SKIP_REASON, jobName: "social-publish" });
  });

  it("CONTROL: an unlisted event function with its switch off still runs", async () => {
    KILLABLE_EVENT_FUNCTIONS.clear();
    state["social-publish"] = false;
    const next = vi.fn(async () => "ran");
    expect(await mw().wrapFunctionHandler({ ctx: { runId: "e5" }, fn: eventFn("social-publish"), next })).toBe("ran");
    expect(isCronEnabled).not.toHaveBeenCalled();
  });

  it("RED CASE: a LISTED event function whose switch is off does not run", async () => {
    KILLABLE_EVENT_FUNCTIONS.add("social-publish");
    state["social-publish"] = false;
    const next = vi.fn(async () => "ran");
    const out = await mw().wrapFunctionHandler({ ctx: { runId: "e1" }, fn: eventFn("social-publish"), next });
    expect(next).not.toHaveBeenCalled();
    expect(out).toEqual({ skipped: true, reason: KILL_SWITCH_SKIP_REASON, jobName: "social-publish" });
    expect(isCronEnabled).toHaveBeenCalledWith("social-publish");
  });

  it("a listed event function with its switch on runs", async () => {
    KILLABLE_EVENT_FUNCTIONS.add("social-publish");
    const next = vi.fn(async () => "ran");
    expect(await mw().wrapFunctionHandler({ ctx: { runId: "e2" }, fn: eventFn("social-publish"), next })).toBe("ran");
  });

  it("listing one event function gates only that one", async () => {
    KILLABLE_EVENT_FUNCTIONS.clear();
    KILLABLE_EVENT_FUNCTIONS.add("social-publish");
    state["nick-action-approved"] = false;
    const next = vi.fn(async () => "ran");
    expect(await mw().wrapFunctionHandler({ ctx: { runId: "e3" }, fn: eventFn("nick-action-approved"), next })).toBe("ran");
    expect(isCronEnabled).not.toHaveBeenCalled();
  });

  it("FAIL OPEN: an unreadable switch runs the listed event function", async () => {
    KILLABLE_EVENT_FUNCTIONS.add("social-publish");
    isCronEnabled.mockRejectedValueOnce(new Error("db down"));
    const next = vi.fn(async () => "ran");
    expect(await mw().wrapFunctionHandler({ ctx: { runId: "e4" }, fn: eventFn("social-publish"), next })).toBe("ran");
  });
});
