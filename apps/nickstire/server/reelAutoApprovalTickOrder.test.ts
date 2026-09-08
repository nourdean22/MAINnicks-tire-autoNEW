/**
 * The auto-approval pass runs on EVERY daily-reel-post tick — including the
 * ones that short-circuit on "already posted today". Pinned because the first
 * live tick after #2217 proved the opposite ordering: the early return came
 * first and a reel assembled after the day's post sat unapproved until the
 * next day's first tick. The PLANTED failure is the pass never being called.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const ORIGINAL_FLAG = process.env.REEL_AUTOPOST_ENABLED;

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.REEL_AUTOPOST_ENABLED;
  else process.env.REEL_AUTOPOST_ENABLED = ORIGINAL_FLAG;
  vi.doUnmock("./services/reelAutoApproval");
  vi.doUnmock("./db");
  vi.resetModules();
});

function todayEt(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

describe("daily-reel-post tick order", () => {
  it("runs the auto-approval pass BEFORE the already-posted-today short-circuit", async () => {
    process.env.REEL_AUTOPOST_ENABLED = "true";
    const pass = vi.fn().mockResolvedValue({ policy: "auto", approved: [], skipped: [] });
    vi.doMock("./services/reelAutoApproval", () => ({ autoApproveAssembledReels: pass }));
    // A db whose only answer is "reel_autopost_last_date = today". Anything
    // past the short-circuit would need more than this chain provides, so
    // reaching it would throw — which is itself the assertion that the
    // early return still fires.
    const chain: any = {
      select: () => chain, from: () => chain, where: () => chain,
      limit: async () => [{ value: todayEt() }],
    };
    vi.doMock("./db", () => ({ getDb: async () => chain }));
    vi.resetModules();

    const { runDailyReelPost } = await import("./cron/jobs/dailyReelPost");
    const r = await runDailyReelPost();

    expect(r.details).toContain("already posted today");
    expect(pass).toHaveBeenCalledTimes(1);
  });

  it("a throwing pass does not stop the tick", async () => {
    process.env.REEL_AUTOPOST_ENABLED = "true";
    vi.doMock("./services/reelAutoApproval", () => ({ autoApproveAssembledReels: vi.fn().mockRejectedValue(new Error("policy unreadable")) }));
    const chain: any = {
      select: () => chain, from: () => chain, where: () => chain,
      limit: async () => [{ value: todayEt() }],
    };
    vi.doMock("./db", () => ({ getDb: async () => chain }));
    vi.resetModules();

    const { runDailyReelPost } = await import("./cron/jobs/dailyReelPost");
    await expect(runDailyReelPost()).resolves.toMatchObject({ details: expect.stringContaining("already posted today") });
  });
});
