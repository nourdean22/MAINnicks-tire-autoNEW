/**
 * Competitor Monitor — Tracks competitor ratings and review counts
 * Uses Google Places API to fetch competitor data on a schedule.
 * Alerts when competitors gain/lose significant reviews.
 *
 * Requires: GOOGLE_PLACES_API_KEY env var
 */

import { createLogger } from "../lib/logger";
import { alertSystem } from "./telegram";

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
 * Persist a snapshot batch to competitor_snapshots so change detection
 * survives pod restarts (wave-181.x · Tier S). Fail-open · DB unavailable
 * just means we lose this one snapshot · won't crash the cron.
 */
async function persistSnapshots(snapshots: CompetitorData[]): Promise<void> {
  if (snapshots.length === 0) return;
  try {
    const { getDb } = await import("../db");
    const { competitorSnapshots } = await import("../../drizzle/schema");
    const d = await getDb();
    if (!d) return;
    await d.insert(competitorSnapshots).values(
      snapshots.map((s) => ({
        competitorName: s.name,
        placeId: s.placeId,
        rating: String(s.rating ?? 0),
        reviewCount: s.reviewCount,
        source: "google_places",
        capturedAt: s.fetchedAt,
      })),
    );
  } catch (err) {
    log.warn("persistSnapshots failed (non-fatal)", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Pull the most-recent snapshot per competitor from DB (older than now
 * by at least 1 hour) so the cron has a real baseline to compare
 * against. Returns empty array on DB error or first-ever run.
 */
async function loadPreviousSnapshots(): Promise<CompetitorData[]> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return [];
    // Pull the most-recent row per place_id older than 1h ago. Indexed
    // (place_id, captured_at DESC) so this is O(N_competitors), not a
    // full-table scan.
    const rows = await d.execute(sql`
      SELECT cs.competitor_name, cs.place_id, cs.rating, cs.review_count, cs.captured_at
      FROM competitor_snapshots cs
      INNER JOIN (
        SELECT place_id, MAX(captured_at) AS max_at
        FROM competitor_snapshots
        WHERE captured_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)
        GROUP BY place_id
      ) latest ON cs.place_id = latest.place_id AND cs.captured_at = latest.max_at
    `);
    const dataRows = (Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows) as Array<{
      competitor_name: string;
      place_id: string;
      rating: string | number;
      review_count: number;
      captured_at: Date | string;
    }>;
    return dataRows.map((r) => ({
      name: r.competitor_name,
      placeId: r.place_id,
      rating: typeof r.rating === "string" ? parseFloat(r.rating) : r.rating,
      reviewCount: r.review_count,
      fetchedAt: new Date(r.captured_at),
    }));
  } catch (err) {
    log.warn("loadPreviousSnapshots failed (non-fatal)", {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/** Fetch all competitor data (call from cron) */
export async function fetchCompetitorSnapshot(): Promise<CompetitorData[]> {
  if (!API_KEY) {
    log.debug("GOOGLE_PLACES_API_KEY not configured, skipping competitor monitor");
    return [];
  }

  const results: CompetitorData[] = [];
  const now = new Date();

  // Fetch Nick's own data first
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

  // Fetch competitors — resolve Place IDs via text search if not already cached
  for (const c of COMPETITORS) {
    let placeId = c.placeId || resolvedPlaceIds[c.searchQuery];
    if (!placeId) {
      placeId = await findPlaceFromText(c.searchQuery) || "";
    }
    if (!placeId) {
      log.warn("Could not resolve Place ID for competitor", { name: c.name, query: c.searchQuery });
      continue;
    }

    const data = await fetchPlaceDetails(placeId);
    if (data) {
      results.push({
        name: c.name,
        placeId,
        rating: data.rating,
        reviewCount: data.reviewCount,
        fetchedAt: now,
      });
    }
  }

  log.info("Competitor snapshot fetched", {
    count: results.length,
    timestamp: now.toISOString(),
  });

  return results;
}

/**
 * Full cycle · wave-181.x · Tier S. Run by the cron tier-4 daily job.
 *   1 · load last persisted snapshot per competitor from DB
 *   2 · fetch fresh data from Google Places
 *   3 · persist the new batch
 *   4 · diff vs the persisted baseline · alert on meaningful drift
 *
 * Returns { fetched, changes } for the cron caller to log.
 *
 * On a first-ever run · loadPreviousSnapshots returns [] · detectChanges
 * yields 0 changes · normal · the next run has a baseline.
 *
 * Fail-open at every step · the cron MUST NOT crash if Google rate-
 * limits, DB hiccups, or one competitor goes off-grid.
 */
export async function runCompetitorMonitorCycle(): Promise<{
  fetched: number;
  changes: number;
  alerted: boolean;
  alertsFired: number;
}> {
  lastDenialStatus = null;
  const previous = await loadPreviousSnapshots();
  const current = await fetchCompetitorSnapshot();
  if (current.length === 0) {
    // 2026-08-11 · zero results + an auth-class API status is a dead key,
    // not a quiet market: throw so cron_log records a FAILED run with the
    // reason, instead of weeks of healthy-looking zeros.
    if (lastDenialStatus) {
      throw new Error(
        `Places API ${lastDenialStatus} — key is configured but rejected; fix the GCP key/API restriction (operator). No competitor rows fetched.`,
      );
    }
    return { fetched: 0, changes: 0, alerted: false, alertsFired: 0 };
  }
  await persistSnapshots(current);
  const changes = detectChanges(previous, current);
  const alertsFired = await fireThresholdAlerts(changes);
  return { fetched: current.length, changes: changes.length, alerted: alertsFired > 0, alertsFired };
}

/** Stable per-day dedup key for one competitor x metric breach. */
export function buildAlertKey(change: { placeId: string; metric: string }): string {
  // cron_alerts_fired.alert_key is VARCHAR(100); "cmp:" + placeId (~27) +
  // ":" + metric stays well under it.
  return `cmp:${change.placeId}:${change.metric}`.slice(0, 100);
}

/**
 * Decision-forcing alert layer (2026-08-11). Fires ONE Telegram per run
 * containing only the breaches that won today's cron_alerts_fired claim —
 * so a breach alerts once per day across restarts and pods, and there is
 * deliberately NO digest mode: no breach, no message. Gated by the
 * competitor_threshold_alerts flag (snapshots persist regardless), which
 * carries the 30-day kill clause in its description.
 */
async function fireThresholdAlerts(
  changes: ReturnType<typeof detectChanges>,
): Promise<number> {
  if (changes.length === 0) return 0;
  try {
    const { isEnabled } = await import("./featureFlags");
    if (!(await isEnabled("competitor_threshold_alerts"))) return 0;
  } catch {
    return 0; // flag unreadable → fail closed for alerts, data still persisted
  }

  const claimed: typeof changes = [];
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return 0; // no DB → no dedup possible → don't risk daily spam
    for (const change of changes) {
      const [claimResult] = await d.execute(sql`
        INSERT IGNORE INTO cron_alerts_fired (alert_key, fired_for, fired_at, payload)
        VALUES (${buildAlertKey(change)}, CURDATE(), NOW(), ${JSON.stringify({ name: change.name, change: change.change })})
      `);
      const affected = (claimResult as { affectedRows?: number })?.affectedRows ?? 0;
      if (affected === 1) claimed.push(change);
    }
  } catch (err) {
    log.warn("[competitorMonitor] alert dedup claim failed — skipping alerts this run", {
      err: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }

  if (claimed.length === 0) return 0;
  const summary = claimed.map((c) => `${c.name}: ${c.change}`).join("\n");
  await alertSystem("Competitor threshold breach", summary).catch((e) => {
    log.warn("[services/competitorMonitor] alert send failed:", e);
  });
  return claimed.length;
}

/**
 * Compare two snapshots and detect significant changes. PURE as of
 * 2026-08-11 — the Telegram side-effect moved to fireThresholdAlerts
 * (flag-gated + deduped per day via cron_alerts_fired); before that this
 * re-alerted on every run a diff persisted and duplicated across pods.
 */
export function detectChanges(
  previous: CompetitorData[],
  current: CompetitorData[]
): Array<{ name: string; placeId: string; metric: "reviews" | "rating"; change: string; severity: "info" | "warning" }> {
  const changes: Array<{ name: string; placeId: string; metric: "reviews" | "rating"; change: string; severity: "info" | "warning" }> = [];

  for (const curr of current) {
    const prev = previous.find((p) => p.placeId === curr.placeId);
    if (!prev) continue;

    const reviewDiff = curr.reviewCount - prev.reviewCount;
    const ratingDiff = curr.rating - prev.rating;

    if (reviewDiff >= 10) {
      changes.push({
        name: curr.name,
        placeId: curr.placeId,
        metric: "reviews",
        change: `+${reviewDiff} reviews (${prev.reviewCount} → ${curr.reviewCount})`,
        severity: "warning",
      });
    }

    if (Math.abs(ratingDiff) >= 0.2) {
      changes.push({
        name: curr.name,
        placeId: curr.placeId,
        metric: "rating",
        change: `Rating ${ratingDiff > 0 ? "up" : "down"} ${prev.rating} → ${curr.rating}`,
        severity: ratingDiff > 0 ? "info" : "warning",
      });
    }
  }

  return changes;
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
