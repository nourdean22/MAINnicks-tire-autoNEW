/**
 * Sentry NICKSTIRE-7 (166 events, 2026-09-27 16:39-18:15 UTC): every
 * `specials.getActive` failed. Innermost cause was NOT the SQL — TiDB Cloud
 * restricted the cluster for usage-quota exhaustion. Nothing in the query was
 * wrong, and the sibling NICKSTIRE-6 (content.activeNotifications) is the same
 * outage.
 *
 * The code defect it exposed: the handler wrapped `return cached(...)` in
 * try/catch WITHOUT `await`, so the rejection escaped the catch. The catch
 * (log + return []) was dead code — it never logged, and the procedure threw a
 * raw INTERNAL_SERVER_ERROR. Making that catch "work" by returning [] would
 * report a DB outage as "the shop has no specials" (empty-vs-error). So the
 * fix is the sibling's contract: the catch runs, logs, and the procedure fails
 * as SERVICE_UNAVAILABLE. The client already renders nothing on error.
 *
 * Asserted through the REAL procedure with a db handle whose query rejects.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  getDb: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getDb: () => h.getDb() };
});

// Pass-through cache so the fetcher always runs (no Redis, no memo between tests).
vi.mock("./lib/cache", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, cached: (_k: string, _t: number, fetcher: () => Promise<unknown>) => fetcher() };
});

vi.mock("./lib/logger", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createLogger: (name: string) =>
      name === "routers:specials"
        ? { error: (...a: unknown[]) => h.logError(...a), warn: () => {}, info: () => {}, debug: () => {} }
        : (actual.createLogger as (n: string) => unknown)(name),
  };
});

/** A drizzle-shaped handle: select().from().where().limit() resolves or rejects. */
function handle(result: Promise<unknown[]>) {
  const chain = { from: () => chain, where: () => chain, limit: () => result };
  return { select: () => chain };
}

async function callGetActive() {
  const { specialsRouter } = await import("./routers/specials");
  return specialsRouter.createCaller({} as never).getActive();
}

describe("specials.getActive on a failed read (NICKSTIRE-7)", () => {
  beforeEach(() => {
    h.getDb.mockReset();
    h.logError.mockReset();
  });

  it("positive control: a healthy read returns the active, unexpired rows", async () => {
    const future = new Date(Date.now() + 86_400_000);
    const past = new Date(Date.now() - 86_400_000);
    h.getDb.mockResolvedValue(handle(Promise.resolve([
      { id: "a", title: "Live", expiresAt: future },
      { id: "b", title: "Expired", expiresAt: past },
      { id: "c", title: "Open-ended", expiresAt: null },
    ])));
    const rows = await callGetActive();
    expect(rows.map((r: { id: string }) => r.id)).toEqual(["a", "c"]);
    expect(h.logError).not.toHaveBeenCalled();
  });

  it("logs the failure and reports SERVICE_UNAVAILABLE instead of leaking a raw query error", async () => {
    h.getDb.mockResolvedValue(handle(Promise.reject(new Error(
      "Due to the usage quota being exhausted, access to the cluster has been restricted.",
    ))));
    await expect(callGetActive()).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    // The catch must actually run — pre-fix it was dead code.
    expect(h.logError).toHaveBeenCalledTimes(1);
  });

  it("never reports an outage as 'no specials'", async () => {
    h.getDb.mockResolvedValue(handle(Promise.reject(new Error("boom"))));
    await expect(callGetActive()).rejects.toBeDefined();
  });
});
