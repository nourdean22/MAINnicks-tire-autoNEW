/**
 * Q-53 · Cleveland 311 pothole requests -> ranked ward drafts.
 *
 * Every case goes through the one export production calls,
 * getPotholeAudienceReport(), with fetch stubbed. Each test imports a fresh
 * module (vi.resetModules) so the 6-hour in-process cache starts empty.
 *
 * Fixtures are real ArcGIS grouped-statistics responses, recorded 2026-09-30:
 * 2026-08-31..09-30 (42 cells, 132 requests) and 2026-08-01..08-31 (43 cells,
 * 123 requests, 3 of them with no ward). The error body is the literal one
 * ArcGIS returned, at HTTP 200, for a query naming a missing field.
 *
 * The contract under test is the one a map must not break: a failed or
 * partial read THROWS and is never cached, so it can never render as
 * "no potholes".
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captionClaimBlockers } from "../services/socialPublish";

const load = (name: string): string =>
  readFileSync(resolve(__dirname, "../__tests__/fixtures/cleveland311", name), "utf8");
const CURRENT = load("pothole-groups-2026-08-31_2026-09-30.json");
const PRIOR = load("pothole-groups-2026-08-01_2026-08-31.json");
const ARCGIS_ERROR_BODY = JSON.stringify({
  error: {
    code: 400,
    message: "Cannot perform query. Invalid query parameters.",
    details: ["'Invalid field: bogus_field' parameter is invalid"],
  },
});

const NOW = new Date("2026-09-30T00:00:00Z");
const SIX_HOURS = 6 * 60 * 60 * 1000;
const ATTRIBUTION =
  "Contains information from City of Cleveland 311 Service Requests, made available under the Open Database License (ODbL).";

const ok = (body: string) => new Response(body, { status: 200 });
const isCurrentWindow = (url: string) =>
  (new URL(url).searchParams.get("where") ?? "").includes(">= TIMESTAMP '2026-08-31");

/** Default: CURRENT for the newer window, PRIOR for the older one. */
function stubArcgis(respond?: (url: string) => Response | undefined) {
  const spy = vi.fn(async (input: string | URL) => {
    const url = String(input);
    return respond?.(url) ?? ok(isCurrentWindow(url) ? CURRENT : PRIOR);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

async function report(now = NOW) {
  const { getPotholeAudienceReport } = await import("./cleveland311Potholes");
  return getPotholeAudienceReport(30, now);
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("cleveland311Potholes · query", () => {
  it("asks ArcGIS for Pothole Repair aggregates by ward and neighborhood, for both windows, with a timeout", async () => {
    const spy = stubArcgis();
    await report();
    expect(spy).toHaveBeenCalledTimes(2);
    const [cur, prior] = spy.mock.calls.map((c) => new URL(String(c[0])));
    expect(cur.origin + cur.pathname).toBe(
      "https://services3.arcgis.com/dty2kHktVXHrqO8i/arcgis/rest/services/Data_311/FeatureServer/0/query",
    );
    expect(cur.searchParams.get("where")).toBe(
      "service_name='Pothole Repair' AND requested_datetime >= TIMESTAMP '2026-08-31 00:00:00' AND requested_datetime < TIMESTAMP '2026-09-30 00:00:00'",
    );
    expect(prior.searchParams.get("where")).toBe(
      "service_name='Pothole Repair' AND requested_datetime >= TIMESTAMP '2026-08-01 00:00:00' AND requested_datetime < TIMESTAMP '2026-08-31 00:00:00'",
    );
    expect(cur.searchParams.get("groupByFieldsForStatistics")).toBe("ward_2026,ward_name_2026,neighborhood");
    expect(cur.searchParams.get("f")).toBe("json");
    // Aggregates only: no address, parcel or request id is ever requested.
    expect(cur.searchParams.get("outFields")).toBeNull();
    expect(cur.search).not.toMatch(/address|parcelpin|service_request_id/);
    for (const call of spy.mock.calls) expect((call[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });
});

describe("cleveland311Potholes · a failed read throws, never 'no potholes'", () => {
  const cases: Array<[string, () => Response, RegExp]> = [
    ["ArcGIS's HTTP-200 error body", () => ok(ARCGIS_ERROR_BODY), /Cleveland 311 error 400: .*Invalid field/],
    ["a truncated result", () => ok(JSON.stringify({ exceededTransferLimit: true, features: [] })), /truncated/],
    ["a non-2xx", () => new Response("upstream down", { status: 503 }), /HTTP 503/],
    ["a non-JSON body", () => ok("<html>"), /invalid JSON/],
    ["a missing features array", () => ok(JSON.stringify({ nope: [] })), /shape \(features\)/],
    ["a string count", () => ok(JSON.stringify({ features: [{ attributes: { n: "13" } }] })), /shape/],
    ["a fractional count", () => ok(JSON.stringify({ features: [{ attributes: { n: 2.5 } }] })), /shape/],
  ];
  for (const [name, body, message] of cases) {
    it(`throws on ${name}`, async () => {
      stubArcgis((url) => (isCurrentWindow(url) ? body() : undefined));
      await expect(report()).rejects.toThrow(message);
    });
  }
});

describe("cleveland311Potholes · ranked ward drafts", () => {
  it("totals both windows and ranks service-area wards first, most requests first within each group", async () => {
    stubArcgis();
    const r = await report();
    expect(r.status).toBe("draft");
    expect(r.totalRequests).toBe(132);
    expect(r.priorTotalRequests).toBe(123);
    expect(r.unassignedRequests).toBe(0);
    expect(r.wards.reduce((s, w) => s + w.requests, 0)).toBe(132);
    const inArea = r.wards.filter((w) => w.inServiceArea);
    const outside = r.wards.filter((w) => !w.inServiceArea);
    expect(inArea.length).toBeGreaterThan(0);
    expect(outside.length).toBeGreaterThan(0);
    expect(r.wards).toEqual([...inArea, ...outside]);
    for (const group of [inArea, outside]) {
      for (let i = 1; i < group.length; i++) expect(group[i - 1].requests).toBeGreaterThanOrEqual(group[i].requests);
    }
    for (const w of inArea) expect(w.milesFromShop!).toBeLessThanOrEqual(8);
    for (const w of outside) expect(w.milesFromShop!).toBeGreaterThan(8);
  });

  it("puts nearby Ward 9 ahead of the far west-side ward that has the most requests", async () => {
    stubArcgis();
    const r = await report();
    const most = [...r.wards].sort((a, b) => b.requests - a.requests)[0];
    expect(most.ward).toBe(15); // the recorded window's raw-count leader, ~15 mi west of the shop
    expect(most.inServiceArea).toBe(false);
    const idx = (n: number) => r.wards.findIndex((w) => w.ward === n);
    expect(idx(9)).toBeLessThan(idx(15));
    expect(r.wards[0].inServiceArea).toBe(true);
  });

  it("gives each ward its change, top neighborhoods, a weighted centre and its distance from the shop", async () => {
    stubArcgis();
    const r = await report();
    const cells = (body: string) =>
      (JSON.parse(body).features as { attributes: { ward_2026: number | null; n: number } }[])
        .filter((f) => f.attributes.ward_2026 === 9)
        .reduce((s, f) => s + f.attributes.n, 0);
    const w9 = r.wards.find((w) => w.ward === 9)!;
    expect(w9.requests).toBe(cells(CURRENT));
    expect(w9.priorRequests).toBe(cells(PRIOR));
    expect(w9.change).toBe(w9.requests - w9.priorRequests);
    expect(w9.neighborhoods[0]).toEqual({ name: "Glenville", requests: 7 });
    expect(w9.neighborhoods.length).toBeLessThanOrEqual(3);
    // Ward 9 (Glenville / Collinwood) sits a few miles west of the Euclid shop.
    expect(w9.milesFromShop).toBeGreaterThan(1);
    expect(w9.milesFromShop).toBeLessThan(6);
    expect(w9.draft.targeting).toMatch(/^1 mi radius around 41\.\d{4}, -81\.\d{4} \(Ward 9\)$/);
    // Great-circle check against a known point: Ward 15 (Kamm's, west side) is ~15 mi out.
    const w15 = r.wards.find((w) => w.ward === 15)!;
    expect(w15.milesFromShop).toBeGreaterThan(13);
    expect(w15.milesFromShop).toBeLessThan(17);
  });

  it("drafts copy that states the source count, carries the ODbL notice and passes the publish claim gate", async () => {
    stubArcgis();
    const r = await report();
    expect(r.source).toMatchObject({ license: "ODbL-1.0", attribution: ATTRIBUTION });
    for (const w of r.wards) {
      expect(w.draft.body).toContain(`logged ${w.requests} pothole repair request`);
      expect(w.draft.body).toContain("(216) 862-0005");
      expect(w.draft.attribution).toBe(ATTRIBUTION);
      expect(captionClaimBlockers(`${w.draft.headline}\n${w.draft.body}`)).toEqual([]);
      expect(`${w.draft.headline} ${w.draft.body}`).not.toMatch(/dangerous|necessary|unsafe|urgent/i);
    }
  });

  it("counts requests ArcGIS could not place in a ward instead of dropping them", async () => {
    stubArcgis(() => ok(PRIOR)); // the older window holds the 3 ward-less requests
    const r = await report();
    expect(r.unassignedRequests).toBe(3);
    expect(r.wards.reduce((s, w) => s + w.requests, 0) + r.unassignedRequests).toBe(123);
  });
});

describe("cleveland311Potholes · cache", () => {
  it("serves the cache for 6 hours, then reads ArcGIS again", async () => {
    const spy = stubArcgis();
    const { getPotholeAudienceReport } = await import("./cleveland311Potholes");
    const r = await getPotholeAudienceReport(30, NOW);
    expect(r.window).toEqual({ from: "2026-08-31T00:00:00.000Z", to: NOW.toISOString(), days: 30 });
    await getPotholeAudienceReport(30, new Date(NOW.getTime() + SIX_HOURS - 1));
    expect(spy).toHaveBeenCalledTimes(2);
    await getPotholeAudienceReport(30, new Date(NOW.getTime() + SIX_HOURS));
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it("never caches a failed read: the next call tries ArcGIS again", async () => {
    let failing = true;
    const spy = stubArcgis(() => (failing ? new Response("down", { status: 502 }) : undefined));
    const { getPotholeAudienceReport } = await import("./cleveland311Potholes");
    await expect(getPotholeAudienceReport(30, NOW)).rejects.toThrow(/HTTP 502/);
    failing = false;
    const r = await getPotholeAudienceReport(30, NOW);
    expect(r.totalRequests).toBe(132);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});
