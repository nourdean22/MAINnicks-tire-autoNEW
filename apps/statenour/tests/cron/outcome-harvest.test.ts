/**
 * outcome-harvest cron (2026-08-19 · outcome-loop follow-up).
 *
 * The loop's last hop terminated in a human: outcomeUseful had writers
 * but only hand-run script readers. This pins the automated reader:
 *   1. The trigger metric is the ledger's OWN correction count
 *      (dismissed OR outcomeUseful:false) — and machine judgments
 *      (reply_judgment) are NEVER part of it (counting the judge's own
 *      output toward an operator-correction gate games the gate).
 *   2. One ROLLING eval_run row (stable key) — seenCount is the run
 *      history, not a new row per week.
 *   3. The 200-correction UPSTREAMS trigger is reported the week it
 *      crosses.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  intelligenceOutcome: { count: vi.fn(), findMany: vi.fn() },
  brainMemory: { findMany: vi.fn(), upsert: vi.fn() },
  chatMessage: { count: vi.fn() },
}));

vi.mock("@/lib/utils/http", () => ({
  cronHandler: (h: (req: Request, ctx: unknown) => Promise<unknown>) => h,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    intelligenceOutcome: mocks.intelligenceOutcome,
    brainMemory: mocks.brainMemory,
    chatMessage: mocks.chatMessage,
  },
}));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

async function loadRoute() {
  vi.resetModules();
  return await import("@/app/api/cron/outcome-harvest/route");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.intelligenceOutcome.count.mockResolvedValue(42);
  // outcomeStats() reads the ledger via findMany.
  mocks.intelligenceOutcome.findMany.mockResolvedValue([]);
  mocks.brainMemory.findMany.mockResolvedValue([]);
  mocks.brainMemory.upsert.mockResolvedValue({ id: "bm-odo" });
  mocks.chatMessage.count.mockResolvedValue(7);
});

describe("outcome-harvest cron", () => {
  it("counts the ledger's own correction metric — dismissed OR outcomeUseful:false", async () => {
    const { GET } = await loadRoute();
    await GET(new Request("http://x/api/cron/outcome-harvest"), {} as never);
    expect(mocks.intelligenceOutcome.count.mock.calls[0][0].where).toEqual({
      OR: [{ decision: "dismissed" }, { outcomeUseful: false }],
    });
  });

  it("never counts machine judgments toward the operator-correction gate", async () => {
    const { GET } = await loadRoute();
    await GET(new Request("http://x/api/cron/outcome-harvest"), {} as never);
    const queried = mocks.brainMemory.findMany.mock.calls.map(
      (c) => c[0]?.where?.category,
    );
    expect(queried).toEqual(["suggestion_loop", "prompt_comparison_run"]);
    expect(queried).not.toContain("reply_judgment");
  });

  it("upserts ONE rolling eval_run odometer row — stable key, seenCount as history", async () => {
    const { GET } = await loadRoute();
    await GET(new Request("http://x/api/cron/outcome-harvest"), {} as never);
    const upsert = mocks.brainMemory.upsert.mock.calls[0][0];
    expect(upsert.where.category_key).toEqual({
      category: "eval_run",
      key: "eval_run:corpus-odometer",
    });
    expect(upsert.update.seenCount).toEqual({ increment: 1 });
    expect(upsert.create.metadata.corrections).toBe(42);
    expect(upsert.create.metadata.triggerMet).toBe(false);
  });

  it("reports the 200-correction UPSTREAMS trigger the week it crosses", async () => {
    mocks.intelligenceOutcome.count.mockResolvedValue(214);
    const { GET } = await loadRoute();
    const out = (await GET(
      new Request("http://x/api/cron/outcome-harvest"),
      {} as never,
    )) as { corrections: number; triggerMet: boolean };
    expect(out.corrections).toBe(214);
    expect(out.triggerMet).toBe(true);
    expect(mocks.brainMemory.upsert.mock.calls[0][0].create.content).toContain("MET");
  });
});
