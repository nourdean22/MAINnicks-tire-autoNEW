/**
 * reel-canary `start` can reserve the slot on the reel's POST day.
 *
 * Every start used to reserve TODAY, so a batch of hand-rendered reels started
 * in one sitting hit RESERVATION_FEED_CAP on the third start. `publicationIntendedAt`
 * is the same option the cron passes to enqueueReelJob when it schedules ahead
 * (dailyReelPost.ts); the route now accepts it, validates it, and threads it.
 *
 * The governor half of these tests runs the REAL requestReservation over a fake
 * DB that applies the day bounds, so "a different day is a different cap" and
 * "the same day still caps at 2" are both measured, not assumed. The harness
 * enqueue reserves on `publicationIntendedAt ?? now`; the real enqueue's window
 * derivation is pinned separately by reelEnqueueReservesIntendedDay.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

type Row = Record<string, unknown>;

// Day-bound-aware fake, the shape contentGovernor.test.ts uses: read the date
// comparisons out of the drizzle SQL tree and apply them.
type DateBound = { col: string; op: string; value: Date };
function dateBounds(cond: unknown): DateBound[] {
  const out: DateBound[] = [];
  const walk = (node: unknown) => {
    const chunks = (node as { queryChunks?: unknown[] } | null)?.queryChunks;
    if (!Array.isArray(chunks)) return;
    for (let i = 0; i < chunks.length; i++) {
      const ch = chunks[i] as { queryChunks?: unknown[]; name?: unknown };
      if (Array.isArray(ch?.queryChunks)) { walk(ch); continue; }
      const op = chunks[i + 1] as { value?: unknown } | undefined;
      const param = chunks[i + 2] as { value?: unknown } | undefined;
      if (typeof ch?.name === "string" && Array.isArray(op?.value) && param?.value instanceof Date) {
        out.push({ col: ch.name, op: op.value.join("").trim(), value: param.value });
      }
    }
  };
  walk(cond);
  return out;
}
const camel = (col: string) => col.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
const inside = (row: Row, bounds: DateBound[]) => bounds.every((b) => {
  const v = new Date(row[camel(b.col)] as string | Date).getTime();
  const t = b.value.getTime();
  return b.op === ">=" ? v >= t : b.op === ">" ? v > t : b.op === "<=" ? v <= t : b.op === "<" ? v < t : true;
});
function fakeGovernorDb(reservations: Row[]) {
  return {
    select: () => ({ from: () => ({ where: (cond?: unknown) => Promise.resolve(reservations.filter((r) => inside(r, dateBounds(cond)))) }) }),
    insert: () => ({ values: (v: Row) => { reservations.push({ ...v, createdAt: new Date() }); return Promise.resolve({}); } }),
    update: () => ({ set: () => ({ where: () => Promise.resolve({}) }) }),
  };
}

let server: Server | null = null;
let base = "";
let enqueue: ReturnType<typeof vi.fn>;
let prep: ReturnType<typeof vi.fn>;
let topicN = 0;

async function boot() {
  const reservations: Row[] = [];
  vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(fakeGovernorDb(reservations)) }));
  prep = vi.fn(async () => {
    topicN += 1;
    return {
      brief: { topic: `distinct topic ${topicN}`, campaignKeyword: `KW${topicN}`, captionHooks: ["h"], selectedCaption: "c", storyboardBeats: [] },
      attempts: 1,
      rejectedForPreflight: [],
    };
  });
  vi.doMock("./services/reelDraftPrep", () => ({ prepareCleanReelBrief: prep }));
  vi.doMock("../client/src/lib/facelessReelStudio", () => ({ resolveConditioningMode: () => "none" }));
  let jobId = 100;
  enqueue = vi.fn(async (brief: { topic: string; campaignKeyword: string }, _src: string, ep: { publicationIntendedAt?: Date }) => {
    const { requestReservation } = await import("./services/contentGovernor");
    const windowStart = ep.publicationIntendedAt ?? new Date();
    const windowEnd = new Date(windowStart.getTime() + 24 * 3600_000);
    const r = await requestReservation({ platform: "instagram", format: "reel", windowStart, windowEnd, topic: brief.topic, cta: brief.campaignKeyword });
    jobId += 1;
    return { jobId, ...(r ? { reservationWindow: { start: windowStart.toISOString(), end: windowEnd.toISOString() } } : {}) };
  });
  vi.doMock("./services/reelPipeline", () => ({ enqueueReelJob: enqueue }));
  vi.resetModules();
  const { registerAdminRoutes } = await import("./routes/adminRoutes");
  const app = express();
  registerAdminRoutes(app);
  await new Promise<void>((ok) => { server = app.listen(0, "127.0.0.1", () => ok()); });
  base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

const start = (extra: Record<string, unknown> = {}) =>
  fetch(`${base}/api/admin/reel-canary`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-admin-key" },
    body: JSON.stringify({ action: "start", topic: "operator topic", ...extra }),
  }).then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> }));

// Noon Eastern on 2026-10-14; only Date is faked so the HTTP server's timers stay real.
const NOW = new Date("2026-10-14T16:00:00Z");
const day3 = (hourUtc: number) => new Date(Date.UTC(2026, 9, 17, hourUtc)).toISOString();

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  process.env.ADMIN_API_KEY = "test-admin-key";
  topicN = 0;
  await boot();
});
afterEach(async () => {
  await new Promise<void>((ok) => (server ? server.close(() => ok()) : ok()));
  server = null;
  vi.useRealTimers();
  for (const m of ["./db", "./services/reelDraftPrep", "../client/src/lib/facelessReelStudio", "./services/reelPipeline"]) vi.doUnmock(m);
  vi.resetModules();
  delete process.env.ADMIN_API_KEY;
});

describe("reel-canary start: publicationIntendedAt", () => {
  it("3 days ahead: the intent reaches enqueueReelJob and the reservation lands on that day", async () => {
    const at = day3(14);
    const res = await start({ publicationIntendedAt: at });
    expect(res.status).toBe(200);
    const ep = enqueue.mock.calls[0][2] as { publicationIntendedAt?: Date };
    expect(ep.publicationIntendedAt).toBeInstanceOf(Date);
    expect(ep.publicationIntendedAt!.toISOString()).toBe(at);
    expect(res.body.reservationWindow).toEqual({ start: at, end: new Date(Date.parse(at) + 24 * 3600_000).toISOString() });
  });

  it("three starts for three different days all succeed (a cap per target day, not per enqueue day)", async () => {
    const days = [15, 16, 17].map((d) => new Date(Date.UTC(2026, 9, d, 14)).toISOString());
    for (const at of days) {
      const res = await start({ publicationIntendedAt: at });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    // The control, in the same run: the cap still bites per day. The 17th already
    // holds 14:00Z; one more fits, the next is refused.
    expect((await start({ publicationIntendedAt: day3(8) })).status).toBe(200);
    const third = await start({ publicationIntendedAt: day3(20) });
    expect(third.status).toBe(500);
    expect(String(third.body.error)).toMatch(/RESERVATION_FEED_CAP/);
  });

  it("three starts for the SAME day: the third is refused by the governor's feed cap", async () => {
    // 04:00, 10:00 and 16:00 Eastern on the 17th: one Cleveland day, 6h apart.
    const a = await start({ publicationIntendedAt: day3(8) });
    const b = await start({ publicationIntendedAt: day3(14) });
    const c = await start({ publicationIntendedAt: day3(20) });
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(c.status).toBe(500);
    expect(String(c.body.error)).toMatch(/RESERVATION_FEED_CAP/);
  });

  it.each([
    ["a past date", "2026-10-13T16:00:00Z", /past/],
    ["a malformed date", "next tuesday-ish", /not a valid date/],
    ["a non-string", 1760000000000, /ISO date string/],
    ["a date with no time (would book the evening before in Cleveland)", "2026-10-20", /time and offset/],
    ["more than 90 days ahead", "2027-02-01T16:00:00Z", /90 days/],
  ])("%s gives 400 with a reason, before any brief is generated or slot reserved", async (_label, value, why) => {
    const res = await start({ publicationIntendedAt: value });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(why);
    expect(prep).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("absent: the enqueue options are exactly today's three keys", async () => {
    const res = await start();
    expect(res.status).toBe(200);
    expect(enqueue.mock.calls[0][2]).toEqual({ objective: "DISCOVERY", disclosureMode: "visibly_animated", ctaType: "NONE" });
  });
});
