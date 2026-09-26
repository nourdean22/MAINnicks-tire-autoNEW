/**
 * Competitor Monitor — competitor place_id registry + on-demand ratings.
 * Stores place_ids only; ratings and review counts are read live from the
 * Google Places API when asked for and never persisted (Q-48, 2026-09-23 —
 * see the registry note above resolveCompetitorPlaceIds).
 *
 * Requires: GOOGLE_PLACES_API_KEY env var
 */

import { createLogger } from "../lib/logger";

const log = createLogger("competitor-monitor");

const API_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "";

interface CompetitorData {
  name: string;
  placeId: string;
  rating: number;
  reviewCount: number;
  address?: string;
  fetchedAt: Date;
}

// Cleveland-area competitors
// Place IDs resolved via Google Places text search at runtime if not cached.
// To get exact Place IDs manually: search on Google Maps → share → extract from URL,
// or use: https://developers.google.com/maps/documentation/places/web-service/place-id
const COMPETITORS: Array<{ name: string; placeId: string; searchQuery: string }> = [
  {
    name: "Firestone Complete Auto Care (Euclid Ave)",
    placeId: "", // resolved at runtime via searchQuery
    searchQuery: "Firestone Complete Auto Care Euclid Ave Cleveland OH",
  },
  {
    name: "Midas (Euclid Ave)",
    placeId: "",
    searchQuery: "Midas Euclid Ave Cleveland OH",
  },
  {
    name: "Pep Boys Cleveland",
    placeId: "",
    searchQuery: "Pep Boys Cleveland OH",
  },
  {
    name: "Meineke Car Care Center Cleveland",
    placeId: "",
    searchQuery: "Meineke Car Care Center Cleveland OH",
  },
  {
    name: "Goodyear Auto Service Cleveland",
    placeId: "",
    searchQuery: "Goodyear Auto Service Center Cleveland OH",
  },
  // 2026-08-11 · LOCAL independents — the set the shop actually competes
  // with block-by-block (same list as client/src/lib/competitorGbpMonitor.ts
  // baselines). The chains above measure the market; these measure the fight.
  {
    name: "Moe's Tire Center",
    placeId: "",
    searchQuery: "Moe's Tire Center Cleveland OH",
  },
  {
    name: "St.Clair Tire",
    placeId: "",
    searchQuery: "St Clair Tire Cleveland OH",
  },
  {
    name: "Bro's Tires",
    placeId: "",
    searchQuery: "Bro's Tires Cleveland OH",
  },
  {
    name: "EJ'S Tire & Auto Repair",
    placeId: "",
    searchQuery: "EJ's Tire and Auto Repair Cleveland OH",
  },
  // 2026-09-23 · the REVIEW-VOLUME set. The recruiting research
  // (docs/recruiting/RECRUITING-ENGINE-2026-09.md Sec. 1 #5, Sec. 7) wants to
  // say "most-reviewed tire & auto shop within N miles" and could not: these
  // are the nearby shops whose public review counts came closest (aggregator
  // figures, 2026-09-22: Conrad's Mayfield Hts ~931, NTB Mayfield ~554,
  // Confident Tire Euclid 1,530 on SureCritic with Google unknown). Measuring
  // them here, in the table that already persists snapshots, is what turns
  // the claim into a dated fact — or rules it out. No superlative ships
  // until a snapshot supports it.
  // (A "Firestone 26086 Euclid Ave" entry was removed the same day: the
  // "Firestone ... Euclid Ave" entry above most likely resolves to that same
  // store — findPlaceFromText takes the first candidate with no location
  // bias — and two rows for one store would double-count it.)
  {
    name: "Confident Tire (Lakeland Blvd, Euclid)",
    placeId: "",
    searchQuery: "Confident Tire 25680 Lakeland Blvd Euclid OH",
  },
  {
    name: "Conrad's Tire Express (Mayfield Hts)",
    placeId: "",
    searchQuery: "Conrad's Tire Express 5739 Mayfield Rd Mayfield Heights OH",
  },
  {
    name: "NTB (Mayfield Rd)",
    placeId: "",
    searchQuery: "NTB National Tire and Battery 3997 Mayfield Rd Cleveland Heights OH",
  },
  {
    name: "Mr. Tire (South Euclid)",
    placeId: "",
    searchQuery: "Mr. Tire 4522 Mayfield Rd South Euclid OH",
  },
  {
    name: "Tire Choice (South Euclid)",
    placeId: "",
    searchQuery: "Tire Choice Auto Service Centers 4311 Mayfield Rd South Euclid OH",
  },
  {
    name: "Euclid Tire",
    placeId: "",
    searchQuery: "Euclid Tire 1054 E 222nd St Euclid OH",
  },
];

// In-memory cache of resolved Place IDs (survives across cron runs within same process)
const resolvedPlaceIds: Record<string, string> = {};

// 2026-08-11 · auth-class API failure tracking. The old code returned null on
// REQUEST_DENIED exactly like on a transient miss, so a dead GCP key produced
// healthy-looking "0 competitors · 0 changes" cron rows for weeks (prod
// capability-ledger: Places key REQUEST_DENIED, silently swallowed). Transient
// per-competitor failures stay fail-open; a SYSTEMIC denial must throw so the
// tier runner writes cron_log.error_message and the skip-watchdog sees it.
const DENIAL_STATUSES = new Set(["REQUEST_DENIED", "OVER_QUERY_LIMIT", "INVALID_REQUEST"]);
let lastDenialStatus: string | null = null;
function noteApiStatus(status: unknown): void {
  if (typeof status === "string" && DENIAL_STATUSES.has(status)) {
    lastDenialStatus = status;
    log.warn("[competitorMonitor] Places API auth-class failure", { status });
  }
}

// Nick's Tire place ID
const NICKS_PLACE_ID = process.env.GOOGLE_PLACE_ID || "";

/** Resolve a business name to a Google Place ID via text search */
async function findPlaceFromText(query: string): Promise<string | null> {
  if (!API_KEY) return null;

  // Check cache first
  if (resolvedPlaceIds[query]) return resolvedPlaceIds[query];

  try {
    const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(query)}&inputtype=textquery&fields=place_id&key=${API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;

    const data = await res.json() as any;
    noteApiStatus(data.status);
    if (data.status !== "OK" || !data.candidates?.length) return null;

    const placeId = data.candidates[0].place_id;
    if (!placeId) {
      log.warn("[competitorMonitor] Place candidate has no place_id", { query, candidate: data.candidates[0] });
      return null;
    }
    // wave-116d — cached placeId locks the competitor identity for the
    // process lifetime. If Google returns multiple candidates (ambiguous
    // query), we always pick [0] but log every candidate's name so the
    // operator can audit if a wrong competitor got locked. Fix mismatches
    // by clearing resolvedPlaceIds[query] (process restart) or making
    // the query more specific.
    if (data.candidates.length > 1) {
      log.warn("[competitorMonitor] Ambiguous query — multiple Place candidates", {
        query,
        chosen: { placeId, name: data.candidates[0].name },
        otherCandidates: data.candidates.slice(1, 5).map((c: any) => ({ placeId: c.place_id, name: c.name })),
      });
    }
    resolvedPlaceIds[query] = placeId; // cache it
    log.info("Resolved Place ID", { query, placeId, candidateCount: data.candidates.length });
    return placeId;
  } catch (err) {
    log.warn("Place text search failed", { query, err });
    return null;
  }
}

/** Fetch place details from Google Places API */
async function fetchPlaceDetails(
  placeId: string
): Promise<{ rating: number; reviewCount: number; name: string } | null> {
  if (!API_KEY || !placeId) return null;

  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,rating,user_ratings_total&key=${API_KEY}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return null;

    const data = await res.json() as any;
    noteApiStatus(data.status);
    if (data.status !== "OK" || !data.result) return null;

    return {
      name: data.result.name || "Unknown",
      rating: data.result.rating || 0,
      reviewCount: data.result.user_ratings_total || 0,
    };
  } catch (err) {
    log.warn("Places API fetch failed", { placeId, err });
    return null;
  }
}

/**
 * competitor_snapshots is a PLACE-ID REGISTRY since 2026-09-23 (Q-48).
 *
 * It used to hold one row per competitor per day with Google's rating and
 * review count (source "google_places"), and the daily cycle diffed today
 * against yesterday to fire threshold alerts. Google Maps Platform Terms
 * forbid that: "Customer will not cache Google Maps Content except as
 * expressly permitted under the Maps Service Specific Terms"
 * (cloud.google.com/maps-platform/terms), and those Service Specific Terms
 * permit caching place_id ("Google ID Caching") and, for the Places API, only
 * latitude/longitude for 30 days (section 14.3). Ratings and counts have no
 * carve-out. The operator approved dropping the rating-history trend and the
 * change alerts that depended on it (issue #2614).
 *
 * Rows written now carry competitor_name + place_id and source "place_id"
 * only; rating/review_count are left to their column defaults (0) and MUST
 * NOT be read as data. Ratings are read on demand (fetchCompetitorSnapshot)
 * and never written anywhere.
 *
 * A stored place_id is durable across restarts. If a query locked onto the
 * wrong store, delete that competitor's source="place_id" row and the next
 * run re-resolves it.
 */
const PLACE_ID_SOURCE = "place_id";

/** Seed resolvedPlaceIds from the registry so a restart does not re-pay the text search. */
async function loadKnownPlaceIds(): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const { competitorSnapshots } = await import("../../drizzle/schema");
    const { desc, eq } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return;
    const rows = await d
      .select({ name: competitorSnapshots.competitorName, placeId: competitorSnapshots.placeId })
      .from(competitorSnapshots)
      .where(eq(competitorSnapshots.source, PLACE_ID_SOURCE))
      .orderBy(desc(competitorSnapshots.capturedAt));
    for (const r of rows) {
      const c = COMPETITORS.find((x) => x.name === r.name);
      if (!c || !r.placeId || resolvedPlaceIds[c.searchQuery]) continue; // newest row wins
      if (NICKS_PLACE_ID && r.placeId === NICKS_PLACE_ID) continue;
      resolvedPlaceIds[c.searchQuery] = r.placeId;
    }
  } catch (err) {
    log.warn("loadKnownPlaceIds failed (non-fatal)", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Store newly resolved place_ids. place_id ONLY — never rating or review count. */
async function persistPlaceIds(entries: Array<{ name: string; placeId: string }>): Promise<void> {
  if (entries.length === 0) return;
  try {
    const { getDb } = await import("../db");
    const { competitorSnapshots } = await import("../../drizzle/schema");
    const d = await getDb();
    if (!d) return;
    const now = new Date();
    await d.insert(competitorSnapshots).values(
      entries.map((e) => ({
        competitorName: e.name,
        placeId: e.placeId,
        source: PLACE_ID_SOURCE,
        capturedAt: now,
      })),
    );
  } catch (err) {
    log.warn("persistPlaceIds failed (non-fatal)", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Resolve every competitor's place_id: registry first, then text search for
 * the rest. Newly resolved ids are stored. A query that resolves to OUR OWN
 * listing is dropped: measured 2026-09-23, "Midas (Euclid Ave)" had resolved
 * to Nick's place_id for 45 snapshots (why Google matches that query to us is
 * not known), filing Nick's 1,715 reviews under a competitor's name.
 */
async function resolveCompetitorPlaceIds(): Promise<{
  resolved: Array<{ name: string; placeId: string }>;
  newlyResolved: number;
  unresolved: number;
}> {
  await loadKnownPlaceIds();
  const resolved: Array<{ name: string; placeId: string }> = [];
  const fresh: Array<{ name: string; placeId: string }> = [];
  let unresolved = 0;

  for (const c of COMPETITORS) {
    let placeId = c.placeId || resolvedPlaceIds[c.searchQuery] || "";
    const known = !!placeId;
    if (!placeId) placeId = (await findPlaceFromText(c.searchQuery)) || "";
    if (!placeId) {
      log.warn("Could not resolve Place ID for competitor", { name: c.name, query: c.searchQuery });
      unresolved++;
      continue;
    }
    if (NICKS_PLACE_ID && placeId === NICKS_PLACE_ID) {
      log.warn("Competitor query resolved to Nick's own listing — skipped", { name: c.name, query: c.searchQuery });
      delete resolvedPlaceIds[c.searchQuery];
      unresolved++;
      continue;
    }
    resolved.push({ name: c.name, placeId });
    if (!known) fresh.push({ name: c.name, placeId });
  }

  await persistPlaceIds(fresh);
  return { resolved, newlyResolved: fresh.length, unresolved };
}

/**
 * ON-DEMAND read of live ratings for Nick's + every competitor. Returns the
 * data to the caller and writes NONE of it: no rating, count or review text is
 * persisted or logged here (Q-48). Only newly resolved place_ids are stored.
 */
export async function fetchCompetitorSnapshot(): Promise<CompetitorData[]> {
  if (!API_KEY) {
    log.debug("GOOGLE_PLACES_API_KEY not configured, skipping competitor monitor");
    return [];
  }

  const results: CompetitorData[] = [];
  const now = new Date();

  if (NICKS_PLACE_ID) {
    const own = await fetchPlaceDetails(NICKS_PLACE_ID);
    if (own) {
      results.push({
        name: "Nick's Tire & Auto (You)",
        placeId: NICKS_PLACE_ID,
        rating: own.rating,
        reviewCount: own.reviewCount,
        fetchedAt: now,
      });
    }
  }

  const { resolved } = await resolveCompetitorPlaceIds();
  for (const c of resolved) {
    const data = await fetchPlaceDetails(c.placeId);
    if (data) {
      results.push({
        name: c.name,
        placeId: c.placeId,
        rating: data.rating,
        reviewCount: data.reviewCount,
        fetchedAt: now,
      });
    }
  }

  log.info("Competitor snapshot fetched (on demand, not stored)", {
    count: results.length,
    timestamp: now.toISOString(),
  });

  return results;
}

/**
 * Daily cron cycle. Since Q-48 (2026-09-23) this ONLY keeps the place_id
 * registry current — it fetches no ratings, so it stores none and alerts on
 * none. The rating-history trend and the >=10-review / >=0.2-star threshold
 * alerts were removed with the stored history they diffed against.
 *
 * Throws when nothing resolved AND Google returned an auth-class status, so a
 * dead key is a FAILED cron_log row rather than a healthy-looking zero.
 */
export async function runCompetitorMonitorCycle(): Promise<{
  known: number;
  newlyResolved: number;
  unresolved: number;
}> {
  if (!API_KEY) return { known: 0, newlyResolved: 0, unresolved: COMPETITORS.length };
  lastDenialStatus = null;
  const { resolved, newlyResolved, unresolved } = await resolveCompetitorPlaceIds();
  if (resolved.length === 0 && lastDenialStatus) {
    throw new Error(
      `Places API ${lastDenialStatus} — key is configured but rejected; fix the GCP key/API restriction (operator). No competitor place_id resolved.`,
    );
  }
  return { known: resolved.length, newlyResolved, unresolved };
}

/** Build a competitive position report */
export function buildPositionReport(
  data: CompetitorData[]
): {
  nicks: CompetitorData | null;
  competitors: CompetitorData[];
  ratingRank: number;
  reviewRank: number;
  summary: string;
} {
  const nicks = data.find((d) => d.placeId === NICKS_PLACE_ID) || null;
  const competitors = data.filter((d) => d.placeId !== NICKS_PLACE_ID);

  const allByRating = [...data].sort((a, b) => b.rating - a.rating);
  const allByReviews = [...data].sort((a, b) => b.reviewCount - a.reviewCount);

  const ratingRank = nicks
    ? allByRating.findIndex((d) => d.placeId === NICKS_PLACE_ID) + 1
    : 0;
  const reviewRank = nicks
    ? allByReviews.findIndex((d) => d.placeId === NICKS_PLACE_ID) + 1
    : 0;

  const summary = nicks
    ? `Nick's: ${nicks.rating}★ (${nicks.reviewCount} reviews) — Rank #${ratingRank} by rating, #${reviewRank} by volume`
    : "No data for Nick's Tire";

  return { nicks, competitors, ratingRank, reviewRank, summary };
}
