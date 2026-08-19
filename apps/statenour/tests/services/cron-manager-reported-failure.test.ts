/**
 * logCronRun reported-failure detection · 2026-08-19.
 *
 * A cron that catches its own error and RETURNS `{ ok: false }` resolves
 * its promise — logCronRun used to file a green success row for it. That
 * false-green was diagnosed and patched per-route three times
 * (correlation-alarm, creation-spike-detect, decision-quality-drift)
 * while ~7 more routes with the identical shape stayed green, including
 * inngest-liveness — the watchdog that logged SUCCESS while reporting
 * that Inngest was down. These tests pin the wrapper-level fix: an
 * explicit `ok: false` in a RESOLVED result files a FAILED row (with the
 * result's reason), while `success` stays true so the HTTP contract and
 * the mega fan-out's child handling are unchanged.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({ id: "row" }),
  publishDurable: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { cronJobLog: { create: h.create } },
}));
vi.mock("@/lib/db/brain-bus-durable", () => ({
  publishDurable: h.publishDurable,
}));

import { logCronRun } from "@/lib/services/cron-manager";

beforeEach(() => {
  h.create.mockClear();
  h.publishDurable.mockClear();
});

describe("logCronRun", () => {
  it("files success for a resolved handler with no failure claim", async () => {
    const run = await logCronRun("healthy-job", async () => ({ drained: 3 }));
    expect(run.success).toBe(true);
    expect(run.reportedFailure).toBeUndefined();
    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "success" }) }),
    );
  });

  it("files FAILED when the handler resolves with ok:false (the false-green class)", async () => {
    const run = await logCronRun("liveness-watchdog", async () => ({
      ok: false,
      reason: "no heartbeat in 26h",
    }));
    // HTTP contract unchanged: the route still returns its payload as a 200
    expect(run.success).toBe(true);
    expect(run.result).toEqual({ ok: false, reason: "no heartbeat in 26h" });
    // …but the log row tells the truth
    expect(run.reportedFailure).toBe("no heartbeat in 26h");
    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed", error: "no heartbeat in 26h" }),
      }),
    );
    // and the brain-bus failure event fires, same as a thrown failure.
    // publishCronFailure is fire-and-forget (void import().then()) — wait
    // for the microtask chain instead of asserting synchronously.
    await vi.waitFor(() =>
      expect(h.publishDurable).toHaveBeenCalledWith(
        "cron.failure",
        "cron_run_failed",
        expect.objectContaining({ jobName: "liveness-watchdog" }),
        expect.anything(),
      ),
    );
  });

  it("falls back to the error field, then a generic reason", async () => {
    const run = await logCronRun("j", async () => ({ ok: false, error: "bridge 401" }));
    expect(run.reportedFailure).toBe("bridge 401");

    const run2 = await logCronRun("j", async () => ({ ok: false }));
    expect(run2.reportedFailure).toBe("handler returned ok:false");
  });

  it("does NOT treat a missing ok field, ok:true, arrays, or primitives as failure claims", async () => {
    for (const result of [{ drained: 0 }, { ok: true }, [1, 2], "done", null, 42]) {
      h.create.mockClear();
      const run = await logCronRun("j", async () => result);
      expect(run.reportedFailure).toBeUndefined();
      expect(h.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: "success" }) }),
      );
    }
  });

  it("still files failed + returns success:false on a thrown handler", async () => {
    const run = await logCronRun("j", async () => {
      throw new Error("boom");
    });
    expect(run.success).toBe(false);
    expect(run.error).toBe("boom");
    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed", error: "boom" }),
      }),
    );
  });
});
