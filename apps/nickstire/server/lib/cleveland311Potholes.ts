/**
 * Cleveland 311 "Pothole Repair" requests by ward -> DRAFT ad audiences (Q-53).
 *
 * SOURCE. City of Cleveland 311 Service Requests, published by opendataCLE as
 * the ArcGIS layer Data_311/FeatureServer/0 (item 7ed7b5f316fc40e99b10dbcffde4ebbe).
 * Its licence is the Open Data Commons Open Database License (ODbL) v1.0
 * (item licenseInfo, read 2026-09-30). No key. Coverage is the CITY of
 * Cleveland only: the shop is in Euclid, which files its own requests
 * elsewhere, so Euclid streets never appear here.
 *
 * WHAT THIS IS. A read-only map input for the Ad Studio. It ranks wards by how
 * many pothole repair requests residents filed in the last N days and drafts
 * ad copy an operator can copy. Nothing here posts, spends, sends or targets
 * a person. Requests are aggregated server-side by ward and neighborhood, so
 * no individual address ever leaves ArcGIS.
 *
 * ODbL. An ad that states a 311 count is a "Produced Work". If one is
 * published, it must carry CLEVELAND_311_ATTRIBUTION (ODbL §4.3). Each draft
 * therefore includes the notice.
 *
 * CONTRACT (same as lib/nwsWeather.ts). Every fetch has a timeout. A non-2xx,
 * an ArcGIS `error` body (ArcGIS answers HTTP 200 with {"error":...} on a bad
 * query), a truncated result or an unexpected shape THROWS. This module never
 * turns a failed read into "0 potholes".
 */

import { BUSINESS } from "../../shared/business";

const CLEVELAND_311_QUERY_URL =
  "https://services3.arcgis.com/dty2kHktVXHrqO8i/arcgis/rest/services/Data_311/FeatureServer/0/query";
const CLEVELAND_311_SOURCE_URL =
  "https://www.arcgis.com/home/item.html?id=7ed7b5f316fc40e99b10dbcffde4ebbe";
const ODBL_LICENSE_URL = "https://opendatacommons.org/licenses/odbl/1-0/";
const CLEVELAND_311_ATTRIBUTION =
  "Contains information from City of Cleveland 311 Service Requests, made available under the Open Database License (ODbL).";

const FETCH_TIMEOUT_MS = 10_000;
const POTHOLE_CACHE_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_NEIGHBORHOODS = 3;
/** Suggested radius for a draft ad set around a ward's request centre. */
const DRAFT_RADIUS_MILES = 1;
/**
 * Wards whose request centre is within this distance of the shop rank first.
 * A heuristic, not a measured catchment: 8 mi reaches Collinwood, Glenville,
 * University Circle and Hough from Euclid, and stops short of the west side.
 * Measured 2026-09-30: by raw count alone, Ward 15 (15.6 mi) ranked above
 * Ward 9 (1.9 mi) and would have been the first draft offered.
 */
const SERVICE_RADIUS_MILES = 8;

/** One ArcGIS statistics row: requests in one (ward, neighborhood) cell. */
interface PotholeGroup {
  ward: number | null;
  wardName: string | null;
  neighborhood: string | null;
  requests: number;
  /** Mean request latitude/longitude of the cell; null when ArcGIS had none. */
  lat: number | null;
  lng: number | null;
  latestAt: Date | null;
}

export interface WardAudienceDraft {
  ward: number;
  wardName: string;
  requests: number;
  priorRequests: number;
  change: number;
  neighborhoods: { name: string; requests: number }[];
  /** Request-weighted centre of the ward's requests; null if no cell had coordinates. */
  center: { lat: number; lng: number } | null;
  milesFromShop: number | null;
  /** Centre within SERVICE_RADIUS_MILES of the shop. */
  inServiceArea: boolean;
  latestRequestAt: string | null;
  draft: {
    headline: string;
    body: string;
    targeting: string;
    /** Required on anything published from this draft (ODbL). */
    attribution: string;
  };
}

export interface PotholeAudienceReport {
  status: "draft";
  generatedAt: string;
  window: { from: string; to: string; days: number };
  priorWindow: { from: string; to: string };
  totalRequests: number;
  priorTotalRequests: number;
  /** Requests ArcGIS could not place in a ward: reported, never dropped silently. */
  unassignedRequests: number;
  wards: WardAudienceDraft[];
  source: { url: string; license: string; licenseUrl: string; attribution: string };
}

/** ArcGIS SQL timestamp literal (hosted layers store UTC). */
function sqlTimestamp(d: Date): string {
  return `TIMESTAMP '${d.toISOString().slice(0, 19).replace("T", " ")}'`;
}

function potholeWhereClause(from: Date, to: Date): string {
  return `service_name='Pothole Repair' AND requested_datetime >= ${sqlTimestamp(from)} AND requested_datetime < ${sqlTimestamp(to)}`;
}

const OUT_STATISTICS = JSON.stringify([
  { statisticType: "count", onStatisticField: "OBJECTID", outStatisticFieldName: "n" },
  { statisticType: "avg", onStatisticField: "lat", outStatisticFieldName: "lat" },
  { statisticType: "avg", onStatisticField: "long", outStatisticFieldName: "lng" },
  { statisticType: "max", onStatisticField: "requested_datetime", outStatisticFieldName: "latest" },
]);

function potholeQueryUrl(from: Date, to: Date): string {
  const params = new URLSearchParams({
    where: potholeWhereClause(from, to),
    groupByFieldsForStatistics: "ward_2026,ward_name_2026,neighborhood",
    outStatistics: OUT_STATISTICS,
    orderByFields: "n DESC",
    f: "json",
  });
  return `${CLEVELAND_311_QUERY_URL}?${params.toString()}`;
}

function fail(what: string): never {
  throw new Error(`Cleveland 311: unexpected response shape (${what})`);
}

const numOrNull = (v: unknown, what: string): number | null =>
  v === null || v === undefined ? null : typeof v === "number" && Number.isFinite(v) ? v : fail(what);
const strOrNull = (v: unknown, what: string): string | null =>
  v === null || v === undefined ? null : typeof v === "string" ? v : fail(what);

function parsePotholeGroups(json: unknown): PotholeGroup[] {
  if (!json || typeof json !== "object" || Array.isArray(json)) fail("body");
  const body = json as Record<string, unknown>;
  if (body.error) {
    const e = body.error as { code?: unknown; message?: unknown; details?: unknown };
    throw new Error(`Cleveland 311 error ${String(e.code ?? "?")}: ${String(e.message ?? "")} ${JSON.stringify(e.details ?? [])}`.trim());
  }
  // A grouped result is far below the layer's 2,000-row cap; if ArcGIS says it
  // truncated anyway, the counts are partial, and a partial count is not a count.
  if (body.exceededTransferLimit === true) throw new Error("Cleveland 311: result truncated (exceededTransferLimit)");
  if (!Array.isArray(body.features)) fail("features");
  return body.features.map((f, i) => {
    const a = (f && typeof f === "object" ? (f as Record<string, unknown>).attributes : null) as
      | Record<string, unknown>
      | null;
    if (!a || typeof a !== "object") fail(`features[${i}].attributes`);
    const requests = numOrNull(a.n, `features[${i}].n`);
    if (requests === null || requests < 0 || !Number.isInteger(requests)) fail(`features[${i}].n`);
    const latest = numOrNull(a.latest, `features[${i}].latest`);
    return {
      ward: numOrNull(a.ward_2026, `features[${i}].ward_2026`),
      wardName: strOrNull(a.ward_name_2026, `features[${i}].ward_name_2026`),
      neighborhood: strOrNull(a.neighborhood, `features[${i}].neighborhood`),
      requests,
      lat: numOrNull(a.lat, `features[${i}].lat`),
      lng: numOrNull(a.lng, `features[${i}].lng`),
      latestAt: latest === null ? null : new Date(latest),
    };
  });
}

async function fetchPotholeGroups(from: Date, to: Date): Promise<PotholeGroup[]> {
  const url = potholeQueryUrl(from, to);
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Cleveland 311 HTTP ${res.status}`);
  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new Error("Cleveland 311: invalid JSON", { cause: err });
  }
  return parsePotholeGroups(json);
}

/** Great-circle distance in miles. */
function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const sum = (groups: PotholeGroup[]) => groups.reduce((s, g) => s + g.requests, 0);

/**
 * Pure: two windows of grouped requests -> ranked ward drafts. Wards in the
 * shop's service area come first; within each group, most requests first,
 * ties broken by distance from the shop.
 */
function buildPotholeAudienceReport(
  current: PotholeGroup[],
  prior: PotholeGroup[],
  opts: { from: Date; to: Date; priorFrom: Date; days: number; now: Date; shop?: { lat: number; lng: number } },
): PotholeAudienceReport {
  const shop = opts.shop ?? BUSINESS.geo;
  const priorByWard = new Map<number, number>();
  for (const g of prior) {
    if (g.ward !== null) priorByWard.set(g.ward, (priorByWard.get(g.ward) ?? 0) + g.requests);
  }

  const byWard = new Map<number, PotholeGroup[]>();
  for (const g of current) {
    if (g.ward === null) continue;
    byWard.set(g.ward, [...(byWard.get(g.ward) ?? []), g]);
  }

  const wards: WardAudienceDraft[] = [...byWard.entries()].map(([ward, groups]) => {
    const requests = sum(groups);
    const priorRequests = priorByWard.get(ward) ?? 0;
    const wardName = groups.find((g) => g.wardName)?.wardName ?? `Ward ${ward}`;

    const hoods = new Map<string, number>();
    for (const g of groups) {
      if (g.neighborhood) hoods.set(g.neighborhood, (hoods.get(g.neighborhood) ?? 0) + g.requests);
    }
    const neighborhoods = [...hoods.entries()]
      .map(([name, n]) => ({ name, requests: n }))
      .sort((a, b) => b.requests - a.requests || a.name.localeCompare(b.name))
      .slice(0, TOP_NEIGHBORHOODS);

    const located = groups.filter((g) => g.lat !== null && g.lng !== null);
    const weight = sum(located);
    const center =
      weight > 0
        ? {
            lat: located.reduce((s, g) => s + g.lat! * g.requests, 0) / weight,
            lng: located.reduce((s, g) => s + g.lng! * g.requests, 0) / weight,
          }
        : null;
    const milesFromShop = center ? Math.round(milesBetween(shop, center) * 10) / 10 : null;

    const latest = groups
      .map((g) => g.latestAt?.getTime() ?? null)
      .filter((t): t is number => t !== null);
    const latestRequestAt = latest.length ? new Date(Math.max(...latest)).toISOString() : null;

    const place = neighborhoods[0]?.name ?? wardName;
    const noun = requests === 1 ? "request" : "requests";
    return {
      ward,
      wardName,
      requests,
      priorRequests,
      change: requests - priorRequests,
      neighborhoods,
      center,
      milesFromShop,
      inServiceArea: milesFromShop !== null && milesFromShop <= SERVICE_RADIUS_MILES,
      latestRequestAt,
      draft: {
        headline: `Hit a pothole around ${place}?`,
        body:
          `Cleveland 311 logged ${requests} pothole repair ${noun} in ${wardName} in the last ${opts.days} days. ` +
          `If your car pulls, shakes, or the steering wheel sits crooked, Nick's Tire & Auto can check your tires, wheels and alignment. ` +
          `${BUSINESS.phone.display}`,
        targeting: center
          ? `${DRAFT_RADIUS_MILES} mi radius around ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)} (${wardName})`
          : `${wardName} (no coordinates in the source; target by neighborhood name)`,
        attribution: CLEVELAND_311_ATTRIBUTION,
      },
    };
  });

  wards.sort(
    (a, b) =>
      Number(b.inServiceArea) - Number(a.inServiceArea) ||
      b.requests - a.requests ||
      (a.milesFromShop ?? Number.POSITIVE_INFINITY) - (b.milesFromShop ?? Number.POSITIVE_INFINITY) ||
      a.ward - b.ward,
  );

  return {
    status: "draft",
    generatedAt: opts.now.toISOString(),
    window: { from: opts.from.toISOString(), to: opts.to.toISOString(), days: opts.days },
    priorWindow: { from: opts.priorFrom.toISOString(), to: opts.from.toISOString() },
    totalRequests: sum(current),
    priorTotalRequests: sum(prior),
    unassignedRequests: sum(current.filter((g) => g.ward === null)),
    wards,
    source: {
      url: CLEVELAND_311_SOURCE_URL,
      license: "ODbL-1.0",
      licenseUrl: ODBL_LICENSE_URL,
      attribution: CLEVELAND_311_ATTRIBUTION,
    },
  };
}

type CacheEntry = { at: number; value: PotholeAudienceReport };
const cache = new Map<number, CacheEntry>();

/**
 * The last `days` days of pothole requests (and the `days` before them for
 * the change column), ranked by ward. Cached in-process for 6 hours; a failed
 * read throws and is never cached.
 */
export async function getPotholeAudienceReport(days = 30, now = new Date()): Promise<PotholeAudienceReport> {
  const hit = cache.get(days);
  if (hit && now.getTime() - hit.at < POTHOLE_CACHE_MS) return hit.value;

  const to = now;
  const from = new Date(to.getTime() - days * DAY_MS);
  const priorFrom = new Date(from.getTime() - days * DAY_MS);
  const [current, prior] = await Promise.all([fetchPotholeGroups(from, to), fetchPotholeGroups(priorFrom, from)]);
  const value = buildPotholeAudienceReport(current, prior, { from, to, priorFrom, days, now });
  cache.set(days, { at: now.getTime(), value });
  return value;
}
