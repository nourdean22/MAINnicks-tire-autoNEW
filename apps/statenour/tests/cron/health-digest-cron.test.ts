/**
 * The health digest lost its only scheduler when wave 2V cut the Fleet/Health pages: the digest route's
 * 4h read-through was "the scheduler" and its only caller was the deleted SystemHealthCard. The rows feed
 * Brain Health Time Travel (app/api/brain/time-travel/route.ts) and the Google OAuth-expiry highlight, so a
 * daily cron now refreshes it. cronHandler (kill switch + CronLifecycle) wraps the real route; here it is
 * the identity so the handler itself is what runs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("@/lib/system/health-digest", () => ({ refreshHealthDigest: h.refresh }));
vi.mock("@/lib/utils/http", () => ({
  cronHandler: (handler: (req: Request, ctx: unknown) => Promise<unknown>) => handler,
}));

import { GET } from "@/app/api/cron/health-digest/route";
import { CRONS } from "@/config/crons";
import { EVENING_JOBS } from "@/lib/inngest/jobs";

const run = () =>
  (GET as unknown as (req: Request, ctx: unknown) => Promise<Record<string, unknown>>)(
    new Request("http://test/api/cron/health-digest"),
    { params: Promise.resolve({}) },
  );

// Braces matter: a beforeEach that RETURNS the mock is run by vitest as a teardown callback, which called the
// throwing implementation after the test and failed it.
beforeEach(() => {
  h.refresh.mockReset();
});

describe("cron/health-digest", () => {
  it("calls refreshHealthDigest once and reports what it wrote", async () => {
    h.refresh.mockResolvedValue({
      generatedAt: "2026-10-19T03:00:00.000Z",
      overall: "healthy",
      counts: { critical: 0, warning: 1, healthy: 5 },
      highlights: [{ severity: "warning", headline: "x" }],
    });
    const out = await run();
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ generatedAt: "2026-10-19T03:00:00.000Z", overall: "healthy", highlights: 1 });
  });

  it("a failing refresh propagates, so the cron run files FAILED instead of a green skip", async () => {
    h.refresh.mockImplementation(async () => {
      throw new Error("db down");
    });
    await expect(run()).rejects.toThrow("db down");
  });
});

describe("cron/health-digest · wiring", () => {
  it("is in the manifest, folded into mega-evening, and in the evening fan-out", () => {
    const entry = CRONS.find((c) => c.name === "health-digest");
    expect(entry, "no manifest entry").toBeDefined();
    expect(entry!.mode).toBe("folded");
    expect(entry!.foldedInto).toBe("mega-evening");
    expect(EVENING_JOBS).toContain("/api/cron/health-digest");
  });
});
