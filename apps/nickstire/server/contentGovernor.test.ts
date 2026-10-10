/**
 * Content governor (Long Haul milestone 5) — creation reservations + the
 * publish-door cadence assertion legacy paths defer to.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

afterEach(() => {
  vi.doUnmock("./db");
  vi.resetModules();
});

type Row = Record<string, unknown>;

/**
 * The fake used to hand back EVERY row whatever the where clause said, so a
 * query with no upper bound on the day and a query with one were the same
 * test. A reservation on Thursday counted toward Wednesday's cap in prod
 * (audit A3, 2026-10-10) and nothing here could see it. The fake now reads
 * the date comparisons out of the drizzle SQL tree and applies them.
 */
type DateBound = { col: string; op: string; value: Date };
function dateBounds(cond: unknown): DateBound[] {
  const out: DateBound[] = [];
  const walk = (node: unknown) => {
    const chunks = (node as { queryChunks?: unknown[] } | null)?.queryChunks;
    if (!Array.isArray(chunks)) return;
    for (let i = 0; i < chunks.length; i++) {
      const ch = chunks[i] as { queryChunks?: unknown[]; name?: unknown; value?: unknown };
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
function rowInsideDateBounds(row: Row, bounds: DateBound[]): boolean {
  return bounds.every((b) => {
    const field = camel(b.col);
    const v = new Date(row[field] as string | Date).getTime();
    const t = b.value.getTime();
    if (b.op === ">=") return v >= t;
    if (b.op === ">") return v > t;
    if (b.op === "<=") return v <= t;
    if (b.op === "<") return v < t;
    return true;
  });
}

function fakeGovernorDb(reservations: Row[], inventory: Row[] = []) {
  let lastTable: "reservations" | "inventory" = "reservations";
  return {
    select: (_proj?: unknown) => ({
      from: (table: { _?: unknown } & Record<string, unknown>) => {
        // crude table discrimination: the inventory table object has a
        // publishedAt column reference in our selects; reservations calls
        // pass the reservations table. We track by column presence.
        lastTable = "publishedAt" in (table as object) || (table as { published_at?: unknown }).published_at ? "inventory" : "reservations";
        const rows = lastTable === "inventory" ? inventory : reservations;
        const chain = {
          where: (cond?: unknown) => {
            const matched = rows.filter((r) => rowInsideDateBounds(r, dateBounds(cond)));
            const p = Promise.resolve(matched) as Promise<Row[]> & { orderBy: (o?: unknown) => Promise<Row[]> };
            p.orderBy = () => Promise.resolve(matched);
            return p;
          },
        };
        return chain;
      },
    }),
    insert: () => ({ values: (v: Row) => { reservations.push(v); return Promise.resolve({}); } }),
    update: () => ({ set: (patch: Row) => ({ where: () => { reservations.forEach((r) => Object.assign(r, r.status === "reserved" && patch.status === "expired" ? {} : {})); return Promise.resolve({}); } }) }),
  };
}

const inWindow = (offsetH: number): Row => ({
  id: `resv_${offsetH}`,
  status: "reserved",
  format: "reel",
  topic: "existing topic",
  cta: "TREAD",
  territory: null,
  windowStart: new Date(Date.now() + offsetH * 3600_000),
  createdAt: new Date(),
});

describe("requestReservation", () => {
  // Noon Eastern: every same-day offset below stays inside the day whatever
  // hour the suite runs at. Only Date is faked; timers stay real.
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-14T16:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("reserves a clean slot and persists the row", async () => {
    const reservations: Row[] = [];
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(fakeGovernorDb(reservations)) }));
    vi.resetModules();
    const { requestReservation } = await import("./services/contentGovernor");
    const res = await requestReservation({
      platform: "instagram",
      format: "reel",
      windowStart: new Date(),
      windowEnd: new Date(Date.now() + 86_400_000),
      topic: "first hard freeze battery check",
      cta: "BATTERY",
    });
    expect(res).not.toBeNull();
    expect(reservations.some((r) => r.id === res!.reservationId && r.status === "reserved")).toBe(true);
  });

  it("denies when the day's feed reservations hit the policy cap", async () => {
    const reservations = [inWindow(1), inWindow(5)]; // DEFAULT maxFeedPostsPerDay = 2
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(fakeGovernorDb(reservations)) }));
    vi.resetModules();
    const { requestReservation, GovernorDenial } = await import("./services/contentGovernor");
    await expect(
      requestReservation({ platform: "instagram", format: "reel", windowStart: new Date(), windowEnd: new Date(Date.now() + 3600_000), topic: "fresh topic" }),
    ).rejects.toThrow(GovernorDenial);
  });

  it("does not count reservations on a LATER day toward today's feed cap", async () => {
    // Two slots already booked for the day after tomorrow. Today is open, and
    // the operator filling it must not be refused RESERVATION_FEED_CAP.
    const reservations = [inWindow(48), inWindow(52)];
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(fakeGovernorDb(reservations)) }));
    vi.resetModules();
    const { requestReservation } = await import("./services/contentGovernor");
    const res = await requestReservation({ platform: "instagram", format: "reel", windowStart: new Date(), windowEnd: new Date(Date.now() + 3600_000), topic: "fresh topic" });
    expect(res?.reservationId).toMatch(/^resv_/);
  });

  it("PLANTED CANARY: two reservations on the SAME day still trip the cap after the day bound", async () => {
    const reservations = [inWindow(1), inWindow(5)];
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(fakeGovernorDb(reservations)) }));
    vi.resetModules();
    const { requestReservation } = await import("./services/contentGovernor");
    await expect(
      requestReservation({ platform: "instagram", format: "reel", windowStart: new Date(Date.now() + 9 * 3600_000), windowEnd: new Date(Date.now() + 10 * 3600_000), topic: "fresh topic" }),
    ).rejects.toThrow(/RESERVATION_FEED_CAP/);
  });

  it("denies a window that violates minimum spacing", async () => {
    const reservations = [inWindow(1)]; // 1h away < 3h spacing
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(fakeGovernorDb(reservations)) }));
    vi.resetModules();
    const { requestReservation } = await import("./services/contentGovernor");
    await expect(
      requestReservation({ platform: "instagram", format: "reel", windowStart: new Date(), windowEnd: new Date(Date.now() + 3600_000), topic: "fresh topic" }),
    ).rejects.toThrow(/RESERVATION_SPACING/);
  });

  it("denies repeated topic and repeated CTA within their lookbacks", async () => {
    const reservations = [{ ...inWindow(20), windowStart: new Date(Date.now() + 20 * 3600_000) }];
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(fakeGovernorDb(reservations)) }));
    vi.resetModules();
    const { requestReservation } = await import("./services/contentGovernor");
    await expect(
      requestReservation({
        platform: "instagram",
        format: "reel",
        windowStart: new Date(Date.now() + 40 * 3600_000),
        windowEnd: new Date(Date.now() + 41 * 3600_000),
        topic: "Existing   TOPIC", // normalization must catch case/space variants
        cta: "TREAD",
      }),
    ).rejects.toThrow(/REPEAT_TOPIC/);
  });

  // ── REPEATS ARE MEASURED AGAINST THE PUBLISH WINDOW, NOT CREATION TIME ──
  // Live 2026-09-08: six pre-rendered reels reserved for six different days
  // were refused REPEAT_CTA because all six were CREATED within one hour. The
  // rule means "same CTA within 72h of the audience's feed", so the window is
  // the clock. Both directions are pinned: a distant window is allowed, and a
  // near window is still refused — a check that cannot fail is not a check.
  it("allows the same CTA when the publish windows are days apart, even if created minutes apart", async () => {
    const reservations = [{ ...inWindow(0), topic: "coolant color", cta: "SAVE", createdAt: new Date() }];
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(fakeGovernorDb(reservations)) }));
    vi.resetModules();
    const { requestReservation } = await import("./services/contentGovernor");
    const res = await requestReservation({
      platform: "instagram",
      format: "reel",
      windowStart: new Date(Date.now() + 5 * 24 * 3600_000),
      windowEnd: new Date(Date.now() + 5 * 24 * 3600_000 + 3600_000),
      topic: "cabin air filter",
      cta: "SAVE",
    });
    expect(res?.reservationId).toMatch(/^resv_/);
  });

  it("PLANTED CANARY: the same CTA within 72h of the window is still refused", async () => {
    // Created five days apart (inside the 7-day fetch the governor runs on
    // createdAt), landing 6h apart. With the fake honouring the where clause,
    // a row created TEN days ago is not fetched at all — that is the real
    // query's reach, not a test artefact, and it is noted in the 2026-10-10
    // audit as adjacent rot rather than widened here.
    const reservations = [{ ...inWindow(0), topic: "coolant color", cta: "SAVE", createdAt: new Date(Date.now() - 5 * 24 * 3600_000) }];
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(fakeGovernorDb(reservations)) }));
    vi.resetModules();
    const { requestReservation } = await import("./services/contentGovernor");
    await expect(
      requestReservation({
        platform: "instagram",
        format: "reel",
        // created five days apart, but landing 6h apart — that is the repeat
        windowStart: new Date(Date.now() + 6 * 3600_000),
        windowEnd: new Date(Date.now() + 7 * 3600_000),
        topic: "cabin air filter",
        cta: "SAVE",
      }),
    ).rejects.toThrow(/REPEAT_CTA/);
  });

  it("returns null loudly when the reservations table is unavailable", async () => {
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(null) }));
    vi.resetModules();
    const { requestReservation } = await import("./services/contentGovernor");
    const res = await requestReservation({ platform: "instagram", format: "reel", windowStart: new Date(), windowEnd: new Date() });
    expect(res).toBeNull();
  });
});

describe("assertPublishCadence (publish door)", () => {
  it("denies the publish when today's published feed count is at cap", async () => {
    const inventory = [
      { publishedAt: new Date(Date.now() - 3600_000), contentType: "reel" },
      { publishedAt: new Date(Date.now() - 7200_000), contentType: "post" },
    ];
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(fakeGovernorDb([], inventory)) }));
    vi.resetModules();
    const { assertPublishCadence } = await import("./services/contentGovernor");
    await expect(assertPublishCadence({ format: "reel" })).rejects.toThrow(/PUBLISH_FEED_CAP/);
  });

  it("denies a publish inside the spacing window and allows one outside it", async () => {
    const recent = [{ publishedAt: new Date(Date.now() - 30 * 60_000), contentType: "post" }];
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(fakeGovernorDb([], recent)) }));
    vi.resetModules();
    const g1 = await import("./services/contentGovernor");
    await expect(g1.assertPublishCadence({ format: "photo" })).rejects.toThrow(/PUBLISH_SPACING/);

    vi.doUnmock("./db");
    vi.resetModules();
    const old = [{ publishedAt: new Date(Date.now() - 5 * 3600_000), contentType: "post" }];
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(fakeGovernorDb([], old)) }));
    vi.resetModules();
    const g2 = await import("./services/contentGovernor");
    await expect(g2.assertPublishCadence({ format: "photo" })).resolves.toBeUndefined();
  });

  it("stories bypass the feed cap", async () => {
    const inventory = [
      { publishedAt: new Date(Date.now() - 3600_000), contentType: "reel" },
      { publishedAt: new Date(Date.now() - 7200_000), contentType: "post" },
    ];
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(fakeGovernorDb([], inventory)) }));
    vi.resetModules();
    const { assertPublishCadence } = await import("./services/contentGovernor");
    await expect(assertPublishCadence({ format: "story" })).resolves.toBeUndefined();
  });
});
