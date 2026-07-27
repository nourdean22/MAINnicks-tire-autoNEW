/**
 * The feed cap must count every door — including the one that publishes most.
 *
 * `assertPublishCadence` carries a note that reads, in full caps, "THE CAP MUST
 * COUNT EVERY DOOR, NOT THE ONE IT WAS WRITTEN BESIDE", and then enumerates
 * three: social_content_inventory, reel_jobs, scheduled_posts. It missed
 * ig_autopost_log — the autonomous IG/FB autoposter, which writes only there.
 *
 * Measured against production 2026-07-27:
 *
 *   ig_autopost_log   116 posted        <- invisible to the cap
 *   scheduled_posts     9 posted
 *   reel_jobs           9 posted
 *   inventory (queue)   6 published
 *
 * So the cap was blind to ~84% of everything that ever reached the feed, and
 * reported no breach the entire time. The busiest day on record is 2026-06-17
 * with 32 autopost publishes in one day, none of which the governor saw.
 *
 * AND ONE UNREADABLE DOOR ZEROED THE REST
 * A single try/catch wrapped every count, so a failure reading reel_jobs
 * silently dropped scheduled_posts too — producing exactly the undercount the
 * note warns about, in the code the note sits on.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

interface DoorState { reel: number | Error; sched: number | Error; autopost: number | Error }
const doors: DoorState = { reel: 0, sched: 0, autopost: 0 };
/** Rows the Queue door returns (each is one published inventory item). */
let inventoryRows: Array<{ publishedAt: Date; contentType: string }> = [];
let limits = { maxFeedPostsPerDay: 20, minimumFeedSpacingHours: 0 };

/** Which table a select() targeted, identified by the object drizzle was given. */
const TABLE = { reelJobs: {}, scheduledPosts: {}, igAutopostLog: {}, socialContentInventory: {} };

vi.mock("../drizzle/schema", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, ...TABLE };
});

/**
 * The real queries are `.select().from(t).where(...)` for the three counters and
 * `.select().from(t).where(...).orderBy(...)` for the inventory read. A promise
 * carrying an extra `orderBy` satisfies both without branching on call shape.
 */
function thenable(value: unknown[] | Error) {
  const p = value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  // Nothing else consumes the rejection; without this Node reports it unhandled.
  p.catch(() => {});
  return Object.assign(p, { orderBy: () => p });
}

vi.mock("./db", () => ({
  getDb: async () => ({
    select: () => ({
      from: (t: unknown) => ({
        where: () => {
          if (t === TABLE.reelJobs) return thenable(doors.reel instanceof Error ? doors.reel : [{ n: doors.reel }]);
          if (t === TABLE.scheduledPosts) return thenable(doors.sched instanceof Error ? doors.sched : [{ n: doors.sched }]);
          if (t === TABLE.igAutopostLog) return thenable(doors.autopost instanceof Error ? doors.autopost : [{ n: doors.autopost }]);
          return thenable(inventoryRows);
        },
      }),
    }),
  }),
}));

// importOriginal, NOT a bare object: contentGovernor also pulls
// clevelandDayStart from this module, and dropping it made every call throw
// into the governor's fail-open catch. The suite then went green while testing
// nothing — the same shape of silent pass this file exists to prevent.
vi.mock("./services/autonomyControl", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getActivePolicy: async () => ({ limits }),
}));

import { assertPublishCadence } from "./services/contentGovernor";

const denied = async (): Promise<string | null> => {
  try { await assertPublishCadence({ format: "photo" }); return null; }
  catch (err) { return err instanceof Error ? err.message : String(err); }
};

beforeEach(() => {
  doors.reel = 0; doors.sched = 0; doors.autopost = 0;
  inventoryRows = [];
  limits = { maxFeedPostsPerDay: 20, minimumFeedSpacingHours: 0 };
});

describe("the autoposter door is counted", () => {
  it("blocks when ig_autopost_log ALONE reaches the cap", async () => {
    // Before this change the Queue was empty, so the governor saw 0 and allowed
    // the publish no matter how many times the autoposter had already fired.
    limits.maxFeedPostsPerDay = 3;
    doors.autopost = 3;
    expect(await denied()).toMatch(/Blocked by content governor|PUBLISH_FEED_CAP/);
  });

  it("allows while the autoposter is still under the cap", async () => {
    limits.maxFeedPostsPerDay = 20;
    doors.autopost = 3;
    expect(await denied()).toBeNull();
  });

  it("sums the autoposter WITH the other doors rather than replacing them", async () => {
    limits.maxFeedPostsPerDay = 4;
    doors.autopost = 2; doors.reel = 1; doors.sched = 1;
    expect(await denied()).toMatch(/Blocked by content governor|PUBLISH_FEED_CAP/);
  });

  it("today's real shape (3 autopost, cap 20) is nowhere near blocking", async () => {
    // The measured worst normal day across all four doors is 5.
    doors.autopost = 3; doors.reel = 1; inventoryRows = [{ publishedAt: new Date(), contentType: "post" }];
    expect(await denied()).toBeNull();
  });

  it("the 2026-06-17 outlier (32 autopost publishes) WOULD be stopped at 20", async () => {
    // The runaway this cap exists for is not hypothetical — it already happened.
    doors.autopost = 20;
    expect(await denied()).toMatch(/Blocked by content governor|PUBLISH_FEED_CAP/);
  });
});

describe("one unreadable door does not zero the others", () => {
  it("still counts the autoposter when reel_jobs cannot be read", async () => {
    // Under the old shared try/catch this threw out of the whole block and
    // externalFeedPosts stayed 0 — so an unrelated failure silently disabled
    // the cap for every other door.
    limits.maxFeedPostsPerDay = 3;
    doors.reel = new Error("reel_jobs unavailable");
    doors.autopost = 3;
    expect(await denied()).toMatch(/Blocked by content governor|PUBLISH_FEED_CAP/);
  });

  it("still counts reel_jobs when the autoposter table cannot be read", async () => {
    limits.maxFeedPostsPerDay = 2;
    doors.autopost = new Error("ig_autopost_log unavailable");
    doors.reel = 2;
    expect(await denied()).toMatch(/Blocked by content governor|PUBLISH_FEED_CAP/);
  });

  it("an unreadable door contributes 0 rather than blocking everything", async () => {
    // Fail-open on a READ failure is the pre-existing, deliberate contract: the
    // cadence check must not become a new way for publishing to break.
    doors.autopost = new Error("down"); doors.reel = new Error("down"); doors.sched = new Error("down");
    expect(await denied()).toBeNull();
  });
});
