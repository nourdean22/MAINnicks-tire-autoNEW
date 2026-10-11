/**
 * Two reels a day (operator, 2026-10-11): the post guard counts posts per ET day
 * instead of treating "a post happened today" as "done". The first post is open
 * all day; the second opens at 18:00 ET.
 *
 * The guard is driven through runDailyReelPost with a db whose KV answers are
 * queued in the order postsToday() reads them (last_date, then day_count).
 * Anything that reads past those two answers throws "past the guard", so a run
 * that gets beyond the guard is visible rather than silently green.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { sliceBlock } from "./testUtils/sourceBlock";

const ORIGINAL_FLAG = process.env.REEL_AUTOPOST_ENABLED;

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.REEL_AUTOPOST_ENABLED;
  else process.env.REEL_AUTOPOST_ENABLED = ORIGINAL_FLAG;
  vi.useRealTimers();
  vi.doUnmock("./services/reelAutoApproval");
  vi.doUnmock("./db");
  vi.resetModules();
});

/** 2026-10-11 at the given ET hour (EDT, UTC-4). */
function setEtClock(hourEt: number): string {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.UTC(2026, 9, 11, hourEt + 4, 30)));
  return "2026-10-11";
}

async function runWithKv(answers: Array<Array<{ value: string }>>) {
  process.env.REEL_AUTOPOST_ENABLED = "true";
  vi.doMock("./services/reelAutoApproval", () => ({ autoApproveAssembledReels: vi.fn().mockResolvedValue({ policy: "auto", approved: [], skipped: [] }) }));
  const queue = [...answers];
  const chain: any = {
    select: () => chain, from: () => chain, where: () => chain,
    limit: async () => {
      const next = queue.shift();
      if (!next) throw new Error("past the guard");
      return next;
    },
  };
  vi.doMock("./db", () => ({ getDb: async () => chain }));
  vi.resetModules();
  const { runDailyReelPost } = await import("./cron/jobs/dailyReelPost");
  return runDailyReelPost().then((r) => ({ result: r, error: null as Error | null }), (error: Error) => ({ result: null, error }));
}

describe("post guard counts posts per ET day", () => {
  it("two posts today: done for the day, even after the evening slot opens", async () => {
    const date = setEtClock(19);
    const { result } = await runWithKv([[{ value: date }], [{ value: `${date}:2` }]]);
    expect(result?.details).toBe(`already posted today (${date})`);
  });

  it("one post today, morning: the second slot is not open yet", async () => {
    const date = setEtClock(10);
    const { result } = await runWithKv([[{ value: date }], [{ value: `${date}:1` }]]);
    expect(result?.details).toContain("next reel slot opens at 18:00 ET");
  });

  it("CONTROL: one post today, evening: the guard lets the pulse through", async () => {
    const date = setEtClock(19);
    const { result, error } = await runWithKv([[{ value: date }], [{ value: `${date}:1` }]]);
    expect(result).toBeNull();
    expect(error?.message).toBe("past the guard");
  });

  it("a bare legacy last_date (no count) means one post, not zero", async () => {
    const date = setEtClock(10);
    const { result } = await runWithKv([[{ value: date }], [{ value: date }]]);
    expect(result?.details).toContain("next reel slot opens at 18:00 ET");
  });

  it("a count left over from yesterday does not count today", async () => {
    const date = setEtClock(10);
    // last_date says today (one post), the count row is yesterday's "2".
    const { result } = await runWithKv([[{ value: date }], [{ value: "2026-10-10:2" }]]);
    expect(result?.details).toContain("next reel slot opens at 18:00 ET");
  });

  it("no post yet today: the guard lets the pulse through", async () => {
    setEtClock(10);
    const { result, error } = await runWithKv([[{ value: "2026-10-10" }]]);
    expect(result).toBeNull();
    expect(error?.message).toBe("past the guard");
  });
});

describe("every post writer records the count", () => {
  const CRON = readFileSync(path.join(__dirname, "cron", "jobs", "dailyReelPost.ts"), "utf8");

  it("no writer stamps the date alone, and all four go through stampPostedDay", () => {
    expect(CRON).not.toMatch(/key: "reel_autopost_last_date"/);
    expect(CRON.match(/await stampPostedDay\(/g)?.length).toBe(4);
  });

  it("the evening run has its own briefId, so it cannot dedupe onto the morning job", () => {
    expect(CRON).toContain("`${morningId}-pm`");
  });

  it("at 18:00 with nothing posted, the unposted morning job is still looked up (no second render beside it)", () => {
    expect(CRON).toContain("evening && posted === 0 ? [morningId, briefId] : [briefId]");
  });

  it("the date-only writer stamps date and count in one transaction", () => {
    const body = sliceBlock(CRON, "async function setAutopostDate", "\n}\n");
    expect(body).toContain("d.transaction(");
  });
});
