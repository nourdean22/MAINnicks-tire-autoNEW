/**
 * Content governor (Long Haul milestone 5) — creation reservations + the
 * publish-door cadence assertion legacy paths defer to.
 */
import { describe, expect, it, vi, afterEach } from "vitest";

afterEach(() => {
  vi.doUnmock("./db");
  vi.resetModules();
});

type Row = Record<string, unknown>;

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
          where: () => {
            const p = Promise.resolve(rows) as Promise<Row[]> & { orderBy: (o?: unknown) => Promise<Row[]> };
            p.orderBy = () => Promise.resolve(rows);
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
