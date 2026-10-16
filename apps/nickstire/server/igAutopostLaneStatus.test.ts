/**
 * instagramAdmin.autopostLaneStatus (contract autopostLaneStatus v1) never
 * renders a failed read as a zero (job 2026-10-16-ig-autopost-controls).
 *
 * Three outcomes, kept apart:
 *  - a failed log read     -> { available: false, reason } (never an empty `recent`)
 *  - a failed flag read    -> paused: null, live: null (UNKNOWN, never "not paused")
 *  - an absent flag row    -> paused: false (what isEnabled, and so the cron, reads)
 *
 * The fake database hands each select() chain the result at its creation
 * index: 0 = the flag read, then 1..4 = lastPosted, today, recent, counts7d.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readAutopostLaneStatus } from "./routers/instagramAdmin";

type Result = unknown[] | Error;

function fakeDb(results: Result[]) {
  let next = 0;
  const chainFor = (r: Result): unknown =>
    new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
            r instanceof Error ? reject(r) : resolve(r);
        }
        return () => chainFor(r);
      },
    });
  return {
    select: () => {
      const r = results[next++];
      if (r === undefined) throw new Error(`unexpected select #${next}`);
      return chainFor(r);
    },
  } as unknown as Parameters<typeof readAutopostLaneStatus>[0];
}

const NOW = new Date("2026-10-15T16:00:00Z");
const posted = { id: 41, slot: "morning", slotDate: "2026-10-15", igPostId: "1789", createdAt: new Date("2026-10-15T12:09:00Z") };
const todayRow = { slot: "morning", status: "posted", createdAt: posted.createdAt, error: null };
const recentRow = {
  id: 41, slot: "morning", slotDate: "2026-10-15", status: "posted", source: "cron",
  igPostId: "1789", error: null, overallScore: 82, createdAt: posted.createdAt,
};
// COUNT(*) can arrive as a string from the driver; the reader must coerce it.
const counts = [
  { status: "posted", n: "13" },
  { status: "aborted", n: 10 },
  { status: "failed", n: 2 },
];
const flagsOn = [
  { key: "ig_autopost_paused", value: true },
  { key: "legacy_autopost_live", value: true },
];

const savedDryrun = process.env.IG_AUTOPOST_DRYRUN;
afterEach(() => {
  if (savedDryrun === undefined) delete process.env.IG_AUTOPOST_DRYRUN;
  else process.env.IG_AUTOPOST_DRYRUN = savedDryrun;
});

describe("readAutopostLaneStatus", () => {
  it("returns the v1 contract on a good read", async () => {
    process.env.IG_AUTOPOST_DRYRUN = "false";
    const s = await readAutopostLaneStatus(fakeDb([flagsOn, [posted], [todayRow], [recentRow], counts]), NOW);
    expect(s).toEqual({
      available: true,
      paused: true,
      live: true,
      lastPosted: posted,
      today: [todayRow],
      recent: [recentRow],
      counts7d: { posted: 13, failed: 2, aborted: 10, dryrun: 0, runs: 25 },
    });
  });

  it("absent flag rows read as not paused and not live, the same as isEnabled", async () => {
    process.env.IG_AUTOPOST_DRYRUN = "false";
    const s = await readAutopostLaneStatus(fakeDb([[], [], [], [], []]), NOW);
    expect(s).toMatchObject({ available: true, paused: false, live: false, lastPosted: null, today: [], recent: [] });
  });

  it("legacy_autopost_live ON is still not live while IG_AUTOPOST_DRYRUN is not exactly 'false'", async () => {
    delete process.env.IG_AUTOPOST_DRYRUN;
    const s = await readAutopostLaneStatus(fakeDb([flagsOn, [], [], [], []]), NOW);
    expect(s).toMatchObject({ available: true, paused: true, live: false });
  });

  it("a failed flag read is UNKNOWN (null), never 'not paused', and history still renders", async () => {
    const s = await readAutopostLaneStatus(fakeDb([new Error("flag read boom"), [posted], [todayRow], [recentRow], counts]), NOW);
    expect(s).toMatchObject({ available: true, paused: null, live: null, recent: [recentRow] });
  });

  it("a failed log read is available:false with a reason, never an empty list", async () => {
    const s = await readAutopostLaneStatus(fakeDb([flagsOn, [posted], new Error("log read boom"), [recentRow], counts]), NOW);
    expect(s.available).toBe(false);
    expect(s).not.toHaveProperty("recent");
    expect((s as { reason: string }).reason).toMatch(/log read boom/);
  });

  it("no database is available:false", async () => {
    const s = await readAutopostLaneStatus(null, NOW);
    expect(s).toEqual({ available: false, reason: expect.stringMatching(/database/i) });
  });
});
