/**
 * The health digest lost its only scheduler when wave 2V cut the Fleet/Health pages: the digest route's
 * 4h read-through was "the scheduler" and its only caller was the deleted SystemHealthCard. The rows feed
 * Brain Health Time Travel (app/api/brain/time-travel/route.ts) and the Google OAuth-expiry highlight, so a
 * daily cron now refreshes it. cronHandler (kill switch + CronLifecycle) wraps the real route; here it is
 * the identity so the handler itself is what runs.
 *
 * Codex review on #3184: a green cron must mean the row is durable. Only the compute step and the Prisma
 * client are faked here; the real persistHealthDigestOrThrow runs, so the write itself is what is tested.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ compute: vi.fn(), upsert: vi.fn() }));

vi.mock("@/lib/system/health-digest", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/system/health-digest")>()),
  computeHealthDigest: h.compute,
}));
vi.mock("@/lib/prisma", () => ({ prisma: { brainMemory: { upsert: h.upsert } } }));
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

const DIGEST = {
  generatedAt: "2026-10-19T03:00:00.000Z",
  overall: "healthy",
  counts: { critical: 0, warning: 1, healthy: 5 },
  highlights: [{ severity: "warning", headline: "x" }],
};

// Braces matter: a beforeEach that RETURNS the mock is run by vitest as a teardown callback, which called the
// throwing implementation after the test and failed it.
beforeEach(() => {
  h.compute.mockReset();
  h.upsert.mockReset();
  h.compute.mockResolvedValue(DIGEST);
  h.upsert.mockResolvedValue({});
});

describe("cron/health-digest", () => {
  it("computes once, awaits the upsert of the day's row, and reports what it wrote", async () => {
    let upsertSettled = false;
    h.upsert.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      upsertSettled = true;
      return {};
    });
    const out = await run();
    expect(upsertSettled, "the cron returned before the write finished").toBe(true);
    expect(h.compute).toHaveBeenCalledTimes(1);
    expect(h.upsert).toHaveBeenCalledTimes(1);
    const arg = h.upsert.mock.calls[0]![0] as {
      where: { category_key: { key: string } };
      create: { content: string };
    };
    expect(arg.where.category_key.key).toBe("2026-10-19");
    expect(JSON.parse(arg.create.content)).toMatchObject({ overall: "healthy" });
    expect(out).toMatchObject({ generatedAt: DIGEST.generatedAt, overall: "healthy", highlights: 1 });
  });

  it("a failing compute propagates, so the cron run files FAILED instead of a green skip", async () => {
    h.compute.mockImplementation(async () => {
      throw new Error("db down");
    });
    await expect(run()).rejects.toThrow("db down");
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("a failing WRITE propagates too: no green run for a digest that never landed", async () => {
    h.upsert.mockRejectedValue(new Error("neon: connection terminated"));
    await expect(run()).rejects.toThrow("connection terminated");
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
