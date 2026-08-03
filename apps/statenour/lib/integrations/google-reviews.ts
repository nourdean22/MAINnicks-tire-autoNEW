/**
 * Google Reviews integration · v10.0.59 · Wave A part 2 · cleanup.
 *
 * Pre-cleanup: 5 dead `Promise.resolve(...)` placeholders that
 * referenced a `googleReview` Prisma model that doesn't exist in
 * the schema (review persistence layer was never built — was
 * intended to live alongside customer/job/lead but those moved to
 * nickstire and reviews were left in limbo).
 *
 * Post-cleanup: persistence layer replaced by `BrainMemory` rows
 * with category="google_review" so the integration actually works.
 * fetchAndStoreReviews is the only side-effecting function; the
 * read functions (getReviewStats, getUnrespondedReviews) source
 * from the same brainMemory category.
 *
 * Why brainMemory not a dedicated table: reviews are low-volume
 * (Nick's Tire averages ~5-10 new reviews/month from Google);
 * adding a dedicated table for that would be over-engineering.
 * brainMemory's category+key indexing handles the lookup just
 * fine, and the content field carries the review JSON.
 */

import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("integrations/google-reviews");

const PLACE_ID = process.env.GOOGLE_PLACE_ID || "";
const API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

interface PlaceReview {
  author_name: string;
  rating: number;
  text: string;
  time: number;
}

interface StoredReview {
  reviewId: string;
  authorName: string;
  rating: number;
  text: string;
  time: number;
  responded?: boolean;
  respondedAt?: string;
  responseText?: string;
}

function reviewKey(authorName: string, time: number): string {
  // Stable key: time is a Unix timestamp (seconds since epoch),
  // unique per review per author.
  return `${time}_${authorName.replace(/\s+/g, "_").slice(0, 40)}`;
}

function parseReview(content: string): StoredReview | null {
  try {
    const parsed = JSON.parse(content) as StoredReview;
    return parsed;
  } catch {
    return null;
  }
}

export async function fetchAndStoreReviews(): Promise<{ fetched: number; newCount: number }> {
  if (!PLACE_ID || !API_KEY) {
    throw new Error("GOOGLE_PLACE_ID and GOOGLE_PLACES_API_KEY must be set");
  }

  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${PLACE_ID}&fields=reviews&key=${API_KEY}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) }); // wave-181.92
  if (!res.ok) throw new Error(`Google Places HTTP ${res.status}`);
  const data = await res.json();

  // forensic-audit MEDIUM · Places returns HTTP 200 with a status field on
  // key/billing/place-id problems (REQUEST_DENIED / OVER_QUERY_LIMIT / NOT_FOUND).
  // Without this an expired key looked like a successful { fetched: 0 } and new
  // negative reviews silently stopped reaching the operator.
  if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(`Google Places error: ${data.status}${data.error_message ? ` — ${data.error_message}` : ""}`);
  }

  const reviews: PlaceReview[] = data.result?.reviews ?? [];
  let newCount = 0;

  for (const review of reviews) {
    const key = reviewKey(review.author_name, review.time);
    const existing = await prisma.brainMemory
      .findUnique({
        where: { category_key: { category: "google_review", key } },
        select: { id: true },
      })
      .catch(() => null);
    if (existing) continue;

    const stored: StoredReview = {
      reviewId: key,
      authorName: review.author_name,
      rating: review.rating,
      text: review.text,
      time: review.time,
      responded: false,
    };
    // forensic-audit MEDIUM · only count a review as new if it actually
    // persisted; the old code ran newCount++ even when the create was caught,
    // overstating what was stored.
    let persisted = true;
    await prisma.brainMemory
      .create({
        data: {
          category: "google_review",
          key,
          content: JSON.stringify(stored),
          confidence: 1.0,
          source: "integrations:google-places",
        },
      })
      .catch((err) => {
        persisted = false;
        log.warn("review_persist_failed", {
          key,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    if (persisted) newCount++;
  }

  return { fetched: reviews.length, newCount };
}

/** Beyond this, the cache is old enough that quoting it as current is wrong. */
const REVIEW_CACHE_STALE_AFTER_DAYS = 7;

export async function getReviewStats(): Promise<{
  total: number;
  average: number;
  breakdown: Record<number, number>;
  responded: number;
  unresponded: number;
  /** false when the store could not be READ — distinct from "no reviews". */
  ok: boolean;
  /** ISO timestamp of the most recently written review row, or null. */
  lastWriteAt: string | null;
  ageDays: number | null;
  stale: boolean;
  /** One line a caller (or the model) can quote verbatim about freshness. */
  freshnessNote: string;
}> {
  // A read failure must NOT render as "0 reviews". The previous `.catch(() => [])`
  // made an unreachable database and a shop with no reviews produce byte-identical
  // output — and `alternate-paths.ts` hands this straight to the model under a
  // "reason from THESE numbers" instruction.
  let rows: Array<{ content: string; updatedAt: Date }> | null = null;
  try {
    rows = await prisma.brainMemory.findMany({
      where: { category: "google_review", deletedAt: null },
      select: { content: true, updatedAt: true },
    });
  } catch {
    rows = null;
  }

  if (rows === null) {
    return {
      total: 0, average: 0, breakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      responded: 0, unresponded: 0,
      ok: false, lastWriteAt: null, ageDays: null, stale: true,
      freshnessNote: "Review store UNREADABLE — these zeros are not a measurement. Do not quote a review count.",
    };
  }

  const reviews: StoredReview[] = [];
  for (const row of rows) {
    const parsed = parseReview(row.content);
    if (parsed) reviews.push(parsed);
  }

  const total = reviews.length;
  const average = total > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / total : 0;
  const breakdown: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let responded = 0;

  for (const r of reviews) {
    breakdown[r.rating] = (breakdown[r.rating] || 0) + 1;
    if (r.responded) responded++;
  }

  // Freshness comes from when a row was last WRITTEN, not from the review dates
  // themselves — a shop can genuinely go weeks without a new review, but the
  // writer should still be touching rows. `fetchAndStoreReviews` currently has
  // ZERO callers, so in practice this is the age of whatever last wrote here.
  const newestWriteMs = rows.reduce((max, r) => Math.max(max, r.updatedAt.getTime()), 0);
  const lastWriteAt = newestWriteMs > 0 ? new Date(newestWriteMs).toISOString() : null;
  const ageDays = newestWriteMs > 0
    ? Math.floor((Date.now() - newestWriteMs) / 86_400_000)
    : null;
  const stale = ageDays === null || ageDays > REVIEW_CACHE_STALE_AFTER_DAYS;

  const freshnessNote = lastWriteAt === null
    ? "No review rows have EVER been written — there is no review data to quote."
    : stale
      ? `Review cache is ${ageDays} days old (last written ${lastWriteAt.slice(0, 10)}). Quote it as "as of" that date, never as current.`
      : `Review cache is current (last written ${lastWriteAt.slice(0, 10)}).`;

  return {
    total,
    average: Math.round(average * 10) / 10,
    breakdown,
    responded,
    unresponded: total - responded,
    ok: true,
    lastWriteAt,
    ageDays,
    stale,
    freshnessNote,
  };
}

export async function markReviewResponded(reviewId: string, responseText: string): Promise<void> {
  const row = await prisma.brainMemory
    .findUnique({
      where: { category_key: { category: "google_review", key: reviewId } },
      select: { content: true },
    })
    .catch(() => null);
  if (!row) {
    log.warn("review_mark_responded_not_found", { reviewId });
    return;
  }
  const parsed = parseReview(row.content);
  if (!parsed) return;
  parsed.responded = true;
  parsed.respondedAt = new Date().toISOString();
  parsed.responseText = responseText;
  await prisma.brainMemory
    .update({
      where: { category_key: { category: "google_review", key: reviewId } },
      data: { content: JSON.stringify(parsed) },
    })
    .catch((err) => {
      log.warn("review_update_failed", {
        reviewId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}

export async function getUnrespondedReviews(minRating = 1, maxRating = 3): Promise<StoredReview[]> {
  const rows = await prisma.brainMemory
    .findMany({
      where: { category: "google_review", deletedAt: null },
      select: { content: true },
    })
    .catch((): Array<{ content: string }> => []);

  const out: StoredReview[] = [];
  for (const row of rows) {
    const parsed = parseReview(row.content);
    if (!parsed) continue;
    if (parsed.responded) continue;
    if (parsed.rating < minRating || parsed.rating > maxRating) continue;
    out.push(parsed);
  }
  // Most recent first
  out.sort((a, b) => b.time - a.time);
  return out;
}
