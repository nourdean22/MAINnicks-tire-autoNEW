/**
 * Board overrides are loaded before a cron or Inngest handler runs (audit 03-F13b preload, 2026-10-11).
 *
 * On a cold start the first getFlag() only STARTS a background load, so a handler that
 * reads NICK_MUTATION_LOCK reads env: the lock set on the board did not hold for the
 * first run after a deploy. cronHandler and wrapFunctionHandler now await the load
 * (R3-01 made it shared and rejecting) before the handler or the kill-switch branch.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    userPreference: { findMany: (...a: unknown[]) => h.findMany(...a) },
    cronJobLog: {
      create: async () => ({ id: "row-1" }),
      update: async () => ({ id: "row-1" }),
      findFirst: async () => null,
      findMany: async () => [],
    },
    apiRequestLog: { create: async () => ({}) },
    errorLog: { create: async () => ({}) },
  },
  resetQueryCount: () => {},
  getQueryCount: () => 0,
}));
vi.mock("@/lib/services/cron-control", () => ({ isCronEnabled: async () => true }));
vi.mock("@/lib/automation/policy", () => ({ logPolicyFire: async () => undefined }));
vi.mock("@/lib/db/brain-bus-durable", () => ({ publishDurable: async () => undefined }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

const LOCK_ROW = [{ key: "NICK_MUTATION_LOCK", value: "true" }];
// A slow DB read, so a handler that does not wait for it is caught reading env.
const slowly = <T,>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 25));

beforeEach(() => {
  vi.resetModules(); // fresh flag cache: nothing loaded, nothing in flight
  h.findMany.mockReset();
  h.findMany.mockImplementation(() => slowly(LOCK_ROW));
  delete process.env.NICK_MUTATION_LOCK;
});

describe("flag overrides preload", () => {
  it("wrapFunctionHandler: an event function's handler sees the board lock", async () => {
    const ff = await import("@/lib/feature-flags");
    const { CronLifecycleMiddleware } = await import("@/lib/inngest/cron-lifecycle");
    const mw = new CronLifecycleMiddleware({ client: {} as never });
    const fn = { opts: { id: "nick-action-approved", triggers: [{ event: "nick/action.approved" }] } };

    const seen = await mw.wrapFunctionHandler({
      ctx: { runId: "r1" },
      fn,
      next: async () => ff.getFlag("NICK_MUTATION_LOCK")?.isOn,
    });

    expect(seen).toBe(true);
  });

  it("wrapFunctionHandler: a failed load still runs the handler (on env)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.findMany.mockRejectedValue(new Error("db down"));
    const { CronLifecycleMiddleware } = await import("@/lib/inngest/cron-lifecycle");
    const mw = new CronLifecycleMiddleware({ client: {} as never });
    const next = vi.fn(async () => "ran");

    const out = await mw.wrapFunctionHandler({
      ctx: { runId: "r2" },
      fn: { opts: { id: "social-publish", triggers: [{ event: "social/publish" }] } },
      next,
    });

    expect(out).toBe("ran");
  });

  it("cronHandler: a route cron's handler sees the board lock", async () => {
    const ff = await import("@/lib/feature-flags");
    const { cronHandler } = await import("@/lib/utils/http");
    const GET = cronHandler(async () => ({ ok: true, lock: ff.getFlag("NICK_MUTATION_LOCK")?.isOn }));

    const res = await (GET as unknown as (r: Request) => Promise<Response>)(
      new Request("http://localhost/api/cron/outbox-drain", { headers: { authorization: "Bearer x" } }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { lock: boolean } };
    expect(body.data.lock).toBe(true);
  });
});
